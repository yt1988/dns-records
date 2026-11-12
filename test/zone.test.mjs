// Which zone the mail and NS questions belong to (docs/decisions.md, 2026-11-12): a host under a domain has no mail
// configuration of its own, so MX/SPF/DMARC/NS/CAA/DNSSEC are asked at the apex found from one SOA answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ZONE_TYPES, nameFor, parentName, soaOwner, findApex, preferRegistrable } from "../src/zone.mjs";

const answerSoa = name => ({ rcode: 0, answers: [{ type: "SOA", name }], authority: [] });
const authoritySoa = name => ({ rcode: 0, answers: [], authority: [{ type: "SOA", name }] });
const nxdomain = { rcode: 3, answers: [], authority: [{ type: "SOA", name: "baidu.com." }] };

// probe that answers from a table and remembers what it was asked
function scripted(table) {
  const asked = [];
  const probe = async n => { asked.push(n); return table[n] === undefined ? null : table[n]; };
  return { probe, asked };
}

test("the apex itself keeps its name, and one SOA answer is enough", async () => {
  const { probe, asked } = scripted({ "baidu.com": answerSoa("baidu.com.") });
  assert.equal(await findApex("baidu.com", probe), "baidu.com");
  assert.deepEqual(asked, ["baidu.com"]);
});

test("a host under a zone is asked once, and the answer's SOA names the apex", async () => {
  const { probe, asked } = scripted({ "www.baidu.com": authoritySoa("baidu.com.") });
  assert.equal(await findApex("www.baidu.com", probe), "baidu.com");
  assert.deepEqual(asked, ["www.baidu.com"], "not one question per candidate name");
});

test("a host that is a CNAME into another zone climbs once and finds its own zone", async () => {
  // www.baidu.com is a CNAME to www.a.shifen.com, so its SOA belongs to shifen.com — not an ancestor, so ask one up
  const { probe, asked } = scripted({ "www.baidu.com": authoritySoa("shifen.com."), "baidu.com": answerSoa("baidu.com.") });
  assert.equal(await findApex("www.baidu.com", probe), "baidu.com");
  assert.deepEqual(asked, ["www.baidu.com", "baidu.com"]);
});

test("a two-label suffix is never taken for the zone of a host under it", async () => {
  const { probe, asked } = scripted({ "www.example.co.uk": authoritySoa("example.co.uk.") });
  assert.equal(await findApex("www.example.co.uk", probe), "example.co.uk");
  assert.deepEqual(asked, ["www.example.co.uk"]);
  assert.notEqual(await findApex("www.example.co.uk", probe), "co.uk");
});

test("a name that is not registered keeps the typed name, never climbs into co.uk", async () => {
  const { probe, asked } = scripted({ "www.x.co.uk": nxdomain, "x.co.uk": nxdomain, "co.uk": answerSoa("co.uk.") });
  assert.equal(await findApex("www.x.co.uk", probe), "www.x.co.uk");
  assert.deepEqual(asked, ["www.x.co.uk", "x.co.uk"], "climbing stops before the two-label suffix is asked");
});

test("an NXDOMAIN for the host climbs one label and uses the SOA found there", async () => {
  const { probe, asked } = scripted({ "www.old.example.net": nxdomain, "old.example.net": answerSoa("example.net.") });
  assert.equal(await findApex("www.old.example.net", probe), "example.net");
  assert.deepEqual(asked, ["www.old.example.net", "old.example.net"]);
});

test("no answer at all leaves the lookup where the visitor pointed", async () => {
  const { probe } = scripted({});
  assert.equal(await findApex("www.baidu.com", probe), "www.baidu.com");
});

test("an SOA owner that is not this name or its ancestor is ignored", async () => {
  assert.equal(soaOwner(answerSoa("someone-else.com.")), "someone-else.com");
  assert.equal(soaOwner({ rcode: 3, authority: [{ type: "SOA", name: "baidu.com." }] }), "", "NXDOMAIN names no apex");
  const { probe } = scripted({ "www.baidu.com": authoritySoa("shifen.com.") });
  assert.equal(await findApex("www.baidu.com", probe), "www.baidu.com");
});

test("zone records go to the apex, host records stay on the typed name", () => {
  for (const type of ["MX", "NS", "TXT", "CAA", "SOA"]) assert.equal(nameFor(type, "www.baidu.com", "baidu.com"), "baidu.com", type);
  for (const type of ["A", "AAAA", "CNAME", "SRV"]) assert.equal(nameFor(type, "www.baidu.com", "baidu.com"), "www.baidu.com", type);
  assert.deepEqual([...ZONE_TYPES].sort(), ["CAA", "MX", "NS", "SOA", "TXT"]);
  assert.equal(parentName("www.baidu.com"), "baidu.com");
  assert.equal(parentName("com"), "");
});

test("the page asks DMARC, DS and the zone types at the apex, and keeps A/AAAA where it was typed", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /resolveApex\(norm\.name, ctl\.signal, browserRdap\)/);
  assert.match(app, /await apexP/);
  assert.match(app, /await ask\(apex, type\)/);
  assert.match(app, /"_dmarc\." \+ apex/);
  assert.match(app, /queryOne\(r, apex, "DS"/);
  // and the blocks that now carry the zone's numbers say which name they are about
  assert.match(app, /t\("q_apex", \{ domain: state\.apex \}\)/);
});

test("a registry answer that arrives late sends the zone questions to the registrable domain again", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  // fetchRdap puts lookedUp at the top of its result (not under data); both readers must match that
  assert.match(app, /rdapAttempt\.then\(r => \(r && r\.lookedUp\)/);
  assert.match(app, /r && typeof r\.lookedUp === "string"/);
  // the registry's lookedUp name is remembered if the lookup is still running, and acted on once it has finished
  assert.match(app, /state\.lateApex = reg/);
  assert.match(app, /await reaskZone\(state\.lateApex, my\)/);
  // and when it arrives after the page is filled, the zone types are asked again at once, then the page is redrawn
  assert.match(app, /if \(state\.finished\) reaskZone\(reg, my\)/);
  assert.match(app, /async function reaskZone\(apex, my\)/);
  assert.match(app, /for \(const type of zoneTypes\) state\.results\[type\] = \[\];/);
  assert.match(app, /state\.dmarc = \[\];[\s\S]*finish\(\);[\s\S]*syncApexNotes\(\);/);
});

test("the registry's registrable domain wins over a separately delegated host zone", () => {
  // www.cloudflare.com is its own zone (its own SOA and NS), but mail for the domain is cloudflare.com's
  assert.equal(preferRegistrable("www.cloudflare.com", "www.cloudflare.com", "cloudflare.com"), "cloudflare.com");
  assert.equal(preferRegistrable("baidu.com", "www.baidu.com", "baidu.com"), "baidu.com");
  // a registry answer about some other name is ignored, and a bare TLD never counts
  assert.equal(preferRegistrable("www.baidu.com", "www.baidu.com", "baidu.net"), "www.baidu.com");
  assert.equal(preferRegistrable("www.example.com", "www.example.com", "com"), "www.example.com");
  assert.equal(preferRegistrable("www.example.co.uk", "www.example.co.uk", "co.uk"), "co.uk");
  assert.equal(preferRegistrable("www.example.co.uk", "www.example.co.uk", ""), "www.example.co.uk");
});
