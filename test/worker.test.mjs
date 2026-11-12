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

// ---- /whois: registration data the browser could not read, asked by the server ----

const whoisReply = "Domain Name: SINA.CN\nSponsoring Registrar: Example Registrar\nName Server: ns1.sina.com.cn\nRegistration Time: 2003-03-17 12:20:05\nExpiration Time: 2027-03-17 12:48:36\nDomain Status: clientTransferProhibited\n";
const socket = () => ({
  opened: Promise.resolve(),
  writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) },
  readable: { getReader: () => { let done = false; return { read: async () => (done ? { done: true } : (done = true, { done: false, value: new TextEncoder().encode(whoisReply) })) }; } },
  close() {},
});

test("/whois refuses anything that is not a plain domain, before asking anyone", async () => {
  for (const d of ["", "a.com/x", "javascript:alert(1)", "a..com", "例子.cn"]) {
    const res = await worker.fetch(new Request("https://dig.1ms.dog/whois?d=" + encodeURIComponent(d)), { ASSETS: { fetch: async () => page() } });
    assert.equal(res.status, 400, d);
    assert.equal((await res.json()).reason, "bad-domain");
  }
  const post = await worker.fetch(new Request("https://dig.1ms.dog/whois?d=sina.cn", { method: "POST" }), {});
  assert.equal(post.status, 405);
});

test("/whois answers with the public fields only, and only dig.1ms.dog may read it from another site", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("No RDAP service is available for this resource", { status: 404 });
  try {
    const res = await worker.fetch(new Request("https://dig.1ms.dog/whois?d=sina.cn", { headers: { origin: "https://dig.1ms.dog" } }), {
      ASSETS: { fetch: async () => page() }, WHOIS_CONNECT: () => socket(),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "https://dig.1ms.dog");
    assert.equal(res.headers.get("vary"), "origin");
    assert.match(res.headers.get("cache-control"), /max-age=3600/);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.src, "whois");
    assert.equal(body.registrar, "Example Registrar");
    assert.deepEqual(body.nameservers, ["ns1.sina.com.cn"]);
    assert.deepEqual(Object.keys(body).sort(),
      ["created", "expires", "nameservers", "ok", "registrar", "src", "status", "tld", "updated"].sort());
    // the registrant is in the registry's reply; it must never be in ours (the fixture has no registrant line, so this
    // checks the shape: these are the only fields the route can carry)
    const other = await worker.fetch(new Request("https://dig.1ms.dog/whois?d=sina.cn", { headers: { origin: "https://example.org" } }), {
      ASSETS: { fetch: async () => page() }, WHOIS_CONNECT: () => socket(),
    });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("every other request goes straight to the static site", async () => {
  const res = await worker.fetch(new Request("https://dig.1ms.dog/zh-cn/"), { ASSETS: { fetch: async () => page() } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-robots-tag"), null);
});
