// Is DNSSEC on, and does it validate? Two signals, neither of which can be read on its own:
//
//   1. the parent zone's DS record — a recursive query for "<domain> DS" returns it, or NOERROR with no answer when
//      the domain is unsigned. This is the only way to tell "off" from "on but broken".
//   2. the AD bit in the answers of resolvers that are known to validate. AD=0 alone proves nothing: a resolver that
//      does not validate (CleanBrowsing, measured) never sets it. Only the seven resolvers that passed the probe in
//      scripts/dnssec-probe.mjs are asked to judge.
//
// The rules come from docs/decisions.md ("v2 DNSSEC 探针"). Anything that does not fit is "unknown", never "broken"
// and never "off": a page that guesses here accuses working domains of being broken.
export const VALIDATORS = ["cloudflare", "google", "controld", "rethink", "dnsforge", "tiarap", "iij"];
// DNS.SB validates (AD on a signed name, measured), but answers a bogus name with HTTP 503 instead of SERVFAIL, so
// it can confirm "passes" and is never used to decide "broken".
export const PASS_ONLY = ["dnssb"];
// The two used for the DS question when they answered anything else; a lookup where both are unreachable falls back
// to whichever validators did answer, so a mainland visitor still learns whether DNSSEC is on.
const DS_PREFERRED = ["cloudflare", "google"];

// The DS answer: true (the parent has a DS), false (the parent says there is none), null (could not tell).
export function dsFound(results) {
  const ok = (results || []).filter(r => r && r.status === "ok");
  if (ok.some(r => r.records.some(x => x.type === "DS"))) return true;
  if (ok.length && ok.every(r => r.rcode === 0 && !r.records.some(x => x.type === "DS"))) return false;
  return null;
}

// Which resolvers to ask for DS, given what answered the record types: the preferred two first, then any other
// validator that answered. At most two, always distinct.
export function dsAskers(answeredIds) {
  const answered = new Set(answeredIds || []);
  const pick = [...DS_PREFERRED.filter(id => answered.has(id)), ...VALIDATORS.filter(id => answered.has(id) && DS_PREFERRED.indexOf(id) < 0)];
  return pick.slice(0, 2);
}

// rows: [{ id, ok: <answered any record type>, ad: <some answer carried AD>, servfail: <some answer was SERVFAIL> }]
// → { state: "pass" | "broken" | "off" | "unknown", validators, answered }
export function dnssecVerdict(ds, rows) {
  const byId = new Map((rows || []).map(r => [r.id, r]));
  const known = [...byId.values()].filter(r => VALIDATORS.indexOf(r.id) >= 0);
  const answering = known.filter(r => r.ok);
  const passing = answering.filter(r => r.ad);
  const failing = known.filter(r => !r.ok && r.servfail).length;
  const sb = byId.get("dnssb");
  const sbPass = !!(sb && sb.ok && sb.ad);
  const answered = answering.length;
  const validators = passing.length + (sbPass ? 1 : 0);
  const verdict = state => ({ state, validators, answered });

  if (ds === true) {
    // Every validator that answered must have set AD. One that cannot resolve at all is not a contradiction: filters
    // SERVFAIL too, so only two or more of them without a single validated answer count as a broken chain.
    if (validators >= 2 && answering.every(r => r.ad)) return verdict("pass");
    // "Broken" is the only state that lowers the grade, so it needs every validating answer to be absent: one AD
    // from a single validator means something does validate, and that is a disagreement, not a broken chain.
    if (!validators && failing >= 2) return verdict("broken");
    return verdict("unknown");
  }
  if (ds === false) return verdict("off");
  return verdict("unknown");
}

// One row per resolver, folded from every answer it gave for the domain's own types (never from the _dmarc name,
// whose AD bit is about a different zone).
export function dnssecRows(byType) {
  const rows = new Map();
  for (const type of Object.keys(byType || {})) {
    for (const r of byType[type]) {
      const row = rows.get(r.id) || { id: r.id, ok: false, ad: false, servfail: false };
      if (r.status === "ok") { row.ok = true; if (r.ad) row.ad = true; }
      if (r.status === "error" && r.error === "servfail") row.servfail = true;
      rows.set(r.id, row);
    }
  }
  return [...rows.values()];
}
