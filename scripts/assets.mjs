#!/usr/bin/env node
// Renders the link-preview images with resvg (dev dependency), 1200 × 630: public/og/<lang>.png for each language.
// Run when the headline, subtitle or card content changes, and commit the output. Uses system fonts for the text
// (Windows: Segoe UI, Microsoft YaHei, Microsoft JhengHei, Yu Gothic UI, Malgun Gothic, Consolas), as the 1ms.dog home
// page's script does.
// Usage: node scripts/assets.mjs
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const pub = new URL("../public/", import.meta.url), src = new URL("../src/", import.meta.url);
const HOST = new URL(process.env.SITE_URL || "https://dig.1ms.dog").host;
const FONTS = { "zh-CN": "Microsoft YaHei", "zh-TW": "Microsoft JhengHei", ja: "Yu Gothic UI", ko: "Malgun Gothic" };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const b64 = async f => Buffer.from(await readFile(new URL(f, pub))).toString("base64");
const render = svg => new Resvg(svg, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: "Segoe UI" } }).render().asPng();

// the panel: what a DNS answer looks like, and how many resolvers agreed (the page's two numbers)
const ROWS = [["A", "203.0.113.10"], ["AAAA", "2001:db8::1"], ["MX", "mail.example.com"], ["TXT", "v=spf1 -all"], ["NS", "ns1.example.com"]];

async function card(lang, title, sub) {
  const ff = `${FONTS[lang] ? `'${FONTS[lang]}', ` : ""}'Segoe UI', 'Microsoft YaHei', sans-serif`;
  const logo = await b64("assets/logo-dark.svg");
  // headline and subtitle fit the left column (480 px): wrapped by estimated width, wide characters counting double
  const wide = ch => /[　-鿿가-힯＀-￯]/.test(ch), est = (s, px) => [...s].reduce((a, ch) => a + (wide(ch) ? 1 : .56) * px, 0);
  const wrap = (text, px) => {
    const out = [];
    let cur = "";
    for (const word of text.split(/(?<=[ ，、？?,])/)) {
      for (const piece of est(word, px) > 480 ? [...word] : [word]) {
        if (cur && est(cur + piece, px) > 480) { out.push(cur.trim()); cur = ""; }
        cur += piece;
      }
    }
    return [...out, cur.trim()];
  };
  let size = 56, lines;
  for (; (lines = wrap(title, size)).length > 2 && size > 40; size -= 4);
  const subs = wrap(sub, 25).slice(0, 2);
  const top = 226 - (subs.length - 1) * 16 + (lines.length > 1 ? 0 : 24);
  const head = lines.map((l, i) => `<text x="72" y="${top + i * (size + 12)}" font-size="${size}" font-weight="700" fill="#ededed">${esc(l)}</text>`).join("");
  const subY = top + (lines.length - 1) * (size + 12) + 56;
  const subText = subs.map((l, i) => `<text x="72" y="${subY + i * 36}" font-size="25" fill="#a0a0a0">${esc(l)}</text>`).join("");
  const barY = subY + (subs.length - 1) * 36 + 40;
  const rows = ROWS.map(([ty, val], i) => {
    const y = 214 + i * 56;
    return `<text x="646" y="${y + 7}" font-size="19" font-family="Consolas, monospace" font-weight="600" fill="#8b93a1">${ty}</text>` +
      `<text x="722" y="${y + 7}" font-size="20" font-family="Consolas, monospace" fill="#ededed">${esc(val)}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="${ff}">
<rect width="1200" height="630" fill="#1c1c1c"/>
<rect x="600" y="150" width="528" height="376" rx="20" fill="#232323" stroke="#363636"/>
<text x="646" y="186" font-size="21" font-family="Consolas, monospace" fill="#a0a0a0">example.com</text>
${rows}
<circle cx="654" cy="480" r="8" fill="#3ecf8e"/>
<text x="674" y="487" font-size="22" font-family="Consolas, monospace" font-weight="600" fill="#3ecf8e">12 / 12</text>
<text x="1090" y="487" font-size="20" fill="#a0a0a0" text-anchor="end">A · MX · TXT · NS …</text>
<image x="72" y="56" width="180" height="72" href="data:image/svg+xml;base64,${logo}"/>
${head}
${subText}
<rect x="72" y="${barY}" width="120" height="6" rx="3" fill="#60a5fa"/>
<text x="72" y="574" font-size="26" font-weight="600" fill="#60a5fa">${HOST}</text>
<text x="1128" y="574" font-size="22" fill="#a0a0a0" text-anchor="end">A · AAAA · CNAME · MX · NS · TXT · CAA · SRV · SOA</text>
</svg>`;
}

await mkdir(new URL("og/", pub), { recursive: true });
for (const f of (await readdir(new URL("i18n/", src))).filter(f => f.endsWith(".mjs"))) {
  const lang = f.slice(0, -4), d = (await import(new URL("i18n/" + f, src).href)).default;
  const png = render(await card(lang, d.h1, d.og_sub));
  await writeFile(new URL(`og/${lang.toLowerCase()}.png`, pub), png);
  console.log(`og/${lang.toLowerCase()}.png ${Math.round(png.length / 1024)} KB`);
}
