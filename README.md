# DNS Records

**English** · [简体中文](README.zh-CN.md)

[DNS Records](https://dig.1ms.dog) looks up any domain's DNS records, from your own browser:

- **Records.** A, AAAA, CNAME, MX, NS, TXT, CAA, SRV and SOA, the common six asked by default. Values that every
  resolver agrees on are merged into one row, with the TTL each resolver has left and how many of them returned it.
- **Propagation.** The same question goes to 12 public resolvers over DNS over HTTPS at once, and each one's own answer
  is shown: who already has the new value, who still has the old one, and who could not be reached or did not answer.
- **Email.** MX records; SPF (more than one record, how it ends, how many DNS lookups it costs); DMARC (policy, rua,
  pct) read from `_dmarc.<domain>`; and the registrar's name servers (RDAP) next to the ones the resolvers return.
- **Registration.** Registrar, created and expiry dates, status flags and the registry's name servers, from RDAP.
- **Share.** A result can be shared as a link and an image in 10 languages. The link is a snapshot of what the resolvers
  returned, so two people compare the same data. It contains the domain and the answers, never the visitor's address.

Live: https://dig.1ms.dog

## How it works

Every query is a DNS over HTTPS `GET` (RFC 8484) sent by the page straight to each resolver — there is no server in the
middle, and no request goes to 1ms.dog. The binary DNS answer is parsed in the browser by a small parser in
[`src/dns.mjs`](src/dns.mjs) (about 250 lines, no DNS library); the merged view comes from
[`src/merge.mjs`](src/merge.mjs), and the mail checks from [`src/mail.mjs`](src/mail.mjs).

The 12 resolvers are Cloudflare, Google, Quad9, Control D, DNS.SB, CleanBrowsing, Rethink DNS, DNS4EU, CZ.NIC ODVR,
DNSForge, Tiarap and IIJ. They were chosen because they answer wire-format DoH queries with CORS headers a browser can
read, from more than one continent.

Three rules keep the result honest:

- **A resolver that did not answer is not a disagreement.** Consistency is the share of *answering* resolvers that gave
  the most common answer. Unreachable resolvers are listed as unreachable; they never look like an empty answer.
- **TTL differences are not disagreement.** TTL counts down from the zone's value and differs per resolver, so it is
  shown as a range, not compared.
- **No direct query to the domain's authoritative server.** Browsers cannot speak DNS on port 53, so the page only sees
  what public resolvers have cached. That is what propagation means; the zone's current truth is not visible here.

DMARC lives at `_dmarc.<domain>`, so when TXT is selected each resolver is also asked for that name. RDAP goes through
https://rdap.org/, which redirects to the right registry.

Not in this version: DNSSEC validation, DKIM selectors and certificates (separate tools), proxy integration, accounts.

## Files

```
src/dns.mjs        DNS wire format: build a DoH GET query, parse answers (no library)
src/domain.mjs     what the visitor typed → a domain (URL, IDN, trailing dot; IPs rejected)
src/resolvers.mjs  the 12 resolvers and the record types
src/merge.mjs      merge answers by value, consistency, stale resolvers, TTL ranges
src/mail.mjs       SPF, DMARC and registrar-vs-resolver name servers
src/rdap.mjs       registration data from rdap.org, normalized
src/code.mjs       a shared result as a link (/r/<code>), and back
src/app.js         the page: queries, verdict, tables, propagation, mail, RDAP, share
src/worker.js      the Worker: static assets, and a shared link's preview title (noindex)
src/page.html      the page template, one per language
src/style.css      the theme (--bg --fg --muted --line --ink), desktop and 375 px
src/i18n/*.mjs     10 languages; keys and placeholders are tested against English
scripts/build.mjs  builds public/ (pages, hashed assets, CSP, sitemap, robots, llms.txt)
scripts/assets.mjs renders public/og/<lang>.png (1200 × 630) with resvg
public/            generated and committed; assets/share/ is copied verbatim from the 1ms.dog shell
test/              node --test: wire parser, merge, SPF/DMARC, RDAP, share codes, pages, Worker
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
Worker either way: only the share link's HTML is rewritten there.

## Adding a resolver

1. Check that its DoH endpoint answers a wire-format GET with CORS from a browser, from more than one network:
   `curl 'https://…/dns-query?dns=AAABAAABAAAAAAAAB2V4YW1wbGUDY29tAAABAAE' -H 'accept: application/dns-message' -i`
   (200, `content-type: application/dns-message`, `access-control-allow-origin: *`).
2. Add it to `src/resolvers.mjs`.
3. `npm run build && npm test`, then `npm run dev` and compare its answer with the others.

## Privacy

The page sends each DNS query from the visitor's browser to the resolvers listed under Propagation; the RDAP query goes
to rdap.org. 1ms.dog's server never sees a query or an answer, and keeps no log. A shared link contains the domain, the
records and the registration fields that were on screen — never the visitor's IP. The share dialog also says this in
every language. No cookies, no accounts, no analytics beyond the shell's page counts.

## License

MIT. The 1ms.dog logo and name belong to 1ms.dog.
