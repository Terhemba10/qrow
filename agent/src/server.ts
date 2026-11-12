/**
 * Qrow agent server (local). One endpoint:
 *   POST /explain  { token, amount, mode, checks[] }  ->  { ok, text } or { ok: false, reason }
 *   GET  /health
 * Binds to 127.0.0.1 only. The web app reaches it through the Vite proxy at /agent.
 * Logs timings and token usage, never request contents or keys.
 */
import { createServer } from "node:http";
import { MODEL, explain, hasCredentials, parseRequest } from "./explain.js";

const PORT = Number(process.env.QROW_AGENT_PORT ?? 8787);
const MAX_BODY = 16 * 1024;

const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true, model: MODEL, ai: hasCredentials() });
  if (req.method !== "POST" || req.url !== "/explain") return send(404, { ok: false, reason: "not_found" });

  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) return send(413, { ok: false, reason: "too_large" });
    chunks.push(c as Buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return send(400, { ok: false, reason: "bad_json" });
  }
  const input = parseRequest(parsed);
  if (!input) return send(400, { ok: false, reason: "bad_request" });

  const result = await explain(input);
  console.log(
    `[explain] ${result.ok ? "ok" : result.reason} ${result.ms}ms` +
      (result.ok ? ` in=${result.usage.input} cacheRead=${result.usage.cacheRead} cacheWrite=${result.usage.cacheWrite} out=${result.usage.output}` : ""),
  );
  send(200, result);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`qrow agent on http://127.0.0.1:${PORT} (model ${MODEL}, AI ${hasCredentials() ? "on" : "off: no ANTHROPIC_API_KEY"})`);
});
