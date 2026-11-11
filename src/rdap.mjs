// Registration data (RDAP, the JSON successor of WHOIS) for a domain, fetched in the browser from rdap.org, which
// redirects to the right registry and sends Access-Control-Allow-Origin on both the redirect and the answer.
// What comes back is only what the registry publishes: privacy services often replace the registrant, and some
// registries publish less than others, so a missing field is shown as unknown, not as "none".
export const RDAP_BASE = "https://rdap.org/domain/";

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
    const res = await fetchImpl(RDAP_BASE + encodeURIComponent(domain), {
      signal: ctl.signal, credentials: "omit", referrerPolicy: "no-referrer",
      headers: { accept: "application/rdap+json, application/json" },
    });
    if (res.status === 404) return { notFound: true };
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
