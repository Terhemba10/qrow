import { WINDOW_GUIDE } from "../lib/action";
import { Link } from "react-router-dom";
import { QOREX_URL } from "../components/AddressChip";
import { FEEDBACK_URL } from "../config/tabs";

/** Help / Get started: optional. Tabs never require reading it. */
export function HelpPage() {
  return (
    <article className="sheet prose" aria-labelledby="help-title">
      <h1 id="help-title">Get started</h1>
      <p className="muted">Testnet only: everything here is free and has no value. Every transaction you make helps test QoreChain before Q-Day.</p>

      <h2>Three things, once</h2>
      <ol>
        <li>
          Get <a href={QOREX_URL} target="_blank" rel="noopener noreferrer">QoreX</a> (Chrome or Firefox extension, or the QoreX app: open Qrow in its dApp Browser) and press <strong>Connect QoreX</strong> at the top of Qrow.
        </li>
        <li>
          Get free test tokens on the <Link to="/faucet">Faucet</Link> tab.
        </li>
        <li>Try any tab. Each action is one confirm in Qrow and one approval in QoreX.</li>
      </ol>

      <h2 id="first-time">The first contract action</h2>
      <p>
        Sending a payment, claiming, buying or listing an NFT, or launching a coin also turns on secure contract actions for this device. It happens inside the same QoreX approval, plus a
        fingerprint, face or PIN prompt from your device. There’s nothing to write down or save.
      </p>

      <h2 id="phone">Use the same account on your phone</h2>
      <p>
        In the official <strong>QoreX</strong> app, choose <em>Restore wallet</em> and enter your recovery phrase. Only ever type it into the QoreX app itself, never into Qrow, a website, a form or a chat.{" "}
        <strong>Qrow never asks for it.</strong>
      </p>
      <p>
        Then open Qrow in the QoreX app’s dApp browser. Swaps, staking and AI top-ups work straight away. Your phone counts as a new device for contract actions (send, mint, list, trade): for your safety it
        can act after 3 days, unless the device you first used Qrow on approves it.
      </p>

      <h2 id="receipts">Receipts and verifying</h2>
      <p>
        After every transaction Qrow shows a receipt with its hash. Your receipts stay in <Link to="/portfolio">Portfolio</Link> in this browser. Press <strong>Verify on testnet</strong>, or paste any hash on the{" "}
        <Link to="/verify">Verify</Link> page, to check it against QoreChain testnet yourself.
      </p>

      <h2>If something stops you</h2>
      <h3 id="testnet">“Switch QoreX to Testnet”</h3>
      <p>In QoreX: Settings, then “Use testnet (developers)”. Qrow never switches it for you, and it works on testnet only.</p>
      <h3 id="qor">“You need free test QOR”</h3>
      <p>
        Network fees are paid in test QOR. Get it on the <Link to="/faucet">Faucet</Link> tab (once every 24 hours).
      </p>
      <h3 id="chain-key">“QoreX hasn’t registered your quantum-safe key yet”</h3>
      <p>In QoreX, send yourself 0.01 QOR once. Your first transfer registers your quantum-safe (ML-DSA-87) key on chain.</p>
      <h3 id="window">“Open Qrow’s access window in QoreX”</h3>
      <p>
        QoreChain only lets a contract action run for your account inside an <strong>EVM access window</strong> that your own quantum-safe key opened. QoreX can’t open one when a website asks yet, so you open it once
        per visit:
      </p>
      <ol className="steps">
        <li>
          In QoreX: <strong>Settings → Security → EVM access window</strong>.
        </li>
        <li>
          <strong>Duration: {WINDOW_GUIDE.blocks.toLocaleString()} blocks</strong> (the maximum QoreX allows: about 6–7 hours on testnet), <strong>Transactions: {WINDOW_GUIDE.txs}</strong>,{" "}
          <strong>Spending cap: {WINDOW_GUIDE.capQor} QOR</strong>.
        </li>
        <li>Approve, come back to Qrow and press Continue. Every Qrow action (send, mint, list, predict, trade) then works until the window ends.</li>
      </ol>
      <p>
        Why it exists: without an open window, a stolen ordinary (secp256k1) key can’t touch your account on the EVM lane. That’s QoreChain’s Q-Day protection. While a window is open, that key alone could spend
        QOR up to the cap, so keep the cap low and close the window in QoreX when you’re done. Your Qrow NFTs and fUSD still need this device’s quantum-safe signature. Swaps, staking and AI top-ups don’t need a
        window.
      </p>

      <h2>Tell us what broke</h2>
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
        <li>
          Your browser remembers a few conveniences for you only: your receipts (transaction hashes and what they did), your last draft payment, past recipients for the lookalike check, launched-coin
          names and whether you closed the welcome tip. Clear site data to remove them.
        </li>
        <li>
          This device’s Qrow key is stored encrypted in this browser and unlocks only with your passkey (fingerprint, face or PIN) where the device supports it. Qrow never shows, exports or sends it, and no code exists to lose.
        </li>
        <li>The Telegram alerts bot keeps your chat ID and the public wallet addresses you asked it to watch, until you send /unwatch or /stop.</li>
      </ul>
      <h2>What the server sees</h2>
      <ul>
        <li>Requests for prices, headlines and chain data, and, when a payment needs a warning, the check results (with addresses removed) for the plain-language summary.</li>
        <li>Your IP address briefly, only to limit abuse. It isn’t logged with what you did.</li>
      </ul>
      <h2>On chain</h2>
      <p>Everything you do on a blockchain is public: addresses, amounts and times. Payment notes are encrypted (ML-KEM-1024) so only the recipient can read them.</p>
    </article>
  );
}
