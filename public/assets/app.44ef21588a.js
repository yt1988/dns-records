(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // src/domain.mjs
  var DomainError = class extends Error {
    constructor(reason) {
      super("domain: " + reason);
      this.name = "DomainError";
      this.reason = reason;
    }
  };
  var IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
  function normalizeDomain(input) {
    let s = String(input || "").trim();
    if (!s) throw new DomainError("empty");
    if (s.length > 2048) throw new DomainError("bad");
    let host;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      try {
        host = new URL(s).hostname;
      } catch (e) {
        throw new DomainError("bad");
      }
    } else if (/[/?#\s]/.test(s)) {
      try {
        host = new URL("http://" + s).hostname;
      } catch (e) {
        throw new DomainError("bad");
      }
    } else {
      host = s;
    }
    host = host.replace(/^\[|\]$/g, "");
    if (IPV4.test(host) || host.includes(":")) throw new DomainError("ip");
    host = host.replace(/\.+$/, "").toLowerCase();
    if (!host || host === ".") throw new DomainError("empty");
    if (/[^\x00-\x7f]/.test(host)) {
      try {
        host = new URL("http://" + host).hostname;
      } catch (e) {
        throw new DomainError("bad");
      }
    }
    host = host.replace(/\.+$/, "").toLowerCase();
    if (host.length > 253) throw new DomainError("bad");
    const labels = host.split(".");
    if (labels.length < 2) throw new DomainError("single");
    for (const l of labels) {
      if (!l || l.length > 63) throw new DomainError("bad");
      if (!/^[a-z0-9_-]+$/.test(l)) throw new DomainError("bad");
      if (l.startsWith("-") || l.endsWith("-")) throw new DomainError("bad");
    }
    if (/^\d+$/.test(labels[labels.length - 1])) throw new DomainError("bad");
    return { name: host, display: host };
  }

  // src/resolvers.mjs
  var RESOLVERS = [
    { id: "cloudflare", name: "Cloudflare", doh: "https://cloudflare-dns.com/dns-query" },
    { id: "google", name: "Google", doh: "https://dns.google/dns-query" },
    { id: "quad9", name: "Quad9", doh: "https://dns.quad9.net/dns-query", filter: "malware" },
    { id: "controld", name: "Control D", doh: "https://freedns.controld.com/p0" },
    { id: "dnssb", name: "DNS.SB", doh: "https://doh.dns.sb/dns-query" },
    { id: "cleanbrowsing", name: "CleanBrowsing", doh: "https://doh.cleanbrowsing.org/doh/security-filter/", filter: "malware" },
    { id: "rethink", name: "Rethink DNS", doh: "https://sky.rethinkdns.com/dns-query" },
    { id: "dns4eu", name: "DNS4EU", doh: "https://unfiltered.joindns4.eu/dns-query" },
    { id: "cznic", name: "CZ.NIC ODVR", doh: "https://odvr.nic.cz/doh" },
    { id: "dnsforge", name: "DNSForge", doh: "https://dnsforge.de/dns-query", filter: "ads" },
    { id: "tiarap", name: "Tiarap", doh: "https://doh.tiar.app/dns-query" },
    { id: "iij", name: "IIJ", doh: "https://public.dns.iij.jp/dns-query" }
  ];
  var ALL_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SRV", "SOA"];

  // src/dns.mjs
  var TYPES = { A: 1, NS: 2, CNAME: 5, SOA: 6, PTR: 12, MX: 15, TXT: 16, AAAA: 28, SRV: 33, DS: 43, DNSKEY: 48, CAA: 257 };
  var TYPE_NAMES = Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [v, k]));
  var RCODE_NAME = { 0: "NOERROR", 1: "FORMERR", 2: "SERVFAIL", 3: "NXDOMAIN", 4: "NOTIMP", 5: "REFUSED" };
  function typeCode(type) {
    const t = typeof type === "number" ? type : TYPES[String(type).toUpperCase()];
    if (!t) throw new Error("dns: unsupported type " + type);
    return t;
  }
  function query(name, type = "A", { do: doBit = false } = {}) {
    const labels = String(name).replace(/\.$/, "").split(".");
    if (!labels.length || labels.some((l) => !l.length || l.length > 63)) throw new Error("dns: bad name");
    const t = typeCode(type);
    const len = 12 + labels.reduce((n, l) => n + 1 + l.length, 0) + 1 + 4 + 11;
    const b = new Uint8Array(len);
    b.set([0, 0, 1, 32, 0, 1, 0, 0, 0, 0, 0, 1]);
    let i = 12;
    for (const l of labels) {
      if (!/^[\x00-\x7f]*$/.test(l)) throw new Error("dns: non-ASCII label must be punycode");
      b[i++] = l.length;
      for (let k = 0; k < l.length; k++) b[i++] = l.charCodeAt(k);
    }
    b[i++] = 0;
    b.set([t >> 8, t & 255, 0, 1], i);
    i += 4;
    b.set([0, 0, 41, 4, 208, 0, 0, doBit ? 128 : 0, 0, 0, 0], i);
    return b;
  }
  function b64url(bytes) {
    let s = "";
    for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  var dohURL = (endpoint, name, type = "A", opts) => endpoint + (endpoint.includes("?") ? "&" : "?") + "dns=" + b64url(query(name, type, opts));
  var u16 = (b, i) => b[i] << 8 | b[i + 1];
  var u32 = (b, i) => (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
  function readName(b, start) {
    const labels = [];
    let i = start, next = -1, jumps = 0;
    for (; ; ) {
      if (i >= b.length) throw new Error("dns: name runs past the end");
      const len = b[i];
      if (len === 0) {
        i++;
        break;
      }
      if ((len & 192) === 192) {
        if (i + 1 >= b.length) throw new Error("dns: bad pointer");
        const ptr = (len & 63) << 8 | b[i + 1];
        if (next < 0) next = i + 2;
        if (++jumps > 64) throw new Error("dns: name pointer loop");
        i = ptr;
        continue;
      }
      if (len & 192) throw new Error("dns: bad label length");
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
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    } catch (e) {
      return decodeChars(bytes);
    }
  }
  function formatIPv6(bytes) {
    if (bytes.length !== 16) return "";
    const g = [];
    for (let i = 0; i < 16; i += 2) g.push((bytes[i] << 8 | bytes[i + 1]).toString(16));
    let best = -1, bestLen = 1;
    for (let i = 0; i < 8; i++) {
      if (g[i] !== "0") continue;
      let j = i;
      while (j < 8 && g[j] === "0") j++;
      if (j - i > bestLen) {
        best = i;
        bestLen = j - i;
      }
      i = j;
    }
    if (best < 0) return g.join(":");
    return g.slice(0, best).join(":") + "::" + g.slice(best + bestLen).join(":");
  }
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
        rec.target = target;
        rec.data = target;
        break;
      }
      case TYPES.MX: {
        const [exchange] = readName(b, rd + 2);
        rec.preference = u16(b, rd);
        rec.exchange = exchange;
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
        rec.text = parts.join("");
        rec.data = rec.text;
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
        rec.data = flags + " " + tag + ' "' + value + '"';
        break;
      }
      // DS and DNSKEY are only asked for, never shown in the record table: the page reads whether they exist, and
      // nothing about the signature itself (docs/decisions.md, the DNSSEC section).
      case TYPES.DS: {
        if (rdlen < 4) throw new Error("dns: short DS");
        const keyTag = u16(b, rd), algorithm = b[rd + 2], digestType = b[rd + 3];
        const digest = [...b.subarray(rd + 4, end)].map((x) => x.toString(16).padStart(2, "0")).join("");
        Object.assign(rec, { keyTag, algorithm, digestType, digest });
        rec.data = keyTag + " " + algorithm + " " + digestType + " " + digest;
        break;
      }
      case TYPES.DNSKEY: {
        if (rdlen < 4) throw new Error("dns: short DNSKEY");
        Object.assign(rec, { flags: u16(b, rd), protocol: b[rd + 2], algorithm: b[rd + 3] });
        rec.data = rec.flags + " " + rec.protocol + " " + rec.algorithm + " \u2026";
        break;
      }
      default:
        rec.data = "\\# " + rdlen + " " + [...b.subarray(rd, Math.min(end, rd + 12))].map((x) => x.toString(16).padStart(2, "0")).join("") + (rdlen > 12 ? "\u2026" : "");
    }
    if (rec.data === void 0) rec.data = "";
    return [rec, end];
  }
  function parse(buffer) {
    const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (b.length < 12 || !(b[2] & 128)) return null;
    const qd = u16(b, 4), an = u16(b, 6), ns = u16(b, 8), ar = u16(b, 10);
    const out = {
      id: u16(b, 0),
      rcode: b[3] & 15,
      rcodeName: RCODE_NAME[b[3] & 15] || String(b[3] & 15),
      ad: !!(b[3] & 32),
      tc: !!(b[2] & 2),
      questions: [],
      answers: [],
      authority: [],
      additional: []
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
  function answerOf(msg, type) {
    if (!msg) return [];
    const t = typeof type === "number" ? type : typeCode(type);
    const rows = msg.answers.filter((r) => r.code === t || r.code === TYPES.CNAME);
    return rows.slice().sort((a, b) => a.code - b.code || a.data.localeCompare(b.data));
  }
  var answerKey = (rows) => rows.map((r) => r.type + " " + r.data).sort().join(" | ");

  // src/merge.mjs
  var OK = "ok";
  var SERVED_ERRORS = /* @__PURE__ */ new Set(["servfail", "refused", "rcode"]);
  var isServed = (r) => r.status !== OK && SERVED_ERRORS.has(r.error);
  var answerKey2 = (rows) => rows.map((r) => r.type + " " + r.data).sort().join(" | ");
  function mergeType(results) {
    const ok = results.filter((r) => r.status === OK);
    const errors = results.filter((r) => r.status !== OK);
    const served = errors.filter(isServed);
    const unreachable = errors.filter((r) => !isServed(r));
    const answered = ok.length + served.length;
    const groups = /* @__PURE__ */ new Map();
    for (const r of ok) {
      const key = answerKey2(r.records);
      if (!groups.has(key)) groups.set(key, { key, records: r.records, resolvers: [] });
      groups.get(key).resolvers.push(r.id);
    }
    const list = [...groups.values()].sort((a, b) => b.resolvers.length - a.resolvers.length || a.key.localeCompare(b.key));
    const majority = list[0] || null;
    const stale = majority ? ok.filter((r) => answerKey2(r.records) !== majority.key) : [];
    return {
      ok,
      errors,
      served,
      unreachable,
      answered,
      groups: list,
      majority,
      consistency: answered >= 2 && majority ? majority.resolvers.length / answered : null,
      stale,
      nx: ok.filter((r) => r.rcode === 3).length,
      empty: ok.length > 0 && ok.every((r) => r.records.length === 0),
      distinct: list.length
    };
  }
  function mergeAll(byType) {
    const out = {};
    for (const type of ALL_TYPES) if (byType[type]) out[type] = mergeType(byType[type]);
    return out;
  }
  function mergeRecords(byType) {
    const rows = /* @__PURE__ */ new Map();
    for (const type of ALL_TYPES) {
      for (const r of byType[type] || []) {
        if (r.status !== OK) continue;
        for (const rec of r.records) {
          const key = rec.type + " " + rec.data;
          if (!rows.has(key)) rows.set(key, { type: rec.type, data: rec.data, ttlMin: rec.ttl, ttlMax: rec.ttl, resolvers: [], record: rec });
          const row = rows.get(key);
          row.ttlMin = Math.min(row.ttlMin, rec.ttl);
          row.ttlMax = Math.max(row.ttlMax, rec.ttl);
          if (!row.resolvers.includes(r.id)) row.resolvers.push(r.id);
        }
      }
    }
    return [...rows.values()].map((r) => ({ ...r, count: r.resolvers.length })).sort((a, b) => ALL_TYPES.indexOf(a.type) - ALL_TYPES.indexOf(b.type) || a.data.localeCompare(b.data));
  }
  function primaryType(merged) {
    return ALL_TYPES.find((t) => merged[t] && merged[t].ok.length) || null;
  }

  // src/mail.mjs
  var textOf = (rec) => typeof rec === "string" ? rec : rec && rec.text != null ? rec.text : rec && rec.data != null ? rec.data : "";
  function spfCheck(records) {
    const all = (records || []).map(textOf).filter((v) => /^v=spf1(?:\s|$)/i.test(v.trim()));
    if (!all.length) return { count: 0, record: null, qualifier: null, lookups: 0, issues: [] };
    const record = all[0].trim();
    const terms = record.split(/\s+/).filter(Boolean).slice(1);
    const issues = [];
    if (all.length > 1) issues.push("multiple");
    const allTerms = terms.filter((t) => /^[+\-~?]?all$/i.test(t));
    let qualifier = null;
    if (allTerms.length) {
      const q = allTerms[allTerms.length - 1][0];
      qualifier = "+-~?".includes(q) ? { "+": "pass", "-": "fail", "~": "softfail", "?": "neutral" }[q] : "pass";
      if (allTerms.length > 1) issues.push("multipleAll");
      if (terms[terms.length - 1] !== allTerms[allTerms.length - 1]) issues.push("allNotLast");
    } else {
      issues.push("noAll");
    }
    if (qualifier === "pass") issues.push("plusAll");
    const lookups = terms.filter((t) => /^[+\-~?]?(?:include:|a(?::|$)|mx(?::|$)|ptr(?::|$)|exists:|redirect=)/i.test(t)).length;
    if (lookups > 10) issues.push("tooManyLookups");
    if (record.length > 512) issues.push("long");
    return { count: all.length, record, qualifier, lookups, issues };
  }
  function dmarcCheck(records) {
    const all = (records || []).map(textOf).filter((v) => /^v=DMARC1\s*(?:;|$)/i.test(v.trim()));
    if (!all.length) return { count: 0, record: null, p: null, sp: null, rua: [], pct: null, issues: [] };
    const record = all[0].trim();
    const tags = {};
    for (const part of record.split(";")) {
      const m = /^\s*([a-z0-9]+)\s*=\s*(.*?)\s*$/i.exec(part);
      if (m) tags[m[1].toLowerCase()] = m[2];
    }
    const p = (tags.p || "").toLowerCase() || null;
    const sp = (tags.sp || "").toLowerCase() || null;
    const rua = (tags.rua || "").split(",").map((s) => s.trim()).filter(Boolean);
    const pct = tags.pct ? Number(tags.pct) : 100;
    const issues = [];
    if (all.length > 1) issues.push("multiple");
    if (!p) issues.push("noPolicy");
    else if (!["none", "quarantine", "reject"].includes(p)) issues.push("badPolicy");
    if (p === "none") issues.push("pNone");
    if (!rua.length) issues.push("noRua");
    if (Number.isFinite(pct) && pct < 100) issues.push("partial");
    return { count: all.length, record, p, sp, rua, pct: Number.isFinite(pct) ? pct : null, issues };
  }
  var normNs = (ns) => String(ns || "").trim().toLowerCase().replace(/\.+$/, "");
  function compareNs(registrarNs, resolverNs) {
    const a = [...new Set((registrarNs || []).map(normNs).filter(Boolean))].sort();
    const b = [...new Set((resolverNs || []).map(normNs).filter(Boolean))].sort();
    const onlyRegistrar = a.filter((x) => !b.includes(x));
    const onlyResolver = b.filter((x) => !a.includes(x));
    return { same: a.length > 0 && b.length > 0 && !onlyRegistrar.length && !onlyResolver.length, onlyRegistrar, onlyResolver };
  }

  // src/dnssec.mjs
  var VALIDATORS = ["cloudflare", "google", "controld", "rethink", "dnsforge", "tiarap", "iij"];
  var DS_PREFERRED = ["cloudflare", "google"];
  function dsFound(results) {
    const ok = (results || []).filter((r) => r && r.status === "ok");
    if (ok.some((r) => r.records.some((x) => x.type === "DS"))) return true;
    if (ok.length && ok.every((r) => r.rcode === 0 && !r.records.some((x) => x.type === "DS"))) return false;
    return null;
  }
  function dsAskers(answeredIds) {
    const answered = new Set(answeredIds || []);
    const pick = [...DS_PREFERRED.filter((id) => answered.has(id)), ...VALIDATORS.filter((id) => answered.has(id) && DS_PREFERRED.indexOf(id) < 0)];
    return pick.slice(0, 2);
  }
  function dnssecVerdict(ds, rows) {
    const byId = new Map((rows || []).map((r) => [r.id, r]));
    const known = [...byId.values()].filter((r) => VALIDATORS.indexOf(r.id) >= 0);
    const answering = known.filter((r) => r.ok);
    const passing = answering.filter((r) => r.ad);
    const failing = known.filter((r) => !r.ok && r.servfail).length;
    const sb = byId.get("dnssb");
    const sbPass = !!(sb && sb.ok && sb.ad);
    const answered = answering.length;
    const validators = passing.length + (sbPass ? 1 : 0);
    const verdict = (state) => ({ state, validators, answered });
    if (ds === true) {
      if (validators >= 2 && answering.every((r) => r.ad)) return verdict("pass");
      if (!validators && failing >= 2) return verdict("broken");
      return verdict("unknown");
    }
    if (ds === false) return verdict("off");
    return verdict("unknown");
  }
  function dnssecRows(byType) {
    const rows = /* @__PURE__ */ new Map();
    for (const type of Object.keys(byType || {})) {
      for (const r of byType[type]) {
        const row = rows.get(r.id) || { id: r.id, ok: false, ad: false, servfail: false };
        if (r.status === "ok") {
          row.ok = true;
          if (r.ad) row.ad = true;
        }
        if (r.status === "error" && r.error === "servfail") row.servfail = true;
        rows.set(r.id, row);
      }
    }
    return [...rows.values()];
  }

  // src/grade.mjs
  var STEPS = ["A", "B", "C", "D"];
  var worse = (a, b) => STEPS.indexOf(a) >= STEPS.indexOf(b) ? a : b;
  var down = (g) => STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(g) + 1)];
  function resolveGrade({ answered, total, consistency, records }) {
    if (!records || answered * 2 < total || consistency == null) return null;
    return consistency === 1 ? "A" : "B";
  }
  function mailGrade({ mx, checked, spf, dmarc }) {
    if (!mx || !checked || !spf || !dmarc) return null;
    const notes = [], problems = [];
    if (!spf.count) problems.push("spf-none");
    else if (spf.qualifier === "pass") problems.push("spf-open");
    else if (spf.qualifier !== "fail" && spf.qualifier !== "softfail") notes.push("spf-weak");
    else if (spf.count > 1 || (spf.issues || []).indexOf("tooManyLookups") >= 0) notes.push("spf-extra");
    if (!dmarc.count) problems.push("dmarc-none");
    else if (dmarc.p === "none" || dmarc.p !== "quarantine" && dmarc.p !== "reject") notes.push("dmarc-weak");
    else if (!dmarc.rua.length) notes.push("dmarc-no-rua");
    if (problems.length >= 2) return "D";
    if (problems.length === 1 || notes.length >= 2) return "C";
    if (notes.length === 1) return "B";
    return "A";
  }
  function overallGrade({ resolve, mail, dnssec }) {
    if (!resolve) return null;
    const base = mail ? worse(resolve, mail) : resolve;
    return dnssec === "broken" ? down(base) : base;
  }

  // src/zone.mjs
  var ZONE_TYPES = /* @__PURE__ */ new Set(["MX", "NS", "TXT", "CAA", "SOA"]);
  function parentName(name) {
    const i = name.indexOf(".");
    return i > 0 ? name.slice(i + 1) : "";
  }
  function preferRegistrable(zone, name, registry) {
    const r = String(registry || "").toLowerCase();
    const lower = String(name).toLowerCase();
    return r && r.split(".").length >= 2 && (r === lower || lower.endsWith("." + r)) ? r : zone;
  }
  function soaOwner(msg) {
    if (!msg || msg.rcode !== 0) return "";
    const soa = (msg.answers || []).find((r) => r.type === "SOA") || (msg.authority || []).find((r) => r.type === "SOA");
    return soa && soa.name ? String(soa.name).replace(/\.$/, "").toLowerCase() : "";
  }
  async function findApex(name, probe, { climbs = 1 } = {}) {
    const lower = String(name).toLowerCase();
    let cur = lower;
    for (let i = 0; i <= climbs; i++) {
      const msg = await probe(cur);
      const owner = soaOwner(msg);
      if (owner && owner.includes(".") && (owner === lower || lower.endsWith("." + owner))) return owner;
      if (msg && parentName(cur)) {
        cur = parentName(cur);
        continue;
      }
      break;
    }
    return lower;
  }

  // src/rdap.mjs
  var RDAP_BASE = "https://rdap.org/domain/";
  var RDAP_SUPPLEMENTS = {
    io: { base: "https://rdap.identitydigital.services/rdap/domain/", name: "Identity Digital" }
  };
  var REGISTRY_WHOIS = {
    cn: { name: "CNNIC", url: "https://whois.cnnic.cn/" },
    jp: { name: "JPRS", url: "https://www.jprs.jp/whois/" },
    ru: { name: "TCI", url: "https://www.tcinet.ru/whois/" },
    hk: { name: "HKDNR", url: "https://www.hkdnr.hk/" },
    vn: { name: "VNNIC", url: "https://whois.vnnic.vn/" }
  };
  var NO_RDAP_TLDS = ["cn", "jp", "ru", "hk", "de", "vn"];
  function tldOf(domain) {
    const labels = String(domain || "").toLowerCase().replace(/\.+$/, "").split(".");
    return labels.length > 1 ? labels[labels.length - 1] : "";
  }
  function registryOf(domain) {
    return REGISTRY_WHOIS[tldOf(domain)] || null;
  }
  function parentDomains(domain) {
    const labels = String(domain || "").toLowerCase().replace(/\.+$/, "").split(".").filter(Boolean);
    const out = [];
    for (let i = 0; i <= labels.length - 2 && out.length < 3; i++) out.push(labels.slice(i).join("."));
    return out;
  }
  async function fetchRdap(domain, { fetchImpl = fetch, signal, timeout = 9e3 } = {}) {
    const ctl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl.abort();
    }, timeout);
    const stop = () => ctl.abort();
    if (signal) {
      if (signal.aborted) ctl.abort();
      else signal.addEventListener("abort", stop);
    }
    try {
      const candidates = parentDomains(domain);
      for (let i = 0; i < candidates.length; i++) {
        const name = candidates[i], tld = tldOf(name), last = i === candidates.length - 1;
        const supplement = RDAP_SUPPLEMENTS[tld];
        const res = await fetchImpl((supplement ? supplement.base : RDAP_BASE) + encodeURIComponent(name), {
          signal: ctl.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { accept: "application/rdap+json, application/json" }
        });
        if (res.status === 404) {
          if (!supplement) {
            const body = await res.text().catch(() => "");
            if (/no rdap service/i.test(body)) return { unsupported: true, tld, lookedUp: name };
            if (NO_RDAP_TLDS.indexOf(tld) >= 0) return { unsupported: true, tld, lookedUp: name };
          }
          if (!last) continue;
          return { notFound: true, lookedUp: name };
        }
        if (!res.ok) return { error: "http", status: res.status };
        let json;
        try {
          json = await res.json();
        } catch (e) {
          return { error: "bad" };
        }
        const data = normalize(json);
        data.raw = String(JSON.stringify(json, null, 2) || "").slice(0, 16e3);
        return { data, lookedUp: name };
      }
      return { notFound: true };
    } catch (e) {
      if (timedOut) return { error: "timeout" };
      if (e && (e.name === "AbortError" || e.name === "TimeoutError")) return { error: "aborted" };
      return { error: "network" };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", stop);
    }
  }
  var WHOIS_ENDPOINT = "/whois?d=";
  async function fetchServerRegistration(domain, { fetchImpl = fetch, signal, timeout = 12e3 } = {}) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const stop = () => ctl.abort();
    if (signal) {
      if (signal.aborted) ctl.abort();
      else signal.addEventListener("abort", stop);
    }
    try {
      const res = await fetchImpl(WHOIS_ENDPOINT + encodeURIComponent(domain), {
        signal: ctl.signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { accept: "application/json" }
      });
      if (!res.ok) return null;
      const j = await res.json();
      if (!j || typeof j !== "object") return null;
      const src = j.src === "whois" ? "whois" : "rdap";
      if (j.ok) return {
        src,
        lookedUp: typeof j.lookedUp === "string" ? j.lookedUp : null,
        data: {
          handle: null,
          registrar: j.registrar || null,
          registrarUrl: j.registrarUrl || null,
          created: j.created || null,
          expires: j.expires || null,
          updated: j.updated || null,
          status: Array.isArray(j.status) ? j.status : [],
          nameservers: Array.isArray(j.nameservers) ? j.nameservers : [],
          // the registrant side the registry publishes, and its own reply for the expandable raw record
          registrant: j.registrant || null,
          registrantOrg: j.registrantOrg || null,
          email: j.email || null,
          phone: j.phone || null,
          dnssec: j.dnssec || null,
          raw: typeof j.raw === "string" ? j.raw : null
        }
      };
      if (j.reason === "notfound") return { notFound: true, src, lookedUp: typeof j.lookedUp === "string" ? j.lookedUp : null };
      return null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", stop);
    }
  }
  function vcard(entity) {
    const card = entity && Array.isArray(entity.vcardArray) && Array.isArray(entity.vcardArray[1]) ? entity.vcardArray[1] : [];
    const get = (name) => card.filter((p) => Array.isArray(p) && p[0] === name).map((p) => Array.isArray(p[3]) ? p[3].join(" ") : p[3]).map((v) => typeof v === "string" ? v.trim() : "").filter(Boolean);
    return { fn: get("fn"), org: get("org"), email: get("email"), tel: get("tel") };
  }
  function vname(entity) {
    const fn = vcard(entity).fn;
    return fn[0] || entity.handle || null;
  }
  var eventDate = (events, ...actions) => {
    for (const action of actions) {
      const e = (events || []).find((x) => String(x.eventAction || "").toLowerCase() === action);
      if (e && e.eventDate) return e.eventDate;
    }
    return null;
  };
  function normalize(json) {
    const entities = Array.isArray(json.entities) ? json.entities : [];
    const registrarEnt = entities.find((e) => Array.isArray(e.roles) && e.roles.includes("registrar")) || entities.find((e) => Array.isArray(e.roles) && e.roles.includes("sponsor"));
    const nameservers = (Array.isArray(json.nameservers) ? json.nameservers : []).map((n) => typeof n === "string" ? n : n.ldhName || n.unicodeName || "").filter(Boolean);
    const rc = vcard(entities.find((e) => Array.isArray(e.roles) && e.roles.includes("registrant")));
    const signed = json.secureDNS && typeof json.secureDNS.delegationSigned === "boolean" ? json.secureDNS.delegationSigned ? "signed" : "unsigned" : null;
    return {
      handle: json.handle || null,
      registrar: registrarEnt ? vname(registrarEnt) : null,
      registrarUrl: registrarEnt && Array.isArray(registrarEnt.links) ? (registrarEnt.links.find((l) => l.rel === "about" || l.rel === "self") || {}).href || null : null,
      created: eventDate(json.events, "registration"),
      expires: eventDate(json.events, "expiration"),
      updated: eventDate(json.events, "last changed", "last update of rdap database"),
      status: (Array.isArray(json.status) ? json.status : []).filter((s) => typeof s === "string"),
      nameservers: [...new Set(nameservers.map((n) => n.toLowerCase().replace(/\.+$/, "")))],
      registrant: rc.fn[0] || null,
      registrantOrg: rc.org.join(", ") || null,
      email: [...new Set(rc.email)].join(", ") || null,
      phone: [...new Set(rc.tel)].join(", ") || null,
      dnssec: signed
    };
  }

  // public/assets/share/codec.js
  var CodecError = class extends Error {
    constructor(reason) {
      super(`codec: ${reason}`);
      this.name = "CodecError";
      this.reason = reason;
    }
  };
  var hasStream = (name) => typeof globalThis[name] === "function";
  var tryFormat = (Ctor) => {
    try {
      new Ctor("deflate-raw");
      return true;
    } catch (e) {
      return false;
    }
  };
  var deflateOk;
  var inflateOk;
  var canDeflate = () => deflateOk !== void 0 ? deflateOk : deflateOk = hasStream("CompressionStream") && tryFormat(globalThis.CompressionStream);
  var canInflate = () => inflateOk !== void 0 ? inflateOk : inflateOk = hasStream("DecompressionStream") && tryFormat(globalThis.DecompressionStream);
  var utf8 = (s) => new TextEncoder().encode(s);
  var text = (b) => new TextDecoder().decode(b);
  function b64u(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function unb64u(str) {
    if (!/^[A-Za-z0-9_-]*$/.test(str)) throw new CodecError("base64");
    const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  async function pipe(bytes, stream) {
    const out = stream.readable;
    const w = stream.writable.getWriter();
    w.write(bytes).catch(() => {
    });
    w.close().catch(() => {
    });
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  async function pack(str) {
    const raw = utf8(str);
    if (canDeflate()) {
      try {
        return "z" + b64u(await pipe(raw, new CompressionStream("deflate-raw")));
      } catch (e) {
      }
    }
    return "u" + b64u(raw);
  }
  async function unpack(code, opts) {
    const legacy = !!(opts && opts.legacy);
    const s = String(code || "");
    const kind = legacy ? "z" : s.charAt(0);
    const body = legacy ? s : s.slice(1);
    if (kind === "u") return text(unb64u(body));
    if (kind !== "z") throw new CodecError("format");
    if (!canInflate()) throw new CodecError("inflate");
    try {
      return text(await pipe(unb64u(body), new DecompressionStream("deflate-raw")));
    } catch (e) {
      throw e instanceof CodecError ? e : new CodecError("corrupt");
    }
  }

  // src/code.mjs
  var CODE_VERSION = "1";
  var CODES = { ok: 0, nx: 3, servfail: 2, timeout: 4, network: 5, http: 6, bad: 7, skipped: 8, refused: 9, rcode: 10 };
  async function encodeResult(obj) {
    return CODE_VERSION + "~" + await pack(JSON.stringify(obj));
  }
  async function decodeResult(code) {
    const m = /^1~([A-Za-z0-9_-]{8,16000})$/.exec(code || "");
    if (!m) return null;
    let text2;
    try {
      text2 = await unpack(m[1]);
    } catch (e) {
      if (e instanceof CodecError && e.reason === "inflate") throw e;
      return null;
    }
    try {
      const r = JSON.parse(text2);
      if (!r || typeof r.d !== "string" || !/^[a-z0-9._-]{1,253}$/i.test(r.d)) return null;
      if (!Array.isArray(r.t) || !r.t.length || r.t.length > 9) return null;
      if (!Array.isArray(r.r) || !r.r.length || r.r.length > 120) return null;
      return r;
    } catch (e) {
      return null;
    }
  }
  function sharePath(path) {
    const m = /^\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?r\/([^/]+)$/.exec(path);
    return m ? { slug: m[1] || "", code: m[2] } : null;
  }
  function resultsFromSnapshot(snap) {
    const byType = {};
    for (const [id, type, code, rows] of snap.r) {
      (byType[type] || (byType[type] = [])).push({
        id,
        type,
        status: code === 0 || code === 3 ? "ok" : "error",
        error: errorOf(code),
        rcode: code,
        ad: false,
        records: (rows || []).map(([t, ttl, data]) => ({ type: t, ttl: Number(ttl) || 0, data: String(data) }))
      });
    }
    return byType;
  }
  function errorOf(code) {
    return { 2: "servfail", 4: "timeout", 5: "network", 6: "http", 7: "bad", 8: "skipped", 9: "refused", 10: "rcode" }[code] || null;
  }

  // src/app.js
  (function() {
    "use strict";
    const L = window.L1MS || {};
    const D = JSON.parse(document.getElementById("data").textContent || "{}");
    const LANG = D.lang || "en";
    const t = (k, vars) => {
      let s = k in L ? L[k] : k;
      if (vars) for (const key of Object.keys(vars)) s = s.split("{" + key + "}").join(String(vars[key]));
      return s;
    };
    const $ = (id) => document.getElementById(id);
    const all = (s) => Array.prototype.slice.call(document.querySelectorAll(s));
    const store = { get(k) {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return null;
      }
    }, set(k, v) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {
      }
    } };
    const K = { theme: "dig:theme", lang: "dig:lang" };
    const EXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    const el = (tag, cls, text2) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text2 != null) n.textContent = text2;
      return n;
    };
    const fmtDate = (s) => {
      if (!s) return "\u2014";
      const d = new Date(s);
      if (isNaN(d.getTime())) return String(s);
      try {
        return new Intl.DateTimeFormat(LANG, { year: "numeric", month: "short", day: "numeric" }).format(d);
      } catch (e) {
        return d.toISOString().slice(0, 10);
      }
    };
    const pct = (n) => Math.round(n * 100) + "%";
    const ttlNum = (n) => n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "");
    function ttlText(a, b) {
      if (Math.max(a, b) >= 172800) {
        const f = (n) => ttlNum(n / 86400);
        return a === b ? t("ttl_d", { a: f(a) }) : t("ttl_range_d", { a: f(a), b: f(b) });
      }
      if (Math.max(a, b) >= 3600) {
        const f = (n) => ttlNum(n / 3600);
        return a === b ? t("ttl_h", { a: f(a) }) : t("ttl_range_h", { a: f(a), b: f(b) });
      }
      return a === b ? t("ttl_s", { a }) : t("ttl_range", { a, b });
    }
    const tool = (id) => {
      const m = document.querySelector('meta[name="' + id + '"]');
      return m && m.content ? m.content.replace(/\/+$/, "") + (D.paths && D.paths[LANG] ? D.paths[LANG] : "/") : "";
    };
    const asnHref = (ip) => {
      const u = tool("asn");
      return u ? u + "ip/" + encodeURIComponent(ip) : "";
    };
    const TH = ["system", "light", "dark"], thBtn = $("theme");
    const applyTheme = (th) => {
      if (th === "system") document.documentElement.removeAttribute("data-theme");
      else document.documentElement.setAttribute("data-theme", th);
      thBtn.dataset.th = th;
      thBtn.title = t("a_theme");
      thBtn.setAttribute("aria-label", t("a_theme"));
    };
    applyTheme(TH.indexOf(store.get(K.theme)) >= 0 ? store.get(K.theme) : "system");
    thBtn.onclick = () => {
      const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3];
      store.set(K.theme, n);
      applyTheme(n);
    };
    $("lang").onchange = (e) => {
      const l = e.target.value;
      store.set(K.lang, l);
      const sp = sharePath(location.pathname);
      const base = D.paths && D.paths[l] || "/";
      location.href = base + (sp ? "r/" + sp.code : "") + location.search;
    };
    const openDlg = (id) => {
      $(id).hidden = false;
      document.documentElement.style.overflow = "hidden";
      const b = $(id).querySelector("[data-close]");
      if (b) b.focus();
    };
    const closeDlg = () => {
      all(".scrim").forEach((s) => {
        s.hidden = true;
      });
      document.documentElement.style.overflow = "";
    };
    all("[data-close]").forEach((b) => {
      b.onclick = closeDlg;
    });
    all(".scrim").forEach((s) => s.addEventListener("click", (e) => {
      if (e.target === s) closeDlg();
    }));
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDlg();
    });
    let helpIdx = 0;
    const helpQs = all("#helpNav [data-hq]");
    $("helpSel").innerHTML = helpQs.map((b, i) => '<option value="' + i + '">' + (i + 1) + " / " + helpQs.length + " \xB7 " + esc(b.textContent) + "</option>").join("");
    const showHelp = (i) => {
      helpIdx = Math.max(0, Math.min(helpQs.length - 1, i));
      helpQs.forEach((b) => b.setAttribute("aria-selected", String(+b.dataset.hq === helpIdx)));
      all("#helpC [data-hqb]").forEach((a) => {
        a.hidden = +a.dataset.hqb !== helpIdx;
      });
      $("helpSel").value = String(helpIdx);
      all("[data-hstep]").forEach((b) => {
        b.disabled = helpIdx + +b.dataset.hstep < 0 || helpIdx + +b.dataset.hstep >= helpQs.length;
      });
      $("helpC").scrollTop = 0;
    };
    $("helpBtn").onclick = () => {
      showHelp(helpIdx);
      openDlg("help");
    };
    helpQs.forEach((b) => {
      b.onclick = () => showHelp(+b.dataset.hq);
    });
    $("helpSel").onchange = (e) => showHelp(+e.target.value);
    all("[data-hstep]").forEach((b) => {
      b.onclick = () => showHelp(helpIdx + +b.dataset.hstep);
    });
    const TIMEOUT = 4500;
    let runId = 0, ctl = null, state = fresh(), R = null;
    function fresh() {
      return {
        domain: "",
        apex: "",
        lateApex: "",
        types: [],
        results: {},
        dmarc: [],
        rdap: null,
        startedAt: 0,
        finished: false,
        tab: "A",
        merged: null,
        records: [],
        shareCode: "",
        shared: false,
        findings: [],
        ds: null,
        dnssec: null,
        grade: null
      };
    }
    const chips = all("#types input");
    const readTypes = () => {
      let list = chips.filter((c) => c.checked).map((c) => c.value);
      if (!list.length) {
        chips.filter((c) => c.value === "A").forEach((c) => {
          c.checked = true;
          c.parentNode.classList.add("on");
        });
        list = ["A"];
      }
      return ALL_TYPES.filter((x) => list.indexOf(x) >= 0);
    };
    chips.forEach((c) => {
      c.parentNode.classList.toggle("on", c.checked);
      c.onchange = () => c.parentNode.classList.toggle("on", c.checked);
    });
    function queryOne(r, name, type, signal, opts) {
      const c = new AbortController();
      let timedOut = false, stopped = false;
      const timer = setTimeout(() => {
        timedOut = true;
        c.abort();
      }, TIMEOUT);
      const onStop = () => {
        stopped = true;
        c.abort();
      };
      if (signal) {
        if (signal.aborted) onStop();
        else signal.addEventListener("abort", onStop);
      }
      return fetch(dohURL(r.doh, name, type, opts), {
        mode: "cors",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { accept: "application/dns-message" },
        signal: c.signal
      }).then((res) => {
        if (!res.ok) return err(r, type, "http", "", res.status);
        return res.arrayBuffer().then((buf) => {
          const msg = parse(buf);
          if (!msg) return err(r, type, "bad");
          if (msg.rcode === 0 || msg.rcode === 3) return { id: r.id, type, status: OK, rcode: msg.rcode, ad: msg.ad, records: answerOf(msg, type) };
          if (msg.rcode === 2) return err(r, type, "servfail", msg.rcodeName);
          if (msg.rcode === 5) return err(r, type, "refused", msg.rcodeName);
          return err(r, type, "rcode", msg.rcodeName);
        });
      }).catch(() => {
        if (stopped) return err(r, type, "aborted");
        return err(r, type, timedOut ? "timeout" : "network");
      }).then((x) => {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onStop);
        return x;
      });
    }
    const err = (r, type, error, rcodeName, statusCode) => ({ id: r.id, type, status: "error", error, rcodeName: rcodeName || "", statusCode: statusCode || 0, records: [] });
    async function resolveApex(name, signal, rdapAttempt) {
      const zoneP = findApex(name, (n) => firstMessage(n, signal));
      const registry = await Promise.race([
        rdapAttempt.then((r) => r && r.lookedUp || "").catch(() => ""),
        new Promise((res) => setTimeout(() => res(""), 1200))
      ]).then((v) => String(v || "").toLowerCase());
      const zone = await zoneP;
      return preferRegistrable(zone, name, registry);
    }
    function firstMessage(name, signal) {
      const c = new AbortController();
      let finished = false, settle, timer = null;
      const done = new Promise((res) => {
        settle = res;
      });
      function finish2(msg) {
        if (finished) return;
        finished = true;
        if (timer) clearTimeout(timer);
        c.abort();
        if (signal) signal.removeEventListener("abort", onStop);
        settle(msg);
      }
      function onStop() {
        finish2(null);
      }
      timer = setTimeout(() => finish2(null), TIMEOUT);
      if (signal) {
        if (signal.aborted) onStop();
        else signal.addEventListener("abort", onStop);
      }
      let left = RESOLVERS.length;
      for (const r of RESOLVERS) {
        fetch(dohURL(r.doh, name, "SOA"), {
          mode: "cors",
          cache: "no-store",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          headers: { accept: "application/dns-message" },
          signal: c.signal
        }).then((res) => res.ok ? res.arrayBuffer() : null).then((buf) => buf ? parse(buf) : null).then((msg) => {
          if (msg) finish2(msg);
          else if (--left === 0) finish2(null);
        }).catch(() => {
          if (--left === 0) finish2(null);
        });
      }
      return done;
    }
    async function askDs(apex, signal, my, onEach) {
      const answered = {};
      Object.keys(state.results).forEach((type) => state.results[type].forEach((r) => {
        if (r.status === OK) answered[r.id] = 1;
      }));
      const ids = dsAskers(Object.keys(answered));
      const results = await Promise.all(ids.map((id) => {
        const r = RESOLVERS.filter((x) => x.id === id)[0];
        return queryOne(r, apex, "DS", signal, { do: true }).then((res) => {
          if (onEach) onEach();
          return res;
        });
      }));
      for (let i = ids.length; i < 2; i++) if (onEach) onEach();
      if (my !== runId) return false;
      state.ds = dsFound(results);
      state.dnssec = dnssecVerdict(state.ds, dnssecRows(state.results));
      return true;
    }
    async function reaskZone(apex, my) {
      const zoneTypes = state.types.filter((x) => ZONE_TYPES.has(x));
      if (!zoneTypes.length) return;
      const wantDmarc = state.types.indexOf("TXT") >= 0;
      state.apex = apex;
      for (const type of zoneTypes) state.results[type] = [];
      state.dmarc = [];
      await Promise.all(RESOLVERS.map(async (r) => {
        let dead = null;
        for (const type of zoneTypes) {
          const res = dead ? err(r, type, "skipped") : await queryOne(r, apex, type, ctl.signal);
          if (my !== runId) return;
          if (!dead && res.status === "error" && (res.error === "timeout" || res.error === "network" || res.error === "http")) dead = res.error;
          addResult(type, res);
        }
        if (wantDmarc) {
          const res = dead ? err(r, "TXT", "skipped") : await queryOne(r, "_dmarc." + apex, "TXT", ctl.signal);
          if (my !== runId) return;
          state.dmarc.push(res);
        }
      }));
      if (my !== runId) return;
      await askDs(apex, ctl.signal, my);
      if (my !== runId) return;
      finish();
      syncApexNotes();
    }
    function setProgress(done, total) {
      $("prog").textContent = done < total ? t("prog", { done, total }) : "";
    }
    function syncApexNotes() {
      const zone = !!(state.apex && state.apex !== state.domain);
      const set = (id, on) => {
        const n = $(id);
        n.hidden = !on;
        n.textContent = on ? t("q_apex", { domain: state.apex }) : "";
      };
      const tab = ZONE_TYPES.has(state.tab);
      set("propApex", zone && tab);
      set("mailApex", zone && state.types.some((x) => ZONE_TYPES.has(x)));
    }
    function addResult(type, res) {
      if (!state.results[type]) state.results[type] = [];
      state.results[type].push(res);
    }
    const resName = (id) => {
      const r = RESOLVERS.find((x) => x.id === id);
      return r ? r.name : id;
    };
    async function lookup(input, types) {
      const my = ++runId;
      let norm;
      try {
        norm = normalizeDomain(input);
      } catch (e) {
        const reason = e instanceof DomainError ? e.reason : "bad";
        $("err").textContent = reason === "ip" ? t("bad_ip") : reason === "empty" ? t("bad_empty") : t("bad_domain");
        $("err").hidden = false;
        $("domain").focus();
        return;
      }
      if (ctl) ctl.abort();
      ctl = new AbortController();
      state = fresh();
      state.domain = norm.name;
      state.types = types.slice();
      state.tab = types[0] || "A";
      state.startedAt = Date.now();
      $("domain").value = norm.display;
      $("err").hidden = true;
      resetUI();
      setGo(true);
      renderPropSkeleton();
      $("prop").hidden = false;
      skeleton();
      $("prog").textContent = t("running");
      const wantDmarc = types.indexOf("TXT") >= 0;
      const total = RESOLVERS.length * (types.length + (wantDmarc ? 1 : 0)) + 3;
      let done = 0;
      const tick = () => {
        done++;
        setProgress(done, total);
      };
      const browserRdap = fetchRdap(norm.name);
      const rdapP = loadRdap(norm.name, my, browserRdap);
      const apexP = resolveApex(norm.name, ctl.signal, browserRdap).then((apex) => {
        if (my === runId) {
          state.apex = apex;
          syncApexNotes();
          tick();
        }
        return apex;
      });
      const hostTypes = types.filter((x) => !ZONE_TYPES.has(x));
      const zoneTypes = types.filter((x) => ZONE_TYPES.has(x));
      await Promise.all(RESOLVERS.map(async (r) => {
        let dead = null;
        const ask = async (name, type) => {
          if (dead) {
            addResult(type, err(r, type, "skipped"));
            tick();
            if (state.tab === type) renderProp();
            return;
          }
          const res = await queryOne(r, name, type, ctl.signal);
          if (my !== runId) return;
          addResult(type, res);
          if (res.status === "error" && (res.error === "timeout" || res.error === "network" || res.error === "http")) dead = res.error;
          tick();
          if (state.tab === type) renderProp();
        };
        for (const type of hostTypes) {
          if (my !== runId) return;
          await ask(norm.name, type);
        }
        const apex = await apexP;
        if (my !== runId) return;
        for (const type of zoneTypes) {
          if (my !== runId) return;
          await ask(apex, type);
        }
        if (wantDmarc && my === runId) {
          if (dead) {
            state.dmarc.push(err(r, "TXT", "skipped"));
            tick();
          } else {
            const res = await queryOne(r, "_dmarc." + apex, "TXT", ctl.signal);
            if (my !== runId) return;
            state.dmarc.push(res);
            tick();
          }
        }
      }));
      if (my !== runId) return;
      if (!await askDs(state.apex, ctl.signal, my, tick)) return;
      state.finished = true;
      finish();
      await rdapP;
      if (my !== runId) return;
      renderRdap();
      renderMail();
      prepareShare();
      if (state.lateApex && state.lateApex !== state.apex) await reaskZone(state.lateApex, my);
    }
    function setGo(busy) {
      const b = $("go");
      b.disabled = busy;
      b.textContent = t(busy ? "running" : state.finished ? "go_again" : "go");
    }
    function loadRdap(name, my, firstTry) {
      $("rdap").hidden = false;
      $("rdapState").textContent = t("rd_loading");
      $("rdapBody").textContent = "";
      return (firstTry || fetchRdap(name)).then(async (r) => {
        if (my !== runId) return;
        if (r.error || r.unsupported) {
          const proxied = await fetchServerRegistration(name);
          if (my !== runId) return;
          if (proxied) r = proxied;
        }
        state.rdap = r;
        renderRdap();
        const reg = r && typeof r.lookedUp === "string" ? r.lookedUp.toLowerCase() : "";
        const lower = name.toLowerCase();
        const valid = reg && reg.split(".").length >= 2 && (reg === lower || lower.endsWith("." + reg));
        if (valid && reg !== state.apex) {
          if (state.finished) reaskZone(reg, my).catch(() => {
          });
          else state.lateApex = reg;
        }
      });
    }
    function resetUI() {
      $("verdict").hidden = true;
      $("records").hidden = true;
      $("prop").hidden = true;
      $("mail").hidden = true;
      $("rdap").hidden = true;
      $("findings").textContent = "";
      $("links").hidden = true;
      $("links").textContent = "";
      ["propApex", "mailApex"].forEach((id) => {
        $(id).hidden = true;
        $(id).textContent = "";
      });
      $("shareBtn").hidden = true;
      $("reportBtn").hidden = true;
      $("recBody").textContent = "";
      $("recCount").textContent = "";
      $("propRows").textContent = "";
      $("propTabs").textContent = "";
      $("mailBody").textContent = "";
      $("rdapBody").textContent = "";
      $("rdapState").textContent = "";
      $("vDot").className = "dot";
      $("vTitle").textContent = "\xA0";
      $("vSub").textContent = "\xA0";
      $("kAgree").textContent = $("kMail").textContent = $("kDnssec").textContent = "\u2014";
      $("kAgreeWho").textContent = $("kMailWho").textContent = $("kDnssecWho").textContent = "";
      $("badges").textContent = "";
      $("badges").hidden = true;
      $("mailGrade").textContent = "";
      $("mailGrade").className = "st grade";
      all(".shared-bar").forEach((n) => n.parentNode.removeChild(n));
    }
    function skeleton() {
      $("verdict").hidden = false;
      $("vDot").className = "dot";
      $("vTitle").textContent = t("running");
      $("vSub").textContent = " ";
      $("findings").textContent = "";
      for (let i = 0; i < 3; i++) $("findings").appendChild(el("li", "ph", "\u2026"));
      $("badges").textContent = "";
      $("badges").hidden = false;
      renderLinks();
      const tb = $("recBody");
      tb.textContent = "";
      state.types.forEach((type) => {
        const tr = el("tr", "ph");
        tr.appendChild(el("td", "t", type));
        tr.appendChild(el("td", "v", "\u2026"));
        tr.appendChild(el("td", "n", "\u2026"));
        tr.appendChild(el("td", "f", "\u2026"));
        tb.appendChild(tr);
      });
      $("recCount").textContent = "";
      $("records").hidden = false;
      const mb = $("mailBody");
      mb.textContent = "";
      [t("mx_h"), t("spf_h"), t("dmarc_h"), t("ns_h")].forEach((head) => {
        line(block(mb, head, "\u2026"), t("running"), "m");
      });
      $("mail").hidden = false;
      const rb = $("rdapBody");
      rb.textContent = "";
      const dl = el("dl", "rdap");
      [
        t("rd_registrar"),
        t("rd_created"),
        t("rd_expires"),
        t("rd_updated"),
        t("rd_status"),
        t("rd_ns"),
        t("rd_registrant"),
        t("rd_email"),
        t("rd_dnssec")
      ].forEach((k) => {
        dl.appendChild(el("dt", "", k));
        dl.appendChild(el("dd", "", "\u2026"));
      });
      rb.appendChild(dl);
      $("rdapState").textContent = t("rd_loading");
      $("rdap").hidden = false;
    }
    function finish() {
      state.merged = mergeAll(state.results);
      state.records = mergeRecords(state.results);
      renderTabs();
      renderProp();
      renderRecords();
      renderVerdict();
      renderMail();
      renderLinks();
      $("shareBtn").hidden = false;
      $("reportBtn").hidden = false;
      setGo(false);
      setProgress(1, 1);
      prepareShare();
    }
    function renderPropSkeleton() {
      const tabs = $("propTabs");
      tabs.textContent = "";
      state.types.forEach((type) => {
        const b = el("button", "tab");
        b.type = "button";
        b.setAttribute("role", "tab");
        b.dataset.type = type;
        b.setAttribute("aria-selected", String(type === state.tab));
        b.appendChild(document.createTextNode(type));
        b.appendChild(el("span", "tab-n", ""));
        b.onclick = () => {
          state.tab = type;
          renderTabs();
          renderProp();
        };
        tabs.appendChild(b);
      });
      const rows = $("propRows");
      rows.textContent = "";
      RESOLVERS.forEach((r) => {
        const row = el("div", "pr");
        row.dataset.id = r.id;
        const name = el("div", "pr-name", r.name);
        row.appendChild(name);
        row.appendChild(el("div", "pr-state", "\u2026"));
        row.appendChild(el("div", "pr-val"));
        rows.appendChild(row);
      });
      $("propSum").textContent = "";
    }
    function renderTabs() {
      all("#propTabs .tab").forEach((b) => {
        b.setAttribute("aria-selected", String(b.dataset.type === state.tab));
        const mt = state.merged ? state.merged[b.dataset.type] : null;
        const n = b.querySelector(".tab-n");
        if (n) n.textContent = mt && mt.ok.length ? " " + mt.distinct : "";
      });
    }
    const valueText = (res) => {
      if (res.rcode === 3) return t("e_nx");
      if (!res.records.length) return t("e_empty");
      return res.records.map((rec) => rec.type === "CNAME" ? "CNAME \u2192 " + rec.data : rec.data).join(" \xB7 ");
    };
    const errText = (res) => res.error === "http" ? t("e_http", { s: res.statusCode }) : res.error === "rcode" ? t("e_rcode", { s: res.rcodeName }) : t("e_" + res.error);
    function renderProp() {
      const results = state.results[state.tab] || [];
      const byId = {};
      results.forEach((r) => {
        byId[r.id] = r;
      });
      const mt = state.merged ? state.merged[state.tab] : mergeType(results);
      RESOLVERS.forEach((r) => {
        const row = document.querySelector('#propRows .pr[data-id="' + r.id + '"]');
        if (!row) return;
        const res = byId[r.id];
        const st = row.children[1], val = row.children[2];
        if (!res) {
          st.className = "pr-state";
          st.textContent = "\u2026";
          val.className = "pr-val muted";
          val.textContent = "";
          return;
        }
        if (res.status !== OK) {
          st.className = "pr-state err";
          st.textContent = errText(res);
          val.className = "pr-val muted";
          val.textContent = "";
          return;
        }
        const agree = !!mt.majority && answerKey(res.records) === mt.majority.key;
        st.className = "pr-state " + (agree ? "ok" : "diff");
        st.textContent = t(agree ? "agree" : "differs");
        val.className = "pr-val" + (res.records.length || res.rcode === 3 ? "" : " muted");
        val.textContent = valueText(res);
      });
      const sum = $("propSum");
      if (!mt.answered && results.length >= RESOLVERS.length) sum.textContent = t("prop_none");
      else if (!mt.answered) sum.textContent = results.length + " / " + RESOLVERS.length;
      else if (mt.answered === 1) sum.textContent = t("v_one");
      else if (mt.consistency != null) sum.textContent = t("prop_summary", { a: mt.majority.resolvers.length, b: mt.answered });
      else sum.textContent = results.length + " / " + RESOLVERS.length;
      syncApexNotes();
    }
    function heroType() {
      const first = primaryType(state.merged || {});
      const m = first && state.merged ? state.merged[first] : null;
      if (m && m.majority && m.majority.records.length) return first;
      return state.records.length ? state.records[0].type : first;
    }
    function mailFacts() {
      const mx = majorityRecords("MX");
      const nullMx = mx.length === 1 && /^0\s+\.?$/.test(mx[0].data.trim());
      const spf = spfInfo(), dmarc = dmarcInfo();
      return { mx: state.types.indexOf("MX") >= 0 && mx.length > 0 && !nullMx, checked: !!(spf.checked && dmarc.checked), spf, dmarc };
    }
    function renderVerdict() {
      const total = RESOLVERS.length;
      const primary = heroType();
      const m = primary ? state.merged[primary] : null;
      const ans = m ? m.answered : 0, miss = m ? m.unreachable.length : 0;
      const facts = mailFacts();
      const resolve = resolveGrade({ answered: ans, total, consistency: m ? m.consistency : null, records: state.records.length });
      const mail = mailGrade(facts);
      const dn = state.dnssec || { state: "unknown", validators: 0, answered: 0 };
      const grade = overallGrade({ resolve, mail, dnssec: dn.state });
      const agree = m && m.majority ? m.majority.resolvers.length + "/" + ans : "\u2014";
      $("kAgree").textContent = agree;
      $("kAgreeWho").textContent = m && m.consistency != null ? pct(m.consistency) : "";
      $("kMail").textContent = mail || "\u2014";
      $("kMailWho").textContent = mail ? "SPF \xB7 DMARC" : "";
      $("kDnssec").textContent = t("dn_card_" + dn.state);
      $("kDnssecWho").textContent = dn.answered ? dn.answered + " / " + total : "";
      const covered = ans * 2 >= total;
      let title = "", dot = "warn";
      if (!m || !ans) {
        title = t("v_allfail");
        dot = "bad";
      } else if (!m.ok.length) {
        title = t("v_servfail", { n: ans });
        dot = "warn";
      } else if (m.nx && m.nx === m.ok.length) {
        title = t("v_nx", { domain: state.domain });
        dot = "warn";
      } else if (!state.records.length) {
        title = t("v_empty", { type: primary });
        dot = "warn";
      } else if (!covered && m.consistency === 1) {
        title = t("v_few_all", { a: ans, b: total });
        dot = "";
      } else if (!covered) {
        title = t("v_few_most", { a: m.majority.resolvers.length, b: total, c: ans });
        dot = "";
      } else if (m.consistency === 1) {
        title = t("v_all", { n: ans });
        dot = "ok";
      } else if (m.consistency != null) {
        title = t("v_most", { a: m.majority.resolvers.length, b: ans });
        dot = "warn";
      } else {
        title = t("v_one");
        dot = "";
      }
      if (grade === "A" || grade === "B") dot = "ok";
      else if (grade === "C") dot = "warn";
      else if (grade === "D") dot = "bad";
      $("vTitle").textContent = grade ? t("v_grade", { grade }) + " \xB7 " + title : title;
      $("vDot").className = "dot " + dot;
      $("vSub").textContent = m ? t("v_sub", { ok: ans, tot: total, fail: miss }) : t("v_allfail");
      state.grade = { resolve, mail, overall: grade, agree };
      const F = [];
      const add = (level, text2) => F.push({ level, text: text2 });
      const spf = spfInfo(), dmarc = dmarcInfo(), ns = nsInfo();
      if (m) {
        if (m.stale.length) add("warn", t("fd_stale", { n: m.stale.length, b: m.ok.length, names: m.stale.slice(0, 3).map((r) => resName(r.id)).join(", ") }));
        if (miss) add("note", t("fd_fail", { n: miss, b: total }));
      }
      if (spf && spf.checked) {
        if (spf.count === 0) add("warn", t("fd_spf_none"));
        else if (spf.issues.indexOf("plusAll") >= 0) add("bad", t("fd_spf_plus"));
        else if (spf.issues.indexOf("multiple") >= 0) add("warn", t("fd_spf_multi", { n: spf.count }));
        else if (spf.issues.indexOf("noAll") >= 0) add("warn", t("fd_spf_noall"));
        else if (spf.issues.indexOf("tooManyLookups") >= 0) add("warn", t("fd_spf_lookups", { n: spf.lookups }));
      }
      if (dmarc && dmarc.checked) {
        if (dmarc.count === 0) add("warn", t("fd_dmarc_none"));
        else if (dmarc.p === "none") add("warn", t("fd_dmarc_pnone"));
        else if (dmarc.issues.indexOf("noRua") >= 0) add("warn", t("fd_dmarc_norua"));
      }
      if (dn.state === "broken") add("bad", t("dn_broken"));
      if (ns && ns.onlyRegistrar.length) add("warn", t("fd_ns", { names: ns.onlyRegistrar.slice(0, 3).join(", ") }));
      if (ns && ns.onlyResolver.length) add("warn", t("fd_ns_extra", { names: ns.onlyResolver.slice(0, 3).join(", ") }));
      if (!F.some((x) => x.level === "warn" || x.level === "bad") && spf && spf.checked) add("ok", t("fd_ok"));
      F.sort((a, b) => (a.level === "bad" ? 0 : 1) - (b.level === "bad" ? 0 : 1));
      state.findings = F.slice(0, 4);
      const ul = $("findings");
      ul.textContent = "";
      state.findings.forEach((x) => {
        const li = el("li", x.level, x.text);
        ul.appendChild(li);
      });
      const badges = $("badges");
      badges.textContent = "";
      if (state.types.indexOf("CAA") >= 0 && majorityRecords("CAA").length) badges.appendChild(el("span", "badge", t("bd_caa")));
      if (state.types.indexOf("AAAA") >= 0 && majorityRecords("AAAA").length) badges.appendChild(el("span", "badge", t("bd_ipv6")));
      $("verdict").hidden = false;
    }
    const PRIVATE4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
    const isPublic = (ip) => ip.indexOf(":") >= 0 ? !/^(::1?$|fe80:|fc|fd)/i.test(ip) : !PRIVATE4.test(ip);
    function renderRecords() {
      const tb = $("recBody");
      tb.textContent = "";
      state.records.forEach((row) => {
        const tr = el("tr");
        const tc = el("td", "t", row.type);
        if (state.apex && state.apex !== state.domain && ZONE_TYPES.has(row.type)) tc.appendChild(el("span", "apex-at", state.apex));
        tr.appendChild(tc);
        const v = el("td", "v");
        if ((row.type === "A" || row.type === "AAAA") && isPublic(row.data) && asnHref(row.data)) {
          const a = el("a", "", row.data);
          a.href = asnHref(row.data);
          a.target = "_blank";
          a.rel = "noopener";
          a.title = t("lk_asn");
          v.appendChild(a);
        } else v.textContent = row.data;
        const ttl = ttlText(row.ttlMin, row.ttlMax);
        const from = t("rec_n", { n: row.count, b: RESOLVERS.length });
        v.appendChild(el("span", "v-meta", ttl + " \xB7 " + from));
        tr.appendChild(v);
        tr.appendChild(el("td", "n", ttl));
        const f = el("td", "f", from);
        f.title = row.resolvers.map(resName).join(", ");
        tr.appendChild(f);
        tb.appendChild(tr);
      });
      $("recCount").textContent = String(state.records.length);
      $("records").hidden = false;
      syncApexNotes();
    }
    function majorityRecords(type) {
      const m = state.merged && state.merged[type];
      return m && m.majority ? m.majority.records : [];
    }
    function spfInfo() {
      if (state.types.indexOf("TXT") < 0) return { checked: false };
      const txts = majorityRecords("TXT").filter((r) => r.type === "TXT");
      const c = spfCheck(txts);
      c.checked = true;
      return c;
    }
    function dmarcInfo() {
      if (state.types.indexOf("TXT") < 0) return { checked: false };
      const ok = state.dmarc.filter((r) => r.status === OK);
      if (!ok.length) return { checked: true, failed: true, count: 0, issues: [], p: null, rua: [] };
      const mt = mergeType(state.dmarc);
      const records = mt.majority ? mt.majority.records.filter((r) => r.type === "TXT") : [];
      const c = dmarcCheck(records);
      c.checked = true;
      return c;
    }
    function nsInfo() {
      const rows = majorityRecords("NS").map((r) => r.data);
      const reg = state.rdap && state.rdap.data ? state.rdap.data.nameservers : null;
      if (!rows.length || !reg) return null;
      const c = compareNs(reg, rows);
      c.registrar = reg;
      c.resolvers = rows;
      return c;
    }
    function block(parent, title, status, cls) {
      const b = el("div", "blk");
      const h = el("div", "blk-h");
      h.appendChild(el("h4", "", title));
      if (status) h.appendChild(el("span", "st " + (cls || ""), status));
      b.appendChild(h);
      parent.appendChild(b);
      return b;
    }
    function line(b, text2, cls) {
      b.appendChild(el("p", cls || "", text2));
      return b;
    }
    function pills(b, list, cls) {
      const p = el("div", "pills");
      list.forEach((x) => p.appendChild(el("span", "pill " + (cls || ""), x)));
      b.appendChild(p);
    }
    function dnssecBlock(parent) {
      const dn = state.dnssec;
      if (!dn) return;
      const cls = dn.state === "pass" ? "ok" : dn.state === "broken" ? "bad" : "";
      const b = block(parent, t("dnssec_h"), t("dn_" + dn.state), cls);
      line(b, t("dn_" + dn.state + "_why", { n: dn.answered, b: RESOLVERS.length }), "m");
    }
    function renderMail() {
      const body = $("mailBody");
      body.textContent = "";
      syncApexNotes();
      const grade = state.grade;
      $("mailGrade").textContent = grade && grade.mail ? grade.mail : "";
      $("mailGrade").title = t("k_mail");
      $("mailGrade").className = "st grade " + (!grade || !grade.mail ? "" : grade.mail === "C" ? "warn" : grade.mail === "D" ? "bad" : "ok");
      const hasMx = state.types.indexOf("MX") >= 0, hasTxt = state.types.indexOf("TXT") >= 0, hasNs = state.types.indexOf("NS") >= 0;
      if (!hasMx && !hasTxt && !hasNs) {
        block(body, t("h_mail"), null).appendChild(el("p", "m", t("mail_unchecked")));
        dnssecBlock(body);
        $("mail").hidden = false;
        return;
      }
      if (!hasMx) line(block(body, t("mx_h"), null), t("mail_unchecked"), "m");
      else {
        const mx = majorityRecords("MX");
        const mm = state.merged && state.merged.MX, mxUnseen = mm && mm.answered === 0;
        const nullMx = mx.length === 1 && /^0\s+\.?$/.test(mx[0].data.trim());
        if (!mx.length && mxUnseen) {
          const b = block(body, t("mx_h"), null, "");
          line(b, t("mx_noanswer"), "m");
        } else if (!mx.length || nullMx) {
          const b = block(body, t("mx_h"), null, "warn");
          line(b, t(nullMx ? "mx_null" : "mx_none"), "m");
          if (nullMx) pills(b, mx.map((r) => r.data));
        } else {
          const b = block(body, t("mx_h"), String(mx.length));
          pills(b, mx.map((r) => r.data));
        }
      }
      const spf = spfInfo();
      if (!spf.checked) line(block(body, t("spf_h"), null), t("mail_unchecked"), "m");
      else if (spf.count === 0) line(block(body, t("spf_h"), t("spf_none")), t("spf_none"), "m");
      else {
        const st = spf.qualifier === "pass" ? { k: "spf_pass", c: "bad" } : spf.qualifier === "fail" ? { k: "spf_fail", c: "ok" } : spf.qualifier === "softfail" ? { k: "spf_softfail", c: "warn" } : spf.qualifier === "neutral" ? { k: "spf_neutral", c: "warn" } : { k: "spf_noall", c: "warn" };
        const b = block(body, t("spf_h"), t(st.k), st.c);
        line(b, spf.record, "val");
        line(b, t("spf_lookups", { n: spf.lookups }), "m");
        if (spf.count > 1) line(b, t("spf_records", { n: spf.count }), "m");
        line(b, t(spf.issues.length ? "spf_bad" : "spf_ok"), "m");
      }
      const dm = dmarcInfo();
      if (!dm.checked) line(block(body, t("dmarc_h"), null), t("mail_unchecked"), "m");
      else if (dm.failed) line(block(body, t("dmarc_h"), t("dmarc_fail")), t("dmarc_fail"), "m");
      else if (dm.count === 0) line(block(body, t("dmarc_h"), t("dmarc_none")), t("dmarc_none"), "m");
      else {
        const st = dm.p === "reject" ? { k: "dmarc_p_reject", c: "ok" } : dm.p === "quarantine" ? { k: "dmarc_p_quarantine", c: "ok" } : { k: "dmarc_p_none", c: "warn" };
        const b = block(body, t("dmarc_h"), t(st.k), st.c);
        line(b, t("dmarc_p", { p: dm.p || "\u2014" }), "m");
        if (dm.rua.length) line(b, t("dmarc_rua", { n: dm.rua.length }) + " \xB7 " + dm.rua.slice(0, 3).join(", "), "m");
        else line(b, t("dmarc_norua"), "m");
      }
      if (!hasNs) line(block(body, t("ns_h"), null), t("mail_unchecked"), "m");
      else {
        const ns = nsInfo();
        const diffNs = ns && (ns.onlyRegistrar.length || ns.onlyResolver.length);
        const b = block(body, t("ns_h"), ns ? diffNs ? t("differs") : t("ns_same") : null, diffNs ? "warn" : ns ? "ok" : "");
        if (!ns) line(b, t("ns_unknown"), "m");
        else {
          b.appendChild(el("p", "m", t("ns_reg")));
          pills(b, ns.registrar);
          b.appendChild(el("p", "m", t("ns_res")));
          pills(b, ns.resolvers);
          const diff = ns.onlyRegistrar.concat(ns.onlyResolver);
          if (diff.length) line(b, t("ns_diff", { names: diff.slice(0, 4).join(", ") }), "m");
        }
      }
      dnssecBlock(body);
      $("mail").hidden = false;
    }
    function renderRdap() {
      const body = $("rdapBody"), st = $("rdapState");
      body.textContent = "";
      st.textContent = "";
      if (!state.rdap) return;
      $("rdap").hidden = false;
      if (state.rdap.error) {
        st.textContent = t("rd_fail");
        line(body, t("rd_fail"), "m");
        return;
      }
      if (state.rdap.unsupported) {
        const suffix = "." + (state.rdap.tld || tldOf(state.domain));
        st.textContent = t("rd_unsupported", { suffix });
        line(body, t("rd_unsupported_why", { suffix }), "m");
        const reg = registryOf(state.domain);
        if (reg) {
          const p = el("p", "m");
          const a = el("a", "ext", t("rd_whois", { registry: reg.name }));
          a.href = reg.url;
          a.target = "_blank";
          a.rel = "noopener";
          const icon = el("span");
          icon.innerHTML = EXT;
          a.appendChild(icon);
          p.appendChild(a);
          body.appendChild(p);
        } else line(body, t("rd_whois_unknown"), "m");
        return;
      }
      const srcNote = () => body.appendChild(el("p", "m", t(state.rdap.src === "whois" ? "rd_src_whois" : state.rdap.src === "rdap" ? "rd_src_rdap" : "rd_from_rdap")));
      if (state.rdap.notFound) {
        st.textContent = t("rd_none");
        line(body, t("rd_none_why"), "m");
        srcNote();
        return;
      }
      const d = state.rdap.data;
      const dl = el("dl", "rdap");
      const row = (k, v, node) => {
        dl.appendChild(el("dt", "", k));
        const dd = el("dd");
        if (node) dd.appendChild(node);
        else dd.textContent = v == null || v === "" ? "\u2014" : String(v);
        dl.appendChild(dd);
      };
      row(t("rd_registrar"), d.registrar, d.registrarUrl ? (() => {
        const a = el("a", "ext", d.registrar);
        a.href = d.registrarUrl;
        a.target = "_blank";
        a.rel = "noopener";
        const icon = el("span");
        icon.innerHTML = EXT;
        a.appendChild(icon);
        return a;
      })() : null);
      row(t("rd_created"), fmtDate(d.created));
      row(t("rd_expires"), fmtDate(d.expires));
      if (d.updated) row(t("rd_updated"), fmtDate(d.updated));
      if (d.status.length) {
        const wrap = el("div", "pills");
        d.status.slice(0, 6).forEach((s) => wrap.appendChild(el("span", "pill", s)));
        row(t("rd_status"), null, wrap);
      }
      if (d.nameservers.length) {
        const wrap = el("div", "pills");
        d.nameservers.forEach((s) => wrap.appendChild(el("span", "pill", s)));
        row(t("rd_ns"), null, wrap);
      }
      if (d.registrant) row(t("rd_registrant"), d.registrant);
      if (d.registrantOrg) row(t("rd_org"), d.registrantOrg);
      if (d.email) row(t("rd_email"), d.email);
      if (d.phone) row(t("rd_phone"), d.phone);
      if (d.dnssec) row(t("rd_dnssec"), d.dnssec);
      body.appendChild(dl);
      srcNote();
      if (state.rdap.lookedUp && state.rdap.lookedUp !== state.domain)
        body.appendChild(el("p", "m", t("rd_parent", { domain: state.rdap.lookedUp })));
      if (d.raw) {
        const det = el("details", "raw");
        det.appendChild(el("summary", "", t("rd_raw")));
        det.appendChild(el("pre", "", d.raw));
        body.appendChild(det);
      }
    }
    function renderLinks() {
      const box = $("links");
      box.textContent = "";
      const add = (id, key, href) => {
        const u = tool(id);
        if (!u) return;
        const a = el("a", "ext");
        a.href = href || u;
        a.target = "_blank";
        a.rel = "noopener";
        a.appendChild(document.createTextNode(t(key)));
        const icon = el("span");
        icon.innerHTML = EXT;
        a.appendChild(icon);
        box.appendChild(a);
      };
      add("dns", "lk_dns");
      add("ping", "lk_ping", tool("ping") + "?t=" + encodeURIComponent(state.domain));
      box.hidden = !box.children.length;
    }
    const errCode = (e) => CODES[e] != null ? CODES[e] : 7;
    function snapshotOf() {
      const rows = [];
      state.types.forEach((type) => (state.results[type] || []).forEach((r) => {
        rows.push([
          r.id,
          type,
          r.status === OK ? r.rcode === 3 ? 3 : 0 : errCode(r.error),
          r.records.map((rec) => [rec.type, rec.ttl, rec.data])
        ]);
      }));
      const dm = state.dmarc.map((r) => [
        r.id,
        r.status === OK ? r.rcode === 3 ? 3 : 0 : errCode(r.error),
        r.records.map((rec) => [rec.type, rec.ttl, rec.data])
      ]);
      const d = state.rdap && state.rdap.data ? {
        registrar: state.rdap.data.registrar,
        created: state.rdap.data.created,
        expires: state.rdap.data.expires,
        status: state.rdap.data.status,
        nameservers: state.rdap.data.nameservers
      } : null;
      const xz = !state.rdap ? "fail" : state.rdap.data ? "ok" : state.rdap.unsupported ? "no" : state.rdap.notFound ? "none" : "fail";
      const xs = state.rdap && state.rdap.src ? state.rdap.src : null;
      const primary = heroType();
      const m = primary && state.merged ? state.merged[primary] : null;
      const first = m && m.majority && m.majority.records.length ? m.majority.records[0] : null;
      return {
        v: 1,
        d: state.domain,
        t: state.types,
        at: state.startedAt,
        r: rows,
        m: dm,
        x: d,
        xz,
        xs,
        // the zone the mail and NS rows came from, when the visitor typed a host inside it (an older link has none)
        ap: state.apex && state.apex !== state.domain ? state.apex : null,
        // the DNSSEC verdict, so a shared link shows the same third number (an older link has none: "unknown")
        dn: state.dnssec ? [state.dnssec.state, state.dnssec.answered] : ["unknown", 0],
        s: {
          ty: primary || state.types[0] || "A",
          val: first ? first.data : "",
          ok: m ? m.answered : 0,
          tot: RESOLVERS.length,
          n: state.records.length
        }
      };
    }
    let sharePromise = null;
    function prepareShare() {
      if (!state.finished) return;
      sharePromise = encodeResult(snapshotOf()).then((code) => {
        state.shareCode = code;
        return code;
      }).catch(() => "");
    }
    $("shareBtn").onclick = async () => {
      if (!state.shareCode) {
        prepareShare();
        await sharePromise;
      }
      if (!state.shareCode) return;
      const mod = await import("/assets/share/share.js?v=9");
      mod.share({
        lang: LANG,
        name: t("app_name"),
        file: "dns-records",
        show: [],
        never: ["ip"],
        link: () => location.origin + (D.paths && D.paths[LANG] ? D.paths[LANG] : "/") + "r/" + state.shareCode,
        home: location.origin + (D.paths && D.paths[LANG] ? D.paths[LANG] : "/"),
        text: () => {
          const s = snapshotOf().s;
          return s.val ? t("share_title", { domain: state.domain, type: s.ty, value: s.val }) : t("share_title_none", { domain: state.domain, n: s.n });
        },
        ts: state.startedAt,
        height: 720,
        draw: drawCard,
        foot: () => [t("card_foot")]
      }).open();
    };
    function drawCard(x, kit) {
      const P = kit.P, w = kit.W - P * 2, F = kit.F, M = kit.M, v = kit.v;
      const g = state.grade || {};
      const grade = g.overall || null;
      const dn = state.dnssec || { state: "unknown" };
      x.textBaseline = "alphabetic";
      x.textAlign = "left";
      const S = 132, gx = P, gy = kit.top + 2;
      x.fillStyle = v("line");
      kit.roundRect(x, gx, gy, S, S, 18);
      x.fill();
      x.fillStyle = grade ? v(grade === "D" ? "bad" : grade === "C" ? "warn" : "ok") : v("muted");
      x.font = "700 84px " + M;
      const letter = grade || "\u2014";
      const lw = x.measureText(letter).width;
      x.fillText(letter, gx + (S - lw) / 2, gy + S / 2 + 30);
      x.fillStyle = v("fg");
      let dz = 46;
      x.font = "700 " + dz + "px " + F;
      while (dz > 24 && x.measureText(state.domain).width > w - S - 28) {
        dz -= 2;
        x.font = "700 " + dz + "px " + F;
      }
      x.fillText(state.domain, gx + S + 28, gy + 58);
      x.fillStyle = v("muted");
      x.font = "400 24px " + F;
      x.fillText(t("card_grade"), gx + S + 28, gy + 98);
      const primary = heroType();
      const m = primary && state.merged ? state.merged[primary] : null;
      const ans = m ? m.answered : 0;
      const covered = ans * 2 >= RESOLVERS.length;
      const rd = state.rdap || null;
      const suffix = "." + (rd && rd.tld || tldOf(state.domain));
      const rdap = !rd ? ["bad", t("rd_fail")] : rd.data ? ["ok", rd.data.registrar || "\u2014"] : rd.unsupported ? ["muted", t("rd_unsupported", { suffix })] : rd.notFound ? ["muted", t("rd_none")] : ["bad", t("rd_fail")];
      const rows = [
        [
          m && m.majority ? covered && m.consistency === 1 ? "ok" : "warn" : "muted",
          t("k_agree"),
          m && m.majority ? m.majority.resolvers.length + " / " + ans : "\u2014"
        ],
        [!g.mail ? "muted" : g.mail === "D" ? "bad" : g.mail === "C" ? "warn" : "ok", t("k_mail"), g.mail || "\u2014"],
        [dn.state === "pass" ? "ok" : dn.state === "broken" ? "bad" : "muted", t("k_dnssec"), t("dn_card_" + dn.state)],
        [rdap[0], t("h_rdap"), rdap[1]]
      ];
      const rh = 60, ry = gy + S + 30;
      rows.forEach((row, i) => {
        const y = ry + i * rh;
        x.fillStyle = v("line");
        x.fillRect(P, y, w, 1);
        x.fillStyle = v(row[0] === "muted" ? "muted" : row[0]);
        x.beginPath();
        x.arc(P + 7, y + 36, 7, 0, Math.PI * 2);
        x.fill();
        x.fillStyle = v("fg");
        kit.fit(x, row[1], w * 0.36, 30, 20, 600);
        x.fillText(row[1], P + 30, y + 46);
        x.fillStyle = v(row[0] === "muted" ? "muted" : "fg");
        kit.fit(x, row[2], w * 0.58, 30, 20, 600);
        x.fillText(row[2], P + w - x.measureText(row[2]).width, y + 46);
      });
      const problems = (state.findings || []).filter((f) => f.level === "warn" || f.level === "bad").length;
      const cov = m ? t("card_cov", { ok: ans, tot: RESOLVERS.length, fail: m.unreachable.length }) + " \xB7 " + (problems ? t("card_findings", { n: problems }) : t("card_clean")) : t("v_allfail");
      x.fillStyle = v("muted");
      x.textAlign = "left";
      kit.fit(x, cov, w, 22, 15, 400);
      x.fillText(cov, P, ry + rows.length * rh + 30);
    }
    function showOldBrowser() {
      $("vDot").className = "dot warn";
      $("vTitle").textContent = t("v_old_browser");
      $("vSub").textContent = t("v_old_browser_sub");
      $("verdict").hidden = false;
    }
    function sharedBanner(snap) {
      import("/assets/share/share.js?v=9").then(({ received }) => {
        received({
          lang: LANG,
          ts: snap.at,
          at: document.querySelector(".hero"),
          test: () => {
            try {
              history.replaceState(null, "", (D.paths && D.paths[LANG] ? D.paths[LANG] : "/") + location.search);
            } catch (e) {
            }
            lookup(state.domain, state.types);
          }
        });
      }, () => {
      });
    }
    function renderSnapshot(snap) {
      state = fresh();
      state.shared = true;
      state.domain = snap.d;
      state.apex = typeof snap.ap === "string" && /^[a-z0-9.-]+$/i.test(snap.ap) ? snap.ap : snap.d;
      state.types = snap.t.filter((x) => ALL_TYPES.indexOf(x) >= 0);
      state.tab = state.types[0] || "A";
      state.startedAt = snap.at || Date.now();
      state.results = resultsFromSnapshot(snap);
      const dn = snap.dn || ["unknown", 0];
      state.dnssec = { state: dn[0] === "pass" || dn[0] === "broken" || dn[0] === "off" ? dn[0] : "unknown", answered: Number(dn[1]) || 0, validators: 0 };
      state.dmarc = snap.m && snap.m.length ? resultsFromSnapshot({ r: snap.m.map((a) => [a[0], "TXT", a[1], a[2] || []]) }).TXT || [] : [];
      state.rdap = snap.xz === "no" ? { unsupported: true, tld: tldOf(snap.d) } : snap.xz === "none" || !snap.xz && !snap.x ? { notFound: true } : snap.xz === "ok" || snap.x ? {
        src: snap.xs === "whois" ? "whois" : snap.xs === "rdap" ? "rdap" : null,
        data: {
          registrar: snap.x.registrar,
          created: snap.x.created,
          expires: snap.x.expires,
          updated: null,
          status: snap.x.status || [],
          nameservers: snap.x.nameservers || [],
          registrarUrl: null
        }
      } : { error: "snapshot" };
      $("domain").value = snap.d;
      $("err").hidden = true;
      resetUI();
      renderPropSkeleton();
      state.merged = mergeAll(state.results);
      state.records = mergeRecords(state.results);
      renderTabs();
      renderProp();
      renderRecords();
      renderVerdict();
      renderMail();
      renderRdap();
      renderLinks();
      sharedBanner(snap);
      $("shareBtn").hidden = false;
      $("reportBtn").hidden = false;
      $("go").textContent = t("go_again");
      setProgress(1, 1);
      state.finished = true;
      prepareShare();
    }
    const form = $("f");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      lookup($("domain").value, readTypes());
    });
    function boot() {
      const sp = sharePath(location.pathname);
      if (sp) {
        decodeResult(sp.code).then((snap) => {
          if (snap) renderSnapshot(snap);
          else showOldBrowser();
        }).catch(() => showOldBrowser());
        return;
      }
      const q = new URLSearchParams(location.search).get("d");
      if (q) {
        $("domain").value = q;
        lookup(q, readTypes());
      }
    }
    window.msReport = () => state.finished ? {
      summary: (primaryType(state.merged || {}) ? document.getElementById("vTitle").textContent || "" : "") + " \xB7 " + state.domain,
      data: { domain: state.domain, types: state.types, records: state.records.slice(0, 40).map((r) => [r.type, r.data, r.ttlMin, r.ttlMax, r.count]) },
      picks: (state.findings || []).slice(0, 8).map((f) => f.text)
    } : null;
    boot();
  })();
})();
