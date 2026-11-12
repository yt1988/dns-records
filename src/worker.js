// The Worker: static files, and two dynamic routes. A shared result (/<lang>/r/<code>) gets its language's page with
// the result in the title and the preview, marked noindex; the page itself then draws the snapshot. /whois asks a
// registry for registration data the visitor's browser cannot read — the only query that goes through this server.
// Everything else is the built site in public/. Nothing is stored beyond the cache and nothing is logged.
import { sharePath, decodeResult } from "./code.mjs";
import { lookupRegistration } from "./whois.mjs";
import en from "./i18n/en.mjs";
import zhCN from "./i18n/zh-CN.mjs";
import zhTW from "./i18n/zh-TW.mjs";
import ja from "./i18n/ja.mjs";
import ko from "./i18n/ko.mjs";
import es from "./i18n/es.mjs";
import fr from "./i18n/fr.mjs";
import de from "./i18n/de.mjs";
import pt from "./i18n/pt.mjs";
import ru from "./i18n/ru.mjs";

const I18N = { en, "zh-CN": zhCN, "zh-TW": zhTW, ja, ko, es, fr, de, pt, ru };
// the URL folder sharePath() returns → the language key in src/i18n/
const SLUG = { "": "en", "zh-cn": "zh-CN", "zh-tw": "zh-TW", ja: "ja", ko: "ko", es: "es", fr: "fr", de: "de", pt: "pt", ru: "ru" };

const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

// Registration lookups are for this site's own page, not for other sites to borrow: CORS names dig.1ms.dog only.
const ALLOWED_ORIGIN = "https://dig.1ms.dog";
const CACHE_SUCCESS = 43200, CACHE_FAILURE = 600, CACHE_CLIENT = 3600;

async function handleWhois(request, url, env, ctx) {
  const headers = { "content-type": "application/json; charset=utf-8", "vary": "origin" };
  const origin = request.headers.get("origin");
  if (origin === ALLOWED_ORIGIN) headers["access-control-allow-origin"] = ALLOWED_ORIGIN;
  const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
  if (request.method !== "GET") return reply({ ok: false, reason: "method" }, 405, { allow: "GET" });
  const domain = (url.searchParams.get("d") || "").trim().toLowerCase().replace(/\.+$/, "");
  // an allow-list of what the page sends: anything else is refused before a socket or a fetch is made
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain) || domain.length > 253) {
    return reply({ ok: false, reason: "bad-domain" }, 400);
  }

  const store = typeof caches !== "undefined" ? caches.default : null;
  const key = new Request("https://whois.internal/?d=" + domain);
  if (store) {
    const hit = await store.match(key);
    if (hit) return reply(await hit.json(), 200, { "cache-control": "public, max-age=" + CACHE_CLIENT });
  }

  // The socket module is imported here, while a request is being handled, never at module scope.
  const connect = env.WHOIS_CONNECT || (async (host, port) => (await import("./whois-net.js")).connectTo(host, port));
  const out = await lookupRegistration(domain, { connect });

  if (store) {
    const ttl = out.ok ? CACHE_SUCCESS : CACHE_FAILURE;
    ctx && ctx.waitUntil(store.put(key, new Response(JSON.stringify(out), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=" + ttl },
    })));
  }
  return reply(out, out.reason === "bad-domain" ? 400 : 200, { "cache-control": "public, max-age=" + CACHE_CLIENT });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/whois") return handleWhois(request, url, env, ctx);
    const sp = sharePath(url.pathname);
    if (!sp) return env.ASSETS.fetch(request);

    let snap = null;
    try { snap = await decodeResult(sp.code); } catch (e) { snap = null; }
    if (!snap) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" } });

    const slug = SLUG[sp.slug] ? sp.slug : "", lang = SLUG[slug], d = I18N[lang], s = snap.s || {};
    const title = s.val
      ? fill(d.share_title, { domain: snap.d, type: s.ty || "A", value: s.val })
      : fill(d.share_title_none, { domain: snap.d, n: s.n || 0 });
    const full = title + " · " + d.app_name;
    const page = "/" + (slug ? slug + "/" : "") + "index.html";

    const res = await env.ASSETS.fetch(new URL(page, url).toString());
    if (!res.ok) return res;
    const out = new HTMLRewriter()
      .on("title", { element(e) { e.setInnerContent(full); } })
      .on('meta[name="description"]', { element(e) { e.setAttribute("content", d.og_sub); } })
      .on('meta[property="og:title"]', { element(e) { e.setAttribute("content", title); } })
      .on('meta[property="og:description"]', { element(e) { e.setAttribute("content", d.og_sub); } })
      .on('meta[name="twitter:title"]', { element(e) { e.setAttribute("content", title); } })
      .on('meta[name="twitter:description"]', { element(e) { e.setAttribute("content", d.og_sub); } })
      .on('meta[name="robots"]', { element(e) { e.setAttribute("content", "noindex, follow"); } })
      .on('link[rel="canonical"]', { element(e) { e.setAttribute("href", url.origin + url.pathname); } })
      .transform(res);
    const headers = new Headers(out.headers);
    headers.set("cache-control", "no-store");
    headers.set("x-robots-tag", "noindex");
    return new Response(out.body, { status: out.status, headers });
  },
};
