// Registration data the browser cannot read, asked by the Worker.
//
// Two things keep a suffix out of the browser: no RDAP in IANA's bootstrap at all (.cn, .jp, .ru, .hk), or RDAP that
// sends no CORS header (.de). The Worker can read both — it has no CORS rules and it can open a TCP socket to the
// registry's port-43 WHOIS server — so /whois asks the registry on the visitor's behalf. This is the one kind of query
// that passes through 1ms.dog's server, and the page says so wherever it shows the answer.
//
// What this module returns is what the registry itself publishes, registrant included: registrar, dates, status flags,
// name servers, DNSSEC state, and the registrant's name or company, e-mail and phone when the registry has them. A
// registry that withholds them (DENIC under GDPR, a privacy service) simply has no such field, and none is invented.
// The registry's own reply is passed along as raw text so a field this parser misses is still there to read.
import { RDAP_BASE, normalize, tldOf } from "./rdap.mjs";

// The registries we ask over port 43, measured from Cloudflare's network (docs/decisions.md). No guessing: a suffix
// without an entry here and without RDAP is "we cannot ask", never "there is nothing".
export const WHOIS_SERVERS = {
  cn: { host: "whois.cnnic.cn", suffix: "" },
  jp: { host: "whois.jprs.jp", suffix: "/e" },     // /e asks JPRS for its English output
  ru: { host: "whois.tcinet.ru", suffix: "" },
  hk: { host: "whois.hkirc.hk", suffix: "" },
};
// Registries whose RDAP does exist but cannot be read from a browser (no CORS). The Worker reads it as plain JSON.
export const SERVER_RDAP = {
  de: "https://rdap.denic.de/domain/",
};
// Known to answer nothing on port 43 from anywhere we have tried; the page keeps its link to the registry instead.
export const QUIET_TLDS = ["vn"];

export const MAX_BYTES = 40960;
export const TIMEOUT_MS = 8000;
const IDLE_MS = 1500;
// The raw reply is for reading, not for shipping unbounded: registries send a few kilobytes, and the page shows it in
// an expandable block.
const RAW_MAX = 16000;
export const clipRaw = s => { const t = String(s || "").replace(/\s+$/, ""); return t.length > RAW_MAX ? t.slice(0, RAW_MAX) + "\n…" : t; };

// A domain the page would accept: ASCII labels only (the page hands over punycode), at least two labels.
const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
export function validDomain(d) {
  const s = String(d || "").trim().toLowerCase().replace(/\.+$/, "");
  return s.length > 0 && s.length <= 253 && DOMAIN_RE.test(s) ? s : null;
}

// "No match!!", "No matching record.", "No entries found…", "The domain has not been registered."
const NOT_FOUND = /no match|no matching record|no entries found|not found|does not exist|no data found|no such domain|has not been registered/i;

const NS_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+\.?$/i;

// "2003-03-17 12:20:05", "2001/02/02", "16-11-2035" (HKDNR writes day first), "1997-09-23T09:00:00Z" → ISO-ish text the
// page's date formatter reads. Anything else is passed through as the registry wrote it.
export function isoDate(value) {
  const s = String(value || "").trim();
  if (!s) return null;
  let m = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?)?/.exec(s);
  if (m) return m[1] + "-" + m[2] + "-" + m[3] + (m[4] ? "T" + m[4] : "");
  m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (m) return m[3] + "-" + m[2] + "-" + m[1];
  return s;
}

// One registry's WHOIS text → the same fields RDAP gives, or null when the reply carries none of them.
// Key lines look like "Key: value", "[Key]   value" or "Name Servers Information:" followed by bare host names.
export function parseWhois(text) {
  const fields = new Map();
  const add = (key, value) => {
    if (!fields.has(key)) fields.set(key, []);
    if (value) fields.get(key).push(value);
  };
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    let key = null, value = "";
    const br = /^\[([^\]]{1,40})\]\s*(.*)$/.exec(line);
    if (br) { key = br[1]; value = br[2].trim(); }
    else {
      // HKDNR puts a hundred-character explanation inside some key names ("Company English Name (It should be …)")
      const kv = /^([A-Za-z][A-Za-z0-9 ._\-/()]{1,200}?)\s*:\s*(.*)$/.exec(line);
      if (kv) { key = kv[1]; value = kv[2].trim(); }
    }
    if (!key) continue;
    const raw = key.toLowerCase().replace(/\s+/g, " ").trim();
    const k = raw.replace(/\s*\(.*$/, "").trim();
    if (value) { add(k, value); continue; }
    // A key whose value is on the line below ("DNSSEC:" then an indented "signedDelegation")
    if (!/name servers?$/.test(k) && k !== "name servers information") {
      const next = (lines[i + 1] || "").trim();
      if (next && !/^\[?[A-Za-z][^:]{1,200}:\s*/.test(next)) { add(k, next); continue; }
    }
    add(k, "");
    // HKIRC lists the name servers as bare host names under an empty "Name Servers Information:" line
    if (/name servers?$/.test(k) || k === "name servers information") {
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j].trim();
        if (!l) { if (fields.get(k).length > 1) break; continue; }
        if (l.endsWith(":") || /^[A-Za-z][A-Za-z0-9 ._\-/()]{1,40}:/.test(l)) break;
        if (NS_RE.test(l)) fields.get(k).push(l.replace(/\.+$/, ""));
        i = j;
      }
    }
  }
  const pick = (...keys) => {
    for (const key of keys) {
      const v = (fields.get(key) || []).filter(Boolean);
      if (v.length) return v;
    }
    return [];
  };
  const first = (...keys) => pick(...keys)[0] || null;
  const status = pick("domain status", "status", "state")
    .flatMap(v => String(v).split(","))
    .map(s => s.trim())
    .filter(s => s && s.length <= 60 && !/^https?:/i.test(s));
  const nameservers = pick("name server", "name servers", "name servers information", "nserver", "域名服务器")
    .map(s => s.replace(/\.+$/, "").toLowerCase())
    .filter(s => NS_RE.test(s));
  // The registrant side, as the registry publishes it: .cn and .jp name it outright, .ru writes org/person. Values are
  // kept as written — no masking, no rewriting — and a registry that leaves them out gets no field here.
  const joined = (...keys) => [...new Set(pick(...keys).map(s => String(s).trim()).filter(Boolean))].join(", ") || null;
  const out = {
    registrar: first("registrar", "sponsoring registrar", "registrar name"),
    created: isoDate(first("registration time", "created on", "created", "registration date", "registered on", "registered", "domain name commencement date")),
    expires: isoDate(first("expiration time", "expires on", "expiry date", "expiration date", "paid-till", "registry expiry date")),
    updated: isoDate(first("last updated", "last update", "updated", "last modified", "modified")),
    status: [...new Set(status)].slice(0, 8),
    nameservers: [...new Set(nameservers)].slice(0, 12),
    registrant: first("registrant", "registrant name", "registrant contact name", "person", "company chinese name"),
    registrantOrg: first("registrant organization", "registrant organisation", "registrant company", "org", "organization", "organisation", "company english name"),
    email: joined("registrant contact email", "registrant email", "registrant e-mail", "email", "e-mail"),
    phone: joined("registrant phone", "registrant phone number", "registrant telephone", "phone", "telephone", "phone number"),
    dnssec: first("dnssec", "dnssec status", "dns-sec"),
  };
  const any = out.registrar || out.created || out.expires || out.updated || out.status.length || out.nameservers.length
    || out.registrant || out.registrantOrg || out.email || out.phone;
  return any ? out : null;
}

// Ask one registry's port-43 server. Resolves to its text, or null when there was no socket, no answer or no time.
export async function queryWhois(domain, server, { connect, timeout = TIMEOUT_MS, maxBytes = MAX_BYTES } = {}) {
  if (typeof connect !== "function") return null;
  let socket;
  // connect may hand back a socket or a promise for one (the Worker imports the sockets module lazily)
  try { socket = await connect(server.host, 43); } catch (e) { return null; }
  if (!socket) return null;
  let timer = null;
  const expired = new Promise(resolve => { timer = setTimeout(() => resolve(null), timeout); });
  const read = (async () => {
    if (socket.opened) await socket.opened;
    const writer = socket.writable.getWriter();
    await writer.write(new TextEncoder().encode(domain + server.suffix + "\r\n"));
    try { writer.releaseLock(); } catch (e) {}
    const reader = socket.readable.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: false });
    let text = "", size = 0, idleTimer = null;
    // cancel() rejects when the stream has already ended; a socket stand-in may not have it at all
    const stop = () => { try { const p = reader.cancel && reader.cancel(); if (p && p.catch) p.catch(() => {}); } catch (e) {} };
    for (;;) {
      // Some registries close the connection when the record is done; CNNIC leaves it open, so a quiet second after
      // the last chunk also counts as the end.
      const chunk = await Promise.race([reader.read(), new Promise(r => { idleTimer = setTimeout(() => r(null), IDLE_MS); })]);
      clearTimeout(idleTimer);
      if (!chunk || chunk.done) { stop(); break; }
      size += chunk.value.byteLength;
      text += decoder.decode(chunk.value, { stream: true });
      if (size >= maxBytes) { stop(); break; }
    }
    return text + decoder.decode();
  })().catch(() => null);
  const text = await Promise.race([read, expired]);
  clearTimeout(timer);
  try { socket.close(); } catch (e) {}
  return text;
}

async function rdapAsk(domain, { fetchImpl, signal }) {
  const tld = tldOf(domain);
  const base = SERVER_RDAP[tld] || RDAP_BASE;
  const res = await fetchImpl(base + encodeURIComponent(domain), {
    signal, redirect: "follow", credentials: "omit",
    headers: { accept: "application/rdap+json, application/json" },
  });
  if (res.status === 404) {
    const body = await res.text().catch(() => "");
    // rdap.org's 404 is about the suffix; a registry's own 404 is about the domain.
    if (base === RDAP_BASE && /no rdap service/i.test(body)) return { noService: true };
    return { notFound: true };
  }
  if (!res.ok) return { error: "http" };
  let json;
  try { json = await res.json(); } catch (e) { return { error: "bad" }; }
  const data = normalize(json);
  data.raw = clipRaw(JSON.stringify(json, null, 2));
  return { data };
}

// The whole answer for /whois: IANA-bootstrap RDAP (or the registry's own RDAP) first, port-43 WHOIS second.
// { ok: true, src: "rdap" | "whois", ...fields } or { ok: false, reason: "notfound" | "no-service" | "timeout" | "error" }.
export async function lookupRegistration(domain, { fetchImpl = fetch, connect, timeout = TIMEOUT_MS } = {}) {
  const d = validDomain(domain);
  if (!d) return { ok: false, reason: "bad-domain" };
  const tld = tldOf(d);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let rdap = null;
  try { rdap = await rdapAsk(d, { fetchImpl, signal: ctl.signal }); }
  catch (e) { rdap = { error: e && e.name === "AbortError" ? "timeout" : "network" }; }
  finally { clearTimeout(timer); }
  if (rdap.data) return { ok: true, src: "rdap", tld, ...rdap.data };
  if (rdap.notFound) return { ok: false, src: "rdap", reason: "notfound", tld };

  const server = WHOIS_SERVERS[tld];
  if (server) {
    const text = await queryWhois(d, server, { connect, timeout });
    if (text == null) return { ok: false, reason: "timeout", tld };
    if (NOT_FOUND.test(text)) return { ok: false, src: "whois", reason: "notfound", tld };
    const data = parseWhois(text);
    // The registry's own reply goes along with the parsed fields, so a field this parser misses is still readable.
    if (data) return { ok: true, src: "whois", tld, ...data, raw: clipRaw(text) };
    // A reply that names the domain but has no fields at all (JPRS does this for a held example domain) is the
    // registry answering with nothing, not a broken lookup.
    if (text.toLowerCase().includes(d)) return { ok: false, src: "whois", reason: "notfound", tld };
    return { ok: false, reason: "error", tld };
  }
  if (rdap.error === "timeout") return { ok: false, reason: "timeout", tld };
  if (QUIET_TLDS.indexOf(tld) >= 0) return { ok: false, reason: "no-service", tld };
  return { ok: false, reason: rdap.noService ? "no-service" : "error", tld };
}
