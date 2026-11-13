/**
 * One QoreX approval per contract action (UX redesign, 13 Nov; same security model as the approved
 * fallback): Qrow checks everything silently, then asks QoreX ONCE for everything QoreX must
 * authorise. On a first action that is also this device's fees and permission (x/authz). On every
 * action it is a short EVM window scoped to exactly these contracts and calls. This device (passkey)
 * then does the rest without asking QoreX again: register its own quantum-safe key, convert bank
 * tokens to ERC-20, add itself as the user's device key, approve, sign the action with ML-DSA-87,
 * simulate it, and run it as the user inside the window.
 *
 * Nothing is weakened: the window is still per action (scope, call count, 10 minutes, value cap), the
 * device key still needs the passkey, and the contracts still check the quantum-safe signature.
 */
import { buildRegisterPqcKeyMsg, evmToQor, fetchPqcStatus, msg, openEvmWindowMsg, signProofOfPossession, type UnifiedAccount } from "@qorechain/sdk";
import { encodeFunctionData, erc20Abi, keccak256, toHex, type Address, type Hex, type PublicClient } from "viem";
import { qrowKeysAbi } from "../abi/QrowKeys";
import { KEYS } from "../config/contracts";
import { NATIVE_CHAIN_ID, REST } from "../config/network";
import { DEVICE_MIN_UQOR, DEVICE_TOPUP_UQOR, deviceState, grantMsg, hasGrant, signOnKeys, withSlot, XVM_TYPE, type DeviceState } from "./appKey";
import { CONVERT_COIN, toErc20Msg } from "./convert";
import { createDeviceUnlocked, deviceInfo, unlockDevice, wipe } from "./device";
import { deviceBroadcast, deviceQor } from "./native";
import { qorexDownload } from "./qorex";
import type { PqKey } from "./pq";
import { qorexAccount, qorexAvailable, registry, signInQorex } from "./staking";
import { PER_CALL_UQOR, readWindow, runAsUser, waitForNativeTx, WINDOW_BLOCKS, windowCovers, XvmError, type Call } from "./xvm";

/** One blocker, shown alone, with one fix. */
export interface Blocker {
  id: "qorex" | "account" | "qor" | "token" | "device" | "pending" | "window" | "chainKey";
  text: string;
  fix?: { label: string; to?: string; href?: string };
}

export interface ActionPlan {
  user: Address;
  /** The Qrow contract the action calls. */
  contract: Address;
  /** An ERC-20 the contract pulls: approved for exactly this amount first. */
  approve?: { token: Address; amount: bigint; symbol: string; decimals: number };
  /** Build the final call; `auth` signs with this device's quantum-safe key (slot included). */
  build: (auth: { key: PqKey; slot: number; sign: (signature: Hex) => Hex }) => Promise<Call>;
  /** Actions anyone may call (refundExpired) need no Qrow device key; they still run through this device. */
  needsKey?: boolean;
}

/** What the silent checks found: the plan for the one QoreX approval. */
export interface Preflight {
  device: DeviceState;
  /** First contract action from this browser: set-up is folded into the same approval. */
  firstTime: boolean;
  needsGrant: boolean;
  needsTopUp: boolean;
  needsApproval: boolean;
  /** Bank-form units of the token to convert to ERC-20 first (0n if none). */
  convert: bigint;
  /** The calls the device will run as the user (window size). */
  calls: number;
  windowOpen: boolean;
  blocker?: Blocker;
}

/** "QoreX isn’t here": one line and the right download for this browser (or the QoreX app on a phone). */
export function qorexBlocker(lead: string): Blocker {
  const dl = qorexDownload();
  return { id: "qorex", text: dl.phone ? `${lead} Open Qrow inside the QoreX app’s dApp Browser.` : `${lead} Qrow connects as soon as it’s installed.`, fix: { label: dl.label, href: dl.url } };
}

/** Fees QoreX pays in the bundle, plus a margin (uqor). */
const QOREX_FEE_UQOR = 150_000n;

const bankOf = async (qor: string, denom: string): Promise<bigint> => {
  const r = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${qor}/by_denom?denom=${encodeURIComponent(denom)}`).catch(() => undefined);
  if (!r?.ok) return 0n;
  const j = (await r.json()) as { balance?: { amount?: string } };
  return BigInt(j.balance?.amount ?? "0");
};

const fmt = (units: bigint, decimals: number) => {
  const base = 10n ** BigInt(decimals);
  const frac = (units % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${units / base}${frac ? "." + frac : ""}`;
};

/** The silent checks. Returns at most one blocker: the first thing that would stop the action. */
export async function preflight(client: PublicClient, plan: ActionPlan): Promise<Preflight> {
  const base: Preflight = { device: { s: "none" }, firstTime: false, needsGrant: false, needsTopUp: false, needsApproval: false, convert: 0n, calls: 1, windowOpen: false };
  if (!qorexAvailable()) return { ...base, blocker: qorexBlocker("Contract actions are approved in QoreX.") };
  const qorexQor = await qorexAccount().catch(() => undefined);
  const userQor = evmToQor(plan.user);
  if (qorexQor !== userQor) return { ...base, blocker: { id: "account", text: "QoreX is on a different account from the one Qrow shows. Choose the same account in QoreX." } };

  const needsKey = plan.needsKey !== false;
  const [device, local, userQorBal] = await Promise.all([deviceState(client, plan.user), deviceInfo(plan.user), bankOf(userQor, "uqor")]);
  if (needsKey && device.s === "pending") return { ...base, device, blocker: { id: "pending", text: `This device is in its 3-day safety wait (ends ${new Date(device.dueAt * 1000).toLocaleString()}). Then it works with one approval.` } };
  if (needsKey && device.s === "otherDevices")
    return { ...base, device, blocker: { id: "device", text: "This account already has a Qrow key in another browser or device. Use that one, or add this browser: for your safety it can act after 3 days, and your other device can cancel it.", fix: { label: "Add this browser", to: "/help#devices" } } };

  const firstTime = needsKey && device.s === "none";
  const [grant, devBal] = local ? await Promise.all([hasGrant(userQor, local.address), deviceQor(local.address)]) : [false, 0n];
  const needsGrant = !grant;
  const needsTopUp = devBal < DEVICE_MIN_UQOR;

  let needsApproval = false;
  let convert = 0n;
  if (plan.approve) {
    const a = plan.approve;
    const [allowance, erc] = await Promise.all([
      client.readContract({ address: a.token, abi: erc20Abi, functionName: "allowance", args: [plan.user, plan.contract] }),
      client.readContract({ address: a.token, abi: erc20Abi, functionName: "balanceOf", args: [plan.user] }),
    ]);
    needsApproval = allowance < a.amount;
    if (erc < a.amount) {
      const bank = await bankOf(userQor, `erc20:${a.token}`);
      if (erc + bank < a.amount)
        return { ...base, device, firstTime, blocker: { id: "token", text: `You have ${fmt(erc + bank, a.decimals)} ${a.symbol}, less than ${fmt(a.amount, a.decimals)}.`, fix: { label: `Get free ${a.symbol}`, to: "/faucet" } } };
      convert = a.amount - erc;
    }
  }

  const calls = (firstTime ? 1 : 0) + (needsApproval ? 1 : 0) + 1;
  const need = QOREX_FEE_UQOR + (needsTopUp ? DEVICE_TOPUP_UQOR : 0n);
  if (userQorBal < need) return { ...base, device, firstTime, blocker: { id: "qor", text: `You need about ${fmt(need, 6)} free test QOR for network fees.`, fix: { label: "Get free test QOR", to: "/faucet" } } };

  const targets = windowTargets(plan, firstTime, needsApproval);
  const windowOpen = windowCovers(await readWindow(plan.user), targets, calls);
  return { device, firstTime, needsGrant, needsTopUp, needsApproval, convert, calls, windowOpen };
}

const windowTargets = (plan: ActionPlan, firstTime: boolean, needsApproval: boolean): Address[] =>
  [...new Set([...(firstTime ? [KEYS] : []), ...(needsApproval && plan.approve ? [plan.approve.token] : []), plan.contract].map((t) => t.toLowerCase() as Address))];

/**
 * What a QoreX refusal means. Careful: message type URLs contain "pqc" (/qorechain.pqc.v1.MsgOpenEVMWindow),
 * so "can't show /qorechain.pqc…" is a display refusal, not a missing key (bug found in the owner's demo run).
 */
export function qorexRefusal(text: string): "cancelled" | "no-key" | "cannot-show" | "other" {
  if (/reject|denied|cancel/i.test(text)) return "cancelled";
  if (/cannot show|can'?t show|not supported|unsupported|does not support/i.test(text)) return "cannot-show";
  if (/(pqc|quantum[- ]safe)?\s*(key|account)[^.]{0,30}not (registered|found)|no (pqc|quantum-safe) key|not registered/i.test(text)) return "no-key";
  return "other";
}

export type Phase ="qorex" | "device" | "setup" | "convert" | "sending";

/** Thrown when QoreX won't open the window from the page: the one blocker, with a manual route. */
export class WindowBlocker extends XvmError {
  readonly blocker: Blocker = {
    id: "window",
    text: "QoreX didn’t open the access window from Qrow. Open it in QoreX (Settings, Security, EVM access window), then try again.",
    fix: { label: "How to open it", to: "/help#window" },
  };
}

/**
 * Run the action: ONE QoreX approval (bundle), then the device. Returns the action's hash and the
 * hashes of the set-up steps (all shown on the receipt).
 */
export async function runAction(client: PublicClient, plan: ActionPlan, pre: Preflight, onPhase: (p: Phase) => void): Promise<{ txHash: string; steps: { label: string; hash: string }[] }> {
  const steps: { label: string; hash: string }[] = [];
  const userQor = evmToQor(plan.user);
  let device: UnifiedAccount | undefined;
  try {
    // This device (one passkey prompt: create on first use, unlock later).
    onPhase("device");
    device = (await deviceInfo(plan.user)) ? await unlockDevice(plan.user) : (await createDeviceUnlocked(plan.user)).acc;

    // 1. The one QoreX approval: fees + permission (first time), convert permission, scoped window.
    const bundle = [];
    if (pre.needsTopUp) bundle.push(msg.bank.send({ fromAddress: userQor, toAddress: device.cosmos, amount: [{ denom: "uqor", amount: DEVICE_TOPUP_UQOR.toString() }] }));
    if (pre.needsGrant) bundle.push(grantMsg(userQor, device.cosmos, XVM_TYPE, 30 * 86_400));
    if (pre.convert > 0n) bundle.push(grantMsg(userQor, device.cosmos, CONVERT_COIN, 10 * 60));
    const targets = windowTargets(plan, pre.firstTime, pre.needsApproval);
    const window = pre.windowOpen ? undefined : openEvmWindowMsg({ sender: userQor, blocks: WINDOW_BLOCKS, maxTxs: BigInt(pre.calls), maxValue: PER_CALL_UQOR * BigInt(pre.calls), allowedTargets: targets });
    if (window) bundle.push(window);
    if (bundle.length) {
      onPhase("qorex");
      let hash: string;
      try {
        hash = (await signInQorex(bundle, "Qrow", 250_000 * bundle.length + 100_000)).txHash;
      } catch (e) {
        const t = e instanceof Error ? e.message : String(e);
        const kind = qorexRefusal(t);
        if (kind === "cancelled") throw new XvmError("You cancelled in QoreX. Nothing was sent.");
        if (kind === "no-key") throw new XvmError("QoreX hasn’t registered your quantum-safe key yet. In QoreX, send yourself 0.01 QOR once, then try again.");
        // QoreX refused to show one message type (e.g. the window): send what it can, then ask for the window by hand.
        const rest = bundle.filter((m) => m !== window);
        if (window && rest.length) {
          let r: { txHash: string };
          try {
            r = await signInQorex(rest, "Qrow", 250_000 * rest.length + 100_000);
          } catch (e2) {
            const t2 = e2 instanceof Error ? e2.message : String(e2);
            if (qorexRefusal(t2) === "cancelled") throw new XvmError("You cancelled in QoreX. Nothing was sent.");
            throw new XvmError(`QoreX can’t approve Qrow’s contract permission yet, so this action can’t run from Qrow today. Swaps and staking work. (QoreX said: ${t2.slice(0, 120)})`);
          }
          await waitForNativeTx(r.txHash);
          steps.push({ label: "QoreX: device fees and permission", hash: r.txHash });
        }
        throw new WindowBlocker("window");
      }
      await waitForNativeTx(hash);
      steps.push({ label: pre.firstTime ? "QoreX: set up this device and open the window" : "QoreX: open the window", hash });
      if (window && !windowCovers(await readWindow(plan.user), targets, pre.calls)) throw new WindowBlocker("window");
    }

    // 2. The device, without asking QoreX again.
    let slot = pre.device.s === "ready" ? pre.device.slot : -1;
    if (pre.firstTime) {
      onPhase("setup");
      const status = await fetchPqcStatus({ rest: REST, address: device.cosmos } as never).catch(() => undefined);
      if (!(status as { registered?: boolean } | undefined)?.registered) {
        const proofOfPossession = signProofOfPossession({ chainId: NATIVE_CHAIN_ID, account: device.cosmos, keypair: device.pqc });
        steps.push({ label: "This device registers its quantum-safe key", hash: (await deviceBroadcast(device, [buildRegisterPqcKeyMsg(device.cosmos, { pqcKeypair: device.pqc, proofOfPossession })], 600_000, "classical")).txHash });
      }
      const publicKey = toHex(device.pqc.publicKey);
      const { validUntil, signature } = await signOnKeys(client, device.pqc, plan.user, keccak256(publicKey));
      const data = encodeFunctionData({ abi: qrowKeysAbi, functionName: "addFirstDevice", args: [publicKey, validUntil, signature] });
      steps.push({ label: "Your device key is added to Qrow", hash: (await runAsUser(client, plan.user, device, [{ to: KEYS, data }])).txHash });
      const st = await deviceState(client, plan.user);
      if (st.s !== "ready") throw new XvmError("This device’s key didn’t register. Try again in a moment.");
      slot = st.slot;
    }
    if (pre.convert > 0n && plan.approve) {
      onPhase("convert");
      const inner = toErc20Msg(userQor, plan.user, plan.approve.token, pre.convert);
      const exec = msg.authz.exec({ grantee: device.cosmos, msgs: [{ typeUrl: inner.typeUrl, value: registry.encode(inner as never) }] });
      steps.push({ label: `Convert ${fmt(pre.convert, plan.approve.decimals)} ${plan.approve.symbol} to its contract form`, hash: (await deviceBroadcast(device, [exec], 750_000)).txHash });
    }
    if (pre.needsApproval && plan.approve) {
      onPhase("sending");
      const data = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [plan.contract, plan.approve.amount] });
      steps.push({ label: `Allow exactly ${fmt(plan.approve.amount, plan.approve.decimals)} ${plan.approve.symbol} for this action`, hash: (await runAsUser(client, plan.user, device, [{ to: plan.approve.token, data }])).txHash });
    }

    // 3. Sign, simulate, send.
    onPhase("sending");
    const call = await plan.build({ key: device.pqc, slot, sign: (s) => withSlot(slot, s) });
    await client.call({ account: plan.user, to: call.to, data: call.data }); // simulation: throws with the contract's reason
    const r = await runAsUser(client, plan.user, device, [call]);
    return { txHash: r.txHash, steps };
  } finally {
    if (device) wipe(device);
  }
}
