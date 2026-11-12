/**
 * seal.ts — QoreSeal notes for script accounts.
 *
 *   npm run seal -- status [--drill]          is an ML-KEM-1024 key registered?
 *   npm run seal -- register [--drill]        publish the account's ML-KEM-1024 key (hybrid-signed native tx)
 *   npm run seal -- read --id N [--drill]     decrypt the notice attached to escrow payment N
 *
 * Seal keys derive from the account's ML-DSA-87 secret key, exactly as web/src/lib/seal.ts does:
 *   seed = SHA-256("qrow-qoreseal-seed-v1|" || ML-DSA-87 secret key)
 * Prints only public data and the decrypted notice text.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { msg } from "@qorechain/sdk";
import { open, sealKeysFromSeed } from "@qorechain/qoreseal";
import { fetchKemKey } from "@qorechain/qoreseal/network";
import { parseAbiItem, toBytes, type Address } from "viem";
import { broadcastNative, evmClients, loadAccount, network } from "./lib.js";

const PURPOSE = "qrow-payment-notice-v1";
const args = process.argv.slice(2);
const prefix = args.includes("--drill") ? "DRILL_" : "";

const sealKeys = (pqSecret: Uint8Array) =>
  sealKeysFromSeed(new Uint8Array(createHash("sha256").update(Buffer.concat([Buffer.from("qrow-qoreseal-seed-v1|"), Buffer.from(pqSecret)])).digest()));

async function main() {
  const net = network();
  const acc = await loadAccount(prefix);
  const keys = sealKeys(acc.pqc.secretKey);
  const cmd = args[0] ?? "status";

  if (cmd === "status" || cmd === "register") {
    const k = await fetchKemKey({ rest: net.rest, address: acc.cosmos });
    const mine = k.registered && k.publicKey && Buffer.from(k.publicKey).equals(Buffer.from(keys.mlkemPublicKey));
    console.log(`account ${acc.evm}: ML-KEM key ${k.registered ? (mine ? "registered (this key)" : "registered, but NOT the Qrow-derived key") : "not registered"}`);
    if (cmd === "register" && !mine) {
      const m = msg.pqc.registerKemKey({ sender: acc.cosmos, algorithmId: 2, publicKey: keys.mlkemPublicKey });
      console.log(`registered: ${await broadcastNative(acc, "hybrid", [m])}`);
    }
    return;
  }

  if (cmd === "read") {
    const id = BigInt(args[args.indexOf("--id") + 1]);
    const escrow = (JSON.parse(readFileSync("deployments/testnet.json", "utf8")) as { QrowEscrow: Address }).QrowEscrow;
    const { publicClient: c } = evmClients(acc);
    const logs = await c.getLogs({
      address: escrow,
      event: parseAbiItem("event PaymentNote(uint256 indexed id, address indexed recipient, bytes sealedNote)"),
      args: { id },
      fromBlock: 9_955_775n,
    });
    if (!logs.length) return console.log(`payment #${id} has no note`);
    const env = logs[0].args.sealedNote!;
    console.log(`envelope: ${(env.length - 2) / 2} bytes, sha-256 ${createHash("sha256").update(toBytes(env)).digest("hex").slice(0, 16)}…`);
    const text = new TextDecoder().decode(open({ chainId: net.chainId, purpose: PURPOSE, envelope: toBytes(env), keys }));
    console.log(`decrypted: ${text}`);
    return;
  }
  throw new Error("Use: status | register | read --id N  [--drill]");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
