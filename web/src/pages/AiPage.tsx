import { evmToQor, msg } from "@qorechain/sdk";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { useConnectQorex } from "../components/QorexConnect";
import { CHAIN } from "../config/network";
import { displayAmount } from "../lib/amount";
import { qorexAccount, signInQorex } from "../lib/staking";

type Op = "chat" | "image" | "video";
const qor = (uqor: bigint | string) => displayAmount(BigInt(uqor), 6);
const LABEL: Record<Op, string> = { chat: "Chat", image: "Image", video: "Video" };

/** This browser's credit key for an account: random, never leaves the browser except to Qrow's AI route. */
function creditKey(addr: string): string {
  const k = `qrow.ai.key.${addr.toLowerCase()}`;
  try {
    const have = localStorage.getItem(k);
    if (have && /^[0-9a-f]{64}$/.test(have)) return have;
  } catch {
    /* fall through */
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(k, key);
  } catch {
    /* private mode: credits last for this visit only */
  }
  return key;
}

const sha256hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function call<T>(body: Record<string, unknown>): Promise<T & { ok: boolean; reason?: string }> {
  const r = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await r.json().catch(() => ({ ok: false, reason: `http_${r.status}` }))) as T & { ok: boolean; reason?: string };
}

const WHY: Record<string, string> = {
  not_enough_credits: "Not enough credits. Top up in QoreX first.",
  provider_not_configured: "This AI feature isn’t switched on yet on this site. Your credits were refunded.",
  provider_failed: "The AI provider failed. Your credits were refunded; try again.",
  slow_down: "Too many requests. Wait a minute.",
  bad_input: "Write a little more (at least 3 characters).",
  treasury_not_configured: "Top-ups aren’t switched on yet on this site.",
  wrong_memo: "That payment wasn’t made for this browser’s credits.",
  already_used: "That payment was already credited.",
};
const why = (r?: string) => WHY[r ?? ""] ?? `Something went wrong (${r ?? "unknown"}).`;

export function AiPage() {
  const { address, chainId, isConnected } = useAccount();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const { connect } = useConnectQorex();
  const key = me ? creditKey(me) : undefined;
  const info = useQuery({ queryKey: ["ai-info"], queryFn: () => call<{ prices: Record<Op, string>; treasury: string | null; persistent: boolean; enabled: Record<Op, boolean> }>({ op: "info" }) });
  const bal = useQuery({ queryKey: ["ai-bal", key], enabled: !!key, queryFn: () => call<{ balance: string }>({ op: "balance", key }) });
  const [balance, setBalance] = useState<bigint>();
  useEffect(() => {
    if (bal.data?.ok) setBalance(BigInt(bal.data.balance));
  }, [bal.data]);
  const [tab, setTab] = useState<Op>("chat");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [text, setText] = useState("");
  const [images, setImages] = useState<{ prompt: string; url: string }[]>([]);
  const [videos, setVideos] = useState<{ prompt: string; id: string; url?: string; status: string }[]>([]);
  const prices = info.data?.ok ? info.data.prices : undefined;
  const price = prices ? BigInt(prices[tab]) : undefined;
  const enough = balance !== undefined && price !== undefined && balance >= price;

  async function topUp(uqor: bigint) {
    if (!me || !key || !info.data?.treasury) return;
    setErr(undefined);
    setBusy("Approve the payment in QoreX…");
    try {
      const from = await qorexAccount();
      if (from !== evmToQor(me)) throw new Error("QoreX is on a different account from the one Qrow shows.");
      const memo = `qrow-ai:${(await sha256hex(key)).slice(0, 32)}`;
      const { txHash } = await signInQorex([msg.bank.send({ fromAddress: from, toAddress: info.data.treasury, amount: [{ denom: "uqor", amount: uqor.toString() }] })], memo, 200_000);
      setBusy("Waiting for the block, then adding your credits…");
      for (let i = 0; i < 30; i++) {
        const r = await call<{ balance: string }>({ op: "topup", key, hash: txHash });
        if (r.ok) {
          setBalance(BigInt(r.balance));
          return;
        }
        if (r.reason !== "not_found_yet") throw new Error(why(r.reason));
        await new Promise((res) => setTimeout(res, 2500));
      }
      throw new Error(`Paid (tx ${txHash.slice(0, 10)}…) but not confirmed yet. Reload in a minute: credits are added when it confirms.`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(/reject|denied|cancel/i.test(m) ? "You cancelled in QoreX. Nothing was sent." : m);
    } finally {
      setBusy(undefined);
    }
  }

  async function run() {
    if (!key || !text.trim()) return;
    setErr(undefined);
    const prompt = text.trim();
    setBusy(tab === "chat" ? "Thinking…" : tab === "image" ? "Drawing (about 5–20 s)…" : "Starting the video…");
    try {
      if (tab === "chat") {
        const next = [...msgs, { role: "user" as const, content: prompt }].slice(-12);
        const r = await call<{ reply: string; balance: string }>({ op: "chat", key, messages: next });
        if (!r.ok) throw new Error(why(r.reason));
        setMsgs([...next, { role: "assistant", content: r.reply }]);
        setBalance(BigInt(r.balance));
      } else if (tab === "image") {
        const r = await call<{ url: string; balance: string }>({ op: "image", key, prompt });
        if (!r.ok) throw new Error(why(r.reason));
        setImages((v) => [{ prompt, url: r.url }, ...v]);
        setBalance(BigInt(r.balance));
      } else {
        const r = await call<{ id: string; balance: string }>({ op: "video", key, prompt });
        if (!r.ok) throw new Error(why(r.reason));
        setVideos((v) => [{ prompt, id: r.id, status: "running" }, ...v]);
        setBalance(BigInt(r.balance));
      }
      setText("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }

  // Poll running videos.
  useEffect(() => {
    if (!key || !videos.some((v) => v.status === "running")) return;
    const t = window.setInterval(async () => {
      for (const v of videos.filter((x) => x.status === "running")) {
        const r = await call<{ status: string; url?: string; balance: string }>({ op: "video-status", key, id: v.id });
        if (!r.ok) continue;
        setBalance(BigInt(r.balance));
        if (r.status !== "running") setVideos((all) => all.map((x) => (x.id === v.id ? { ...x, status: r.status, url: r.url } : x)));
      }
    }, 5000);
    return () => window.clearInterval(t);
  }, [videos, key]);

  return (
    <section className="page" aria-labelledby="ai-title">
      <div className="sheet__head">
        <h1 id="ai-title">AI</h1>
        <p className="muted">
          Chat, make images and make short videos, paid with <strong>test QOR</strong> credits. You top up in QoreX; each action takes credits from your balance. Testnet only.
        </p>
      </div>

      <ul className="stats" aria-label="Price list">
        {(["chat", "image", "video"] as const).map((o) => (
          <li key={o} className="stat">
            <span className="hint">{LABEL[o]}</span>
            <strong className="fig">{prices ? `${qor(prices[o])} QOR` : "–"}</strong>
            <span className="hint">{o === "chat" ? "per message" : o === "image" ? "per image" : "per clip (about 5 s)"}</span>
          </li>
        ))}
        <li className="stat">
          <span className="hint">Your credits</span>
          <strong className="fig">{balance !== undefined ? `${qor(balance)} QOR` : me ? "…" : "–"}</strong>
          <span className="hint">in this browser</span>
        </li>
      </ul>

      {!me ? (
        <button className="btn" type="button" onClick={connect}>
          Connect QoreX
        </button>
      ) : (
        <>
          <div className="panel stack">
            <h2>Top up credits</h2>
            <p className="hint">
              A test-QOR payment to Qrow’s AI wallet{info.data?.treasury ? <> (<span className="mono">{info.data.treasury.slice(0, 10)}…{info.data.treasury.slice(-4)}</span>)</> : null}, approved in QoreX. Credits belong to this browser{info.data && !info.data.persistent ? "; this test server may reset them" : ""}. Need QOR? <Link to="/faucet">Faucet</Link>.
            </p>
            <div className="row">
              {[5n, 20n, 50n].map((n) => (
                <button key={n.toString()} className="btn btn--quiet" type="button" disabled={!!busy || !info.data?.treasury} onClick={() => void topUp(n * 1_000_000n)}>
                  Top up {n.toString()} QOR
                </button>
              ))}
            </div>
          </div>

          <div className="seg" role="radiogroup" aria-label="AI tool">
            {(["chat", "image", "video"] as const).map((o) => (
              <span key={o}>
                <input type="radio" id={`ai-${o}`} name="ai-tab" checked={tab === o} onChange={() => setTab(o)} />
                <label htmlFor={`ai-${o}`}>{LABEL[o]}</label>
              </span>
            ))}
          </div>

          {info.data?.ok && !info.data.enabled[tab] && <p className="notice notice--warn">{LABEL[tab]} isn’t switched on yet on this site (the owner adds the provider key). You won’t be charged.</p>}

          {tab === "chat" && msgs.length > 0 && (
            <ol className="chatlog" aria-live="polite">
              {msgs.map((m, i) => (
                <li key={i} className={`chatlog__msg chatlog__msg--${m.role}`}>
                  {m.content}
                </li>
              ))}
            </ol>
          )}
          {tab === "image" && images.length > 0 && (
            <ul className="nftgrid">
              {images.map((im) => (
                <li key={im.url} className="nftcard">
                  <img src={im.url} alt={im.prompt} width={240} height={240} />
                  <p className="hint">{im.prompt}</p>
                </li>
              ))}
            </ul>
          )}
          {tab === "video" && videos.length > 0 && (
            <ul className="stack">
              {videos.map((v) => (
                <li key={v.id} className="panel stack">
                  <p className="hint">{v.prompt}</p>
                  {v.status === "done" && v.url ? <video src={v.url} controls playsInline style={{ width: "100%", maxWidth: 480, borderRadius: 12 }} /> : <p>{v.status === "failed" ? "Failed: your credits were refunded." : "Rendering… (often 1–3 minutes)"}</p>}
                </li>
              ))}
            </ul>
          )}

          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (enough) void run();
            }}
          >
            <label className="field">
              <span>{tab === "chat" ? "Message" : `Describe the ${tab}`}</span>
              <textarea className="input" rows={tab === "chat" ? 2 : 3} maxLength={tab === "chat" ? 2000 : 600} value={text} onChange={(e) => setText(e.target.value)} />
            </label>
            {err && <p className="field-error">{err}</p>}
            {busy && (
              <p className="hint" role="status">
                {busy}
              </p>
            )}
            <button className="btn" type="submit" disabled={!enough || !!busy || !text.trim()} aria-busy={!!busy}>
              {enough ? `${tab === "chat" ? "Send" : "Generate"} (${prices ? qor(prices[tab]) : "…"} QOR)` : "Top up to use this"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
