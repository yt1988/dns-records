// Registration data (RDAP, the JSON successor of WHOIS) for a domain, fetched in the browser from rdap.org, which
// redirects to the right registry and sends Access-Control-Allow-Origin on both the redirect and the answer.
// What comes back is only what the registry publishes: privacy services often replace the registrant, and some
// registries publish less than others, so a missing field is shown as unknown, not as "none".
//
// rdap.org follows IANA's bootstrap file, which covers ~1,200 suffixes but not all of them: .cn, .jp, .ru, .hk, .de
// and .vn are missing, and for them rdap.org answers 404 "No RDAP service is available for this resource". That is
// not the same as "this domain has no registration data", so it gets its own state ("unsupported") and a link to the
// registry's own WHOIS page — stating "none" when we simply cannot ask would be a lie (docs/decisions.md).
export const RDAP_BASE = "https://rdap.org/domain/";
// Registries with a working public RDAP + CORS that IANA's bootstrap does not list. Measured, not guessed; add one
// only after checking it from a browser (no CORS means it cannot be used here: rdap.denic.de for .de, for example).
export const RDAP_SUPPLEMENTS = {
  io: { base: "https://rdap.identitydigital.services/rdap/domain/", name: "Identity Digital" },
};
// Where to send a visitor when we cannot query RDAP at all. The registry's own WHOIS form, not port 43.
export const REGISTRY_WHOIS = {
  cn: { name: "CNNIC", url: "https://whois.cnnic.cn/" },
  jp: { name: "JPRS", url: "https://www.jprs.jp/whois/" },
  ru: { name: "TCI", url: "https://www.tcinet.ru/whois/" },
  hk: { name: "HKDNR", url: "https://www.hkdnr.hk/" },
  vn: { name: "VNNIC", url: "https://whois.vnnic.vn/" },
};
// The suffixes we know rdap.org cannot answer, for the help text and as a fallback when the 404 body is unreadable.
export const NO_RDAP_TLDS = ["cn", "jp", "ru", "hk", "de", "vn"];

export function tldOf(domain) {
  const labels = String(domain || "").toLowerCase().replace(/\.+$/, "").split(".");
  return labels.length > 1 ? labels[labels.length - 1] : "";
}

export function registryOf(domain) {
  return REGISTRY_WHOIS[tldOf(domain)] || null;
}

export async function fetchRdap(domain, { fetchImpl = fetch, signal, timeout = 9000 } = {}) {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeout);
  const stop = () => ctl.abort();
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener("abort", stop);
  }
  try {
    const tld = tldOf(domain);
    const supplement = RDAP_SUPPLEMENTS[tld];
    const res = await fetchImpl((supplement ? supplement.base : RDAP_BASE) + encodeURIComponent(domain), {
      signal: ctl.signal, credentials: "omit", referrerPolicy: "no-referrer",
      headers: { accept: "application/rdap+json, application/json" },
    });
    if (res.status === 404) {
      // rdap.org's 404 is about the suffix, the registry's is about the domain. Only rdap.org is asked that question.
      if (supplement) return { notFound: true };
      const body = await res.text().catch(() => "");
      if (/no rdap service/i.test(body)) return { unsupported: true, tld };
      // An unreadable 404 from a suffix we know has no service is still "cannot ask", not "no registration data".
      return NO_RDAP_TLDS.indexOf(tld) >= 0 ? { unsupported: true, tld } : { notFound: true };
    }
    if (!res.ok) return { error: "http", status: res.status };
    let json;
    try { json = await res.json(); } catch (e) { return { error: "bad" }; }
    return { data: normalize(json) };
  } catch (e) {
    if (timedOut) return { error: "timeout" };
    if (e && (e.name === "AbortError" || e.name === "TimeoutError")) return { error: "aborted" };
    return { error: "network" };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", stop);
  }
}

function vname(entity) {
  const card = Array.isArray(entity.vcardArray) && Array.isArray(entity.vcardArray[1]) ? entity.vcardArray[1] : [];
  const fn = card.find(p => Array.isArray(p) && p[0] === "fn");
  return (fn && typeof fn[3] === "string" && fn[3].trim()) || entity.handle || null;
}

const eventDate = (events, ...actions) => {
  for (const action of actions) {
    const e = (events || []).find(x => String(x.eventAction || "").toLowerCase() === action);
    if (e && e.eventDate) return e.eventDate;
  }
  return null;
};

export function normalize(json) {
  const entities = Array.isArray(json.entities) ? json.entities : [];
  const registrarEnt = entities.find(e => Array.isArray(e.roles) && e.roles.includes("registrar"))
    || entities.find(e => Array.isArray(e.roles) && e.roles.includes("sponsor"));
  const nameservers = (Array.isArray(json.nameservers) ? json.nameservers : [])
    .map(n => (typeof n === "string" ? n : n.ldhName || n.unicodeName || ""))
    .filter(Boolean);
  return {
    handle: json.handle || null,
    registrar: registrarEnt ? vname(registrarEnt) : null,
    registrarUrl: registrarEnt && Array.isArray(registrarEnt.links)
      ? (registrarEnt.links.find(l => l.rel === "about" || l.rel === "self") || {}).href || null : null,
    created: eventDate(json.events, "registration"),
    expires: eventDate(json.events, "expiration"),
    updated: eventDate(json.events, "last changed", "last update of rdap database"),
    status: (Array.isArray(json.status) ? json.status : []).filter(s => typeof s === "string"),
    nameservers: [...new Set(nameservers.map(n => n.toLowerCase().replace(/\.+$/, "")))],
  };
}
