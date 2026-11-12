/**
 * Qrow alerts watcher.
 * - Live: subscribes to QrowEscrow logs and new blocks over WebSocket (eth_subscribe), no polling
 *   of the chain for events. On start it back-fills anything missed since the last run.
 * - Clock: once a minute, checks pending payments for the day-5 reminder, the 24 h warning and an
 *   overdue refund.
 * - Failures: transactions to the escrow that reverted are decoded and the sender is told why.
 * - Telegram: /watch <address> subscribes a chat to an address's alerts (public on-chain data
 *   only). Email can be added behind the same Notifier interface.
 * Read-only: the watcher holds no keys and can't sign or move anything.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, decodeFunctionData, defineChain, formatUnits, getAddress, http, isAddress, parseAbi, webSocket, type Address, type Hex, type Log } from "viem";
import { qorToEvm } from "@qorechain/sdk";
import { clockAlerts, ESCROW, eventAlerts, type Alert, type Kind, type PaymentInfo } from "./alerts.js";

// ---------------------------------------------------------------- config
const WS = process.env.QROW_EVM_WS ?? "wss://evm-ws-testnet.qore.host";
const HTTP = process.env.QROW_EVM_HTTP ?? "https://evm-testnet.qore.host";
const REST = process.env.QROW_REST ?? "https://api-testnet.qore.host";
const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const DEPLOY_BLOCK = 9_955_775n;
const DATA = new URL("../data/", import.meta.url);

const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  "0x0000000000000000000000000000000000000000": { symbol: "QOR", decimals: 18 },
  "0x97143b771d34ddb9130b807b135ae675a5a963ca": { symbol: "fUSD", decimals: 6 },
  "0x02292293c13880a26242690eb70a0e42b8e91c28": { symbol: "fETH", decimals: 18 },
  "0x4604e7e45b2ecdbfbdc157103f5b2b62cb16451a": { symbol: "fBTC", decimals: 8 },
};

const abi = parseAbi([
  "event PaymentCreated(uint256 indexed id, address indexed sender, address indexed recipient, address token, uint256 amount, uint64 deadline, uint8 mode)",
  "event PaymentNote(uint256 indexed id, address indexed recipient, bytes sealedNote)",
  "event PaymentClaimed(uint256 indexed id, address indexed recipient, uint256 amount)",
  "event PaymentReleased(uint256 indexed id, address indexed recipient, uint256 amount)",
  "event PaymentCancelled(uint256 indexed id, address indexed sender, uint256 amount)",
  "event PaymentRefunded(uint256 indexed id, address indexed sender, uint256 amount, address indexed caller)",
  "function getPayment(uint256 id) view returns ((address sender, address recipient, address token, uint256 amount, uint64 createdAt, uint64 deadline, uint8 mode, uint8 status))",
  "function createPayment(address recipient, address token, uint256 amount, uint8 mode, bytes sealedNote, uint64 validUntil, bytes pqSig)",
  "function cancel(uint256 id, uint64 validUntil, bytes pqSig)",
  "function claim(uint256 id, uint64 validUntil, bytes pqSig)",
  "function release(uint256 id, uint64 validUntil, bytes pqSig)",
  "function refundExpired(uint256 id)",
  "error BadPqSignature()", "error SignatureExpired()", "error NoPqKey()", "error NotPending()", "error NotSender()", "error NotRecipient()",
  "error Expired()", "error NotExpired()", "error OverPaymentLimit()", "error OverDailyLimit()", "error TransferFailed()", "error InvalidRecipient()",
]);

const chain = defineChain({ id: 9800, name: "QoreChain testnet", nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 }, rpcUrls: { default: { http: [HTTP], webSocket: [WS] } } });
const httpClient = createPublicClient({ chain, transport: http(HTTP) });
const wsClient = createPublicClient({ chain, transport: webSocket(WS, { reconnect: { attempts: 1_000, delay: 2_000 }, keepAlive: true }) });

// ---------------------------------------------------------------- state (watcher/data, git-ignored)
interface State {
  subs: Record<string, string[]>; // chatId -> lowercase addresses
  lastBlock: string;
  sent: string[]; // idempotency keys, most recent last
  pending: Record<string, PaymentInfo & { createdAt: number; idStr?: string }>;
  tgOffset: number;
}
mkdirSync(DATA, { recursive: true });
const statePath = new URL("state.json", DATA);
const state: State = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"), (k, v) => (k === "id" && typeof v === "string" ? BigInt(v) : v))
  : { subs: {}, lastBlock: (DEPLOY_BLOCK - 1n).toString(), sent: [], pending: {}, tgOffset: 0 };
const save = () => writeFileSync(statePath, JSON.stringify(state, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));

// ---------------------------------------------------------------- notifier (Telegram; email fits the same interface)
interface Notifier {
  send(chatId: string, text: string): Promise<void>;
}
const telegram: Notifier = {
  async send(chatId, text) {
    if (!TOKEN) return;
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) console.log(`[telegram] send failed: HTTP ${res.status}`);
  },
};

async function deliver(alerts: Alert[]) {
  for (const a of alerts) {
    if (state.sent.includes(a.key)) continue;
    state.sent.push(a.key);
    if (state.sent.length > 5_000) state.sent.splice(0, state.sent.length - 5_000);
    const chats = Object.entries(state.subs).filter(([, addrs]) => addrs.includes(a.to.toLowerCase())).map(([c]) => c);
    for (const c of chats) await telegram.send(c, a.text);
    console.log(`[alert] ${a.kind} → ${a.role} ${a.to.slice(0, 8)}… (${chats.length} chat${chats.length === 1 ? "" : "s"})`);
  }
  save();
}

// ---------------------------------------------------------------- chain helpers
async function cosmosHash(evmHash: Hex): Promise<string | undefined> {
  try {
    const q = encodeURIComponent(`ethereum_tx.ethereumTxHash='${evmHash}'`);
    const r = await fetch(`${REST}/cosmos/tx/v1beta1/txs?query=${q}&pagination.limit=1`);
    const j = (await r.json()) as { tx_responses?: { txhash: string }[] };
    return j.tx_responses?.[0]?.txhash;
  } catch {
    return undefined;
  }
}

async function paymentInfo(id: bigint): Promise<(PaymentInfo & { createdAt: number }) | undefined> {
  try {
    const p = await httpClient.readContract({ address: ESCROW, abi, functionName: "getPayment", args: [id] });
    const t = TOKENS[p.token.toLowerCase()] ?? { symbol: `token ${p.token.slice(0, 8)}…`, decimals: 18 };
    return { id, sender: p.sender, recipient: p.recipient, amount: `${formatUnits(p.amount, t.decimals)} ${t.symbol}`, deadline: Number(p.deadline), createdAt: Number(p.createdAt) };
  } catch {
    return undefined;
  }
}

const EVENT_KIND: Record<string, Kind> = {
  PaymentCreated: "created",
  PaymentNote: "notified",
  PaymentClaimed: "claimed",
  PaymentReleased: "released",
  PaymentCancelled: "cancelled",
  PaymentRefunded: "refunded",
};

async function handleLog(log: Log & { eventName?: string; args?: { id?: bigint } }) {
  const kind = log.eventName ? EVENT_KIND[log.eventName] : undefined;
  const id = log.args?.id;
  if (!kind || id === undefined || !log.transactionHash) return;
  const info = await paymentInfo(id);
  if (!info) return;
  if (kind === "created") state.pending[id.toString()] = info;
  if (["claimed", "released", "cancelled", "refunded"].includes(kind)) delete state.pending[id.toString()];
  await deliver(eventAlerts(kind, info, log.transactionHash, await cosmosHash(log.transactionHash)));
  if (log.blockNumber && log.blockNumber > BigInt(state.lastBlock)) state.lastBlock = log.blockNumber.toString();
  save();
}

async function backfill() {
  const latest = await httpClient.getBlockNumber();
  const from = BigInt(state.lastBlock) + 1n;
  if (from > latest) return;
  const logs = await httpClient.getLogs({ address: ESCROW, events: abi.filter((x) => x.type === "event"), fromBlock: from, toBlock: latest });
  console.log(`[backfill] ${logs.length} escrow events in blocks ${from}–${latest}`);
  for (const l of logs) await handleLog(l as never);
  state.lastBlock = latest.toString();
  save();
}

/** Reverted transactions to the escrow: decode the call and the reason, tell the sender. */
async function checkBlockForFailures(blockNumber: bigint) {
  const block = await httpClient.getBlock({ blockNumber, includeTransactions: true });
  for (const tx of block.transactions) {
    if (tx.to?.toLowerCase() !== ESCROW) continue;
    const r = await httpClient.getTransactionReceipt({ hash: tx.hash });
    if (r.status !== "reverted") continue;
    let reason = "reverted";
    let id: bigint | undefined;
    try {
      const call = decodeFunctionData({ abi, data: tx.input });
      if (call.functionName !== "createPayment") id = call.args[0] as bigint;
      await httpClient.call({ account: tx.from, to: ESCROW, data: tx.input, value: tx.value, blockNumber: blockNumber - 1n });
    } catch (e) {
      const m = /reverted with the following signature[^]*?|Error: (\w+)\(\)/.exec(String(e));
      const name = (e as { cause?: { data?: { errorName?: string } } }).cause?.data?.errorName ?? m?.[1];
      if (name) reason = name;
    }
    const info = id !== undefined ? await paymentInfo(id) : undefined;
    const base: PaymentInfo = info ?? { id: id ?? 0n, sender: tx.from, recipient: tx.to ?? ESCROW, amount: "", deadline: 0 };
    await deliver(eventAlerts("failure", { ...base, sender: tx.from }, tx.hash, await cosmosHash(tx.hash), reason));
  }
}

async function clock() {
  const now = Math.floor(Date.now() / 1000);
  for (const p of Object.values(state.pending)) await deliver(clockAlerts(p, p.createdAt, now));
}

/** Staking reminder (D3): once a day, tell watchers when at least 1 QOR of rewards is ready to Claim & restake. */
async function stakingReminders() {
  const day = Math.floor(Date.now() / 86_400_000);
  const addrs = [...new Set(Object.values(state.subs).flat())];
  for (const a of addrs) {
    try {
      const { evmToQor } = await import("@qorechain/sdk");
      const qor = evmToQor(a);
      const r = (await (await fetch(`${REST}/cosmos/distribution/v1beta1/delegators/${qor}/rewards`)).json()) as { total?: { denom: string; amount: string }[] };
      const uqor = BigInt((r.total?.find((t) => t.denom === "uqor")?.amount ?? "0").split(".")[0]);
      if (uqor < 1_000_000n) continue;
      const qorAmt = formatUnits(uqor, 6);
      await deliver([{ key: `rewards:${a}:${day}`, to: a, role: "sender", kind: "reminder_day5", text: `Qrow: ${qorAmt} QOR of staking rewards is ready. Open Staking in Qrow and use Claim & restake (one QoreX signature). Nothing is restaked without you.

Testnet: these tokens have no value.` }]);
    } catch {
      /* try again next hour */
    }
  }
}

// ---------------------------------------------------------------- Telegram commands (long polling the Bot API)
function toEvm(s: string): Address | undefined {
  const t = s.trim();
  if (isAddress(t, { strict: false })) return getAddress(t);
  if (/^qor1[0-9a-z]{38}$/.test(t)) {
    try {
      return getAddress(qorToEvm(t));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

const HELP = [
  "Qrow alerts (QoreChain testnet). Commands:",
  "/watch <0x… or qor1…> : get alerts for payments to or from this address",
  "/unwatch <address> : stop alerts for it",
  "/list : addresses this chat watches",
  "/stop : remove everything",
  "Alerts only contain public on-chain data. Qrow never asks for keys or recovery codes here.",
].join("\n");

async function handleCommand(chatId: string, text: string) {
  const [cmd, arg = ""] = text.trim().split(/\s+/, 2);
  const subs = (state.subs[chatId] ??= []);
  if (cmd === "/start" || cmd === "/help") return telegram.send(chatId, HELP);
  if (cmd === "/list") return telegram.send(chatId, subs.length ? `Watching:\n${subs.join("\n")}` : "Not watching any address. Use /watch <address>.");
  if (cmd === "/stop") {
    delete state.subs[chatId];
    save();
    return telegram.send(chatId, "Stopped. No more Qrow alerts in this chat.");
  }
  if (cmd === "/watch" || cmd === "/unwatch") {
    const a = toEvm(arg);
    if (!a) return telegram.send(chatId, "That isn't a QoreChain address. Send /watch 0x… or /watch qor1…");
    const key = a.toLowerCase();
    if (cmd === "/watch") {
      if (!subs.includes(key)) subs.push(key);
      if (subs.length > 10) subs.shift();
      save();
      return telegram.send(chatId, `Watching ${a}. You'll get alerts when payments to or from it are created, claimed, cancelled, released or refunded, plus reminders.`);
    }
    state.subs[chatId] = subs.filter((x) => x !== key);
    save();
    return telegram.send(chatId, `Stopped watching ${a}.`);
  }
  return telegram.send(chatId, HELP);
}

async function pollTelegram() {
  if (!TOKEN) return console.log("[telegram] TELEGRAM_BOT_TOKEN not set: alerts are logged only");
  for (;;) {
    try {
      const r = await fetch(`https://api.telegram.org/bot${TOKEN}/getUpdates?timeout=30&offset=${state.tgOffset}`);
      const j = (await r.json()) as { ok: boolean; result?: { update_id: number; message?: { chat: { id: number }; text?: string } }[] };
      for (const u of j.result ?? []) {
        state.tgOffset = u.update_id + 1;
        if (u.message?.text) await handleCommand(String(u.message.chat.id), u.message.text.slice(0, 200));
      }
      save();
    } catch {
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
}

// ---------------------------------------------------------------- run
async function main() {
  console.log(`qrow watcher: escrow ${ESCROW}, ws ${WS}, telegram ${TOKEN ? "on" : "off"}`);
  await backfill();
  wsClient.watchContractEvent({
    address: ESCROW,
    abi,
    onLogs: (logs) => void Promise.all(logs.map((l) => handleLog(l as never))),
    onError: (e) => console.log(`[ws] ${e.message.split("\n")[0]}`),
  });
  wsClient.watchBlockNumber({
    onBlockNumber: (n) => void checkBlockForFailures(n).catch((e: Error) => console.log(`[blocks] ${e.message.split("\n")[0]}`)),
    onError: (e) => console.log(`[ws] ${e.message.split("\n")[0]}`),
  });
  setInterval(() => void clock(), 60_000);
  setInterval(() => void stakingReminders(), 3_600_000);
  void clock();
  void pollTelegram();
}

void main();
