// Writes Cloudflare Pages' _headers and _redirects into dist/ after `vite build`.
// The CSP allows the browser to talk only to Qrow's own API (VITE_API_BASE) and QoreChain.
import { writeFileSync } from "node:fs";

const api = (process.env.VITE_API_BASE ?? "").replace(/\/$/, "");
if (api && !/^https:\/\/[a-z0-9.-]+$/.test(api)) throw new Error(`VITE_API_BASE must be an https origin, got "${api}"`);
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://api.fontshare.com https://fonts.googleapis.com",
  "font-src 'self' https://cdn.fontshare.com https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${api} https://*.qore.host wss://*.qore.host https://*.walletconnect.com wss://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org`.replace(/  +/g, " "),
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

writeFileSync(
  "dist/_headers",
  `/*
  Content-Security-Policy: ${csp}
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()
  Cross-Origin-Opener-Policy: same-origin
  Strict-Transport-Security: max-age=31536000

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`,
);
// Client-side routes (/send, /launch, ...) all load the app.
writeFileSync("dist/_redirects", "/*  /index.html  200\n");
console.log(`pages files written (API ${api || "same origin"})`);
