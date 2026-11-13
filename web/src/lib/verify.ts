/**
 * Verify page: check any transaction hash or Qrow reference against the chain itself (through Qrow's
 * read-only relay), never against a Qrow database. No wallet needed.
 *
 * Inputs: a native transaction hash (64 hex, as explore.qore.network shows it), an EVM hash (0x + 64
 * hex), an explorer link, or a Qrow reference: QRW-PAY-000123 (escrow payment #123) or QRW-NFT-000045
 * (Qrow Genesis NFT #45). Swaps, transfers and other one-step actions are referred to by their hash.
 */
import { decodeFunctionData, erc20Abi, type Abi, type Address, type Hex, type PublicClient } from "viem";
import { qrowCoinFactoryAbi } from "../abi/QrowCoinFactory";
import { qrowEscrowAbi } from "../abi/QrowEscrow";
import { qrowGenesisAbi } from "../abi/QrowGenesis";
import { qrowKeysAbi } from "../abi/QrowKeys";
import { qrowMarketAbi } from "../abi/QrowMarket";
import { COIN_FACTORY, GENESIS, KEYS, MARKET } from "../config/contracts";
import { ESCROW, ESCROW_DEMO, ESCROW_REAL, REST } from "../config/network";
import { tokenByAddress } from "../config/tokens";
import { coinByDenom } from "./swap";
import { fetchTx, type ChainTx, type TxEvent } from "./tx";

// ---------------------------------------------------------------- input

export type VerifyInput =
  | { kind: "hash"; hash: string }
  | { kind: "payment"; id: bigint }
  | { kind: "nft"; id: bigint }
  | { kind: "malformed"; reason: string };

export const paymentRef = (id: bigint | number) => `QRW-PAY-${id.toString().padStart(6, "0")}`;
export const nftRef = (id: bigint | number) => `QRW-NFT-${id.toString().padStart(6, "0")}`;

export function parseVerifyInput(raw: string): VerifyInput {
  const s = raw.trim();
  if (!s) return { kind: "malformed", reason: "Paste a transaction hash or a Qrow reference." };
  const ref = /^QRW-(PAY|NFT)-(\d{1,12})$/i.exec(s);
  if (ref) return ref[1].toUpperCase() === "PAY" ? { kind: "payment", id: BigInt(ref[2]) } : { kind: "nft", id: BigInt(ref[2]) };
  if (/^QRW-/i.test(s)) return { kind: "malformed", reason: "Qrow references look like QRW-PAY-000123 (a payment) or QRW-NFT-000045 (an NFT). Swaps and transfers are checked by their transaction hash." };
  const fromLink = /\/tx\/(?:0x)?([0-9a-f]{64})(?:[/?#]|$)/i.exec(s);
  const bare = fromLink?.[1] ?? s.replace(/^0x/i, "");
  if (/^[0-9a-f]{64}$/i.test(bare)) return { kind: "hash", hash: bare.toUpperCase() };
  if (/^(0x)?[0-9a-f]+$/i.test(s)) return { kind: "malformed", reason: `A transaction hash has 64 characters (0–9, A–F); this one has ${s.replace(/^0x/i, "").length}. Check that you copied all of it.` };
  if (/^qor1|^0x[0-9a-f]{40}$/i.test(s)) return { kind: "malformed", reason: "That’s an address, not a transaction. Paste a transaction hash instead (an explorer can list an address’s transactions)." };
  return { kind: "malformed", reason: "That isn’t a transaction hash or a Qrow reference." };
}

// ---------------------------------------------------------------- Qrow contracts

const QROW_CONTRACTS: { address: Address; name: string; abi: Abi }[] = [
  { address: ESCROW_REAL, name: "Qrow escrow", abi: qrowEscrowAbi as Abi },
  { address: ESCROW_DEMO, name: "Qrow demo escrow", abi: qrowEscrowAbi as Abi },
  { address: KEYS, name: "Qrow device keys", abi: qrowKeysAbi as Abi },
  { address: GENESIS, name: "Qrow Genesis NFT", abi: qrowGenesisAbi as Abi },
  { address: MARKET, name: "Qrow NFT market", abi: qrowMarketAbi as Abi },
  { address: COIN_FACTORY, name: "Qrow coin launcher", abi: qrowCoinFactoryAbi as Abi },
];
/** Earlier Qrow versions (contracts/deployments/testnet.json), retired 12 Nov: recognised, labelled as such. */
const RETIRED: Record<string, string> = {
  "0x4ee5ca4c4d4ce7a7458a44c8eb155d7026f23db8": "Qrow device keys v2",
  "0xe51f1a2d28661bead6b0a75d3e4e2b3edff766da": "Qrow escrow v2",
  "0xc985a2bf1e87409ff63433e29d2e9a8b891a1d09": "Qrow demo escrow v2",
  "0x73fe0fb443962c1e1503f57aba3cc6e895117287": "Qrow Genesis NFT v2",
  "0xc9c9dab84f368d879aa8f96b5dbf5c22062da373": "Qrow NFT market v2",
  "0x7ff6a8a047d9558c6b152a3cffe1adea19407836": "Qrow coin launcher v2",
  "0xcf36b836872a0b277919eac1fb976722e32d824b": "Qrow escrow v1",
  "0x5005f0efa49ae70e7d785983a610c997c80d3bb4": "Qrow demo escrow v1",
  "0xb82ba02428506ad69be84ee932c844e0d99bc67f": "Qrow Genesis NFT v1",
  "0x92da580048b7cedfd6d834a0f839d38121fc347b": "Qrow NFT market v1",
  "0x3571ac216de6fd72ce8e1d9ecebf79d030142f12": "Qrow coin launcher v1",
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const qrowContract = (addr: string) => QROW_CONTRACTS.find((c) => same(c.address, addr));
export const retiredQrow = (addr: string) => RETIRED[addr.toLowerCase()];

/** Plain names for what each function does. */
const ACTION: Record<string, string> = {
  createPayment: "Create a payment",
  claim: "Claim a payment",
  release: "Release a payment",
  cancel: "Cancel",
  refundExpired: "Return an unclaimed payment",
  withdrawOwed: "Withdraw what’s owed",
  mint: "Mint an NFT",
  pqTransfer: "Transfer an NFT (quantum-safe)",
  marketMove: "Move an NFT for the market",
  list: "List an NFT for sale",
  buy: "Buy an NFT",
  launch: "Launch a coin",
  addFirstDevice: "Add the first device key",
  addApprovedDevice: "Add a device key (approved by another device)",
  proposeDevice: "Propose a device key (3-day wait)",
  finishProposal: "Finish adding a device key",
  cancelProposal: "Cancel a device-key proposal",
  removeDevice: "Remove a device key",
  approve: "Allow a contract to use a token",
  transfer: "Send a token",
  transferFrom: "Move a token",
};

export interface Arg {
  name: string;
  value: string;
}

/** Plain labels for contract arguments; unknown names are shown as they are. */
const ARG_LABEL: Record<string, string> = {
  recipient: "Recipient",
  token: "Token",
  amount: "Amount",
  mode: "Kind",
  sealedNote: "Sealed note",
  validUntil: "Signature valid until",
  deadline: "Deadline",
  pqSig: "Quantum-safe signature",
  id: "Number",
  tokenId: "NFT",
  spender: "Allowed contract",
  to: "To",
  from: "From",
  price: "Price",
};
const TIME_ARGS = new Set(["validUntil", "deadline"]);

/** Decode an EVM call to a Qrow contract or a configured token, or say what it is. */
export function describeCall(to: string, data: Hex): { contract: string; qrow: boolean; action: string; fn?: string; args: Arg[] } {
  const c = qrowContract(to);
  const token = tokenByAddress(to);
  const abi = c?.abi ?? (token ? (erc20Abi as Abi) : undefined);
  const retired = retiredQrow(to);
  const contract = c?.name ?? (retired ? `${retired} (retired; today’s Qrow uses v3)` : token ? `${token.symbol} token` : to);
  if (retired && !abi) return { contract, qrow: true, action: "Call to an earlier Qrow version", args: [] };
  if (!abi || data.length < 10) return { contract, qrow: !!c, action: data.length < 10 ? "Plain transfer" : "Contract call", args: [] };
  try {
    const d = decodeFunctionData({ abi, data });
    const item = (abi as { type: string; name?: string; inputs?: { name: string; type: string }[] }[]).find((x) => x.type === "function" && x.name === d.functionName && (x.inputs?.length ?? 0) === (d.args?.length ?? 0));
    const args = (d.args ?? []).map((v, i) => {
      const raw = item?.inputs?.[i]?.name || `arg${i}`;
      const value = TIME_ARGS.has(raw) && typeof v === "bigint" ? new Date(Number(v) * 1000).toLocaleString() : d.functionName === "createPayment" && raw === "mode" ? (v === 0 ? "Payment (recipient claims)" : "Freelance (sender releases)") : showArg(v, item?.inputs?.[i]?.type);
      return { name: ARG_LABEL[raw] ?? raw, value };
    });
    return { contract, qrow: !!c, action: ACTION[d.functionName] ?? d.functionName, fn: d.functionName, args };
  } catch {
    return { contract, qrow: !!c, action: "Contract call (unknown function)", args: [] };
  }
}

function showArg(v: unknown, type?: string): string {
  if (type === "bytes" && typeof v === "string") return v.length > 2 ? `${(v.length - 2) / 2} bytes` : "none";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 40)}…` : v;
  if (Array.isArray(v)) return `[${v.map((x) => showArg(x)).join(", ")}]`;
  return String(v);
}

// ---------------------------------------------------------------- native transactions

export interface Step {
  title: string;
  lines: Arg[];
  /** Set when a device ran this as the user (authz MsgExec). */
  asUser?: string;
  qrow: boolean;
}

export interface NativeReport {
  kind: "native";
  tx: ChainTx;
  status: "confirmed" | "failed";
  failure?: string;
  fee?: string;
  memo: string;
  signer?: string;
  quantumSafe: { algorithm: string; verified: boolean } | undefined;
  steps: Step[];
  qrow: boolean;
}

type AnyMsg = Record<string, unknown> & { "@type": string };

const coinText = (c: { denom: string; amount: string }) => {
  const known = coinByDenom(c.denom);
  if (!known) return `${c.amount} ${c.denom}`;
  const base = 10n ** BigInt(known.decimals);
  const v = BigInt(c.amount);
  const frac = (v % base).toString().padStart(known.decimals, "0").replace(/0+$/, "");
  return `${v / base}${frac ? "." + frac : ""} ${known.symbol}`;
};

const attrs = (e: TxEvent) => Object.fromEntries(e.attributes.map((a) => [a.key, a.value]));

const b64ToHex = (b: string): Hex => {
  const bin = atob(b);
  let h = "0x";
  for (let i = 0; i < bin.length; i++) h += bin.charCodeAt(i).toString(16).padStart(2, "0");
  return h as Hex;
};

const TYPE_NAMES: Record<string, string> = {
  "/cosmos.bank.v1beta1.MsgSend": "Transfer",
  "/cosmos.staking.v1beta1.MsgDelegate": "Stake",
  "/cosmos.staking.v1beta1.MsgUndelegate": "Unstake",
  "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward": "Claim staking rewards",
  "/cosmos.authz.v1beta1.MsgGrant": "Give a device permission (authz grant)",
  "/cosmos.authz.v1beta1.MsgRevoke": "Remove a device’s permission",
  "/cosmos.evm.erc20.v1.MsgConvertCoin": "Convert a coin to its ERC-20 form",
  "/cosmos.evm.erc20.v1.MsgConvertERC20": "Convert an ERC-20 back to a coin",
};

function stepFor(m: AnyMsg, i: number, events: TxEvent[], asUser?: string): Step {
  const t = m["@type"];
  const at = (type: string) => events.filter((e) => e.type === type).map(attrs).find((a) => a.msg_index === undefined || a.msg_index === String(i));
  if (t === "/qorechain.amm.v1.MsgSwapExactIn" || t === "/qorechain.amm.v1.MsgSwapExactOut") {
    const s = at("amm_swap");
    const lines: Arg[] = [{ name: "Pool", value: `#${m.pool_id as string}` }];
    if (s) lines.push({ name: "Paid", value: coinText({ denom: s.denom_in, amount: s.amount_in }) }, { name: "Received", value: coinText({ denom: s.denom_out, amount: s.amount_out }) });
    return { title: "Swap on QoreChain’s exchange", lines, asUser, qrow: false };
  }
  if (t === "/cosmos.bank.v1beta1.MsgSend") {
    const amount = (m.amount as { denom: string; amount: string }[]).map(coinText).join(", ");
    return { title: "Transfer", lines: [{ name: "From", value: m.from_address as string }, { name: "To", value: m.to_address as string }, { name: "Amount", value: amount }], asUser, qrow: false };
  }
  if (t === "/qorechain.crossvm.v1.MsgCrossVMCall") {
    const to = m.target_contract as string;
    const call = describeCall(to, b64ToHex((m.payload as string) ?? ""));
    const resp = at("crossvm_response");
    const lines: Arg[] = [{ name: "Contract", value: call.qrow ? `${call.contract} (${to})` : call.contract }, ...call.args];
    if (resp?.status && resp.status !== "executed") lines.push({ name: "Result", value: resp.status });
    return { title: call.action, lines, asUser: asUser ?? (m.sender as string), qrow: call.qrow };
  }
  if (t === "/cosmos.authz.v1beta1.MsgGrant") {
    const g = m.grant as { authorization?: { msg?: string; "@type"?: string }; expiration?: string } | undefined;
    const lines: Arg[] = [{ name: "Device", value: m.grantee as string }];
    if (g?.authorization?.msg) lines.push({ name: "May do", value: g.authorization.msg.split(".").pop() ?? g.authorization.msg });
    if (g?.expiration) lines.push({ name: "Until", value: new Date(g.expiration).toLocaleString() });
    return { title: TYPE_NAMES[t], lines, asUser, qrow: false };
  }
  if (/MsgOpenEVMWindow$/i.test(t)) {
    return { title: "Open an EVM window (a short, limited permission)", lines: Object.entries(m).filter(([k]) => k !== "@type").map(([k, v]) => ({ name: k, value: typeof v === "object" ? JSON.stringify(v) : String(v) })).slice(0, 6), asUser, qrow: false };
  }
  return { title: TYPE_NAMES[t] ?? t.split(".").pop() ?? t, lines: [], asUser, qrow: false };
}

export function describeNative(tx: ChainTx): NativeReport {
  const steps: Step[] = [];
  let device: string | undefined;
  ((tx.body?.messages ?? []) as AnyMsg[]).forEach((m, i) => {
    if (m["@type"] === "/cosmos.authz.v1beta1.MsgExec") {
      device = m.grantee as string;
      (m.msgs as AnyMsg[]).forEach((inner) => steps.push(stepFor(inner, i, tx.events)));
    } else steps.push(stepFor(m, i, tx.events));
  });
  const pq = tx.events.filter((e) => e.type === "pqc_hybrid_verify").map(attrs)[0];
  const memo = tx.body?.memo ?? "";
  return {
    kind: "native",
    tx,
    status: tx.code === 0 ? "confirmed" : "failed",
    failure: tx.code === 0 ? undefined : tx.rawLog.slice(0, 300),
    fee: tx.feeAmount?.map(coinText).join(", "),
    memo,
    signer: pq?.address ?? device,
    quantumSafe: pq ? { algorithm: pq.algorithm_id === "dilithium5" ? "ML-DSA-87 (Dilithium5)" : pq.algorithm_id, verified: pq.status === "verified" } : undefined,
    steps,
    qrow: steps.some((s) => s.qrow) || /^qrow\b/i.test(memo),
  };
}

// ---------------------------------------------------------------- EVM transactions

export interface EvmReport {
  kind: "evm";
  hash: Hex;
  status: "confirmed" | "failed" | "pending";
  from: Address;
  to?: Address;
  block?: bigint;
  time?: number;
  call?: ReturnType<typeof describeCall>;
  qrow: boolean;
}

async function fetchEvm(client: PublicClient, hash: Hex): Promise<EvmReport | undefined> {
  const tx = await client.getTransaction({ hash }).catch(() => undefined);
  if (!tx) return undefined;
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => undefined);
  const block = receipt ? await client.getBlock({ blockNumber: receipt.blockNumber }).catch(() => undefined) : undefined;
  const call = tx.to ? describeCall(tx.to, tx.input) : undefined;
  return {
    kind: "evm",
    hash,
    status: !receipt ? "pending" : receipt.status === "success" ? "confirmed" : "failed",
    from: tx.from,
    to: tx.to ?? undefined,
    block: receipt?.blockNumber,
    time: block ? Number(block.timestamp) : undefined,
    call,
    qrow: !!call?.qrow,
  };
}

// ---------------------------------------------------------------- references

export interface PaymentReport {
  kind: "payment";
  id: bigint;
  ref: string;
  escrow: Address;
  found: boolean;
  sender?: Address;
  recipient?: Address;
  token?: string;
  amount?: string;
  createdAt?: number;
  deadline?: number;
  status?: string;
}

const PAY_STATUS = ["None", "Pending", "Claimed", "Released", "Cancelled", "Refunded"];

async function fetchPayment(client: PublicClient, id: bigint): Promise<PaymentReport> {
  const ref = paymentRef(id);
  const count = (await client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "paymentCount" })) as bigint;
  if (id === 0n || id > count) return { kind: "payment", id, ref, escrow: ESCROW, found: false };
  const p = (await client.readContract({ address: ESCROW, abi: qrowEscrowAbi, functionName: "getPayment", args: [id] })) as {
    sender: Address;
    recipient: Address;
    token: Address;
    amount: bigint;
    createdAt: bigint;
    deadline: bigint;
    status: number;
  };
  const t = await tokenInfo(client, p.token);
  return {
    kind: "payment",
    id,
    ref,
    escrow: ESCROW,
    found: true,
    sender: p.sender,
    recipient: p.recipient,
    token: t ? `${t.symbol} (${p.token})` : p.token,
    amount: t ? `${units(p.amount, t.decimals)} ${t.symbol}` : `${p.amount} (raw units)`,
    createdAt: Number(p.createdAt),
    deadline: Number(p.deadline),
    status: PAY_STATUS[p.status] ?? String(p.status),
  };
}

export interface NftReport {
  kind: "nft";
  id: bigint;
  ref: string;
  found: boolean;
  owner?: Address;
  minted?: bigint;
}

async function fetchNft(client: PublicClient, id: bigint): Promise<NftReport> {
  const ref = nftRef(id);
  const minted = (await client.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "totalMinted" })) as bigint;
  const owner = (await client.readContract({ address: GENESIS, abi: qrowGenesisAbi, functionName: "ownerOf", args: [id] }).catch(() => undefined)) as Address | undefined;
  return { kind: "nft", id, ref, found: !!owner, owner, minted };
}

// ---------------------------------------------------------------- the check

export type Report =
  | NativeReport
  | EvmReport
  | PaymentReport
  | NftReport
  | { kind: "mainnet"; hash: string; height?: number }
  | { kind: "notfound"; hash: string; oldestBlock?: number }
  | { kind: "malformed"; reason: string };

async function mainnetHas(hash: string): Promise<{ found: boolean; height?: number }> {
  const r = await fetch(`${REST}/mainnet-check/${hash}`).catch(() => undefined);
  if (!r?.ok) return { found: false };
  return ((await r.json().catch(() => ({ found: false }))) as { found: boolean; height?: number }) ?? { found: false };
}

/** The node keeps recent history only: its oldest block, for a helpful "not found". */
async function oldestBlock(): Promise<number | undefined> {
  const r = await fetch(`${REST}/cosmos/base/tendermint/v1beta1/blocks/1`).catch(() => undefined);
  const j = (await r?.json().catch(() => ({}))) as { message?: string } | undefined;
  const m = j?.message?.match(/lowest height is (\d+)/);
  return m ? Number(m[1]) : undefined;
}

/** Symbol and decimals of a token: from config, else read from the token contract on chain. */
async function tokenInfo(client: PublicClient, addr: Address): Promise<{ symbol: string; decimals: number } | undefined> {
  const t = tokenByAddress(addr);
  if (t) return { symbol: t.symbol, decimals: t.decimals };
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: addr, abi: erc20Abi, functionName: "symbol" }),
      client.readContract({ address: addr, abi: erc20Abi, functionName: "decimals" }),
    ]);
    return { symbol, decimals };
  } catch {
    return undefined;
  }
}

const units = (raw: bigint, decimals: number) => {
  const base = 10n ** BigInt(decimals);
  const frac = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${raw / base}${frac ? "." + frac : ""}`;
};

/** Turn a "Token" address and raw "Amount" into "1 XLANE" (token read from chain when not in config). */
export async function withTokenNames(client: PublicClient, steps: Step[]): Promise<void> {
  for (const s of steps) {
    const tok = s.lines.find((l) => l.name === "Token" && /^0x[0-9a-fA-F]{40}$/.test(l.value));
    if (!tok) continue;
    const info = await tokenInfo(client, tok.value as Address);
    if (!info) continue;
    const amt = s.lines.find((l) => l.name === "Amount" && /^\d+$/.test(l.value));
    if (amt) amt.value = `${units(BigInt(amt.value), info.decimals)} ${info.symbol}`;
    tok.value = `${info.symbol} (${tok.value})`;
  }
}

export async function verify(input: VerifyInput, client: PublicClient): Promise<Report> {
  if (input.kind === "malformed") return input;
  if (input.kind === "payment") return fetchPayment(client, input.id);
  if (input.kind === "nft") return fetchNft(client, input.id);
  const native = await fetchTx(input.hash);
  if (native) {
    const r = describeNative(native);
    await withTokenNames(client, r.steps);
    return r;
  }
  const evm = await fetchEvm(client, `0x${input.hash.toLowerCase()}` as Hex);
  if (evm) return evm;
  const main = await mainnetHas(input.hash);
  if (main.found) return { kind: "mainnet", hash: input.hash, height: main.height };
  return { kind: "notfound", hash: input.hash, oldestBlock: await oldestBlock() };
}
