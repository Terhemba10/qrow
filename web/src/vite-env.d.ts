/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_QROW_ESCROW?: string;
  readonly VITE_API_BASE?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  /** Dev only: address for the read-only watch connector. */
  readonly VITE_DEV_WATCH_ADDRESS?: string;
}
