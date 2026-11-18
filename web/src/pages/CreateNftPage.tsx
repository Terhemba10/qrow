import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { qrowEditionsAbi } from "../abi/QrowEditions";
import { PqActionPanel } from "../components/PqActionPanel";
import { useConnectQorex } from "../components/QorexConnect";
import { EDITIONS } from "../config/contracts";
import { CHAIN } from "../config/network";
import { createParams, fileToDataUrl, uploadNft } from "../lib/editions";

const MAX = 3 * 1024 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export function CreateNftPage() {
  const { address, chainId, isConnected } = useAccount();
  const me = isConnected && chainId === CHAIN.id ? address : undefined;
  const { connect } = useConnectQorex();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<string>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [supply, setSupply] = useState("10");
  const [err, setErr] = useState<string>();
  const [uploading, setUploading] = useState(false);
  const [uri, setUri] = useState<string>();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!file) return setPreview(undefined);
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const copies = Number(supply);
  const valid = !!file && name.trim().length > 0 && Number.isInteger(copies) && copies >= 1 && copies <= 10_000;

  async function upload() {
    if (!file || !me) return;
    setErr(undefined);
    setUploading(true);
    try {
      const r = await uploadNft({ name: name.trim(), description: description.trim(), supply: copies, creator: me, image: await fileToDataUrl(file) });
      setUri(r.metadataUri);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="page" aria-labelledby="create-title">
      <div className="sheet__head">
        <h1 id="create-title">Create NFT</h1>
        <p className="muted">
          Upload your own artwork and mint it as an edition of 1 to 10,000 copies on QoreChain testnet. The image and its details are stored on IPFS; network fees are paid in test QOR. <strong>Testnet only:</strong> NFTs have no value.
        </p>
      </div>
      <ul className="nftkinds" aria-label="Two kinds of NFT">
        <li className="panel stack">
          <h2>Qrow Genesis</h2>
          <p className="muted">Generative art drawn on chain by Qrow: 256 in total, 1 fUSD each. You don’t upload anything.</p>
          <Link className="btn btn--quiet" to="/shop">
            Mint a Genesis NFT
          </Link>
        </li>
        <li className="panel stack nftkinds--on">
          <h2>Your own NFT</h2>
          <p className="muted">Your image, your name, 1 to 10,000 copies. Fill in the form below.</p>
        </li>
      </ul>
      {!EDITIONS && <p className="notice notice--warn">The NFT editions contract is being deployed to testnet. Creating opens here as soon as it’s live.</p>}
      {done ? (
        <div className="notice notice--ok stack">
          <p className="notice__title">Your NFT is minted.</p>
          <p>
            All {copies} {copies === 1 ? "copy is" : "copies are"} in your wallet. <Link to="/portfolio">See it in Portfolio</Link>, where you can send it or list it on the NFT Market.
          </p>
        </div>
      ) : (
        <div className="split">
          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (!me) return connect();
              if (valid && !uri) void upload();
            }}
          >
            <label className="field">
              <span>Image (PNG, JPEG, GIF or WebP, up to 3 MB)</span>
              <input
                className="input"
                type="file"
                accept={TYPES.join(",")}
                disabled={!!uri}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  setErr(undefined);
                  if (f && (!TYPES.includes(f.type) || f.size > MAX)) {
                    setFile(undefined);
                    return setErr(f.size > MAX ? "The image is over 3 MB. Pick a smaller one." : "Pick a PNG, JPEG, GIF or WebP image.");
                  }
                  setFile(f);
                }}
              />
            </label>
            <label className="field">
              <span>Name</span>
              <input className="input" value={name} maxLength={60} disabled={!!uri} onChange={(e) => setName(e.target.value)} placeholder="Desert Signal #1" />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea className="input" value={description} maxLength={500} rows={3} disabled={!!uri} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label className="field">
              <span>Copies (supply)</span>
              <input className="input" inputMode="numeric" value={supply} disabled={!!uri} onChange={(e) => setSupply(e.target.value.replace(/\D/g, ""))} />
            </label>
            {err && <p className="field-error">{err}</p>}
            {!uri && (
              <button className="btn btn--block" type="submit" disabled={!EDITIONS || (!!me && !valid) || uploading} aria-busy={uploading}>
                {!me ? "Connect QoreX to mint" : uploading ? "Uploading to IPFS…" : "Upload and review"}
              </button>
            )}
            {uri && me && EDITIONS && (
              <PqActionPanel
                sender={me}
                contract={EDITIONS}
                title={`Mint “${name.trim()}”`}
                summary={<p className="muted">Uploaded to IPFS ({uri.slice(0, 22)}…). Minting puts every copy in your wallet.</p>}
                pq={{ actionName: "ACTION_CREATE", paramsHash: createParams(uri, BigInt(copies)) }}
                build={(auth) => ({ abi: qrowEditionsAbi, functionName: "create", args: [uri, BigInt(copies), auth!.validUntil, auth!.signature] })}
                confirmLabel="Mint in QoreX"
                details={[
                  { name: "Copies", value: String(copies) },
                  { name: "Cost", value: "Network fee only, in test QOR" },
                ]}
                receipt={() => ({ kind: "NFT created", title: `Minted ${copies} × ${name.trim()}`, lines: [{ name: "Metadata", value: uri }] })}
                onDone={() => setDone(true)}
                onCancel={() => setUri(undefined)}
              />
            )}
          </form>
          <div className="panel stack" aria-live="polite">
            <h2>Preview</h2>
            {preview ? <img className="nftpreview" src={preview} alt={name ? `Preview of ${name}` : "Preview of your image"} /> : <div className="nftpreview nftpreview--empty">Your image</div>}
            <p className="nftcard__name">{name || "Untitled"}</p>
            <p className="hint">{description || "No description"}</p>
            <p className="hint fig">Edition of {copies || 0}</p>
          </div>
        </div>
      )}
    </section>
  );
}
