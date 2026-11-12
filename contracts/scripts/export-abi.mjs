// Writes web/src/abi/<Name>.ts from contracts/out after `forge build`.
import { readFileSync, writeFileSync } from "node:fs";
const names = ["QrowKeys", "QrowEscrow", "QrowGenesis", "QrowMarket", "QrowCoinFactory", "QrowCoin"];
for (const n of names) {
  const { abi } = JSON.parse(readFileSync(`out/${n}.sol/${n}.json`, "utf8"));
  const id = n[0].toLowerCase() + n.slice(1) + "Abi";
  writeFileSync(`../web/src/abi/${n}.ts`, `// Generated from contracts/out (forge build). Do not edit by hand.\nexport const ${id} = ${JSON.stringify(abi, null, 2)} as const;\n`);
  console.log(`web/src/abi/${n}.ts`);
}
