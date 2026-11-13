/**
 * Shared helpers for the Qrow testnet scripts. Adapted from the create-qorechain-dapp
 * `foundry` template's window.ts (Apache-2.0, QoreChain Association).
 *
 * Secrets come from .env only and are never printed.
 */
import { StargateClient } from "@cosmjs/stargate";
import {
  EthNativeSigner,
  deriveUnifiedAccount,
  getNetwork,
  isValidRecoveryCode,
  pqcKeyFromRecoveryCode,
  unifiedAccountFromSeed,
  type UnifiedAccount,
} from "@qorechain/sdk";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const qorechainDiana = defineChain({
  id: 9800,
  name: "QoreChain Diana (testnet)",
  nativeCurrency: { name: "QOR", symbol: "QOR", decimals: 18 },
  rpcUrls: { default: { http: [process.env.QORE_EVM_RPC_URL?.trim() || "https://evm-testnet.qore.host"] } },
  testnet: true,
});

export function network() {
  const name = (process.env.QORE_NETWORK ?? "testnet").trim();
  if (name !== "testnet") throw new Error("Qrow scripts run on testnet (qorechain-diana) only.");
  const n = getNetwork("testnet");
  return {
    chainId: n.chainId,
    rest: process.env.QORE_REST_URL?.trim() || n.endpoints.rest,
    rpc: process.env.QORE_RPC_URL?.trim() || n.endpoints.rpc,
  };
}

/** Load an account from a given env prefix ("" = deployer, e.g. "DRILL_" for the drill account). */
export async function loadAccount(prefix = ""): Promise<UnifiedAccount> {
  const acc = await loadAccountInner(prefix);
  prefixes.set(acc, prefix);
  return acc;
}

const prefixes = new WeakMap<UnifiedAccount, string>();

/** Env name of an account's Qrow app-key recovery code (QRC1), kept only in .env. */
export const appKeyEnv = (prefix: string) => `${prefix}QROW_APP_KEY_CODE`;

/**
 * The ML-DSA-87 secret key that signs Qrow contract actions: the account's Qrow app key if
 * ${prefix}QROW_APP_KEY_CODE is set (registered in QrowKeys), else its chain-registered key.
 */
export function contractSecretKey(acc: UnifiedAccount): Uint8Array {
  const code = process.env[appKeyEnv(prefixes.get(acc) ?? "")]?.trim();
  if (!code) return acc.pqc.secretKey;
  if (!isValidRecoveryCode(code)) throw new Error("QROW_APP_KEY_CODE is not a valid QRC1 code");
  return pqcKeyFromRecoveryCode(code, acc.cosmos).secretKey;
}

async function loadAccountInner(prefix: string): Promise<UnifiedAccount> {
  const mnemonic = process.env[`${prefix}QORE_MNEMONIC`]?.trim();
  if (mnemonic) return deriveUnifiedAccount(mnemonic, 0);
  const key = process.env[`${prefix}PRIVATE_KEY`]?.trim();
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(`Set ${prefix}QORE_MNEMONIC, or ${prefix}PRIVATE_KEY (0x + 64 hex) in .env`);
  }
  const recoveryCode = process.env[`${prefix}QORE_PQC_RECOVERY_CODE`]?.trim();
  if (!recoveryCode) throw new Error(`Set ${prefix}QORE_PQC_RECOVERY_CODE in .env (needed with a private key)`);
  if (!isValidRecoveryCode(recoveryCode)) throw new Error(`${prefix}QORE_PQC_RECOVERY_CODE is not a valid QRC1 code`);
  return unifiedAccountFromSeed(Uint8Array.from(Buffer.from(key.slice(2), "hex")), { recoveryCode });
}

export async function accountSequence(rest: string, address: string) {
  const res = await fetch(`${rest}/cosmos/auth/v1beta1/accounts/${address}`);
  if (res.status === 404) throw new Error(`${address} does not exist on chain yet: fund it from the faucet first`);
  if (!res.ok) throw new Error(`account query failed: HTTP ${res.status}`);
  const body = (await res.json()) as { account?: Record<string, unknown> };
  const acc = (body.account?.base_account ?? body.account ?? {}) as Record<string, string>;
  return { accountNumber: BigInt(acc.account_number ?? "0"), sequence: BigInt(acc.sequence ?? "0") };
}

const FEE = { amount: [{ denom: "uqor", amount: "100000" }], gas: "800000" };

/** Sign (hybrid secp256k1 + ML-DSA-87, or classical for first key registration) and broadcast. */
export async function broadcastNative(
  acc: UnifiedAccount,
  mode: "hybrid" | "classical",
  messages: Parameters<EthNativeSigner["sign"]>[0]["messages"],
  memo?: string,
  gas?: number,
): Promise<string> {
  const net = network();
  const { accountNumber, sequence } = await accountSequence(net.rest, acc.cosmos);
  const signer = new EthNativeSigner(acc, { signMode: mode, rest: net.rest });
  const transport = await StargateClient.connect(net.rpc);
  try {
    const res = await signer.signAndBroadcast(transport, {
      chainId: net.chainId,
      accountNumber,
      sequence,
      // The chain minimum is 0.1 uqor per gas and the whole limit is charged, so callers size it closely.
      fee: gas
        ? { amount: [{ denom: "uqor", amount: String(Math.ceil(gas / 10)) }], gas: String(gas) }
        : messages.length > 1
          ? { amount: [{ denom: "uqor", amount: String(100_000 * messages.length) }], gas: String(800_000 * messages.length) }
          : FEE,
      messages,
      ...(memo ? { memo } : {}),
    });
    return res.transactionHash;
  } finally {
    transport.disconnect();
  }
}

export function evmClients(acc: UnifiedAccount) {
  const account = privateKeyToAccount(acc.privateKey as `0x${string}`);
  const transport = http();
  return {
    account,
    publicClient: createPublicClient({ chain: qorechainDiana, transport }),
    walletClient: createWalletClient({ account, chain: qorechainDiana, transport }),
  };
}

export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Set ${name} in .env`);
  return v;
}
