// DNS messages for DoH (RFC 8484): build a query, encode it for ?dns=, read the answer.
//
// Written here rather than pulled from a library: the page needs a query for a handful of record types and a parser
// for their answers, and that is about this file. It is shared by the page, the Worker (it only decodes shared
// results, never queries) and the tests.
//
// Supported answer types: A, NS, CNAME, SOA, PTR, MX, TXT, AAAA, SRV, CAA. Anything else in an answer is ignored (a
// resolver that adds RRSIG or OPT records does not confuse the rest).

export const TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, CAA: 257 };
export const TYPE_NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]));
export const RCODE = { NOERROR: 0, FORMERR: 1, SERVFAIL: 2, NXDOMAIN: 3, NOTIMP: 4, REFUSED: 5 };
export const RCODE_NAME = { 0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED" };

export function typeCode(type) {
  const t = typeof type === "number" ? type : TYPES[String(type).toUpperCase()];
  if (!t) throw new Error("dns: unsupported type " + type);
  return t;
}

// A recursive query with EDNS (1232-byte UDP size) and the AD bit set, which asks a validating resolver to say
// whether the answer passed DNSSEC validation (RFC 6840). ID 0, as RFC 8484 recommends for GET.
export function query(name, type = "A") {
  const labels = String(name).replace(/\.$/, "").split(".");
  if (!labels.length || labels.some(l => !l.length || l.length > 63)) throw new Error("dns: bad name");
  const t = typeCode(type);
  const len = 12 + labels.reduce((n, l) => n + 1 + l.length, 0) + 1 + 4 + 11;
  const b = new Uint8Array(len);
  b.set([0, 0, 0x01, 0x20, 0, 1, 0, 0, 0, 0, 0, 1]);   // ID 0, RD + AD, one question, one additional (OPT)
  let i = 12;
  for (const l of labels) {
    if (!/^[\x00-\x7f]*$/.test(l)) throw new Error("dns: non-ASCII label must be punycode");
    b[i++] = l.length;
    for (let k = 0; k < l.length; k++) b[i++] = l.charCodeAt(k);
  }
  b[i++] = 0;
  b.set([t >> 8, t & 255, 0, 1], i); i += 4;
  b.set([0, 0, 41, 0x04, 0xd0, 0, 0, 0, 0, 0, 0], i);   // OPT: root name, type 41, UDP size 1232, no flags, no options
  return b;
}

export function b64url(bytes) {
  let s = "";
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// The GET URL for a query to a DoH endpoint
export const dohURL = (endpoint, name, type = "A") =>
  endpoint + (endpoint.includes("?") ? "&" : "?") + "dns=" + b64url(query(name, type));

const u16 = (b, i) => (b[i] << 8) | b[i + 1];
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

// Read a (possibly compressed) name at i; returns [name, next index after it].
function readName(b, start) {
  const labels = [];
  let i = start, next = -1, jumps = 0;
  for (;;) {
    if (i >= b.length) throw new Error("dns: name runs past the end");
    const len = b[i];
    if (len === 0) { i++; break; }
    if ((len & 0xc0) === 0xc0) {
      if (i + 1 >= b.length) throw new Error("dns: bad pointer");
      const ptr = ((len & 0x3f) << 8) | b[i + 1];
      if (next < 0) next = i + 2;
      if (++jumps > 64) throw new Error("dns: name pointer loop");
      i = ptr;
      continue;
    }
    if (len & 0xc0) throw new Error("dns: bad label length");
    if (i + 1 + len > b.length) throw new Error("dns: label runs past the end");
    labels.push(decodeChars(b.subarray(i + 1, i + 1 + len)));
    i += 1 + len;
  }
  return [labels.join("."), next < 0 ? i : next];
}

function decodeChars(bytes) {
  let s = "";
  for (const c of bytes) s += c >= 32 && c < 127 ? String.fromCharCode(c) : "\\" + c.toString().padStart(3, "0");
  return s;
}

function decodeText(bytes) {
  try { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
  catch (e) { return decodeChars(bytes); }
}

// Render IPv6 groups with :: for the longest run of zero groups (RFC 5952), lowercase.
export function formatIPv6(bytes) {
  if (bytes.length !== 16) return "";
  const g = [];
  for (let i = 0; i < 16; i += 2) g.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
  let best = -1, bestLen = 1;
  for (let i = 0; i < 8; i++) {
    if (g[i] !== "0") continue;
    let j = i;
    while (j < 8 && g[j] === "0") j++;
    if (j - i > bestLen) { best = i; bestLen = j - i; }
    i = j;
  }
  if (best < 0) return g.join(":");
  return g.slice(0, best).join(":") + "::" + g.slice(best + bestLen).join(":");
}

// One resource record. Unknown types are kept with a hex preview so a caller can see what it skipped.
function readRecord(b, i) {
  const [name, afterName] = readName(b, i);
  if (afterName + 10 > b.length) throw new Error("dns: record header runs past the end");
  const type = u16(b, afterName), cls = u16(b, afterName + 2);
  const ttl = u32(b, afterName + 4), rdlen = u16(b, afterName + 8);
  const rd = afterName + 10, end = rd + rdlen;
  if (end > b.length) throw new Error("dns: rdata runs past the end");
  const rec = { name, type: TYPE_NAMES[type] || "TYPE" + type, code: type, ttl, class: cls };
  switch (type) {
    case TYPES.A:
      if (rdlen === 4) rec.data = [...b.subarray(rd, end)].join(".");
      break;
    case TYPES.AAAA:
      if (rdlen === 16) rec.data = formatIPv6(b.subarray(rd, end));
      break;
    case TYPES.NS:
    case TYPES.CNAME:
    case TYPES.PTR: {
      const [target] = readName(b, rd);
      rec.target = target; rec.data = target;
      break;
    }
    case TYPES.MX: {
      const [exchange] = readName(b, rd + 2);
      rec.preference = u16(b, rd); rec.exchange = exchange;
      // a null MX (RFC 7505: "0 .") has the root as its exchange; show it as ".", not as an empty name
      rec.data = rec.preference + " " + (exchange || ".");
      break;
    }
    case TYPES.TXT: {
      const parts = [];
      let k = rd;
      while (k < end) {
        const n = b[k++];
        if (k + n > end) throw new Error("dns: TXT string runs past the record");
        parts.push(decodeText(b.subarray(k, k + n)));
        k += n;
      }
      rec.text = parts.join(""); rec.data = rec.text;
      break;
    }
    case TYPES.SOA: {
      const [mname, k1] = readName(b, rd), [rname, k2] = readName(b, k1);
      if (k2 + 20 > end) throw new Error("dns: short SOA");
      const serial = u32(b, k2), refresh = u32(b, k2 + 4), retry = u32(b, k2 + 8), expire = u32(b, k2 + 12), minimum = u32(b, k2 + 16);
      Object.assign(rec, { mname, rname, serial, refresh, retry, expire, minimum });
      rec.data = [mname, rname, serial, refresh, retry, expire, minimum].join(" ");
      break;
    }
    case TYPES.SRV: {
      if (rd + 6 > end) throw new Error("dns: short SRV");
      const [target] = readName(b, rd + 6);
      Object.assign(rec, { priority: u16(b, rd), weight: u16(b, rd + 2), port: u16(b, rd + 4), target });
      rec.data = [rec.priority, rec.weight, rec.port, target].join(" ");
      break;
    }
    case TYPES.CAA: {
      if (rd + 2 > end) throw new Error("dns: short CAA");
      const flags = b[rd], tagLen = b[rd + 1];
      if (rd + 2 + tagLen > end) throw new Error("dns: short CAA tag");
      const tag = decodeChars(b.subarray(rd + 2, rd + 2 + tagLen));
      const value = decodeText(b.subarray(rd + 2 + tagLen, end));
      Object.assign(rec, { flags, tag, value });
      rec.data = flags + " " + tag + " \"" + value + "\"";
      break;
    }
    default:
      rec.data = "\\# " + rdlen + " " + [...b.subarray(rd, Math.min(end, rd + 12))].map(x => x.toString(16).padStart(2, "0")).join("") + (rdlen > 12 ? "…" : "");
  }
  if (rec.data === undefined) rec.data = "";
  return [rec, end];
}

// Read an answer. Returns null when it isn't a DNS response at all; otherwise
//   { id, rcode, rcodeName, ad, tc, questions, answers, authority, additional }
// where every section is an array of parsed records (OPT, type 41, is dropped).
export function parse(buffer) {
  const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (b.length < 12 || !(b[2] & 0x80)) return null;
  const qd = u16(b, 4), an = u16(b, 6), ns = u16(b, 8), ar = u16(b, 10);
  const out = {
    id: u16(b, 0), rcode: b[3] & 15, rcodeName: RCODE_NAME[b[3] & 15] || String(b[3] & 15),
    ad: !!(b[3] & 0x20), tc: !!(b[2] & 0x02), questions: [], answers: [], authority: [], additional: [],
  };
  let i = 12;
  for (let q = 0; q < qd; q++) {
    const [name, next] = readName(b, i);
    if (next + 4 > b.length) return null;
    out.questions.push({ name, type: TYPE_NAMES[u16(b, next)] || String(u16(b, next)) });
    i = next + 4;
  }
  const readSection = (n, into) => {
    for (let k = 0; k < n; k++) {
      const [rec, next] = readRecord(b, i);
      i = next;
      if (rec.code !== 41) into.push(rec);
    }
  };
  readSection(an, out.answers);
  readSection(ns, out.authority);
  readSection(ar, out.additional);
  return out;
}

// The records of a type followed by the CNAME chain that led to them, as one comparable answer. Order does not
// matter for the comparison: two resolvers that return the same addresses in a different order agree.
export function answerOf(msg, type) {
  if (!msg) return [];
  const t = typeof type === "number" ? type : typeCode(type);
  const rows = msg.answers.filter(r => r.code === t || r.code === TYPES.CNAME);
  return rows.slice().sort((a, b) => a.code - b.code || a.data.localeCompare(b.data));
}

export const answerKey = rows => rows.map(r => r.type + " " + r.data).sort().join(" | ");
