import { Link } from "react-router-dom";
import { FAUCET_URL, QOREX_URL } from "../components/Readiness";
import { FEEDBACK_URL } from "../config/tabs";

export function HowToTestPage() {
  return (
    <article className="sheet prose" aria-labelledby="htt-title">
      <h1 id="htt-title">How to test Qrow</h1>
      <p className="muted">About 15 minutes. Testnet only: everything here is free and has no value.</p>
      <p>Try every feature with free test QOR. Every transaction you make helps test and improve QoreChain before Q-Day.</p>

      <h2>1. Wallets</h2>
      <ol>
        <li>
          Install <a href={QOREX_URL} target="_blank" rel="noopener noreferrer">QoreX</a> (Chrome or Firefox extension; on a phone, the QoreX app). In QoreX: Settings, then “Use testnet (developers)”.
        </li>
        <li>
          Install MetaMask and create a <strong>new, testnet-only</strong> wallet. QoreX doesn’t send EVM transactions yet, so payments are signed in MetaMask; this is QoreChain’s own setup.
        </li>
        <li>Restore that MetaMask recovery phrase into QoreX, so both wallets hold the same account. Never use a wallet that holds real funds.</li>
        <li>Add QoreChain testnet to MetaMask (chain ID 9800) and connect it to Qrow.</li>
      </ol>

      <h2>2. Test tokens and your keys</h2>
      <ol>
        <li>
          Get free test QOR from the <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer">QoreChain faucet</a> (once every 24 hours).
        </li>
        <li>In QoreX, send yourself 0.01 QOR. Your first transfer registers your quantum-safe key on chain.</li>
        <li>
          On Qrow’s <Link to="/">Start</Link> page, create your <strong>Qrow key</strong> and save its recovery code. You type that code when you sign in Qrow. It is not your 24 words; Qrow never asks for those.
        </li>
      </ol>

      <h2>3. Send and receive</h2>
      <ol>
        <li>
          <Link to="/send">Send</Link> 1 QOR to a friend (or to a second account of yours). Qrow checks the address first and explains anything risky.
        </li>
        <li>Each signed step opens a short EVM window in QoreX (about 10 minutes, only for Qrow’s contract), then MetaMask confirms the transaction.</li>
        <li>
          Your friend opens <Link to="/receive">Receive</Link> and claims it. If nobody claims it within 7 days, anyone can return it to you.
        </li>
        <li>Optional: get Telegram alerts by sending <span className="mono">/watch your-address</span> to @qrow_alerts_bot.</li>
      </ol>

      <h2>4. Tell us what broke</h2>
      <p>
        Use <a href={FEEDBACK_URL} target="_blank" rel="noopener noreferrer">Report a problem</a>. Say what you tried and what happened; no personal details needed.
      </p>

      <h2>About Qrow</h2>
      <p>Built in Doha, Qatar, Middle East, by one developer for QoreChain’s Build Before Q-Day Developer Fest. Qrow is an independent community project, not made by QoreChain.</p>
    </article>
  );
}

export function PrivacyPage() {
  return (
    <article className="sheet prose" aria-labelledby="priv-title">
      <h1 id="priv-title">Privacy and testnet</h1>
      <h2>Testnet only</h2>
      <p>Qrow runs on QoreChain testnet (qorechain-diana, chain ID 9800). Its tokens are free and have no value. Never send real funds, and use a wallet that holds none.</p>
      <h2>What Qrow stores</h2>
      <ul>
        <li>No accounts, no cookies, no tracking, no analytics scripts.</li>
        <li>Your browser remembers a few conveniences for you only (your last draft payment, past recipients for the lookalike check, launched-coin names). Clear site data to remove them.</li>
        <li>
          Your Qrow key recovery code is never stored or sent anywhere. It stays in this tab’s memory while you sign, then it’s wiped.
        </li>
        <li>The Telegram alerts bot keeps your chat ID and the public wallet addresses you asked it to watch, until you send /unwatch or /stop.</li>
      </ul>
      <h2>What the server sees</h2>
      <ul>
        <li>Requests for prices, headlines and chain data, and, when you review a payment, the check results (with addresses removed) for the plain-language summary.</li>
        <li>Your IP address briefly, only to limit abuse. It isn’t logged with what you did.</li>
      </ul>
      <h2>On chain</h2>
      <p>Everything you do on a blockchain is public: addresses, amounts and times. Payment notes are encrypted (ML-KEM-1024) so only the recipient can read them.</p>
    </article>
  );
}
