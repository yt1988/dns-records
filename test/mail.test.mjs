import test from "node:test";
import assert from "node:assert/strict";
import { spfCheck, dmarcCheck, compareNs } from "../src/mail.mjs";

const txt = t => ({ type: "TXT", data: t, text: t });

test("a good SPF record: one record, -all, few lookups", () => {
  const r = spfCheck([txt("v=spf1 include:_spf.example.com ip4:192.0.2.0/24 -all")]);
  assert.equal(r.count, 1);
  assert.equal(r.qualifier, "fail");
  assert.equal(r.lookups, 1);
  assert.deepEqual(r.issues, []);
});

test("SPF problems: +all, no all, several records, too many lookups", () => {
  assert.ok(spfCheck([txt("v=spf1 include:a.example +all")]).issues.includes("plusAll"));
  assert.ok(spfCheck([txt("v=spf1 include:a.example")]).issues.includes("noAll"));
  assert.ok(spfCheck([txt("v=spf1 -all"), txt("v=spf1 ~all")]).issues.includes("multiple"));
  assert.ok(spfCheck([txt("v=spf1 a mx +all include:more.example")]).issues.includes("allNotLast"));

  const many = ["a", "mx", "ptr", "include:a.example", "include:b.example", "include:c.example", "include:d.example",
    "include:e.example", "include:f.example", "include:g.example", "exists:x.example"].join(" ");
  assert.ok(spfCheck([txt("v=spf1 " + many + " -all")]).issues.includes("tooManyLookups"));
  assert.equal(spfCheck([txt("v=spf1 include:a include:b a mx -all")]).lookups, 4);
  assert.equal(spfCheck([txt("v=spf1 ip4:192.0.2.1 -all")]).lookups, 0);
});

test("no SPF record is a count of zero, not an empty record", () => {
  const r = spfCheck([txt("google-site-verification=x"), txt("v=spf10 -all")]);
  assert.equal(r.count, 0);
  assert.equal(r.record, null);
});

test("DMARC: strict policy with reporting", () => {
  const r = dmarcCheck([txt("v=DMARC1; p=reject; rua=mailto:d@example.com, mailto:e@example.com; pct=100")]);
  assert.equal(r.p, "reject");
  assert.deepEqual(r.rua, ["mailto:d@example.com", "mailto:e@example.com"]);
  assert.deepEqual(r.issues, []);
});

test("DMARC problems: none, no rua, missing policy, partial, several records", () => {
  assert.ok(dmarcCheck([txt("v=DMARC1; p=none")]).issues.includes("pNone"));
  assert.ok(dmarcCheck([txt("v=DMARC1; p=none")]).issues.includes("noRua"));
  assert.ok(dmarcCheck([txt("v=DMARC1; rua=mailto:d@example.com")]).issues.includes("noPolicy"));
  assert.ok(dmarcCheck([txt("v=DMARC1; p=quarantine; pct=50")]).issues.includes("partial"));
  assert.ok(dmarcCheck([txt("v=DMARC1; p=none"), txt("v=DMARC1; p=reject")]).issues.includes("multiple"));
  assert.equal(dmarcCheck([txt("v=spf1 -all")]).count, 0);
});

test("NS comparison ignores case and the trailing dot", () => {
  const r = compareNs(["NS1.Example.com.", "ns2.example.com"], ["ns1.example.com", "ns3.example.com"]);
  assert.deepEqual(r.onlyRegistrar, ["ns2.example.com"]);
  assert.deepEqual(r.onlyResolver, ["ns3.example.com"]);
  assert.equal(r.same, false);
  assert.equal(compareNs(["a.example"], ["a.example."]).same, true);
  assert.equal(compareNs([], ["a.example"]).same, false);
});
