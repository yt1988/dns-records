// The public resolvers the page can read answers from: each DoH address answers a wire-format GET (?dns=) with
// Access-Control-Allow-Origin, so the browser reads the records instead of only timing the request.
//
// These are the 12 of dns-test's 33 that were measured to allow this (2026-11-11, from Tokyo with an Origin header).
// The other 20 (AliDNS, DNSPod, 360, AdGuard, Mullvad, HE, OpenDNS, NextDNS, Yandex, …) answer 200 without the CORS
// header, so a web page can send the query but cannot read the answer; listing them here would show empty rows, not
// data. Cloudflare and Google are blocked in mainland China, which is why a mainland visitor sees fewer answers — the
// page says "couldn't connect" for those, never an empty record set.
export const RESOLVERS = [
  { id: "cloudflare", name: "Cloudflare", doh: "https://cloudflare-dns.com/dns-query" },
  { id: "google", name: "Google", doh: "https://dns.google/dns-query" },
  { id: "quad9", name: "Quad9", doh: "https://dns.quad9.net/dns-query", filter: "malware" },
  { id: "controld", name: "Control D", doh: "https://freedns.controld.com/p0" },
  { id: "dnssb", name: "DNS.SB", doh: "https://doh.dns.sb/dns-query" },
  { id: "cleanbrowsing", name: "CleanBrowsing", doh: "https://doh.cleanbrowsing.org/doh/security-filter/", filter: "malware" },
  { id: "rethink", name: "Rethink DNS", doh: "https://sky.rethinkdns.com/dns-query" },
  { id: "dns4eu", name: "DNS4EU", doh: "https://unfiltered.joindns4.eu/dns-query" },
  { id: "cznic", name: "CZ.NIC ODVR", doh: "https://odvr.nic.cz/doh" },
  { id: "dnsforge", name: "DNSForge", doh: "https://dnsforge.de/dns-query", filter: "ads" },
  { id: "tiarap", name: "Tiarap", doh: "https://doh.tiar.app/dns-query" },
  { id: "iij", name: "IIJ", doh: "https://public.dns.iij.jp/dns-query" },
];

// The types the page can ask for, in tab order.
export const ALL_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SRV", "SOA"];
// Asked in one go unless the visitor changes the selection: the six that answer "how does this domain work".
export const DEFAULT_TYPES = ["A", "AAAA", "MX", "NS", "TXT", "CAA"];
