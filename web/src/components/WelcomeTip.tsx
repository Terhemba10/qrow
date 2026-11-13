import { useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";

const KEY = "qrow.welcomeTip.v1";
const seen = () => {
  try {
    return localStorage.getItem(KEY) === "closed";
  } catch {
    return false;
  }
};

/** First visit only: one dismissible tip that follows where the visitor is. Never shown again once closed. */
export function WelcomeTip() {
  const { isConnected } = useAccount();
  const [open, setOpen] = useState(() => !seen());
  if (!open) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "closed");
    } catch {
      /* storage blocked: closes for this visit */
    }
    setOpen(false);
  };
  return (
    <aside className="welcome" aria-label="Welcome">
      <p>
        {isConnected ? "You’re connected. Next: get free test tokens on the " : "Welcome! Connect QoreX, get free test tokens on the "}
        <Link to="/faucet" onClick={close}>
          Faucet
        </Link>
        , then try any tab.
      </p>
      <button className="btn btn--quiet" type="button" onClick={close} aria-label="Close the welcome tip">
        Got it
      </button>
    </aside>
  );
}
