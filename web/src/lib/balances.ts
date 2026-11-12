import { useQuery } from "@tanstack/react-query";
import { erc20Abi, type Address } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { evmToQor } from "@qorechain/sdk";
import { REST } from "../config/network";
import type { Token } from "../config/tokens";

export type BalanceState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; evmUnits: bigint; bankUnits: bigint | undefined };

interface BankBalances {
  balances: { denom: string; amount: string }[];
}

/** Bank-lane balances (fest tokens arrive here until converted with MsgConvertCoin). */
export function useBankBalances(address: Address | undefined) {
  return useQuery({
    queryKey: ["bank", address],
    enabled: !!address,
    staleTime: 15_000,
    queryFn: async () => {
      const res = await fetch(`${REST}/cosmos/bank/v1beta1/balances/${evmToQor(address!)}`);
      if (!res.ok) throw new Error(`bank balances: HTTP ${res.status}`);
      return (await res.json()) as BankBalances;
    },
  });
}

/** What the escrow can actually pull: the EVM-side balance (native QOR or the ERC-20). */
export function useTokenBalance(address: Address | undefined, token: Token): BalanceState {
  const native = useBalance({ address, query: { enabled: !!address && !token.address } });
  const erc20 = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!token.address },
  });
  const bank = useBankBalances(address);

  const q = token.address ? erc20 : native;
  if (!address || q.isLoading) return { status: "loading" };
  if (q.isError) return { status: "error", message: "Could not read your balance from the testnet." };
  const evmUnits = token.address ? (erc20.data as bigint | undefined) ?? 0n : native.data?.value ?? 0n;
  let bankUnits: bigint | undefined;
  if (token.address && bank.data) {
    const coin = bank.data.balances.find((b) => b.denom.toLowerCase() === token.bankDenom.toLowerCase());
    bankUnits = coin ? BigInt(coin.amount) : 0n;
  }
  return { status: "ok", evmUnits, bankUnits };
}
