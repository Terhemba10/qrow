/**
 * Production entry on Render: the public server in this process, and the Telegram alerts watcher
 * as a child process (QROW_RUN_WATCHER=1). If the watcher crashes it restarts with backoff, so
 * alerts keep flowing; /agent/health reports its state for uptime monitoring.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import "./server.js";
import { watcherState } from "./state.js";

const WATCHER_DIR = fileURLToPath(new URL("../../watcher/", import.meta.url));
const TSX = join(WATCHER_DIR, "node_modules", "tsx", "dist", "cli.mjs");

function startWatcher(delayMs = 0) {
  setTimeout(() => {
    const child = spawn(process.execPath, [TSX, "src/main.ts"], { cwd: WATCHER_DIR, env: process.env, stdio: "inherit" });
    watcherState.running = true;
    watcherState.since = new Date().toISOString();
    child.on("exit", (code, signal) => {
      watcherState.running = false;
      watcherState.lastExit = `${new Date().toISOString()} code=${code} signal=${signal}`;
      watcherState.restarts += 1;
      const wait = Math.min(60_000, 2_000 * 2 ** Math.min(watcherState.restarts, 5));
      console.error(`[run] watcher exited (${watcherState.lastExit}); restarting in ${wait / 1000}s`);
      startWatcher(wait);
    });
  }, delayMs);
}

if (process.env.QROW_RUN_WATCHER === "1") {
  if (!process.env.TELEGRAM_BOT_TOKEN) console.error("[run] QROW_RUN_WATCHER=1 but TELEGRAM_BOT_TOKEN is not set; watcher not started");
  else {
    watcherState.enabled = true;
    startWatcher();
  }
}
