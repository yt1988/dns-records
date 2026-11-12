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

const whoisReply = "Domain Name: SINA.CN\nSponsoring Registrar: Example Registrar\nName Server: ns1.sina.com.cn\nRegistration Time: 2003-03-17 12:20:05\nExpiration Time: 2027-03-17 12:48:36\nDomain Status: clientTransferProhibited\nRegistrant: 一些公司\nRegistrant Contact Email: someone@example.com\nDNSSEC: unsigned\n";
const textSocket = text => ({
  opened: Promise.resolve(),
  writable: { getWriter: () => ({ write: async () => {}, releaseLock() {} }) },
  readable: { getReader: () => { let done = false; return { read: async () => (done ? { done: true } : (done = true, { done: false, value: new TextEncoder().encode(text) })) }; } },
  close() {},
});
const socket = () => textSocket(whoisReply);

test("/whois refuses anything that is not a plain domain, before asking anyone", async () => {
  for (const d of ["", "a.com/x", "javascript:alert(1)", "a..com", "例子.cn"]) {
    const res = await worker.fetch(new Request("https://dig.1ms.dog/whois?d=" + encodeURIComponent(d)), { ASSETS: { fetch: async () => page() } });
    assert.equal(res.status, 400, d);
    assert.equal((await res.json()).reason, "bad-domain");
  }
  const post = await worker.fetch(new Request("https://dig.1ms.dog/whois?d=sina.cn", { method: "POST" }), {});
  assert.equal(post.status, 405);
});

test("/whois answers with what the registry publishes, and only dig.1ms.dog may read it from another site", async () => {
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
    // the registrant side the registry made public, as written, plus the registry's own reply
    assert.equal(body.registrant, "一些公司");
    assert.equal(body.email, "someone@example.com");
    assert.equal(body.dnssec, "unsigned");
    assert.match(body.raw, /Sponsoring Registrar: Example Registrar/);
    assert.deepEqual(Object.keys(body).sort(), ["created", "dnssec", "email", "expires", "nameservers", "ok", "phone",
      "raw", "registrant", "registrantOrg", "registrar", "src", "status", "tld", "updated"].sort());
    const other = await worker.fetch(new Request("https://dig.1ms.dog/whois?d=sina.cn", { headers: { origin: "https://example.org" } }), {
      ASSETS: { fetch: async () => page() }, WHOIS_CONNECT: () => socket(),
    });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("/whois caches under the request URL: a second ask costs no lookup, and a miss is only kept 10 minutes", async () => {
  const realFetch = globalThis.fetch, realCaches = globalThis.caches;
  globalThis.fetch = async () => new Response("No RDAP service is available for this resource", { status: 404 });
  const store = new Map(), puts = [];
  globalThis.caches = { default: {
    match: async req => store.get(req.url) || undefined,
    put: async (req, res) => { puts.push([req.url, res.headers.get("cache-control")]); store.set(req.url, res); },
  } };
  try {
    let lookups = 0;
    const pending = [];
    const env = { ASSETS: { fetch: async () => page() }, WHOIS_CONNECT: () => { lookups++; return socket(); } };
    const ctx = { waitUntil: p => { pending.push(p); } };
    const get = async d => { const res = await worker.fetch(new Request("https://dig.1ms.dog/whois?d=" + d), env, ctx); await Promise.all(pending.splice(0)); return res; };

    const first = await (await get("sina.cn")).json();
    assert.equal(first.ok, true);
    assert.deepEqual(puts.at(-1), ["https://dig.1ms.dog/whois?d=sina.cn&v=2", "public, max-age=43200"]);
    // same URL again: served from the cache, the registry is not asked a second time
    const again = await (await get("sina.cn")).json();
    assert.equal(again.ok, true);
    assert.equal(lookups, 1, "one lookup, then the cache answers");

    // a different domain is a different entry — the key carries d
    await get("example.cn");
    assert.equal(lookups, 2);

    // "the registry has no such domain" is cached too, but for ten minutes rather than twelve hours
    store.clear(); puts.length = 0;
    const noSuch = { ...env, WHOIS_CONNECT: () => textSocket("No matching record.") };
    const miss = await (await worker.fetch(new Request("https://dig.1ms.dog/whois?d=nope.cn"), noSuch, ctx)).json();
    await Promise.all(pending.splice(0));
    assert.equal(miss.reason, "notfound");
    assert.deepEqual(puts.at(-1), ["https://dig.1ms.dog/whois?d=nope.cn&v=2", "public, max-age=600"]);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.caches = realCaches;
  }
});

test("every other request goes straight to the static site", async () => {
  const res = await worker.fetch(new Request("https://dig.1ms.dog/zh-cn/"), { ASSETS: { fetch: async () => page() } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-robots-tag"), null);
});
