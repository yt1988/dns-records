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
    const data = normalize(json);
    // The registry's own reply, for the expandable "raw record": anything the parser misses is still there to read.
    data.raw = String(JSON.stringify(json, null, 2) || "").slice(0, 16000);
    return { data };
  } catch (e) {
    if (timedOut) return { error: "timeout" };
    if (e && (e.name === "AbortError" || e.name === "TimeoutError")) return { error: "aborted" };
    return { error: "network" };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", stop);
  }
}

// What the page asks when the browser cannot read the registry itself: the Worker reaches RDAP without CORS and the
// registry's port-43 WHOIS server. The answer comes back like fetchRdap's, plus src — "rdap" or "whois" — so the page
// can say the lookup was made on the visitor's behalf (docs/decisions.md).
export const WHOIS_ENDPOINT = "/whois?d=";

export async function fetchServerRegistration(domain, { fetchImpl = fetch, signal, timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const stop = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener("abort", stop); }
  try {
    const res = await fetchImpl(WHOIS_ENDPOINT + encodeURIComponent(domain), {
      signal: ctl.signal, credentials: "omit", referrerPolicy: "no-referrer", headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const j = await res.json();
    if (!j || typeof j !== "object") return null;
    const src = j.src === "whois" ? "whois" : "rdap";
    if (j.ok) return {
      src,
      data: {
        handle: null, registrar: j.registrar || null, registrarUrl: j.registrarUrl || null,
        created: j.created || null, expires: j.expires || null, updated: j.updated || null,
        status: Array.isArray(j.status) ? j.status : [],
        nameservers: Array.isArray(j.nameservers) ? j.nameservers : [],
        // the registrant side the registry publishes, and its own reply for the expandable raw record
        registrant: j.registrant || null, registrantOrg: j.registrantOrg || null,
        email: j.email || null, phone: j.phone || null, dnssec: j.dnssec || null,
        raw: typeof j.raw === "string" ? j.raw : null,
      },
    };
    if (j.reason === "notfound") return { notFound: true, src };
    return null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", stop);
  }
}

// vCard fields (fn, org, email, tel) as plain strings; org may be an array of strings per the vCard spec.
function vcard(entity) {
  const card = entity && Array.isArray(entity.vcardArray) && Array.isArray(entity.vcardArray[1]) ? entity.vcardArray[1] : [];
  const get = name => card.filter(p => Array.isArray(p) && p[0] === name)
    .map(p => (Array.isArray(p[3]) ? p[3].join(" ") : p[3]))
    .map(v => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  return { fn: get("fn"), org: get("org"), email: get("email"), tel: get("tel") };
}

function vname(entity) {
  const fn = vcard(entity).fn;
  return fn[0] || entity.handle || null;
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
  // The registrant as the registry publishes it. A privacy service or a registry that redacts it (DENIC) gives an
  // empty vCard, and then there is nothing to show — not a field to invent.
  const rc = vcard(entities.find(e => Array.isArray(e.roles) && e.roles.includes("registrant")));
  const signed = json.secureDNS && typeof json.secureDNS.delegationSigned === "boolean"
    ? (json.secureDNS.delegationSigned ? "signed" : "unsigned") : null;
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
    registrant: rc.fn[0] || null,
    registrantOrg: rc.org.join(", ") || null,
    email: [...new Set(rc.email)].join(", ") || null,
    phone: [...new Set(rc.tel)].join(", ") || null,
    dnssec: signed,
  };
}
