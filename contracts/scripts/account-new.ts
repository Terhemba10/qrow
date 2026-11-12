/**
 * account-new.ts — create a FRESH Ethereum-style (eth_secp256k1) testnet account for Qrow.
 *
 *   npm run account:new -- --prefix DRILL_      the Q-Day Drill account
 *   npm run account:new -- --prefix ""          the deployer
 *   npm run account:new -- --prefix TEST_A_     a manual-test sender
 *
 * It generates a random private key plus a separate PQC recovery code (QRC1) and APPENDS both to
 * .env (git-ignored). Secrets are never printed: only the public addresses are shown. It refuses to
 * overwrite an existing entry.
 *
 * Why two secrets: the private key is the classical ECDSA key (the Drill hands it to the attacker);
 * the recovery code derives the ML-DSA-87 key that QrowEscrow checks. Keep them apart.
 * Then: fund the qor1 address from the faucet, and run `npm run window register` (with the same prefix).
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { generatePqcRecoveryCode, unifiedAccountFromSeed } from "@qorechain/sdk";
import { generatePrivateKey } from "viem/accounts";

const args = process.argv.slice(2);
const i = args.indexOf("--prefix");
const prefix = i === -1 ? "" : (args[i + 1] ?? "");
if (!/^[A-Z0-9_]*$/.test(prefix)) throw new Error("--prefix must be upper-case letters, digits and _");

const env = existsSync(".env") ? readFileSync(".env", "utf8") : "";
for (const k of [`${prefix}PRIVATE_KEY`, `${prefix}QORE_PQC_RECOVERY_CODE`, `${prefix}QORE_MNEMONIC`]) {
  if (new RegExp(`^${k}=.+`, "m").test(env)) throw new Error(`${k} is already set in .env; refusing to overwrite`);
}

const privateKey = generatePrivateKey();
const recoveryCode = generatePqcRecoveryCode();
const acc = unifiedAccountFromSeed(Uint8Array.from(Buffer.from(privateKey.slice(2), "hex")), { recoveryCode });

appendFileSync(
  ".env",
  `${env.endsWith("\n") || env === "" ? "" : "\n"}# --- ${prefix || "DEPLOYER_"} account, created ${new Date().toISOString()} (testnet only)\n` +
    `${prefix}PRIVATE_KEY=${privateKey}\n${prefix}QORE_PQC_RECOVERY_CODE=${recoveryCode}\n`,
);

console.log(`Created ${prefix || "deployer"} account (secrets written to .env, not shown):`);
console.log(`  EVM:    ${acc.evm}`);
console.log(`  native: ${acc.cosmos}`);
console.log("Next: fund the native address at dashboard.qorechain.io/faucet, then");
console.log(`  npm run window -- register${prefix === "DRILL_" ? " --drill" : ""}`);
