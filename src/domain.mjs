// What the visitor typed → a hostname to query. Accepts a domain, a URL, or a trailing dot; rejects an IP address
// (a DNS record belongs to a name, not to an address). IDNs become punycode, which is what goes on the wire.
export class DomainError extends Error {
  constructor(reason) { super("domain: " + reason); this.name = "DomainError"; this.reason = reason; }
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function normalizeDomain(input) {
  let s = String(input || "").trim();
  if (!s) throw new DomainError("empty");
  if (s.length > 2048) throw new DomainError("bad");

  let host;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    try { host = new URL(s).hostname; } catch (e) { throw new DomainError("bad"); }
  } else if (/[/?#\s]/.test(s)) {
    try { host = new URL("http://" + s).hostname; } catch (e) { throw new DomainError("bad"); }
  } else {
    host = s;
  }

  // URL keeps the brackets around an IPv6 literal; both forms are addresses, not names
  host = host.replace(/^\[|\]$/g, "");
  if (IPV4.test(host) || host.includes(":")) throw new DomainError("ip");

  host = host.replace(/\.+$/, "").toLowerCase();
  if (!host || host === ".") throw new DomainError("empty");

  // A non-ASCII name goes through the URL parser, which applies IDNA (Unicode → xn--)
  if (/[^\x00-\x7f]/.test(host)) {
    try { host = new URL("http://" + host).hostname; } catch (e) { throw new DomainError("bad"); }
  }
  host = host.replace(/\.+$/, "").toLowerCase();
  if (host.length > 253) throw new DomainError("bad");

  const labels = host.split(".");
  if (labels.length < 2) throw new DomainError("single");   // "localhost" and a bare TLD are not domains here
  for (const l of labels) {
    if (!l || l.length > 63) throw new DomainError("bad");
    if (!/^[a-z0-9_-]+$/.test(l)) throw new DomainError("bad");
    if (l.startsWith("-") || l.endsWith("-")) throw new DomainError("bad");
  }
  if (/^\d+$/.test(labels[labels.length - 1])) throw new DomainError("bad");   // an all-numeric TLD
  return { name: host, display: host };
}
