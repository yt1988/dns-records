import test from "node:test";
import assert from "node:assert/strict";
import { fetchRdap, normalize, RDAP_BASE } from "../src/rdap.mjs";

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

  const gone = await fetchRdap("nope.example", { fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.deepEqual(gone, { notFound: true });
  const bad = await fetchRdap("example.com", { fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.deepEqual(bad, { error: "http", status: 503 });
  const down = await fetchRdap("example.com", { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  assert.deepEqual(down, { error: "network" });
});
