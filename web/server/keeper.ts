/**
 * One keeper pass over QrowPerps (testnet only): read every open position, then run executeTpSl for any whose
 * take profit or stop loss is hit and liquidate any that can be liquidated. Anyone may call those two functions;
 * this is Qrow's own keeper, from its own keeper wallet (never the deployer, never a user).
 *
 * /api/keeper calls this once per request; a free external timer (cron-job.org) calls /api/keeper every minute.
 * Prices come from getPrices() and are signed with PRICE_SIGNER_KEY exactly like /api/price, so the keeper and
 * the Trade tab always see the same price. Secrets are read from env and never logged.
 */
import { StargateClient } from "@cosmjs/stargate";
import { EthNativeSigner, getNetwork, isValidRecoveryCode, openEvmWindowMsg, unifiedAccountFromSeed, type UnifiedAccount } from "@qorechain/sdk";
import { createPublicClient, createWalletClient, defineChain, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { qrowPerpsAbi } from "../src/abi/QrowPerps.js";
import { getPrices, PAIRS, pairId, signReport, type Pair } from "./price.js";

const chain = defineChain({
  id: 9800,
  name: "QoreChain Diana (testnet)",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [process.env.QORE_EVM_RPC_URL?.trim() || "https://evm-testnet.qore.host"] } },
  testnet: true,
});
const NET = getNetwork("testnet");
const REST = process.env.QORE_REST_URL?.trim() || NET.endpoints.rest;
const RPC = process.env.QORE_RPC_URL?.trim() || NET.endpoints.rpc;

export interface KeeperConfig {
  perps: Address;
  priceKey: Hex;
  account: UnifiedAccount;
}

/** Reads the keeper's settings from env; a list of what's missing (names only) if it can't run. */
export function keeperConfig(env = process.env): { ok: true; config: KeeperConfig } | { ok: false; missing: string[] } {
  const perps = env.QROW_PERPS_ADDRESS?.trim();
  const priceKey = env.PRICE_SIGNER_KEY?.trim();
  const key = env.KEEPER_PRIVATE_KEY?.trim();
  const code = env.KEEPER_QORE_PQC_RECOVERY_CODE?.trim();
  const missing = [
    !perps || !/^0x[0-9a-fA-F]{40}$/.test(perps) ? "QROW_PERPS_ADDRESS" : "",
    !priceKey || !/^0x[0-9a-fA-F]{64}$/.test(priceKey) ? "PRICE_SIGNER_KEY" : "",
    !key || !/^0x[0-9a-fA-F]{64}$/.test(key) ? "KEEPER_PRIVATE_KEY" : "",
    !code || !isValidRecoveryCode(code) ? "KEEPER_QORE_PQC_RECOVERY_CODE" : "",
  ].filter(Boolean);
  if (missing.length) return { ok: false, missing };
  const account = unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key!.slice(2), "hex")), { recoveryCode: code! });
  return { ok: true, config: { perps: perps as Address, priceKey: priceKey as Hex, account } };
}

/** Opens the keeper's own EVM window (perps only, QoreX's maximum length) when none covers the next send. */
async function ensureWindow(acc: UnifiedAccount, perps: Address, log: (s: string) => void) {
  const st = (await (await fetch(`${REST}/qorechain/pqc/v1/evm_window/${acc.cosmos}`)).json()) as { live?: boolean; remaining_txs?: string; remaining_blocks?: string };
  if (st.live && Number(st.remaining_txs) > 0 && Number(st.remaining_blocks) > 30) return;
  log("opening the keeper's EVM window (perps only)");
  const res = await fetch(`${REST}/cosmos/auth/v1beta1/accounts/${acc.cosmos}`);
  if (!res.ok) throw new Error(`keeper account not found on chain (HTTP ${res.status}): fund it first`);
  const body = (await res.json()) as { account?: Record<string, unknown> };
  const a = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  const signer = new EthNativeSigner(acc, { signMode: "hybrid", rest: REST });
  const transport = await StargateClient.connect(RPC);
  try {
    await signer.signAndBroadcast(transport, {
      chainId: NET.chainId,
      accountNumber: BigInt(a.account_number ?? "0"),
      sequence: BigInt(a.sequence ?? "0"),
      fee: { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" },
      messages: [openEvmWindowMsg({ sender: acc.cosmos, blocks: 17_280n, maxTxs: 200n, maxValue: 20_000_000n, allowedTargets: [perps] })],
    });
  } finally {
    transport.disconnect();
  }
  await new Promise((r) => setTimeout(r, 8000));
}

export interface PassResult {
  open: number;
  withTpSl: number;
  actions: { id: string; pair: Pair; action: "take profit" | "stop loss" | "liquidated"; status: string; tx: Hex }[];
  prices: Record<Pair, string>;
}

export async function keeperPass({ perps, priceKey, account: acc }: KeeperConfig, log: (s: string) => void = console.log): Promise<PassResult> {
  const account = privateKeyToAccount(acc.privateKey as Hex);
  const transport = http();
  const c = createPublicClient({ chain, transport });
  const w = createWalletClient({ account, chain, transport });
  const pairOf = new Map(PAIRS.map((p) => [pairId(p).toLowerCase(), p]));
  const [count, px] = await Promise.all([c.readContract({ address: perps, abi: qrowPerpsAbi, functionName: "positionCount" }), getPrices()]);
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
  const positions: { id: bigint; open: boolean; pair: Hex }[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const batch = await Promise.all(ids.slice(i, i + 20).map(async (id) => ({ id, ...((await c.readContract({ address: perps, abi: qrowPerpsAbi, functionName: "getPosition", args: [id] })) as { open: boolean; pair: Hex }) })));
    positions.push(...batch.filter((p) => p.open));
  }
  const out: PassResult = { open: 0, withTpSl: 0, actions: [], prices: Object.fromEntries(PAIRS.map((p) => [p, px.prices[p].toString()])) as Record<Pair, string> };
  for (const p of positions) {
    const pair = pairOf.get(p.pair.toLowerCase());
    if (!pair) continue;
    out.open++;
    const price = px.prices[pair];
    const [t, reason] = await Promise.all([
      c.readContract({ address: perps, abi: qrowPerpsAbi, functionName: "getTpSl", args: [p.id] }) as Promise<{ takeProfit: bigint; stopLoss: bigint }>,
      c.readContract({ address: perps, abi: qrowPerpsAbi, functionName: "tpSlTriggered", args: [p.id, price] }) as Promise<number>,
    ]);
    if (t.takeProfit || t.stopLoss) out.withTpSl++;
    const s = await signReport(pair, price, perps, priceKey);
    const report = { pair: s.pair, price: BigInt(s.price), timestamp: BigInt(s.timestamp), signature: s.signature };
    let fn: "executeTpSl" | "liquidate" | undefined = reason ? "executeTpSl" : undefined;
    if (!fn) {
      try {
        await c.simulateContract({ address: perps, abi: qrowPerpsAbi, functionName: "liquidate", args: [p.id, report], account });
        fn = "liquidate";
      } catch {
        /* not liquidatable */
      }
    }
    if (!fn) continue;
    await ensureWindow(acc, perps, log);
    const nonce = await c.getTransactionCount({ address: account.address, blockTag: "pending" });
    const hash = await w.writeContract({ address: perps, abi: qrowPerpsAbi, functionName: fn, args: [p.id, report], nonce, account, chain });
    const rc = await c.waitForTransactionReceipt({ hash, timeout: 60_000 });
    const action = fn === "liquidate" ? "liquidated" : reason === 3 ? "take profit" : "stop loss";
    out.actions.push({ id: p.id.toString(), pair, action, status: rc.status, tx: hash });
    log(`#${p.id} ${pair} ${action} at ${Number(price) / 1e8}: ${rc.status} (tx ${hash})`);
  }
  const fmt = (n: number) => (n >= 1 ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : n.toPrecision(3));
  log(
    `checked: ${out.open} open position${out.open === 1 ? "" : "s"} (${out.withTpSl} with TP/SL), ${out.actions.length ? `${out.actions.length} triggered` : "nothing to trigger"}. Prices: ${PAIRS.map((p) => `${p} ${fmt(Number(px.prices[p]) / 1e8)}`).join(", ")}`,
  );
  return out;
}
