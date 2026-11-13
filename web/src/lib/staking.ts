/**
 * Native-lane staking (x/staking, x/distribution, x/stakingtier). Read over REST; signed in QoreX
 * with signAndBroadcast, which adds the hybrid ML-DSA-87 signature the chain requires.
 * Qrow never holds or uses a staking key.
 */
import { useQuery } from "@tanstack/react-query";
import { msg, qorechainRegistry } from "@qorechain/sdk";
import { getQorexNative, hasCapability } from "@qorechain/qorex-types";
import { NATIVE_CHAIN_ID, REST } from "../config/network";

export const LOCK_TERMS = [
  { months: 3, label: "90 days" },
  { months: 6, label: "180 days" },
  { months: 12, label: "1 year" },
] as const;
export const UQOR = 1_000_000n; // 1 QOR = 1,000,000 uqor on the native lane

export interface Validator {
  operator: string;
  moniker: string;
  commission: number;
  tokens: bigint;
  jailed: boolean;
}
export interface Delegation {
  validator: string;
  amount: bigint; // uqor
  rewards: bigint; // uqor, whole units (floored)
}
export interface Lock {
  id: string;
  validator: string;
  amount: bigint;
  months: number;
  bonusBps: number;
  startTime: number;
  endTime: number;
  accruedBonus: bigint;
  released: boolean;
}
export interface TierParams {
  tiers: { months: number; bonusBps: number }[];
  earlyUnlockPenaltyBps: number;
  minLock: bigint;
  enabled: boolean;
  unbondingSeconds: number;
}

const get = async <T,>(path: string) => {
  const r = await fetch(`${REST}${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
  return (await r.json()) as T;
};

export async function loadValidators(): Promise<Validator[]> {
  const j = await get<{ validators: { operator_address: string; description: { moniker: string }; commission: { commission_rates: { rate: string } }; tokens: string; jailed: boolean }[] }>(
    "/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=100",
  );
  return j.validators.map((v) => ({ operator: v.operator_address, moniker: v.description.moniker, commission: Number(v.commission.commission_rates.rate), tokens: BigInt(v.tokens), jailed: v.jailed }));
}

export async function loadTierParams(): Promise<TierParams> {
  const [p, s] = await Promise.all([
    get<{ lock_tiers: { months: number; bonus_bps: number }[]; early_unlock_penalty_bps: number; min_lock_amount: string; enabled: boolean }>("/qorechain/stakingtier/v1/params"),
    get<{ params: { unbonding_time: string } }>("/cosmos/staking/v1beta1/params"),
  ]);
  return {
    tiers: p.lock_tiers.map((t) => ({ months: t.months, bonusBps: t.bonus_bps })),
    earlyUnlockPenaltyBps: p.early_unlock_penalty_bps,
    minLock: BigInt(p.min_lock_amount),
    enabled: p.enabled,
    unbondingSeconds: Number(s.params.unbonding_time.replace(/s$/, "")),
  };
}

export async function loadPosition(delegator: string) {
  const [dels, rew, locks, bank] = await Promise.all([
    get<{ delegation_responses: { delegation: { validator_address: string }; balance: { amount: string } }[] }>(`/cosmos/staking/v1beta1/delegations/${delegator}`),
    get<{ rewards: { validator_address: string; reward: { denom: string; amount: string }[] }[] }>(`/cosmos/distribution/v1beta1/delegators/${delegator}/rewards`),
    get<{ locks?: { id: string; validator: string; locked_amount: string; months: number; tier_bonus_bps: number; start_time: string; end_time: string; accrued_bonus: string; released: boolean }[]; claimable?: string }>(
      `/qorechain/stakingtier/v1/locks/${delegator}`,
    ).catch(() => ({ locks: [], claimable: "0" })),
    get<{ balances: { denom: string; amount: string }[] }>(`/cosmos/bank/v1beta1/balances/${delegator}`),
  ]);
  const rewardOf = (v: string) => {
    const coin = rew.rewards.find((r) => r.validator_address === v)?.reward.find((c) => c.denom === "uqor");
    return coin ? BigInt(coin.amount.split(".")[0]) : 0n;
  };
  const delegations: Delegation[] = dels.delegation_responses.map((d) => ({ validator: d.delegation.validator_address, amount: BigInt(d.balance.amount), rewards: rewardOf(d.delegation.validator_address) }));
  const lockList: Lock[] = (locks.locks ?? []).map((l) => ({
    id: l.id,
    validator: l.validator,
    amount: BigInt(l.locked_amount),
    months: l.months,
    bonusBps: l.tier_bonus_bps,
    startTime: Number(l.start_time),
    endTime: Number(l.end_time),
    accruedBonus: BigInt(l.accrued_bonus ?? "0"),
    released: l.released,
  }));
  const liquid = BigInt(bank.balances.find((b) => b.denom === "uqor")?.amount ?? "0");
  return { delegations, locks: lockList, claimableBonus: BigInt(locks.claimable ?? "0"), liquid };
}

export function useStaking(delegator: string | undefined) {
  const validators = useQuery({ queryKey: ["validators"], queryFn: loadValidators, staleTime: 60_000 });
  const params = useQuery({ queryKey: ["tier-params"], queryFn: loadTierParams, staleTime: 300_000 });
  const position = useQuery({ queryKey: ["stake-pos", delegator], enabled: !!delegator, refetchInterval: 20_000, queryFn: () => loadPosition(delegator!) });
  return { validators, params, position };
}

// ---------------------------------------------------------------- early unlock maths (D2)
/**
 * What an early unlock costs, from chain parameters. Base staking rewards accrue per block and stay
 * yours (pro-rata for the days actually staked); the tier bonus is forfeited; a share of the locked
 * amount is burned. Unbonding still applies afterwards.
 */
export function earlyUnlockQuote(lock: Lock, penaltyBps: number, nowSec: number) {
  const penalty = (lock.amount * BigInt(penaltyBps)) / 10_000n;
  const daysStaked = Math.max(0, Math.floor((nowSec - lock.startTime) / 86_400));
  const daysTotal = Math.round((lock.endTime - lock.startTime) / 86_400);
  return { penalty, bonusForfeited: lock.accruedBonus, keep: lock.amount - penalty, daysStaked, daysTotal };
}

// ---------------------------------------------------------------- signing in QoreX
const registry = qorechainRegistry();
type Eo = { typeUrl: string; value: unknown };

export function qorexAvailable(): boolean {
  const n = getQorexNative();
  return !!n && hasCapability(n, "signAndBroadcast");
}

export async function qorexAccount(): Promise<string | undefined> {
  const n = getQorexNative();
  if (!n) return undefined;
  await n.enable(NATIVE_CHAIN_ID);
  const k = (await n.getKey(NATIVE_CHAIN_ID)) as { bech32Address?: string };
  return k.bech32Address;
}

/** Sign and broadcast native messages in QoreX (hybrid secp256k1 + ML-DSA-87 signature). */
export async function signInQorex(messages: Eo[], memo?: string, gasLimit?: number): Promise<{ txHash: string; code: number }> {
  const n = getQorexNative();
  if (!n || !hasCapability(n, "signAndBroadcast")) throw new Error("QoreX isn’t available in this browser.");
  const r = await n.signAndBroadcast({
    chainId: NATIVE_CHAIN_ID,
    messages: messages.map((m) => ({ typeUrl: m.typeUrl, value: registry.encode(m as never) })),
    memo,
    gasLimit: gasLimit ?? 400_000 * messages.length,
  });
  if (r.code !== 0) throw new Error(`The chain refused the transaction (code ${r.code}).`);
  return r;
}

export const build = {
  delegate: (delegator: string, validator: string, uqor: bigint) => msg.staking.delegate({ delegatorAddress: delegator, validatorAddress: validator, amount: { denom: "uqor", amount: uqor.toString() } }),
  undelegate: (delegator: string, validator: string, uqor: bigint) => msg.staking.undelegate({ delegatorAddress: delegator, validatorAddress: validator, amount: { denom: "uqor", amount: uqor.toString() } }),
  withdraw: (delegator: string, validator: string) => msg.distribution.withdrawDelegatorReward({ delegatorAddress: delegator, validatorAddress: validator }),
  lock: (delegator: string, validator: string, uqor: bigint, months: number) => msg.stakingtier.lockDelegation({ delegator, validator, amount: uqor.toString(), months }),
  unlockEarly: (delegator: string, lockId: string) => msg.stakingtier.unlockEarly({ delegator, lockId }),
  claimBonus: (holder: string) => msg.stakingtier.claimBonus({ holder }),
};

// ---------------------------------------------------------------- referrals (tracking only, no payouts)
const REF_KEY = "qrow.ref";
export const REF_MEMO = (qor: string) => `qrow-ref:${qor}`;

/** Remember a ?ref= referrer from the landing link (first one wins; never your own address). */
export function captureReferral(search: string, self?: string) {
  try {
    const r = new URLSearchParams(search).get("ref");
    if (r && /^qor1[0-9a-z]{38}$/.test(r) && r !== self && !localStorage.getItem(REF_KEY)) localStorage.setItem(REF_KEY, r);
  } catch {
    /* storage unavailable */
  }
}
export function storedReferral(): string | undefined {
  try {
    return localStorage.getItem(REF_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}
