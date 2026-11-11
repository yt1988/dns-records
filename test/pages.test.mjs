// What the build produced: every language's page, with its head, its alternatives and no unfilled placeholders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { build, LANGS } from "../scripts/build.mjs";

const pub = new URL("../public/", import.meta.url);
const SLUGS = LANGS.map(([l, s]) => [l, s]);
const page = async slug => readFile(new URL((slug ? slug + "/" : "") + "index.html", pub), "utf8");

test("public/ is up to date with src/", async () => {
  assert.deepEqual(await build({ check: true }), []);
});

test("every language has a page with its own lang, title, canonical and alternatives", async () => {
  for (const [lang, slug] of SLUGS) {
    const html = await page(slug);
    assert.match(html, new RegExp('<html lang="' + lang + '"'), lang);
    assert.doesNotMatch(html, /\{\{[\w:]+\}\}/, lang + " has an unfilled placeholder");
    assert.match(html, /<title>[^<]+<\/title>/, lang);
    assert.match(html, /<link rel="canonical" href="https:\/\/dig\.1ms\.dog\/(?:[a-z-]+\/)?">/, lang);
    assert.equal((html.match(/rel="alternate" hreflang="/g) || []).length, LANGS.length + 1, lang + " alternatives");
    assert.match(html, /<meta property="og:image" content="https:\/\/dig\.1ms\.dog\/og\/[a-z-]+\.png">/, lang);
    assert.match(html, /<div data-ms-more><\/div>/, lang);
    assert.match(html, /id="shareBtn"/, lang);
    assert.match(html, /data-1p-ignore/, lang);
  }
});

test("every page loads its own strings file and the shared code", async () => {
  for (const [lang, slug] of SLUGS) {
    const html = await page(slug);
    const m = /<script src="\/assets\/(l\.[a-z-]+\.[0-9a-f]+\.js)"><\/script>/.exec(html);
    assert.ok(m, lang);
    const js = await readFile(new URL("assets/" + m[1], pub), "utf8");
    assert.match(js, /^window\.L1MS=/, lang);
    assert.match(html, /<script src="\/assets\/app\.[0-9a-f]+\.js"><\/script>/, lang);
    assert.match(html, /<link rel="stylesheet" href="\/assets\/app\.[0-9a-f]+\.css">/, lang);
  }
});

test("the headers carry a CSP with the one inline script's hash, and long-lived hashed assets", async () => {
  const h = await readFile(new URL("_headers", pub), "utf8");
  assert.match(h, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/);
  assert.match(h, /connect-src 'self' https:/);
  assert.match(h, /\/assets\/app\.\*[\s\S]*immutable/);
  assert.match(h, /\/assets\/share\/\*[\s\S]*max-age=0, must-revalidate/);
});

test("the site files exist: sitemap, robots (share links kept out), llms.txt", async () => {
  const robots = await readFile(new URL("robots.txt", pub), "utf8");
  assert.match(robots, /Disallow: \/r\//);
  const sitemap = await readFile(new URL("sitemap.xml", pub), "utf8");
  for (const [, slug] of SLUGS) assert.match(sitemap, new RegExp("<loc>https://dig\\.1ms\\.dog/" + (slug ? slug + "/" : "") + "</loc>"), slug);
  const llms = await readFile(new URL("llms.txt", pub), "utf8");
  assert.match(llms, /DNS over HTTPS/);
  assert.match(llms, /https:\/\/github\.com\/yt1988\/dns-records/);
});

test("the built assets have no placeholder left and the page code has no template tokens", async () => {
  const files = await readdir(new URL("assets/", pub));
  for (const f of files.filter(f => /^app\..+\.(js|css)$/.test(f))) {
    const s = await readFile(new URL("assets/" + f, pub), "utf8");
    assert.doesNotMatch(s, /{{/, f);
  }
});
