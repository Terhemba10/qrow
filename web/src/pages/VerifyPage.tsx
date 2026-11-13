import { useQuery } from "@tanstack/react-query";
import { useId, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { usePublicClient } from "wagmi";
import { IconAlert, IconCheck, IconInfo } from "../components/Icons";
import { TxHash } from "../components/TxHash";
import { CHAIN, IS_DEMO } from "../config/network";
import { EXPLORER_NOTE, EXPLORER_TX } from "../lib/tx";
import { parseVerifyInput, verify, type Arg, type Report } from "../lib/verify";

const dateTime = (sec: number) => new Date(sec * 1000).toLocaleString();

function Facts({ rows }: { rows: (Arg | false | "" | 0 | undefined)[] }) {
  return (
    <dl className="facts">
      {rows.filter((r): r is Arg => !!r).map((r) => (
        <div key={r.name}>
          <dt>{r.name}</dt>
          <dd className="fig verify__value">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Verdict({ tone, title, children }: { tone: "ok" | "warn" | "danger" | "info"; title: string; children?: React.ReactNode }) {
  return (
    <div className={`notice ${tone === "info" ? "" : `notice--${tone}`}`} role="status">
      <p className="notice__title">
        {tone === "ok" ? <IconCheck /> : tone === "info" ? <IconInfo /> : <IconAlert />} {title}
      </p>
      {children}
    </div>
  );
}

function ReportView({ r }: { r: Report }) {
  switch (r.kind) {
    case "malformed":
      return <Verdict tone="warn" title="Can’t check that">{<p>{r.reason}</p>}</Verdict>;
    case "mainnet":
      return (
        <Verdict tone="warn" title="This is a QoreChain mainnet transaction">
          <p>
            It’s on mainnet{r.height ? ` (block ${r.height.toLocaleString()})` : ""}, not the testnet. Qrow runs on the testnet only, so this isn’t a Qrow transaction. Never send real funds to anyone who says it is.
          </p>
        </Verdict>
      );
    case "notfound":
      return (
        <Verdict tone="warn" title="Not found">
          <p>
            No transaction with this hash on QoreChain testnet or mainnet. Check you copied all of it. If it was just sent, wait a few seconds and check again.
            {r.oldestBlock ? ` The testnet node keeps recent history only (from block ${r.oldestBlock.toLocaleString()}), so a much older transaction can’t be read here.` : ""}
          </p>
        </Verdict>
      );
    case "native":
      return (
        <div className="stack">
          {r.status === "failed" ? (
            <Verdict tone="danger" title="This transaction failed">
              <p>It’s on chain but did nothing (fees are still charged). The chain said: {r.failure}</p>
            </Verdict>
          ) : r.qrow ? (
            <Verdict tone="ok" title="Confirmed: a Qrow transaction on QoreChain testnet" />
          ) : (
            <Verdict tone="info" title="Confirmed on QoreChain testnet, but not made through Qrow">
              <p>It’s a valid testnet transaction. It doesn’t touch a Qrow contract or carry Qrow’s note.</p>
            </Verdict>
          )}
          <TxHash hash={r.tx.hash} status={r.status} height={r.tx.height} time={r.tx.time} verifyLink={false} />
          <Facts
            rows={[
              r.signer && { name: "Signed by", value: r.signer },
              {
                name: "Quantum-safe",
                value: r.quantumSafe ? `${r.quantumSafe.algorithm} hybrid signature, ${r.quantumSafe.verified ? "verified by the chain" : "not verified"}` : "No: classical signature only",
              },
              r.fee && { name: "Network fee", value: r.fee },
              { name: "Gas used", value: r.tx.gasUsed.toLocaleString() },
              r.memo && { name: "Note", value: r.memo },
            ]}
          />
          {r.steps.map((s, i) => (
            <section key={i} className="panel stack verify__step" aria-label={`Step ${i + 1}`}>
              <h3>
                {r.steps.length > 1 && `${i + 1}. `}
                {s.title}
              </h3>
              <Facts rows={[s.asUser && { name: "As account", value: s.asUser }, ...s.lines]} />
            </section>
          ))}
        </div>
      );
    case "evm":
      return (
        <div className="stack">
          {r.status === "failed" ? (
            <Verdict tone="danger" title="This EVM transaction failed" />
          ) : r.status === "pending" ? (
            <Verdict tone="info" title="Sent, not in a block yet" />
          ) : (
            <Verdict tone={r.qrow ? "ok" : "info"} title={r.qrow ? "Confirmed: a Qrow transaction (EVM)" : "Confirmed on QoreChain testnet (EVM), not a Qrow contract"} />
          )}
          <Facts
            rows={[
              { name: "Hash", value: r.hash },
              r.block !== undefined && { name: "Block", value: r.block.toLocaleString() },
              r.time && { name: "Time", value: dateTime(r.time) },
              { name: "From", value: r.from },
              r.to && { name: "To", value: r.call?.qrow ? `${r.call.contract} (${r.to})` : r.to },
              r.call && { name: "Action", value: r.call.action },
              ...(r.call?.args ?? []),
              { name: "Quantum-safe", value: "Not at the transaction level: EVM transactions carry a classical signature. Qrow contract actions also check an ML-DSA signature inside the call." },
            ]}
          />
          <p className="hint">
            <a href={EXPLORER_TX(r.hash)} target="_blank" rel="noopener noreferrer">
              View on explorer
            </a>
            . {EXPLORER_NOTE}
          </p>
        </div>
      );
    case "payment":
      if (!r.found) return <Verdict tone="warn" title={`${r.ref} doesn’t exist`}>{<p>There’s no payment with this number in the Qrow escrow{IS_DEMO ? " (demo escrow)" : ""} yet.</p>}</Verdict>;
      return (
        <div className="stack">
          <Verdict tone="ok" title={`${r.ref}: a real Qrow payment, read from the escrow contract`} />
          <Facts
            rows={[
              { name: "Status", value: r.status! },
              { name: "Amount", value: r.amount! },
              { name: "Token", value: r.token! },
              { name: "From", value: r.sender! },
              { name: "To", value: r.recipient! },
              { name: "Created", value: dateTime(r.createdAt!) },
              { name: r.status === "Pending" ? "Returnable after" : "Deadline", value: dateTime(r.deadline!) },
              { name: "Escrow contract", value: r.escrow },
            ]}
          />
          <p className="hint">These details come from the contract’s state right now. Each step (create, claim, return) has its own transaction hash, which the people involved see in Qrow and can check here.</p>
        </div>
      );
    case "nft":
      if (!r.found) return <Verdict tone="warn" title={`${r.ref} doesn’t exist`}>{<p>Qrow Genesis has {r.minted?.toString() ?? "…"} NFTs so far; there’s no #{r.id.toString()}.</p>}</Verdict>;
      return (
        <div className="stack">
          <Verdict tone="ok" title={`${r.ref}: a real Qrow Genesis NFT`} />
          <Facts rows={[{ name: "Owner", value: r.owner! }, { name: "Minted so far", value: r.minted!.toString() }]} />
        </div>
      );
  }
}

/** Verify page: paste a hash or a Qrow reference; everything is read from the chain. No wallet needed. */
export function VerifyPage() {
  const id = useId();
  const [params, setParams] = useSearchParams();
  const asked = params.get("q") ?? "";
  const [text, setText] = useState(asked);
  const client = usePublicClient({ chainId: CHAIN.id });
  const input = parseVerifyInput(asked);
  const result = useQuery({
    queryKey: ["verify", asked],
    enabled: asked.trim() !== "" && !!client,
    staleTime: 10_000,
    retry: 1,
    queryFn: () => verify(input, client!),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    setParams(q ? { q } : {});
    if (q === asked) void result.refetch();
  };

  return (
    <section className="page" aria-labelledby="verify-title">
      <div className="sheet__head">
        <h1 id="verify-title">Verify a transaction</h1>
        <p className="muted">Check any transaction hash or Qrow reference against QoreChain itself. No wallet needed.</p>
      </div>

      <form className="panel stack" onSubmit={submit} role="search">
        <div className="field">
          <label htmlFor={id}>Transaction hash or Qrow reference</label>
          <input
            id={id}
            className="input input--mono"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="4A676D5F… or QRW-PAY-000002"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${id}-hint`}
          />
          <p className="hint" id={`${id}-hint`}>
            A hash from Qrow or the explorer (with or without 0x), an explorer link, or a reference like QRW-PAY-000002 (payment) or QRW-NFT-000001 (NFT).
          </p>
        </div>
        <button className="btn" type="submit" disabled={!text.trim() || result.isFetching}>
          {result.isFetching ? "Checking…" : "Verify"}
        </button>
      </form>

      <div className="verify__result" aria-live="polite">
        {result.isError && (
          <Verdict tone="warn" title="Couldn’t reach the chain">
            <p>The check didn’t finish ({(result.error as Error).message}). Try again in a moment.</p>
          </Verdict>
        )}
        {result.data && <ReportView r={result.data} />}
      </div>
    </section>
  );
}
