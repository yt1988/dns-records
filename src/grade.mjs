// The checkup: what the page looks at, how it grades it, and why a missing optional thing never counts against a
// domain. Pure functions shared by the page and the share card, so the letter on the card is the letter on the page.
//
// Four states per check, as in docs/tool-contract.md: good, note (worth fixing, not broken), problem, and unknown.
// "Unknown" is never drawn as a problem and never enters a denominator — a resolver that did not answer is not a
// domain with a bad record set.
export const STEPS = ["A", "B", "C", "D"];
const worse = (a, b) => (STEPS.indexOf(a) >= STEPS.indexOf(b) ? a : b);
const down = g => STEPS[Math.min(STEPS.length - 1, STEPS.indexOf(g) + 1)];

// The answers agreeing: A only when every resolver answered and all said the same thing. Half the resolvers failing
// is not "healthy" even when the ones that answered agree, so it is a B; fewer than half answering is unknown.
export function resolveGrade({ ok, total, consistency, records }) {
  if (!records || ok * 2 < total || consistency == null) return null;
  if (ok < total) return "B";
  return consistency === 1 ? "A" : "B";
}

// The mail grade: A–D, or null when the lookup cannot say (no MX, a null MX, or TXT not asked).
// Each of SPF and DMARC adds at most one note, so "p=none without rua" is one thing to fix, not two.
export function mailGrade({ mx, checked, spf, dmarc }) {
  if (!mx || !checked || !spf || !dmarc) return null;
  const notes = [], problems = [];
  if (!spf.count) problems.push("spf-none");
  else if (spf.qualifier === "pass") problems.push("spf-open");
  else if (spf.qualifier !== "fail" && spf.qualifier !== "softfail") notes.push("spf-weak");
  else if (spf.count > 1 || (spf.issues || []).indexOf("tooManyLookups") >= 0) notes.push("spf-extra");
  if (!dmarc.count) problems.push("dmarc-none");
  else if (dmarc.p === "none" || (dmarc.p !== "quarantine" && dmarc.p !== "reject")) notes.push("dmarc-weak");
  else if (!dmarc.rua.length) notes.push("dmarc-no-rua");
  if (problems.length >= 2) return "D";
  if (problems.length === 1 || notes.length >= 2) return "C";
  if (notes.length === 1) return "B";
  return "A";
}

// The overall letter is the lower of the two, and a signed domain that fails validation drops one more step.
// DNSSEC off, no CAA and no IPv6 never lower it: most domains are like that, and a grade that punishes them says
// nothing.
export function overallGrade({ resolve, mail, dnssec }) {
  if (!resolve) return null;
  const base = mail ? worse(resolve, mail) : resolve;
  return dnssec === "broken" ? down(base) : base;
}
