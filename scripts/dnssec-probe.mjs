// Which of the 12 resolvers validate DNSSEC and set the AD bit?
// Run from the repo on a network that can reach all 12 (a VPS, not a proxied desktop):
//   node scripts/dnssec-probe.mjs
// It asks three names that tell the resolvers apart:
//   cloudflare.com     signed, valid
//   google.com         unsigned
//   dnssec-failed.org  signed, deliberately broken (a validator must SERVFAIL)
// The query carries the DO bit, which the page's builder does not set yet.
const RESOLVERS = [
  ["cloudflare", "https://cloudflare-dns.com/dns-query"],
  ["google", "https://dns.google/dns-query"],
  ["quad9", "https://dns.quad9.net/dns-query"],
  ["controld", "https://freedns.controld.com/p0"],
  ["dnssb", "https://doh.dns.sb/dns-query"],
  ["cleanbrowsing", "https://doh.cleanbrowsing.org/doh/security-filter/"],
  ["rethink", "https://sky.rethinkdns.com/dns-query"],
  ["dns4eu", "https://unfiltered.joindns4.eu/dns-query"],
  ["cznic", "https://odvr.nic.cz/doh"],
  ["dnsforge", "https://dnsforge.de/dns-query"],
  ["tiarap", "https://doh.tiar.app/dns-query"],
  ["iij", "https://public.dns.iij.jp/dns-query"],
];

function query(name, type = 1) {
  const labels = name.replace(/\.$/, "").split(".");
  const q = [0, 0, 0x01, 0x20, 0, 1, 0, 0, 0, 0, 0, 1]; // ID 0, RD + AD, one question, one OPT
  for (const l of labels) q.push(l.length, ...Buffer.from(l, "ascii"));
  q.push(0, 0, type, 0, 1);
  q.push(0, 0, 41, 0x04, 0xd0, 0, 0, 0x80, 0, 0, 0); // OPT, 1232 bytes, DO bit set
  return Buffer.from(q);
}

const b64url = b => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function flags(buf) {
  const ad = !!(buf[3] & 0x20), rcode = buf[3] & 0x0f, tc = !!(buf[2] & 0x02);
  // an OPT record counts as one additional record; if EDNS was stripped, there is none
  const opt = buf.readUInt16BE(10) > 0;
  return { ad, rcode, tc, opt };
}

async function ask(url, name) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url + "?dns=" + b64url(query(name)), { headers: { accept: "application/dns-message" }, signal: ac.signal });
    if (!res.ok) return "HTTP " + res.status;
    const buf = Buffer.from(await res.arrayBuffer());
    const f = flags(buf);
    const rc = ["NOERROR", "FORMERR", "SERVFAIL", "NXDOMAIN", "NOTIMP", "REFUSED"][f.rcode] || "RCODE " + f.rcode;
    return `${rc}${f.ad ? " AD" : " no-AD"}${f.opt ? " +OPT" : " no-OPT"}`;
  } catch (e) {
    return e.name === "AbortError" ? "timeout" : "failed";
  } finally { clearTimeout(t); }
}

for (const [id, url] of RESOLVERS) {
  const [signed, unsigned, bogus] = await Promise.all([ask(url, "cloudflare.com"), ask(url, "google.com"), ask(url, "dnssec-failed.org")]);
  console.log(`${id.padEnd(13)} signed: ${signed.padEnd(16)} unsigned: ${unsigned.padEnd(16)} bogus: ${bogus}`);
}
