import test from "node:test";
import assert from "node:assert/strict";
import { query, parse, dohURL, b64url, formatIPv6, answerOf, answerKey, TYPES, RCODE } from "../src/dns.mjs";

const bytes = s => Uint8Array.from([...s].map(c => c.charCodeAt(0)));
const u16 = n => [n >> 8 & 255, n & 255];
const u32 = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
const name = n => n.split(".").flatMap(l => [l.length, ...bytes(l)]).concat([0]);

function rr(owner, type, ttl, rdata) {
  const own = owner === null ? [0xc0, 0x0c] : name(owner);
  return [...own, ...u16(type), 0, 1, ...u32(ttl), ...u16(rdata.length), ...rdata];
}

// a response to "example.com A" (the question sits at offset 12, so 0xc00c points at it)
function response(answers, { rcode = 0, ad = false, tc = false } = {}) {
  const q = [...name("example.com"), 0, 1, 0, 1];
  const flags = 0x8180 | (ad ? 0x20 : 0) | (tc ? 0x0200 : 0) | rcode;
  return Uint8Array.from([0, 0, flags >> 8, flags & 255, 0, 1, 0, answers.length, 0, 0, 0, 0, ...q, ...answers.flat()]);
}

test("query builds a wire-format question with EDNS and the AD bit", () => {
  const q = query("example.com", "MX");
  assert.equal(q.length, 12 + 1 + 7 + 1 + 3 + 1 + 4 + 11);
  assert.deepEqual([...q.slice(0, 6)], [0, 0, 1, 0x20, 0, 1]);
  assert.equal(q[12], 7);                       // "example"
  assert.deepEqual([...q.slice(24, 29)], [0, 0, 15, 0, 1]);   // root label, MX, IN
  assert.equal(q[29], 0);                       // OPT owner
  assert.deepEqual([...q.slice(30, 34)], [0, 41, 4, 0xd0]);
  assert.deepEqual([...q.slice(34, 38)], [0, 0, 0, 0]);   // OPT TTL: no DO bit unless asked
  assert.throws(() => query("例え.テスト", "A"), /punycode/);
});

test("only a DS query sets the EDNS DO bit", () => {
  const q = query("example.com", "DS", { do: true });
  assert.deepEqual([...q.slice(25, 27)], [0, 43]);   // DS
  assert.deepEqual([...q.slice(34, 38)], [0, 0, 0x80, 0]);   // OPT TTL: flags 0x8000, DO in the high byte
  assert.deepEqual([...query("example.com", "DS").slice(34, 38)], [0, 0, 0, 0]);
});

test("parse reads DS and DNSKEY records", () => {
  const digest = [0xde, 0xad, 0xbe, 0xef].concat(Array(28).fill(7));
  const ds = [...u16(2371), 13, 2, ...digest];
  const dnskey = [...u16(257), 3, 8, ...Array(16).fill(9)];
  const by = Object.fromEntries(parse(response([rr(null, 43, 3600, ds), rr(null, 48, 3600, dnskey)])).answers.map(r => [r.type, r]));
  assert.deepEqual([by.DS.keyTag, by.DS.algorithm, by.DS.digestType], [2371, 13, 2]);
  assert.equal(by.DS.digest.length, 64);
  assert.equal(by.DS.data, "2371 13 2 " + by.DS.digest);
  assert.deepEqual([by.DNSKEY.flags, by.DNSKEY.protocol, by.DNSKEY.algorithm], [257, 3, 8]);
  assert.equal(by.DNSKEY.data, "257 3 8 …");
});

test("dohURL encodes the query as base64url without padding", () => {
  const url = dohURL("https://dns.google/dns-query", "example.com", "A");
  assert.match(url, /^https:\/\/dns\.google\/dns-query\?dns=[A-Za-z0-9_-]+$/);
  const body = url.split("dns=")[1];
  assert.equal(b64url(query("example.com", "A")), body);
  assert.ok(!body.includes("="));
});

test("parse reads A records, TTL and the AD flag", () => {
  const buf = response([rr(null, 1, 300, [93, 184, 216, 34]), rr(null, 1, 120, [1, 2, 3, 4])], { ad: true });
  const m = parse(buf);
  assert.equal(m.rcode, 0);
  assert.equal(m.ad, true);
  assert.equal(m.questions[0].name, "example.com");
  assert.equal(m.questions[0].type, "A");
  assert.deepEqual(m.answers.map(r => [r.type, r.data, r.ttl]), [["A", "93.184.216.34", 300], ["A", "1.2.3.4", 120]]);
});

test("parse reads AAAA, MX, TXT, CNAME, SOA, SRV and CAA", () => {
  const aaaa = [0x26, 0x06, 0x47, 0x00, 0x47, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0x11, 0x11];
  const mx = [...u16(10), ...name("mail.example.com")];
  const txt = [7, ...bytes("v=spf1 "), 24, ...bytes("include:_spf.example.com")];
  const soa = [...name("ns1.example.com"), ...name("hostmaster.example.com"), ...u32(2024010101), ...u32(7200), ...u32(3600), ...u32(1209600), ...u32(300)];
  const srv = [...u16(10), ...u16(5), ...u16(443), ...name("target.example.com")];
  const caa = [0, 5, ...bytes("issue"), ...bytes("letsencrypt.org")];
  const buf = response([
    rr(null, 28, 60, aaaa), rr(null, 15, 60, mx), rr(null, 16, 60, txt),
    rr(null, 5, 60, name("alias.example.com")), rr(null, 6, 60, soa), rr(null, 33, 60, srv), rr(null, 257, 60, caa),
  ]);
  const m = parse(buf);
  const by = Object.fromEntries(m.answers.map(r => [r.type, r]));
  assert.equal(by.AAAA.data, "2606:4700:4700::1111");
  assert.equal(by.MX.preference, 10);
  assert.equal(by.MX.exchange, "mail.example.com");
  assert.equal(by.TXT.text, "v=spf1 include:_spf.example.com");
  assert.equal(by.CNAME.target, "alias.example.com");
  assert.equal(by.SOA.serial, 2024010101);
  assert.equal(by.SOA.minimum, 300);
  assert.equal(by.SRV.port, 443);
  assert.equal(by.SRV.target, "target.example.com");
  assert.deepEqual([by.CAA.flags, by.CAA.tag, by.CAA.value], [0, "issue", "letsencrypt.org"]);
});

test("parse reports NXDOMAIN and truncation, and rejects things that are not answers", () => {
  const nx = parse(response([], { rcode: RCODE.NXDOMAIN }));
  assert.equal(nx.rcode, 3);
  assert.equal(nx.rcodeName, "NXDOMAIN");
  assert.equal(parse(response([], { tc: true })).tc, true);
  assert.equal(parse(new Uint8Array([0, 1, 2])), null);
  assert.equal(parse(Uint8Array.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0])), null);   // QR bit clear
});

test("a compression pointer loop is rejected", () => {
  const buf = Uint8Array.from([0, 0, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0, 0xc0, 0x0c]);
  assert.throws(() => parse(buf), /pointer loop|runs past/);
});

test("formatIPv6 follows RFC 5952", () => {
  assert.equal(formatIPv6(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])), "::1");
  assert.equal(formatIPv6(new Uint8Array(16)), "::");
  assert.equal(formatIPv6(Uint8Array.from([0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])), "2001:db8::1");
  assert.equal(formatIPv6(Uint8Array.from([0x20, 0x01, 0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7])), "2001:1:2:3:4:5:6:7");
});

test("answerOf keeps the CNAME chain with the asked type, order-insensitively", () => {
  const buf = response([rr(null, 5, 60, name("cdn.example.net")), rr(null, 1, 60, [1, 2, 3, 4])]);
  const m = parse(buf);
  const a = answerOf(m, "A");
  assert.deepEqual(a.map(r => r.type), ["A", "CNAME"]);
  const b = answerOf(m, "A").slice().reverse();
  assert.equal(answerKey(a), answerKey(b));
  assert.deepEqual(answerOf(m, "AAAA").map(r => r.type), ["CNAME"]);   // the alias applies to every type
  assert.equal(TYPES.CAA, 257);
});

test("a null MX (0 .) keeps its root exchange as a dot", () => {
  const m = parse(response([rr(null, 15, 300, [...u16(0), 0])]));
  assert.equal(m.answers[0].data, "0 .");
  assert.equal(m.answers[0].preference, 0);
  assert.equal(m.answers[0].exchange, "");
});
