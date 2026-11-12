import test from "node:test";
import assert from "node:assert/strict";
import { resolveGrade, mailGrade, overallGrade } from "../src/grade.mjs";
import { dsFound, dsAskers, dnssecVerdict, dnssecRows, VALIDATORS } from "../src/dnssec.mjs";

const spf = (o = {}) => ({ count: 1, qualifier: "fail", issues: [], ...o });
const dmarc = (o = {}) => ({ count: 1, p: "reject", rua: ["mailto:x@example.com"], ...o });
const good = { mx: true, checked: true, spf: spf(), dmarc: dmarc() };

test("the answers' grade: A when every resolver that answered gave the same answer", () => {
  assert.equal(resolveGrade({ answered: 12, total: 12, consistency: 1, records: 1 }), "A");
  // cloudflare.com: 11 of 12 answered and all agree. The one we could not reach is not a disagreement and does not
  // lower the letter — a resolver we cannot reach says nothing about the domain (docs/tool-contract.md).
  assert.equal(resolveGrade({ answered: 11, total: 12, consistency: 1, records: 1 }), "A");
  assert.equal(resolveGrade({ answered: 6, total: 12, consistency: 1, records: 1 }), "A");
  // a different answer from a resolver that did answer is a disagreement, so it is a B
  assert.equal(resolveGrade({ answered: 12, total: 12, consistency: 11 / 12, records: 1 }), "B");
  assert.equal(resolveGrade({ answered: 12, total: 12, consistency: 0.9, records: 1 }), "B");
});

test("fewer than half the resolvers answering is not graded at all", () => {
  assert.equal(resolveGrade({ answered: 5, total: 12, consistency: 1, records: 1 }), null);
  assert.equal(resolveGrade({ answered: 0, total: 12, consistency: null, records: 0 }), null);
  assert.equal(resolveGrade({ answered: 12, total: 12, consistency: null, records: null }), null);
});

test("the mail grade: A for one SPF and a strict DMARC with reports", () => {
  assert.equal(mailGrade(good), "A");
  assert.equal(mailGrade({ ...good, spf: spf({ issues: ["allNotLast"] }) }), "A");
});

test("each of SPF and DMARC costs at most one note", () => {
  assert.equal(mailGrade({ ...good, spf: spf({ qualifier: "neutral" }) }), "B");
  assert.equal(mailGrade({ ...good, dmarc: dmarc({ p: "none" }) }), "B");
  assert.equal(mailGrade({ ...good, dmarc: dmarc({ rua: [] }) }), "B");
  assert.equal(mailGrade({ ...good, spf: spf({ count: 2, issues: ["multiple"] }) }), "B");
  assert.equal(mailGrade({ ...good, spf: spf({ issues: ["tooManyLookups"] }) }), "B");
  assert.equal(mailGrade({ ...good, spf: spf({ qualifier: "neutral" }), dmarc: dmarc({ p: "none" }) }), "C");
});

test("a missing or open record is a problem, and two problems are a D", () => {
  assert.equal(mailGrade({ ...good, spf: spf({ count: 0, qualifier: null }) }), "C");
  assert.equal(mailGrade({ ...good, dmarc: dmarc({ count: 0, p: null, rua: [] }) }), "C");
  assert.equal(mailGrade({ ...good, spf: spf({ count: 0, qualifier: null }), dmarc: dmarc({ count: 0, p: null, rua: [] }) }), "D");
  assert.equal(mailGrade({ ...good, spf: spf({ qualifier: "pass" }) }), "C");
});

test("mail is ungraded without an accepting MX or without the TXT answers", () => {
  assert.equal(mailGrade({ ...good, mx: false }), null);
  assert.equal(mailGrade({ ...good, checked: false }), null);
  assert.equal(mailGrade({ ...good, dmarc: null }), null);
});

test("the overall grade is the lower one, and a broken DNSSEC chain drops one step", () => {
  assert.equal(overallGrade({ resolve: "A", mail: "A", dnssec: "off" }), "A");
  assert.equal(overallGrade({ resolve: "A", mail: "C", dnssec: "pass" }), "C");
  assert.equal(overallGrade({ resolve: "B", mail: null, dnssec: "unknown" }), "B");
  assert.equal(overallGrade({ resolve: "A", mail: "A", dnssec: "broken" }), "B");
  assert.equal(overallGrade({ resolve: "C", mail: "B", dnssec: "broken" }), "D");
  assert.equal(overallGrade({ resolve: "B", mail: "D", dnssec: "broken" }), "D");
  assert.equal(overallGrade({ resolve: null, mail: "A", dnssec: "pass" }), null);
});

test("the DS answer tells off from broken: a record, no record, or no answer", () => {
  const ok = (records, rcode = 0) => ({ status: "ok", rcode, records });
  assert.equal(dsFound([ok([{ type: "DS", data: "1 13 2 ab" }])]), true);
  assert.equal(dsFound([ok([{ type: "DS", data: "1 13 2 ab" }]), { status: "error", error: "timeout" }]), true);
  assert.equal(dsFound([ok([]), ok([])]), false);
  assert.equal(dsFound([ok([], 3)]), null);
  assert.equal(dsFound([{ status: "error", error: "timeout" }]), null);
  assert.equal(dsFound([]), null);
});

test("DS is asked of two resolvers that answered, preferring Cloudflare and Google", () => {
  assert.deepEqual(dsAskers(["cloudflare", "google", "quad9", "dnssb"]), ["cloudflare", "google"]);
  assert.deepEqual(dsAskers(["quad9", "tiarap", "iij"]), ["tiarap", "iij"]);
  assert.deepEqual(dsAskers(["google", "dnssb", "iij"]), ["google", "iij"]);
  assert.deepEqual(dsAskers(["quad9", "dnssb"]), []);
  assert.deepEqual(dsAskers([]), []);
});

test("DNSSEC passes only when two or more known validators set AD and none disagree", () => {
  const row = (id, ad, ok = true) => ({ id, ok, ad, servfail: false });
  const all = VALIDATORS.map(id => row(id, true));
  const v = dnssecVerdict(true, all);
  assert.equal(v.state, "pass");
  assert.equal(v.validators, 7);
  assert.equal(v.answered, 7);

  // one validator that answered without AD means it could not validate: not a pass, and not proof of a broken chain
  assert.equal(dnssecVerdict(true, [...all.slice(0, 6), row("iij", false)]).state, "unknown");
  assert.equal(dnssecVerdict(true, [row("cloudflare", true)]).state, "unknown");
  assert.equal(dnssecVerdict(true, [row("cloudflare", true), row("quad9", true)]).state, "unknown");
  assert.equal(dnssecVerdict(true, []).state, "unknown");
});

test("a broken chain needs two validators failing SERVFAIL, not one filtered resolver", () => {
  const down = (id, ad = false) => ({ id, ok: false, ad, servfail: true });
  assert.equal(dnssecVerdict(true, [down("cloudflare"), down("google"), { id: "iij", ok: true, ad: false, servfail: false }]).state, "broken");
  assert.equal(dnssecVerdict(true, [down("cloudflare"), { id: "iij", ok: true, ad: false, servfail: false }]).state, "unknown");
  // one validated answer means something does validate: a disagreement, not a broken chain
  assert.equal(dnssecVerdict(true, [down("cloudflare"), down("google"), { id: "tiarap", ok: true, ad: true, servfail: false }]).state, "unknown");
});

test("DNS.SB can confirm a pass, and its 503 never blocks a broken verdict", () => {
  const sb = { id: "dnssb", ok: true, ad: true, servfail: false };
  const one = { id: "cloudflare", ok: true, ad: true, servfail: false };
  const v = dnssecVerdict(true, [one, sb]);
  assert.equal(v.state, "pass");
  assert.equal(v.validators, 2);
  // its bogus-name answer is HTTP 503, not SERVFAIL, so it arrives as a plain error and says nothing here
  const broken = dnssecVerdict(true, [
    { id: "dnssb", ok: false, ad: false, servfail: false },
    { id: "cloudflare", ok: false, ad: false, servfail: true },
    { id: "google", ok: false, ad: false, servfail: true },
  ]);
  assert.equal(broken.state, "broken");
});

test("off and unknown are never accused of being broken", () => {
  const all = VALIDATORS.map(id => ({ id, ok: true, ad: false, servfail: false }));
  assert.equal(dnssecVerdict(false, all).state, "off");
  assert.equal(dnssecVerdict(null, all).state, "unknown");
});

test("resolver rows fold every answer a resolver gave, and ignore other zones", () => {
  const rows = dnssecRows({
    A: [{ id: "cloudflare", status: "ok", ad: false }, { id: "google", status: "ok", ad: true }],
    MX: [{ id: "cloudflare", status: "ok", ad: true }, { id: "google", status: "error", error: "servfail" }],
    TXT: [{ id: "cloudflare", status: "error", error: "servfail" }],
  });
  const by = Object.fromEntries(rows.map(r => [r.id, r]));
  assert.deepEqual(by.cloudflare, { id: "cloudflare", ok: true, ad: true, servfail: true });
  assert.deepEqual(by.google, { id: "google", ok: true, ad: true, servfail: true });
  assert.deepEqual(dnssecRows({}), []);
  assert.deepEqual(dnssecRows(null), []);
});
