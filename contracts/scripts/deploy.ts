/**
 * deploy.ts — deploy QrowEscrow to testnet (qorechain-diana) from the forge build artifact.
 *
 *   forge build
 *   pnpm window open --txs 1      (deployer; no --targets: a window with targets refuses creation)
 *   pnpm deploy:testnet
 *   pnpm window close
 *
 * Writes the address to deployments/testnet.json. The constructor takes no arguments and the
 * contract has no owner, so the deployer keeps no power over it.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { Hex } from "viem";
import { evmClients, loadAccount } from "./lib.js";

async function main() {
  const artifact = JSON.parse(readFileSync("out/QrowEscrow.sol/QrowEscrow.json", "utf8")) as {
    abi: unknown[];
    bytecode: { object: Hex };
  };
  const acc = await loadAccount();
  const { publicClient, walletClient, account } = evmClients(acc);
  console.log(`deployer: ${account.address}`);

  const hash = await walletClient.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [] });
  console.log(`tx: ${hash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error("deployment failed");
  console.log(`QrowEscrow: ${receipt.contractAddress} (block ${receipt.blockNumber})`);

  mkdirSync("deployments", { recursive: true });
  writeFileSync(
    "deployments/testnet.json",
    JSON.stringify(
      {
        chain: "qorechain-diana",
        evmChainId: 9800,
        QrowEscrow: receipt.contractAddress,
        deployTx: hash,
        block: Number(receipt.blockNumber),
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Saved deployments/testnet.json. Now: pnpm window close");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
