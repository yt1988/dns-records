// Combining the answers of many resolvers.
//
// One resolver's answer for one type is a list of records: the CNAME chain it followed, then the records of the
// requested type. Two answers are the same when those lists hold the same records (order and TTL ignored): the TTL
// depends on when each resolver cached the record, so it says nothing about propagation.
//
// "Consistency" is how many of the resolvers that answered gave the most common answer. Two kinds of failure are
// not the same thing (docs/tool-contract.md: unknown is neither fine nor a problem):
//   - SERVFAIL, REFUSED or an odd rcode is the resolver answering about the domain. It counts as an answer, so it
//     takes part in the consistency figure — the domain's own state is different from the others'.
//   - timeout, a blocked request, an HTTP error or an unreadable answer is us not reaching the resolver. It has told
//     us nothing, so it enters no denominator and says nothing good or bad about the domain.
import { ALL_TYPES } from "./resolvers.mjs";

export const OK = "ok";
export const ERR = "error";

// The errors that are an answer about the domain, rather than a failed trip to the resolver.
export const SERVED_ERRORS = new Set(["servfail", "refused", "rcode"]);
export const isServed = r => r.status !== OK && SERVED_ERRORS.has(r.error);

// Records sorted by type and value: the same set of answers in a different order is the same answer.
export const answerKey = rows => rows.map(r => r.type + " " + r.data).sort().join(" | ");

// status per type: { ok, errors, served, unreachable, answered, groups, majority, consistency, stale, nx, empty, distinct }
export function mergeType(results) {
  const ok = results.filter(r => r.status === OK);
  const errors = results.filter(r => r.status !== OK);
  const served = errors.filter(isServed);
  const unreachable = errors.filter(r => !isServed(r));
  const answered = ok.length + served.length;
  const groups = new Map();
  for (const r of ok) {
    const key = answerKey(r.records);
    if (!groups.has(key)) groups.set(key, { key, records: r.records, resolvers: [] });
    groups.get(key).resolvers.push(r.id);
  }
  const list = [...groups.values()].sort((a, b) => b.resolvers.length - a.resolvers.length || a.key.localeCompare(b.key));
  const majority = list[0] || null;
  const stale = majority ? ok.filter(r => answerKey(r.records) !== majority.key) : [];
  return {
    ok,
    errors,
    served,
    unreachable,
    answered,
    groups: list,
    majority,
    consistency: answered >= 2 && majority ? majority.resolvers.length / answered : null,
    stale,
    nx: ok.filter(r => r.rcode === 3).length,
    empty: ok.length > 0 && ok.every(r => r.records.length === 0),
    distinct: list.length,
  };
}

export function mergeAll(byType) {
  const out = {};
  for (const type of ALL_TYPES) if (byType[type]) out[type] = mergeType(byType[type]);
  return out;
}

// One row per distinct value across every type: { type, data, ttlMin, ttlMax, resolvers: [ids], count }.
export function mergeRecords(byType) {
  const rows = new Map();
  for (const type of ALL_TYPES) {
    for (const r of byType[type] || []) {
      if (r.status !== OK) continue;
      for (const rec of r.records) {
        const key = rec.type + " " + rec.data;
        if (!rows.has(key)) rows.set(key, { type: rec.type, data: rec.data, ttlMin: rec.ttl, ttlMax: rec.ttl, resolvers: [], record: rec });
        const row = rows.get(key);
        row.ttlMin = Math.min(row.ttlMin, rec.ttl);
        row.ttlMax = Math.max(row.ttlMax, rec.ttl);
        if (!row.resolvers.includes(r.id)) row.resolvers.push(r.id);
      }
    }
  }
  return [...rows.values()].map(r => ({ ...r, count: r.resolvers.length }))
    .sort((a, b) => ALL_TYPES.indexOf(a.type) - ALL_TYPES.indexOf(b.type) || a.data.localeCompare(b.data));
}

// Which records the resolver agreed on for the type with the most answers; used for the one-line conclusion.
export function primaryType(merged) {
  return ALL_TYPES.find(t => merged[t] && merged[t].ok.length) || null;
}

