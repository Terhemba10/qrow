/**
 * Moving fest tokens between their two forms, signed in QoreX:
 * - bank coin (what the faucet pays and the AMM trades)  →  ERC-20 (what Qrow's contracts use): MsgConvertCoin
 * - ERC-20  →  bank coin: MsgConvertERC20
 * The SDK doesn't build these, so Qrow encodes them (protobuf, cosmos.evm.erc20.v1). Both proven on testnet
 * 13 Nov (docs/PLAN.md, research). Note: MsgConvertERC20's sender must be the qor1 address, not 0x.
 */
import { BinaryWriter } from "@bufbuild/protobuf/wire";
import type { Address } from "viem";
import { registry } from "./staking";

export const CONVERT_COIN = "/cosmos.evm.erc20.v1.MsgConvertCoin";
export const CONVERT_ERC20 = "/cosmos.evm.erc20.v1.MsgConvertERC20";

interface ConvertCoin {
  coin: { denom: string; amount: string };
  receiver: string; // 0x
  sender: string; // qor1
}
interface ConvertErc20 {
  contract: string; // 0x ERC-20
  amount: string;
  receiver: string; // qor1
  sender: string; // qor1 (the chain rejects 0x here)
}

const ConvertCoinType = {
  encode(m: ConvertCoin, w: BinaryWriter = new BinaryWriter()) {
    const c = w.uint32(10).fork();
    c.uint32(10).string(m.coin.denom).uint32(18).string(m.coin.amount);
    c.join();
    return w.uint32(18).string(m.receiver).uint32(26).string(m.sender);
  },
  decode(): ConvertCoin {
    throw new Error("decode not supported");
  },
  fromPartial: (m: ConvertCoin) => m,
};
const ConvertErc20Type = {
  encode(m: ConvertErc20, w: BinaryWriter = new BinaryWriter()) {
    return w.uint32(10).string(m.contract).uint32(18).string(m.amount).uint32(26).string(m.receiver).uint32(34).string(m.sender);
  },
  decode(): ConvertErc20 {
    throw new Error("decode not supported");
  },
  fromPartial: (m: ConvertErc20) => m,
};

let registered = false;
function ensureRegistered() {
  if (registered) return;
  registry.register(CONVERT_COIN, ConvertCoinType as never);
  registry.register(CONVERT_ERC20, ConvertErc20Type as never);
  registered = true;
}

/** Bank coin → ERC-20 (to use fUSD/fETH/fBTC in Qrow's contracts). */
export function toErc20Msg(qor: string, evm: Address, token: Address, amount: bigint) {
  ensureRegistered();
  return { typeUrl: CONVERT_COIN, value: { coin: { denom: `erc20:${token}`, amount: amount.toString() }, receiver: evm, sender: qor } satisfies ConvertCoin };
}

/** ERC-20 → bank coin (to swap or add liquidity with tokens a contract paid out). */
export function toBankMsg(qor: string, token: Address, amount: bigint) {
  ensureRegistered();
  return { typeUrl: CONVERT_ERC20, value: { contract: token, amount: amount.toString(), receiver: qor, sender: qor } satisfies ConvertErc20 };
}

/** Measured about 440k gas each on testnet; 600k leaves room. */
export const CONVERT_GAS = 600_000;

/** Exported for tests: the exact bytes the chain accepted. */
export const encodeConvertCoin = (m: ConvertCoin) => ConvertCoinType.encode(m).finish();
export const encodeConvertErc20 = (m: ConvertErc20) => ConvertErc20Type.encode(m).finish();
