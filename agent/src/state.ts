/** Shared process state for /agent/health (set by run.ts when the watcher runs alongside). */
export const watcherState: { enabled: boolean; running: boolean; restarts: number; since?: string; lastExit?: string } = {
  enabled: false,
  running: false,
  restarts: 0,
};
