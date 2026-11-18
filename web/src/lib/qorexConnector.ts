/**
 * Qrow's QoreX wallet for RainbowKit/wagmi. Same as `@qorechain/qorex-rainbowkit`'s `qorexWallet`, except the
 * provider comes from Qrow's wider lookup (`findQorexProvider`: EIP-6963, `window.qorex.evm` without the flag,
 * `window.ethereum` / `providers[]` flagged as QoreX), looked up again on every use, so a QoreX that the mobile
 * in-app browser injects late is still found. Accounts and network are re-read on focus, because QoreX doesn't
 * emit `accountsChanged` / `chainChanged` yet.
 */
import { qorexWallet } from "@qorechain/qorex-rainbowkit";
import type { Wallet } from "@rainbow-me/rainbowkit";
import { createConnector } from "wagmi";
import { injected } from "wagmi/connectors";
import { findQorexProvider, qorexPresent } from "./qorex";

export function qrowQorexWallet(): Wallet {
  const base = qorexWallet({ pollAccountsOnFocus: true });
  return {
    ...base,
    installed: typeof window === "undefined" ? undefined : qorexPresent(),
    createConnector: (walletDetails) =>
      createConnector((config) => {
        const inner = injected({
          shimDisconnect: true,
          // An object target: wagmi then never substitutes another wallet's window.ethereum.
          target: { id: "qorex", name: "QoreX", icon: base.iconUrl as string, provider: () => findQorexProvider() as never },
        })(config);
        let stop: (() => void) | undefined;
        const watch = (c: typeof inner) => {
          stop?.();
          let last = "";
          const check = async () => {
            const p = findQorexProvider();
            if (!p) return;
            try {
              const accounts = (await p.request({ method: "eth_accounts" })) as string[];
              const key = accounts.map((a) => a.toLowerCase()).join(",");
              if (last && key !== last) c.onAccountsChanged(accounts);
              last = key;
              c.onChainChanged((await p.request({ method: "eth_chainId" })) as string);
            } catch {
              /* locked or busy: try again on the next focus */
            }
          };
          const onVis = () => document.visibilityState === "visible" && void check();
          window.addEventListener("focus", check);
          document.addEventListener("visibilitychange", onVis);
          void check();
          stop = () => {
            window.removeEventListener("focus", check);
            document.removeEventListener("visibilitychange", onVis);
          };
        };
        return {
          ...inner,
          rdns: "network.qore.qorex",
          async connect(params) {
            const r = await inner.connect.call(this, params as never);
            watch(this as typeof inner);
            return r as never;
          },
          async disconnect() {
            stop?.();
            await inner.disconnect.call(this);
          },
          ...walletDetails,
        };
      }),
  };
}
