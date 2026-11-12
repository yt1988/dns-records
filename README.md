# Domain X-Ray

**English** · [简体中文](README.zh-CN.md)

[Domain X-Ray](https://dig.1ms.dog) looks up any domain's DNS records from your own browser, and gives the domain a
checkup grade:

- **Records.** A, AAAA, CNAME, MX, NS, TXT, CAA, SRV and SOA, the common six asked by default. Values that every
  resolver agrees on are merged into one row, with the TTL each resolver has left and how many of them returned it.
- **Resolver answers.** The same question goes to 12 public resolvers over DNS over HTTPS at once, and each one's own
  answer is shown: who already has the new value, who still has the old one, and who could not be reached.
- **Checkup.** Three cards on the first screen — how far the resolvers agree, the mail grade, and DNSSEC. The overall
  letter is the lower of the answers and the mail; a signed domain whose DNSSEC chain is broken drops one more step,
  while DNSSEC being off never counts against it. CAA and IPv6 are badges only.
- **Email.** MX records; SPF (more than one record, how it ends, how many DNS lookups it costs); DMARC (policy, rua,
  pct) read from `_dmarc.<domain>`; and the registrar's name servers (RDAP) next to the ones the resolvers return.
- **DNSSEC.** The page asks the parent zone for a DS record and reads the AD bit of resolvers known to validate, then
  says on and validating / on but failing validation / off / cannot tell. Fewer than two confirming validators means
  it says it cannot tell.
- **Registration.** Registrar, created and expiry dates, status flags and the registry's name servers, from RDAP.
- **Share.** A result can be shared as a link and an image in 10 languages. The link is a snapshot of what the resolvers
  returned, so two people compare the same data. It contains the domain and the answers, never the visitor's address.

Live: https://dig.1ms.dog

## How it works

Every DNS query is a DNS over HTTPS `GET` (RFC 8484) sent by the page straight to each resolver — there is no server in
the middle, and no DNS query goes to 1ms.dog. The binary DNS answer is parsed in the browser by a small parser in
[`src/dns.mjs`](src/dns.mjs) (about 250 lines, no DNS library); the merged view comes from
[`src/merge.mjs`](src/merge.mjs), the mail checks from [`src/mail.mjs`](src/mail.mjs), the DNSSEC verdict from
[`src/dnssec.mjs`](src/dnssec.mjs) and the grade from [`src/grade.mjs`](src/grade.mjs).

The 12 resolvers are Cloudflare, Google, Quad9, Control D, DNS.SB, CleanBrowsing, Rethink DNS, DNS4EU, CZ.NIC ODVR,
DNSForge, Tiarap and IIJ. They were chosen because they answer wire-format DoH queries with CORS headers a browser can
read, from more than one continent.

Four rules keep the result honest:

- **A resolver we could not reach is not a disagreement, and not a fault.** Consistency is the share of *answering*
  resolvers that gave the most common answer; a timeout or a blocked request enters no denominator and never lowers the
  grade. SERVFAIL, REFUSED or another rcode is the resolver answering about the domain, so it does count.
- **Few answers are not a healthy result.** The answers earn an A when every resolver that answered gave the same
  answer. A grade needs at least half of the 12 answering; below that the page says how many did answer, with no letter
  and no green.
- **TTL differences are not disagreement.** TTL counts down from the zone's value and differs per resolver, so it is
  shown as a range, not compared.
- **No direct query to the domain's authoritative server.** Browsers cannot speak DNS on port 53, so the page only sees
  what public resolvers have cached; the zone's current truth is not visible here.

DMARC lives at `_dmarc.<domain>`, so when TXT is selected each resolver is also asked for that name. For DNSSEC the DS
question goes to two resolvers that already answered the other types (Cloudflare and Google first); ordinary queries
carry no EDNS DO bit, and AD is read from the answer header. Registration data is read in the browser first: through
https://rdap.org/, which redirects to the right registry, or the registry's own RDAP for suffixes outside IANA's
bootstrap that publish it with CORS (currently .io). When a browser cannot read the registry — the suffix has no RDAP
(.cn, .jp, .ru, .hk), or its RDAP sends no CORS header (.de) — the page asks the Worker's `GET /whois?d=<domain>`, which
tries RDAP without CORS and then the registry's port-43 WHOIS (currently CNNIC, JPRS, TCI and HKDNR). That answer is
marked on the page as fetched by the server, and it carries only the registrar, the dates, the status flags and the name
servers: registrant names, e-mails and phone numbers are never read out of the registry's reply or returned. A suffix
with neither (currently .vn) says it cannot be looked up and links to the registry's own WHOIS page — it never claims
the domain has no registration.

Not in this version: DKIM selectors and certificates (separate tools), proxy integration, accounts.

## Files

```
src/dns.mjs        DNS wire format: build a DoH GET query, parse answers (no library)
src/domain.mjs     what the visitor typed → a domain (URL, IDN, trailing dot; IPs rejected)
src/resolvers.mjs  the 12 resolvers and the record types
src/merge.mjs      merge answers by value, consistency, stale resolvers, TTL ranges
src/mail.mjs       SPF, DMARC and registrar-vs-resolver name servers
src/dnssec.mjs     the DS answer, the AD bit and the validator list → four DNSSEC states
src/grade.mjs      the answers' grade, the mail grade, and the overall letter
src/rdap.mjs       registration data from rdap.org, normalized; CORS-capable supplements (.io); the request the
                   page makes when the browser cannot read a registry itself
src/whois.mjs      the Worker's registration lookup: RDAP without CORS, port-43 WHOIS for .cn/.jp/.ru/.hk, and the
                   text parser that keeps only registrar, dates, status and name servers
src/whois-net.js   Cloudflare's sockets API, imported only while a /whois request is being handled
src/code.mjs       a shared result as a link (/r/<code>), and back
src/app.js         the page: queries, verdict, the three cards, tables, resolver answers, mail, RDAP, share
src/worker.js      the Worker: static assets, a shared link's preview title (noindex), and GET /whois
src/page.html      the page template, one per language
src/style.css      the theme (--bg --fg --muted --line --ink), desktop and 375 px
src/i18n/*.mjs     10 languages; keys and placeholders are tested against English
scripts/build.mjs  builds public/ (pages, hashed assets, CSP, sitemap, robots, llms.txt)
scripts/assets.mjs renders public/og/<lang>.png (1200 × 630) with resvg
scripts/dnssec-probe.mjs  checks each resolver's DNSSEC behaviour from a machine that can reach DoH
public/            generated and committed; assets/share/ is copied verbatim from the 1ms.dog shell
test/              node --test: wire parser, merge, SPF/DMARC, DNSSEC, grades, RDAP, share codes, pages, Worker
```

## Run it

```bash
npm install
npm run build     # public/
npm test          # build --check + unit and page tests
npm run dev       # wrangler dev, http://localhost:8794
```

Deploy: `npm run deploy`. On 1ms.dog the domain is routed by the shell; to self-host, bind your own domain to the Worker
in the Cloudflare dashboard and build with `SITE_URL=https://your.domain npm run build`. No DNS query passes through the
Worker either way: only the share link's HTML is rewritten there and the registration lookups a browser cannot make are
asked through it.

## Adding a resolver

1. Check that its DoH endpoint answers a wire-format GET with CORS from a browser, from more than one network:
   `curl 'https://…/dns-query?dns=AAABAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE' -H 'accept: application/dns-message' -i`
   (200, `content-type: application/dns-message`, `access-control-allow-origin: *`).
2. Add it to `src/resolvers.mjs`.
3. `npm run build && npm test`, then `npm run dev` and compare its answer with the others.
4. To let it judge DNSSEC, run `scripts/dnssec-probe.mjs` to confirm it validates (AD on a signed name, SERVFAIL on a
   bogus one), then add it to `VALIDATORS` in `src/dnssec.mjs`.

## Privacy

The page sends each DNS query from the visitor's browser to the resolvers listed under Resolver answers; 1ms.dog's server
never sees a DNS query or its answer. Registration data is asked by the browser too (rdap.org, or the registry's own
RDAP). When a browser cannot read a registry, the page asks the Worker's `/whois`: it tries RDAP and then the registry's
port-43 WHOIS, and returns only the fields listed above — never registrant details — and the page marks the answer as
fetched by the server. Those lookups are cached for twelve hours (failures ten minutes) and no log is kept. A shared
link contains the domain's own public records and the registration fields that were on screen — never the visitor's IP.
Both the share dialog and the Q&A say this in every language. No cookies, no accounts, no analytics beyond the shell's
page counts.

## License

MIT. The 1ms.dog logo and name belong to 1ms.dog.
