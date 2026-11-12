// The Worker's registration lookup: which domains it accepts, how each registry's WHOIS text is read — registrant side
// included — and that one call does the whole RDAP-then-WHOIS chain. The socket and HTTP are stubbed here; the real
// servers are checked by hand (docs/decisions.md).
import test from "node:test";
import assert from "node:assert/strict";
import { validDomain, parseWhois, isoDate, queryWhois, lookupRegistration, WHOIS_SERVERS } from "../src/whois.mjs";

const CN = `Domain Name: SINA.CN
ROID: 20030311s10001s00038551-cn
Domain Status: clientDeleteProhibited
Domain Status: serverTransferProhibited
Registrant: 一些公司
Registrant Contact Email: someone@example.com
Sponsoring Registrar: 北京国科云计算技术有限公司
Name Server: ns3.sina.com.cn
Name Server: ns2.sina.com.cn
Registration Time: 2003-03-17 12:20:05
Expiration Time: 2027-03-17 12:48:36
DNSSEC: unsigned
`;

const JP = `Domain Information:
[Domain Name]                   JPRS.JP
[Registrant]                    Japan Registry Services Co.,Ltd.
[Name Server]                   ns1.jprs.jp
[Name Server]                   ns2.jprs.jp
[Created on]                    2001/02/02
[Expires on]                    2027/02/28
[Status]                        Active
[Lock Status]                   DomainTransferLocked
[Last Updated]                  2026/03/01 01:05:03 (JST)
[Name]                          Japan Registry Services Co.,Ltd.
[Email]                         someone@example.jp
`;

const RU = `% TCI Whois Service
domain:        TCINET.RU
nserver:       ns1.tcinet.ru.
registrar:     RU-CENTER-RU
org:           Some Company
created:       1997-09-23T09:00:00Z
paid-till:     2027-10-01T21:00:00Z
state:         REGISTERED, DELEGATED, VERIFIED
`;

const HK = `Domain Name Information:

Domain Name:  HKIRC.HK Bundled Domain Name:   香港互聯網註冊.HK /.香港
Domain Name Commencement Date: 04-05-2004
Expiry Date: 16-11-2035
Domain Status: Active

Registrar Name: Hong Kong Domain Name Registration Company Limited

Name Servers Information:

NS7.HKIRC.NET.HK
NS8.HKIRC.NET.HK

Status Information:
`;

test("only a plain ASCII domain reaches a registry", () => {
  assert.equal(validDomain("sina.cn"), "sina.cn");
  assert.equal(validDomain(" Example.DE. "), "example.de");
  assert.equal(validDomain("xn--fiqs8s.cn"), "xn--fiqs8s.cn");
  for (const bad of ["", "com", "-a.com", "a..com", "a b.com", "example.com/path", "a.com\r\nX: y", "a_b.com", "例子.cn"]) {
    assert.equal(validDomain(bad), null, JSON.stringify(bad) + " should be refused");
  }
  assert.equal(validDomain("a".repeat(64) + ".com"), null);
});

test("dates from the four registries become what the page can format", () => {
  assert.equal(isoDate("2003-03-17 12:20:05"), "2003-03-17T12:20");
  assert.equal(isoDate("2001/02/02"), "2001-02-02");
  assert.equal(isoDate("16-11-2035"), "2035-11-16");     // HKDNR writes the day first
  assert.equal(isoDate("1997-09-23T09:00:00Z"), "1997-09-23T09:00");
  assert.equal(isoDate(""), null);
});

test("CNNIC's English WHOIS keys are read, registrant included", () => {
  const d = parseWhois(CN);
  assert.equal(d.registrar, "北京国科云计算技术有限公司");
  assert.equal(d.created, "2003-03-17T12:20");
  assert.equal(d.expires, "2027-03-17T12:48");
  assert.deepEqual(d.nameservers, ["ns3.sina.com.cn", "ns2.sina.com.cn"]);
  assert.deepEqual(d.status, ["clientDeleteProhibited", "serverTransferProhibited"]);
  // published by the registry, so it is shown as written — Chinese registrant names included
  assert.equal(d.registrant, "一些公司");
  assert.equal(d.email, "someone@example.com");
  assert.equal(d.dnssec, "unsigned");
});

test("JPRS's bracket keys are read, registrant included", () => {
  const d = parseWhois(JP);
  assert.equal(d.created, "2001-02-02");
  assert.equal(d.expires, "2027-02-28");
  assert.deepEqual(d.status, ["Active"]);
  assert.deepEqual(d.nameservers, ["ns1.jprs.jp", "ns2.jprs.jp"]);
  assert.equal(d.registrant, "Japan Registry Services Co.,Ltd.");
  assert.equal(d.email, "someone@example.jp");
  assert.equal(d.registrar, null);
});

test("TCI's key: value pairs and comma-separated states are read", () => {
  const d = parseWhois(RU);
  assert.equal(d.registrar, "RU-CENTER-RU");
  assert.equal(d.created, "1997-09-23T09:00");
  assert.equal(d.expires, "2027-10-01T21:00");
  assert.deepEqual(d.status, ["REGISTERED", "DELEGATED", "VERIFIED"]);
  assert.deepEqual(d.nameservers, ["ns1.tcinet.ru"]);
  assert.equal(d.registrantOrg, "Some Company");
});

test("HKDNR's date-first fields and bare name-server list are read", () => {
  const d = parseWhois(HK);
  assert.equal(d.registrar, "Hong Kong Domain Name Registration Company Limited");
  assert.equal(d.created, "2004-05-04");
  assert.equal(d.expires, "2035-11-16");
  assert.deepEqual(d.nameservers, ["ns7.hkirc.net.hk", "ns8.hkirc.net.hk"]);
  assert.deepEqual(d.status, ["Active"]);
});

test("a reply with no fields at all is not turned into an empty registration", () => {
  assert.equal(parseWhois("some banner\nno records here"), null);
  assert.equal(parseWhois(""), null);
});

// A socket stand-in: opened resolves, the reply is queued, then the stream ends.
function fakeConnect(reply) {
  const seen = [];
  const connect = (host, port) => {
    seen.push([host, port]);
    return {
      opened: Promise.resolve(),
      writable: { getWriter: () => ({ write: async q => { seen.push(q); }, releaseLock() {} }) },
      readable: { getReader: () => {
        let done = false;
        return { read: async () => (done ? { done: true } : (done = true, { done: false, value: new TextEncoder().encode(reply) })) };
      } },
      close() {},
    };
  };
  connect.seen = seen;
  return connect;
}

test("the domain and the registry's own query suffix are what goes over the socket", async () => {
  const connect = fakeConnect(JP);
  const text = await queryWhois("jprs.jp", WHOIS_SERVERS.jp, { connect });
  assert.equal(text, JP);
  assert.deepEqual(connect.seen[0], ["whois.jprs.jp", 43]);
  assert.equal(new TextDecoder().decode(connect.seen[1]), "jprs.jp/e\r\n");
});

test("no socket to open leaves no answer instead of guessing", async () => {
  assert.equal(await queryWhois("sina.cn", WHOIS_SERVERS.cn, {}), null);
  assert.equal(await queryWhois("sina.cn", WHOIS_SERVERS.cn, { connect: () => { throw new Error("blocked"); } }), null);
});

const noRdap = () => new Response("No RDAP service is available for this resource", { status: 404 });

test("with RDAP unreachable, the registry's WHOIS answers and is marked as such", async () => {
  const out = await lookupRegistration("sina.cn", { fetchImpl: async () => noRdap(), connect: fakeConnect(CN) });
  assert.equal(out.ok, true);
  assert.equal(out.src, "whois");
  assert.equal(out.registrar, "北京国科云计算技术有限公司");
  assert.equal(out.registrant, "一些公司");
  assert.equal(out.email, "someone@example.com");
  assert.equal(out.dnssec, "unsigned");
  // the registry's own reply travels with the parsed fields, so a field the parser misses is still readable
  assert.equal(out.raw, CN.trim());
});

test("one lookup does the whole chain: one RDAP request, then one socket, never a second round trip", async () => {
  let fetches = 0, sockets = 0;
  const connect = (host, port) => { sockets++; return fakeConnect(CN)(host, port); };
  const out = await lookupRegistration("sina.cn", { fetchImpl: async () => { fetches++; return noRdap(); }, connect });
  assert.equal(out.src, "whois");
  assert.equal(fetches, 1, "RDAP is asked once");
  assert.equal(sockets, 1, "and WHOIS once, inside the same call");
});

test("the page asks the Worker at most once per lookup, and only after the browser's own RDAP failed", async () => {
  // the built page cannot be run here without a DOM; this pins the shape of the one call site instead
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  // one call site in the whole page: the fallback inside loadRdap, after the browser's own RDAP failed
  assert.equal((app.match(/fetchServerRegistration\(/g) || []).length, 1, "exactly one call to the Worker");
  const at = app.indexOf("fetchServerRegistration(name)");
  assert.ok(at > 0, "the call goes through the single fallback in loadRdap");
  assert.ok(app.slice(at, at + 400).includes("state.rdap = r"), "its result is the answer, not a second request");
});

test("RDAP that works is used first, and says src rdap", async () => {
  const rdap = { handle: "D1", status: ["active"], events: [{ eventAction: "registration", eventDate: "2000-01-01T00:00:00Z" }],
    nameservers: [{ ldhName: "NS1.EXAMPLE.DE" }], entities: [] };
  let asked = null;
  const out = await lookupRegistration("example.de", {
    fetchImpl: async (url) => { asked = String(url); return new Response(JSON.stringify(rdap), { status: 200 }); },
    connect: () => { throw new Error("no socket should be opened"); },
  });
  assert.match(asked, /rdap\.denic\.de/);
  assert.equal(out.src, "rdap");
  assert.equal(out.created, "2000-01-01T00:00:00Z");
  assert.deepEqual(out.nameservers, ["ns1.example.de"]);
});

test("a registry that says it never heard of the domain is not asked over WHOIS", async () => {
  let sockets = 0;
  const out = await lookupRegistration("nope.com", {
    fetchImpl: async () => new Response("{}", { status: 404 }),
    connect: () => { sockets++; return null; },
  });
  assert.deepEqual(out, { ok: false, src: "rdap", reason: "notfound", tld: "com" });
  assert.equal(sockets, 0);
});

test("a suffix we have no server for is 'cannot ask', not 'nothing there'", async () => {
  const out = await lookupRegistration("example.vn", { fetchImpl: async () => noRdap(), connect: fakeConnect("") });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "no-service");
  assert.equal(out.tld, "vn");
});

test("a WHOIS reply that says the domain is not registered is not found, not an error", async () => {
  const out = await lookupRegistration("no-such-domain-zzz9.cn", { fetchImpl: async () => noRdap(), connect: fakeConnect("No matching record.") });
  assert.deepEqual(out, { ok: false, src: "whois", reason: "notfound", tld: "cn" });
});
