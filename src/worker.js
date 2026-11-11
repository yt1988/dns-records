// The Worker: static files, and one dynamic route — a shared result, /<lang>/r/<code>. For a share link it serves the
// language's page with the result in the title and the preview, marked noindex; the page itself then draws the snapshot.
// Everything else is the built site in public/. Nothing is stored and nothing is logged.
import { sharePath, decodeResult } from "./code.mjs";
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
