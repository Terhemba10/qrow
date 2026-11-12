import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useConnect } from "wagmi";

/** Dev only: connect the read-only watch wallet (see wagmi.ts). Absent from production builds. */
function DevWatchButton() {
  const { connectors, connect } = useConnect();
  const { isConnected } = useAccount();
  const watch = connectors.find((c) => c.id === "mock");
  if (!import.meta.env.DEV || !watch || isConnected) return null;
  return (
    <button className="btn btn--quiet" type="button" onClick={() => connect({ connector: watch })}>
      Watch address (dev)
    </button>
  );
}

/** RainbowKit's connect flow, drawn with Qrow's own controls. */
export function WalletButton() {
  return (
    <>
      <DevWatchButton />
      <WalletButtonInner />
    </>
  );
}

function WalletButtonInner() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        if (!ready) {
          return (
            <button className="btn btn--quiet" type="button" disabled aria-busy="true">
              Loading wallet
            </button>
          );
        }
        if (!account || !chain) {
          return (
            <button className="btn" type="button" onClick={openConnectModal}>
              Connect wallet
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button className="btn btn--quiet" type="button" onClick={openChainModal}>
              Wrong network
            </button>
          );
        }
        return (
          <button
            className="btn btn--quiet mono"
            type="button"
            onClick={openAccountModal}
            aria-label={`Connected as ${account.address}. Open account menu`}
          >
            {account.displayName}
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
