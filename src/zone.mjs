// Which DNS zone the domain-wide records belong to.
//
// A visitor may type a host name (www.baidu.com). Its MX, SPF TXT, _dmarc and NS records are not about that host:
// they live at the zone apex (baidu.com), and the host's parent (shifen.com, for the CNAME) says nothing about how
// baidu.com takes mail. Asking www.baidu.com for MX and _dmarc.www.baidu.com gets an empty answer or NXDOMAIN, and
// showing that as "this domain has no mail" is wrong.
//
// One SOA question tells us the apex: asked at the apex the answer section carries the SOA, asked at a host inside
// the zone the authority section carries the same SOA (NODATA). No public-suffix list is needed, and no guessing:
// a name that isn't inside an existing zone gets no SOA at all, and we keep asking where the visitor pointed.
// Zone apexes from the wire are trustworthy here; "co.uk" only appears as an SOA owner for names that are not
// registered, and those answers come back NXDOMAIN, which never sets the apex (docs/decisions.md).

// Records that belong to the zone: a host name has no MX, SPF, DMARC, NS, CAA or SOA of its own worth showing.
export const ZONE_TYPES = new Set(["MX", "NS", "TXT", "CAA", "SOA"]);

// Where one record type should be asked.
export const nameFor = (type, domain, apex) => (ZONE_TYPES.has(type) && apex ? apex : domain);

// "www.baidu.com" → "baidu.com"; "" for a single label.
export function parentName(name) {
  const i = name.indexOf(".");
  return i > 0 ? name.slice(i + 1) : "";
}

// The name zone-wide records are asked at: the registry's registrable domain when it is the typed name or an ancestor
// of it, else the DNS apex found from SOA. A host can be delegated as a zone of its own (www.cloudflare.com is), yet
// mail sent to that domain is still the registrable domain's — the registry knows which one that is.
export function preferRegistrable(zone, name, registry) {
  const r = String(registry || "").toLowerCase();
  const lower = String(name).toLowerCase();
  return r && r.split(".").length >= 2 && (r === lower || lower.endsWith("." + r)) ? r : zone;
}

// The zone apex an SOA answer names, or "" when it has no SOA.
export function soaOwner(msg) {
  if (!msg || msg.rcode !== 0) return "";
  const soa = (msg.answers || []).find(r => r.type === "SOA") || (msg.authority || []).find(r => r.type === "SOA");
  return soa && soa.name ? String(soa.name).replace(/\.$/, "").toLowerCase() : "";
}

// Walk from `name` up at most `climbs` labels, asking `probe(name)` for the first SOA answer. Returns the apex, or
// `name` when nothing could be learned (no network, no SOA, a name outside any zone): the lookup then stays where
// the visitor pointed instead of inventing a parent.
//
// Two questions at most: the name the visitor typed, then one level up. A deeper walk would end at the public suffix
// (www.x.co.uk → x.co.uk → co.uk) whenever the name does not exist, and asking co.uk for its mail helps nobody.
export async function findApex(name, probe, { climbs = 1 } = {}) {
  const lower = String(name).toLowerCase();
  let cur = lower;
  for (let i = 0; i <= climbs; i++) {
    const msg = await probe(cur);
    const owner = soaOwner(msg);
    // the owner must be the name itself or an ancestor of it, and must have a dot (a single TLD is no one's zone)
    if (owner && owner.includes(".") && (owner === lower || lower.endsWith("." + owner))) return owner;
    // No usable SOA: the name has no zone of its own. That is NXDOMAIN, or a CNAME into another zone —
    // www.baidu.com follows its CNAME to a.shifen.com and reports that zone's SOA, which says nothing about baidu.com.
    if (msg && parentName(cur)) { cur = parentName(cur); continue; }
    break;
  }
  return lower;
}
