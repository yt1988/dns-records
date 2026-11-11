// Combining the answers of many resolvers.
//
// One resolver's answer for one type is a list of records: the CNAME chain it followed, then the records of the
// requested type. Two answers are the same when those lists hold the same records (order and TTL ignored): the TTL
// depends on when each resolver cached the record, so it says nothing about propagation.
//
// "Consistency" is how many of the resolvers that answered gave the most common answer. Resolvers that failed are
// counted separately and never as disagreement: a resolver that could not be reached has not told us anything, so it
// must not look like an empty or outdated answer.
import { ALL_TYPES } from "./resolvers.mjs";

export const OK = "ok";
export const ERR = "error";

// Records sorted by type and value: the same set of answers in a different order is the same answer.
export const answerKey = rows => rows.map(r => r.type + " " + r.data).sort().join(" | ");

// status per type: { ok, errors, groups, majority, consistency, stale, nx, empty, distinct }
export function mergeType(results) {
  const ok = results.filter(r => r.status === OK);
  const errors = results.filter(r => r.status !== OK);
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
    groups: list,
    majority,
    consistency: ok.length >= 2 && majority ? majority.resolvers.length / ok.length : null,
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

