// The Worker's one dynamic route: a shared result gets its language's page, marked noindex; a bad code gets 404;
// everything else is the static site. HTMLRewriter is a Worker-only API, so the test stubs it: the route and headers
// are what is checked here, not the rewritten tags.
import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeResult } from "../src/code.mjs";

globalThis.HTMLRewriter = class {
  on() { return this; }
  transform(res) { return res; }
};
const { default: worker } = await import("../src/worker.js");

const snapshot = {
  v: 1, d: "example.com", t: ["A"], at: 1762819200000,
  r: [["cloudflare", "A", 0, [["A", 300, "203.0.113.10"]]]],
  m: [], x: null, xz: "none",
  s: { ty: "A", val: "203.0.113.10", ok: 1, tot: 12, n: 1 },
};
const page = () => new Response("<!doctype html><html><head><title>site</title></head><body></body></html>",
  { headers: { "content-type": "text/html; charset=utf-8" } });

test("a share link is served the page of its language, uncached and noindex", async () => {
  const code = await encodeResult(snapshot), seen = [];
  const res = await worker.fetch(new Request("https://dig.1ms.dog/zh-cn/r/" + code), {
    ASSETS: { fetch: async u => { seen.push(String(u)); return page(); } },
  });
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /\/zh-cn\/index\.html$/);
  assert.equal(res.headers.get("x-robots-tag"), "noindex");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("a link with no language, or a language folder the site does not have, uses the English page", async () => {
  const code = await encodeResult(snapshot);
  for (const [path, want] of [["/r/" + code, /\/index\.html$/], ["/xx/r/" + code, /\/index\.html$/]]) {
    const seen = [];
    await worker.fetch(new Request("https://dig.1ms.dog" + path), { ASSETS: { fetch: async u => { seen.push(String(u)); return page(); } } });
    assert.match(seen[0], want);
  }
});

test("a code that does not decode is a plain 404, without reading any asset", async () => {
  let called = false;
  const res = await worker.fetch(new Request("https://dig.1ms.dog/r/1~not-a-real-code"), { ASSETS: { fetch: async () => { called = true; return page(); } } });
  assert.equal(res.status, 404);
  assert.equal(called, false);
  assert.match(res.headers.get("content-type"), /text\/plain/);
});

test("every other request goes straight to the static site", async () => {
  const res = await worker.fetch(new Request("https://dig.1ms.dog/zh-cn/"), { ASSETS: { fetch: async () => page() } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-robots-tag"), null);
});
