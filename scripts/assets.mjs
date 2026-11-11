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

// the panel: the checkup grade and the same three figures the page's first screen shows
async function card(lang, d) {
  const title = d.h1, sub = d.og_sub;
  const ff = `${FONTS[lang] ? `'${FONTS[lang]}', ` : ""}'Segoe UI', 'Microsoft YaHei', sans-serif`;
  const logo = await b64("assets/logo-dark.svg");
  // headline and subtitle fit the left column (480 px): wrapped by estimated width, wide characters counting double
  const wide = ch => /[　-鿿가-힯＀-￯]/.test(ch), est = (s, px) => [...s].reduce((a, ch) => a + (wide(ch) ? 1 : .56) * px, 0);
  const wrap = (text, px, max = 480) => {
    const out = [];
    let cur = "";
    for (const word of text.split(/(?<=[ ，、？?,])/)) {
      for (const piece of est(word, px) > max ? [...word] : [word]) {
        if (cur && est(cur + piece, px) > max) { out.push(cur.trim()); cur = ""; }
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
  // three figures across the panel, the same ones the page's first screen shows
  const BW = 152, GAP = 13;
  const box = (i, value, label, color) => {
    const x = 646 + i * (BW + GAP), lines2 = wrap(label, 15, BW - 24).slice(0, 2);
    return `<rect x="${x}" y="326" width="${BW}" height="112" rx="14" fill="#1c1c1c" stroke="#363636"/>` +
      `<text x="${x + 16}" y="369" font-size="26" font-weight="700" fill="${color}">${esc(value)}</text>` +
      lines2.map((l, j) => `<text x="${x + 16}" y="${394 + j * 19}" font-size="15" fill="#a0a0a0">${esc(l)}</text>`).join("");
  };
  const boxes = box(0, "12 / 12", d.k_agree, "#3ecf8e") + box(1, "A", d.k_mail, "#3ecf8e") + box(2, d.dn_card_pass, d.k_dnssec, "#3ecf8e");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" font-family="${ff}">
<rect width="1200" height="630" fill="#1c1c1c"/>
<rect x="600" y="150" width="528" height="376" rx="20" fill="#232323" stroke="#363636"/>
<text x="646" y="184" font-size="21" font-family="Consolas, monospace" fill="#a0a0a0">example.com</text>
<rect x="646" y="204" width="104" height="104" rx="16" fill="#1c1c1c" stroke="#363636"/>
<text x="698" y="278" font-size="64" font-weight="700" fill="#3ecf8e" text-anchor="middle">A</text>
<text x="772" y="262" font-size="24" font-weight="600" fill="#ededed">${esc(wrap(d.card_grade, 24, 340)[0])}</text>
${boxes}
<text x="646" y="492" font-size="17" fill="#a0a0a0">${esc(d.card_foot)}</text>
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
  const png = render(await card(lang, d));
  await writeFile(new URL(`og/${lang.toLowerCase()}.png`, pub), png);
  console.log(`og/${lang.toLowerCase()}.png ${Math.round(png.length / 1024)} KB`);
}
