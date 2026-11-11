import test from "node:test";
import assert from "node:assert/strict";
import { mergeType, mergeRecords, primaryType, answerKey } from "../src/merge.mjs";

const rec = (type, data, ttl = 300) => ({ type, data, ttl });
const ok = (id, records, rcode = 0) => ({ id, status: "ok", records, rcode });
const fail = (id, error) => ({ id, status: "error", records: [], error });

test("identical answers agree, whatever order and TTL", () => {
  const m = mergeType([
    ok("a", [rec("A", "1.1.1.1", 300), rec("A", "2.2.2.2", 200)]),
    ok("b", [rec("A", "2.2.2.2", 50), rec("A", "1.1.1.1", 20)]),
  ]);
  assert.equal(m.groups.length, 1);
  assert.equal(m.consistency, 1);
  assert.equal(m.stale.length, 0);
  assert.equal(m.distinct, 1);
});

test("a resolver with an older answer is stale; failed resolvers are not counted as disagreement", () => {
  const m = mergeType([
    ok("a", [rec("A", "1.1.1.1")]), ok("b", [rec("A", "1.1.1.1")]),
    ok("c", [rec("A", "9.9.9.9")]), fail("d", "timeout"), fail("e", "network"),
  ]);
  assert.equal(m.ok.length, 3);
  assert.equal(m.errors.length, 2);
  assert.equal(m.consistency, 2 / 3);
  assert.deepEqual(m.stale.map(r => r.id), ["c"]);
  assert.equal(m.majority.resolvers.length, 2);
});

test("one answering resolver has no consistency figure, not 100%", () => {
  const m = mergeType([ok("a", [rec("A", "1.1.1.1")]), fail("b", "timeout")]);
  assert.equal(m.consistency, null);
});

test("NXDOMAIN and empty answers are real answers, not failures", () => {
  const m = mergeType([ok("a", [], 3), ok("b", [], 3)]);
  assert.equal(m.nx, 2);
  assert.equal(m.empty, true);
  assert.equal(m.consistency, 1);
});

test("the CNAME chain is part of the answer", () => {
  const m = mergeType([
    ok("a", [rec("A", "1.1.1.1"), rec("CNAME", "cdn.example.net")]),
    ok("b", [rec("CNAME", "cdn.example.net"), rec("A", "1.1.1.1")]),
    ok("c", [rec("A", "1.1.1.1")]),
  ]);
  assert.equal(m.groups.length, 2);
  assert.deepEqual(m.stale.map(r => r.id), ["c"]);
  assert.notEqual(answerKey([rec("A", "1.1.1.1"), rec("CNAME", "cdn.example.net")]), answerKey([rec("A", "1.1.1.1")]));
});

test("mergeRecords joins values across resolvers and keeps the TTL range", () => {
  const rows = mergeRecords({
    A: [ok("a", [rec("A", "1.1.1.1", 300)]), ok("b", [rec("A", "1.1.1.1", 60)]), ok("c", [rec("A", "2.2.2.2", 30)])],
    MX: [ok("a", [rec("MX", "10 mail.example.com", 300)])],
  });
  const a = rows.find(r => r.data === "1.1.1.1");
  assert.deepEqual([a.count, a.ttlMin, a.ttlMax], [2, 60, 300]);
  assert.equal(rows[rows.length - 1].type, "MX");
  assert.equal(primaryType({ A: mergeType([ok("a", [rec("A", "1.1.1.1")])]) }), "A");
});
