// Mail records in plain words: what the SPF and DMARC TXT records say, and whether the registrar's name servers
// match the ones the resolvers return. Pure functions: the page calls them with the TXT/NS records it already has.
//
// SPF (RFC 7208): at most one v=spf1 record, it should end with -all (or ~all while testing), and the mechanisms
// that need another DNS lookup (include, a, mx, ptr, exists, redirect) may cost at most 10 lookups per check.
// DMARC (RFC 7489): one v=DMARC1 record at _dmarc.<domain>, with p= telling receivers what to do with mail that
// fails both SPF and DKIM.

const textOf = rec => (typeof rec === "string" ? rec : rec && rec.text != null ? rec.text : rec && rec.data != null ? rec.data : "");

export function spfCheck(records) {
  const all = (records || []).map(textOf).filter(v => /^v=spf1(?:\s|$)/i.test(v.trim()));
  if (!all.length) return { count: 0, record: null, qualifier: null, lookups: 0, issues: [] };
  const record = all[0].trim();
  const terms = record.split(/\s+/).filter(Boolean).slice(1);
  const issues = [];
  if (all.length > 1) issues.push("multiple");

  const allTerms = terms.filter(t => /^[+\-~?]?all$/i.test(t));
  let qualifier = null;
  if (allTerms.length) {
    const q = allTerms[allTerms.length - 1][0];
    qualifier = "+-~?".includes(q) ? { "+": "pass", "-": "fail", "~": "softfail", "?": "neutral" }[q] : "pass";
    if (allTerms.length > 1) issues.push("multipleAll");
    if (terms[terms.length - 1] !== allTerms[allTerms.length - 1]) issues.push("allNotLast");
  } else {
    issues.push("noAll");
  }
  if (qualifier === "pass") issues.push("plusAll");

  const lookups = terms.filter(t => /^[+\-~?]?(?:include:|a(?::|$)|mx(?::|$)|ptr(?::|$)|exists:|redirect=)/i.test(t)).length;
  if (lookups > 10) issues.push("tooManyLookups");
  if (record.length > 512) issues.push("long");
  return { count: all.length, record, qualifier, lookups, issues };
}

export function dmarcCheck(records) {
  const all = (records || []).map(textOf).filter(v => /^v=DMARC1\s*(?:;|$)/i.test(v.trim()));
  if (!all.length) return { count: 0, record: null, p: null, sp: null, rua: [], pct: null, issues: [] };
  const record = all[0].trim();
  const tags = {};
  for (const part of record.split(";")) {
    const m = /^\s*([a-z0-9]+)\s*=\s*(.*?)\s*$/i.exec(part);
    if (m) tags[m[1].toLowerCase()] = m[2];
  }
  const p = (tags.p || "").toLowerCase() || null;
  const sp = (tags.sp || "").toLowerCase() || null;
  const rua = (tags.rua || "").split(",").map(s => s.trim()).filter(Boolean);
  const pct = tags.pct ? Number(tags.pct) : 100;
  const issues = [];
  if (all.length > 1) issues.push("multiple");
  if (!p) issues.push("noPolicy");
  else if (!["none", "quarantine", "reject"].includes(p)) issues.push("badPolicy");
  if (p === "none") issues.push("pNone");
  if (!rua.length) issues.push("noRua");
  if (Number.isFinite(pct) && pct < 100) issues.push("partial");
  return { count: all.length, record, p, sp, rua, pct: Number.isFinite(pct) ? pct : null, issues };
}

const normNs = ns => String(ns || "").trim().toLowerCase().replace(/\.+$/, "");

export function compareNs(registrarNs, resolverNs) {
  const a = [...new Set((registrarNs || []).map(normNs).filter(Boolean))].sort();
  const b = [...new Set((resolverNs || []).map(normNs).filter(Boolean))].sort();
  const onlyRegistrar = a.filter(x => !b.includes(x));
  const onlyResolver = b.filter(x => !a.includes(x));
  return { same: a.length > 0 && b.length > 0 && !onlyRegistrar.length && !onlyResolver.length, onlyRegistrar, onlyResolver };
}
