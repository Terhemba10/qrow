/**
 * stake.ts — native-lane staking for script accounts, same SDK messages as the web Staking tab
 * (which signs them in QoreX). Hybrid-signed (secp256k1 + ML-DSA-87).
 *
 *   npm run stake -- status [--drill]
 *   npm run stake -- delegate --validator qorvaloper1… --amount 1 [--memo qrow-ref:qor1…]
 *   npm run stake -- restake                      claim every reward and stake it again (one tx)
 *   npm run stake -- lock --validator … --amount 10 --months 3|6|12
 *   npm run stake -- unlock --lock 7              early unlock (burns the chain's penalty)
 */
import { msg } from "@qorechain/sdk";
import { broadcastNative, loadAccount, network } from "./lib.js";

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? undefined : args[i + 1];
};
const uqor = (qor: string) => BigInt(Math.round(Number(qor) * 1e6)).toString();

async function main() {
  const acc = await loadAccount(args.includes("--drill") ? "DRILL_" : "");
  const me = acc.cosmos;
  const rest = network().rest;
  const get = async <T,>(p: string) => (await (await fetch(`${rest}${p}`)).json()) as T;
  const cmd = args[0] ?? "status";

  if (cmd === "status") {
    const [d, r, l] = await Promise.all([
      get<{ delegation_responses: { delegation: { validator_address: string }; balance: { amount: string } }[] }>(`/cosmos/staking/v1beta1/delegations/${me}`),
      get<{ total: { denom: string; amount: string }[] }>(`/cosmos/distribution/v1beta1/delegators/${me}/rewards`),
      get<{ locks?: unknown[] }>(`/qorechain/stakingtier/v1/locks/${me}`),
    ]);
    console.log(`${me}: ${d.delegation_responses.map((x) => `${x.balance.amount} uqor → ${x.delegation.validator_address.slice(0, 18)}…`).join(", ") || "no delegations"}`);
    console.log(`rewards: ${r.total.find((t) => t.denom === "uqor")?.amount ?? "0"} uqor; locks: ${l.locks?.length ?? 0}`);
    return;
  }

  let messages: { typeUrl: string; value: unknown }[] = [];
  let memo: string | undefined;
  if (cmd === "delegate") {
    messages = [msg.staking.delegate({ delegatorAddress: me, validatorAddress: flag("validator")!, amount: { denom: "uqor", amount: uqor(flag("amount")!) } })];
    memo = flag("memo");
  } else if (cmd === "restake") {
    const r = await get<{ rewards: { validator_address: string; reward: { denom: string; amount: string }[] }[] }>(`/cosmos/distribution/v1beta1/delegators/${me}/rewards`);
    for (const x of r.rewards) {
      const amt = (x.reward.find((c) => c.denom === "uqor")?.amount ?? "0").split(".")[0];
      if (BigInt(amt) === 0n) continue;
      messages.push(msg.distribution.withdrawDelegatorReward({ delegatorAddress: me, validatorAddress: x.validator_address }));
      messages.push(msg.staking.delegate({ delegatorAddress: me, validatorAddress: x.validator_address, amount: { denom: "uqor", amount: amt } }));
      console.log(`claim & restake ${amt} uqor with ${x.validator_address.slice(0, 18)}…`);
    }
    if (!messages.length) return console.log("no rewards to restake yet");
  } else if (cmd === "lock") {
    messages = [msg.stakingtier.lockDelegation({ delegator: me, validator: flag("validator")!, amount: uqor(flag("amount")!), months: Number(flag("months")) })];
  } else if (cmd === "unlock") {
    messages = [msg.stakingtier.unlockEarly({ delegator: me, lockId: flag("lock")! })];
  } else {
    throw new Error("Use: status | delegate | restake | lock | unlock");
  }
  const hash = await broadcastNative(acc, "hybrid", messages as never, memo);
  console.log(`${cmd}: ${hash}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
