/**
 * Offline check that QrowEscrow.pqMessage() equals QoreSign's messagePqSignBytes() — the bytes
 * QoreX's planned signArbitrary signs — and that an ML-DSA-87 signature over them verifies.
 * Run: npx tsx scripts/check/pq-message-compat.ts
 */
import { messagePqSignBytes, pqKeyFromSeed, pqSign, pqVerify } from "@qorechain/qoresign";
import { randomBytes } from "node:crypto";

const digest = "0x00112233445566778899aabbccddeeff0123456789abcdef00ff10a0b0c0d0e0";
// Same constant and expected bytes as test/PqMessage.t.sol::test_MessageFormatIsQoreSign.
const solidityExpected = "qorechain-msg-v1|qorechain-diana|" + digest;

const qoresign = Buffer.from(messagePqSignBytes("qorechain-diana", digest)).toString("utf8");
const same = qoresign === solidityExpected;
console.log(`messagePqSignBytes == QrowEscrow.pqMessage: ${same}`);

const kp = pqKeyFromSeed(randomBytes(32));
const msg = messagePqSignBytes("qorechain-diana", digest);
const sig = pqSign(kp.secretKey, msg);
console.log(`signature ${sig.length} bytes, pubkey ${kp.publicKey.length} bytes`);
console.log(`pqVerify(pqMessage):            ${pqVerify(kp.publicKey, msg, sig)}  (expect true)`);
const raw = Buffer.from(digest.slice(2), "hex");
console.log(`pqVerify(raw digest, same sig): ${pqVerify(kp.publicKey, raw, sig)}  (expect false)`);
if (!same || !pqVerify(kp.publicKey, msg, sig) || pqVerify(kp.publicKey, raw, sig)) process.exitCode = 1;
