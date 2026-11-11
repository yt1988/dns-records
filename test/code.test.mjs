// Shared result links: what goes into a code, what comes back, and the paths that carry one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeResult, decodeResult, sharePath, resultsFromSnapshot, CODES } from "../src/code.mjs";

const snap = {
  v: 1, d: "example.com", t: ["A", "MX"], at: 1762819200000,
  r: [
    ["cloudflare", "A", 0, [["A", 300, "203.0.113.10"]]],
    ["google", "A", 3, []],
    ["cloudflare", "MX", 0, [["MX", 3600, "mail.example.com"]]],
    ["google", "MX", 2, []],
    ["quad9", "MX", 8, []],
  ],
  m: [["cloudflare", 0, [["TXT", 3600, "v=DMARC1; p=reject"]]]],
  x: { registrar: "Example Registrar", created: "1995-08-14T04:00:00Z", expires: "2027-08-13T04:00:00Z", status: ["client transfer prohibited"], nameservers: ["ns1.example.com"] },
  xz: "ok",
  s: { ty: "A", val: "203.0.113.10", ok: 1, tot: 12, n: 2 },
};

test("a snapshot survives the code and comes back as it was", async () => {
  const code = await encodeResult(snap);
  assert.match(code, /^1~/);
  const back = await decodeResult(code);
  assert.deepEqual(back, snap);
});

test("a code that is garbled, cut short or of another version is not read", async () => {
  assert.equal(await decodeResult(""), null);
  assert.equal(await decodeResult("2~abcdefgh"), null);
  assert.equal(await decodeResult("1~short"), null);
  assert.equal(await decodeResult("1~!!!!!!!!"), null);
  const good = await encodeResult(snap);
  assert.equal(await decodeResult(good.slice(0, good.length - 5)), null);
});

test("sharePath reads the plain and the language form, and nothing else", () => {
  assert.deepEqual(sharePath("/r/1~abc"), { slug: "", code: "1~abc" });
  assert.deepEqual(sharePath("/zh-cn/r/1~abc"), { slug: "zh-cn", code: "1~abc" });
  assert.deepEqual(sharePath("/zh-tw/r/1~abc"), { slug: "zh-tw", code: "1~abc" });
  assert.equal(sharePath("/r/"), null);
  assert.equal(sharePath("/r/a/b"), null);
  assert.equal(sharePath("/zh-cn/"), null);
  assert.equal(sharePath("/x/r/1~abc"), null);
});

test("resultsFromSnapshot restores answers, failures and the types that were asked", () => {
  const by = resultsFromSnapshot(snap);
  assert.deepEqual(Object.keys(by).sort(), ["A", "MX"]);
  assert.equal(by.A.length, 2);
  assert.equal(by.A[0].status, "ok");
  assert.equal(by.A[0].records[0].data, "203.0.113.10");
  assert.equal(by.A[1].status, "ok");
  assert.equal(by.A[1].rcode, 3);          // NXDOMAIN is an answer, not a failure
  assert.equal(by.MX[1].status, "error");
  assert.equal(by.MX[1].error, "servfail");
  assert.equal(by.MX[2].error, "skipped");
  assert.equal(CODES.refused, 9);
});
