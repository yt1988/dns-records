// A shared result in a link: /<lang>/r/<code>. The code is "<version>~<body>"; a new format gets a new version, so
// links already sent keep opening. Used by the page (bundled into app.js) and by the Worker, which titles the link's
// preview. The body is made by 1ms.dog's shared codec (public/assets/share/codec.js, copied byte for byte):
//   "z" + base64url(deflate-raw(JSON)), or "u" + base64url(JSON) when the browser can't compress.
//
// What a link holds: the domain, the types asked for, when it was looked up, every resolver's answer per type
// ([resolver id, type, code, [[record type, TTL, value], …]]), and the registration fields the page showed. It is the
// result as it was seen — opening the link does not query again — and it never holds anything about the visitor.
import { pack, unpack, CodecError } from "../public/assets/share/codec.js";

export const CODE_VERSION = "1";
// 9 and up were added later: a link made by this build and opened by an older page is read as an unknown error there,
// which is treated as "we don't know", never as the domain's fault.
export const CODES = { ok: 0, nx: 3, servfail: 2, timeout: 4, network: 5, http: 6, bad: 7, skipped: 8, refused: 9, rcode: 10 };

export async function encodeResult(obj) {
  return CODE_VERSION + "~" + await pack(JSON.stringify(obj));
}

// The result, or null when the code can't be read (garbled, cut short, a version this code doesn't know). Throws
// CodecError("inflate") when the code is fine but this browser can't decompress it (the Worker always can).
export async function decodeResult(code) {
  const m = /^1~([A-Za-z0-9_-]{8,16000})$/.exec(code || "");
  if (!m) return null;
  let text;
  try { text = await unpack(m[1]); }
  catch (e) { if (e instanceof CodecError && e.reason === "inflate") throw e; return null; }
  try {
    const r = JSON.parse(text);
    if (!r || typeof r.d !== "string" || !/^[a-z0-9._-]{1,253}$/i.test(r.d)) return null;
    if (!Array.isArray(r.t) || !r.t.length || r.t.length > 9) return null;
    if (!Array.isArray(r.r) || !r.r.length || r.r.length > 120) return null;
    return r;
  } catch (e) { return null; }
}

// "/r/<code>" or "/<lang folder>/r/<code>" → { slug, code }
export function sharePath(path) {
  const m = /^\/(?:([a-z]{2}(?:-[a-z]{2})?)\/)?r\/([^/]+)$/.exec(path);
  return m ? { slug: m[1] || "", code: m[2] } : null;
}

// Rebuild the shape the page renders from a decoded share link.
export function resultsFromSnapshot(snap) {
  const byType = {};
  for (const [id, type, code, rows] of snap.r) {
    (byType[type] || (byType[type] = [])).push({
      id, type, status: code === 0 || code === 3 ? "ok" : "error",
      error: errorOf(code), rcode: code, ad: false,
      records: (rows || []).map(([t, ttl, data]) => ({ type: t, ttl: Number(ttl) || 0, data: String(data) })),
    });
  }
  return byType;
}

function errorOf(code) {
  return { 2: "servfail", 4: "timeout", 5: "network", 6: "http", 7: "bad", 8: "skipped", 9: "refused", 10: "rcode" }[code] || null;
}
