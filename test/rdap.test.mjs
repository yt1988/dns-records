import test from "node:test";
import assert from "node:assert/strict";
import { fetchRdap, normalize, RDAP_BASE, tldOf, registryOf } from "../src/rdap.mjs";

const json = {
  handle: "2336799_DOMAIN_COM-VRSN",
  status: ["client transfer prohibited"],
  events: [
    { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" },
    { eventAction: "expiration", eventDate: "2026-08-13T04:00:00Z" },
    { eventAction: "last changed", eventDate: "2025-08-14T07:01:38Z" },
  ],
  entities: [
    { roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "REDACTED FOR PRIVACY"]]] },
    { roles: ["registrar"], handle: "376", vcardArray: ["vcard", [["fn", {}, "text", "RESERVED-Internet Assigned Numbers Authority"]]] },
  ],
  nameservers: [{ ldhName: "A.IANA-SERVERS.NET" }, { ldhName: "b.iana-servers.net." }],
};

test("normalize picks the registrar, dates, status and name servers", () => {
  const d = normalize(json);
  assert.equal(d.registrar, "RESERVED-Internet Assigned Numbers Authority");
  assert.equal(d.created, "1995-08-14T04:00:00Z");
  assert.equal(d.expires, "2026-08-13T04:00:00Z");
  assert.deepEqual(d.status, ["client transfer prohibited"]);
  assert.deepEqual(d.nameservers, ["a.iana-servers.net", "b.iana-servers.net"]);
});

test("missing fields stay null instead of becoming text", () => {
  const d = normalize({ handle: "X" });
  assert.equal(d.registrar, null);
  assert.equal(d.created, null);
  assert.deepEqual(d.status, []);
  assert.deepEqual(d.nameservers, []);
});

test("fetchRdap asks rdap.org and separates not-found, HTTP and network failures", async () => {
  let asked = "";
  const good = await fetchRdap("example.com", { fetchImpl: async url => { asked = url; return { ok: true, status: 200, json: async () => json }; } });
  assert.equal(asked, RDAP_BASE + "example.com");
  assert.equal(good.data.registrar, "RESERVED-Internet Assigned Numbers Authority");

  const gone = await fetchRdap("nope.example", { fetchImpl: async () => ({ ok: false, status: 404, text: async () => '{"errorCode":404,"title":"Not Found"}' }) });
  assert.deepEqual(gone, { notFound: true, lookedUp: "nope.example" });
  const bad = await fetchRdap("example.com", { fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.deepEqual(bad, { error: "http", status: 503 });
  const down = await fetchRdap("example.com", { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual(down, { error: "network" });
});

test("a suffix with no RDAP is not a domain without registration data", async () => {
  const noService = '{"rdapConformance":["rdap_level_0"],"errorCode":404,"title":"No RDAP service is available for this resource"}';
  const cn = await fetchRdap("sina.cn", { fetchImpl: async () => ({ ok: false, status: 404, text: async () => noService }) });
  assert.deepEqual(cn, { unsupported: true, tld: "cn", lookedUp: "sina.cn" });

  // an unreadable 404 from a suffix we know has no service is still "we could not ask"
  const jp = await fetchRdap("example.jp", { fetchImpl: async () => ({ ok: false, status: 404, text: async () => "" }) });
  assert.deepEqual(jp, { unsupported: true, tld: "jp", lookedUp: "example.jp" });

  // ...but an unreadable 404 from a covered suffix is the registry saying the name is not there
  const com = await fetchRdap("nope.example", { fetchImpl: async () => ({ ok: false, status: 404, text: async () => "" }) });
  assert.deepEqual(com, { notFound: true, lookedUp: "nope.example" });
});

test("a host name is asked as itself first, then as the domain it belongs to", async () => {
  const asked = [];
  const res = await fetchRdap("www.example.com", { fetchImpl: async url => {
    asked.push(url);
    return url === RDAP_BASE + "example.com"
      ? { ok: true, status: 200, json: async () => json }
      : { ok: false, status: 404, text: async () => '{"errorCode":404,"title":"Not Found"}' };
  } });
  assert.deepEqual(asked, [RDAP_BASE + "www.example.com", RDAP_BASE + "example.com"]);
  assert.equal(res.lookedUp, "example.com");
  assert.equal(res.data.registrar, "RESERVED-Internet Assigned Numbers Authority");
});

test(".io is asked of Identity Digital directly, not rdap.org", async () => {
  let asked = "";
  const ok = await fetchRdap("example.io", { fetchImpl: async url => { asked = url; return { ok: true, status: 200, json: async () => json }; } });
  assert.equal(asked, "https://rdap.identitydigital.services/rdap/domain/example.io");
  assert.equal(ok.data.registrar, "RESERVED-Internet Assigned Numbers Authority");
  // a 404 here is the registry saying the domain does not exist, not a missing service
  const gone = await fetchRdap("nope.io", { fetchImpl: async () => ({ ok: false, status: 404, text: async () => "No RDAP service is available for this resource" }) });
  assert.deepEqual(gone, { notFound: true, lookedUp: "nope.io" });
});

test("the registry WHOIS link is known for the suffixes we cannot ask", () => {
  assert.equal(registryOf("sina.cn").name, "CNNIC");
  assert.equal(registryOf("example.jp").name, "JPRS");
  assert.equal(registryOf("EXAMPLE.RU.").name, "TCI");
  assert.equal(registryOf("example.io"), null);
  assert.equal(tldOf("www.example.co.uk"), "uk");
  assert.equal(tldOf("localhost"), "");
});
