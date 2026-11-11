// The page. The visitor's browser asks each public resolver over DNS over HTTPS; nothing here goes through 1ms.dog.
import { normalizeDomain, DomainError } from "./domain.mjs";
import { RESOLVERS, ALL_TYPES } from "./resolvers.mjs";
import { dohURL, parse, answerOf, answerKey } from "./dns.mjs";
import { mergeType, mergeAll, mergeRecords, primaryType, OK } from "./merge.mjs";
import { spfCheck, dmarcCheck, compareNs } from "./mail.mjs";
import { fetchRdap } from "./rdap.mjs";
import { encodeResult, decodeResult, sharePath, resultsFromSnapshot, CODES } from "./code.mjs";

(function () {
  "use strict";
  const L = window.L1MS || {};
  const D = JSON.parse(document.getElementById("data").textContent || "{}");
  const LANG = D.lang || "en";
  const t = (k, vars) => {
    let s = k in L ? L[k] : k;
    if (vars) for (const key of Object.keys(vars)) s = s.split("{" + key + "}").join(String(vars[key]));
    return s;
  };
  const $ = id => document.getElementById(id);
  const all = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  const K = { theme: "dig:theme", lang: "dig:lang" };
  const EXT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 2.5h4.5V7M13.5 2.5 7.5 8.5M12 10v3.5H2.5V4H6"/></svg>';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmtDate = s => {
    if (!s) return "—";
    const d = new Date(s);
    if (isNaN(d.getTime())) return String(s);
    try { return new Intl.DateTimeFormat(LANG, { year: "numeric", month: "short", day: "numeric" }).format(d); }
    catch (e) { return d.toISOString().slice(0, 10); }
  };
  const pct = n => Math.round(n * 100) + "%";
  // TTL: seconds are precise but hard to read past an hour; long values get hours or days instead.
  const ttlNum = n => (n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ""));
  function ttlText(a, b) {
    if (Math.max(a, b) >= 172800) {
      const f = n => ttlNum(n / 86400);
      return a === b ? t("ttl_d", { a: f(a) }) : t("ttl_range_d", { a: f(a), b: f(b) });
    }
    if (Math.max(a, b) >= 3600) {
      const f = n => ttlNum(n / 3600);
      return a === b ? t("ttl_h", { a: f(a) }) : t("ttl_range_h", { a: f(a), b: f(b) });
    }
    return a === b ? t("ttl_s", { a }) : t("ttl_range", { a, b });
  }

  // Other 1ms.dog tools: their address comes from the shell's <meta name="<id>">; self-hosted there is none, so no link.
  // Links keep this page's language folder.
  const tool = id => {
    const m = document.querySelector('meta[name="' + id + '"]');
    return m && m.content ? m.content.replace(/\/+$/, "") + (D.paths && D.paths[LANG] ? D.paths[LANG] : "/") : "";
  };
  const asnHref = ip => { const u = tool("asn"); return u ? u + "ip/" + encodeURIComponent(ip) : ""; };

  /* ---------------- theme, language, help ---------------- */
  const TH = ["system", "light", "dark"], thBtn = $("theme");
  const applyTheme = th => {
    if (th === "system") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", th);
    thBtn.dataset.th = th;
    thBtn.title = t("a_theme");
    thBtn.setAttribute("aria-label", t("a_theme"));
  };
  applyTheme(TH.indexOf(store.get(K.theme)) >= 0 ? store.get(K.theme) : "system");
  thBtn.onclick = () => { const n = TH[(TH.indexOf(thBtn.dataset.th) + 1) % 3]; store.set(K.theme, n); applyTheme(n); };
  $("lang").onchange = e => {
    const l = e.target.value;
    store.set(K.lang, l);
    const sp = sharePath(location.pathname);
    const base = (D.paths && D.paths[l]) || "/";
    location.href = base + (sp ? "r/" + sp.code : "") + location.search;
  };

  const openDlg = id => { $(id).hidden = false; document.documentElement.style.overflow = "hidden"; const b = $(id).querySelector("[data-close]"); if (b) b.focus(); };
  const closeDlg = () => { all(".scrim").forEach(s => { s.hidden = true; }); document.documentElement.style.overflow = ""; };
  all("[data-close]").forEach(b => { b.onclick = closeDlg; });
  all(".scrim").forEach(s => s.addEventListener("click", e => { if (e.target === s) closeDlg(); }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeDlg(); });
  let helpIdx = 0;
  const helpQs = all("#helpNav [data-hq]");
  $("helpSel").innerHTML = helpQs.map((b, i) => '<option value="' + i + '">' + (i + 1) + " / " + helpQs.length + " · " + esc(b.textContent) + "</option>").join("");
  const showHelp = i => {
    helpIdx = Math.max(0, Math.min(helpQs.length - 1, i));
    helpQs.forEach(b => b.setAttribute("aria-selected", String(+b.dataset.hq === helpIdx)));
    all("#helpC [data-hqb]").forEach(a => { a.hidden = +a.dataset.hqb !== helpIdx; });
    $("helpSel").value = String(helpIdx);
    all("[data-hstep]").forEach(b => { b.disabled = helpIdx + +b.dataset.hstep < 0 || helpIdx + +b.dataset.hstep >= helpQs.length; });
    $("helpC").scrollTop = 0;
  };
  $("helpBtn").onclick = () => { showHelp(helpIdx); openDlg("help"); };
  helpQs.forEach(b => { b.onclick = () => showHelp(+b.dataset.hq); });
  $("helpSel").onchange = e => showHelp(+e.target.value);
  all("[data-hstep]").forEach(b => { b.onclick = () => showHelp(helpIdx + +b.dataset.hstep); });

  /* ---------------- state ---------------- */
  const TIMEOUT = 4500;
  let runId = 0, ctl = null, state = fresh(), R = null;

  function fresh() {
    return { domain: "", types: [], results: {}, dmarc: [], rdap: null, startedAt: 0, finished: false,
      tab: "A", merged: null, records: [], shareCode: "", shared: false, findings: [] };
  }

  const chips = all("#types input");
  const readTypes = () => {
    let list = chips.filter(c => c.checked).map(c => c.value);
    if (!list.length) { chips.filter(c => c.value === "A").forEach(c => { c.checked = true; c.parentNode.classList.add("on"); }); list = ["A"]; }
    return ALL_TYPES.filter(x => list.indexOf(x) >= 0);
  };
  chips.forEach(c => {
    c.parentNode.classList.toggle("on", c.checked);
    c.onchange = () => c.parentNode.classList.toggle("on", c.checked);
  });

  /* ---------------- querying ---------------- */
  function queryOne(r, name, type, signal) {
    const c = new AbortController();
    let timedOut = false, stopped = false;
    const timer = setTimeout(() => { timedOut = true; c.abort(); }, TIMEOUT);
    const onStop = () => { stopped = true; c.abort(); };
    if (signal) { if (signal.aborted) onStop(); else signal.addEventListener("abort", onStop); }
    return fetch(dohURL(r.doh, name, type), {
      mode: "cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
      headers: { accept: "application/dns-message" }, signal: c.signal,
    }).then(res => {
      if (!res.ok) return err(r, type, "http", "", res.status);
      return res.arrayBuffer().then(buf => {
        const msg = parse(buf);
        if (!msg) return err(r, type, "bad");
        if (msg.rcode === 0 || msg.rcode === 3) return { id: r.id, type, status: OK, rcode: msg.rcode, ad: msg.ad, records: answerOf(msg, type) };
        if (msg.rcode === 2) return err(r, type, "servfail", msg.rcodeName);
        if (msg.rcode === 5) return err(r, type, "refused", msg.rcodeName);
        return err(r, type, "rcode", msg.rcodeName);
      });
    }).catch(() => {
      if (stopped) return err(r, type, "aborted");
      return err(r, type, timedOut ? "timeout" : "network");
    }).then(x => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onStop);
      return x;
    });
  }
  const err = (r, type, error, rcodeName, statusCode) => ({ id: r.id, type, status: "error", error, rcodeName: rcodeName || "", statusCode: statusCode || 0, records: [] });

  function setProgress(done, total) { $("prog").textContent = done < total ? t("prog", { done, total }) : ""; }

  function addResult(type, res) {
    if (!state.results[type]) state.results[type] = [];
    state.results[type].push(res);
  }
  const resName = id => { const r = RESOLVERS.find(x => x.id === id); return r ? r.name : id; };

  async function lookup(input, types) {
    const my = ++runId;
    let norm;
    try { norm = normalizeDomain(input); }
    catch (e) {
      const reason = e instanceof DomainError ? e.reason : "bad";
      $("err").textContent = reason === "ip" ? t("bad_ip") : reason === "empty" ? t("bad_empty") : t("bad_domain");
      $("err").hidden = false;
      $("domain").focus();
      return;
    }
    if (ctl) ctl.abort();
    ctl = new AbortController();
    state = fresh();
    state.domain = norm.name;
    state.types = types.slice();
    state.tab = types[0] || "A";
    state.startedAt = Date.now();
    $("domain").value = norm.display;
    $("err").hidden = true;
    resetUI();
    setGo(true);
    renderPropSkeleton();
    $("prop").hidden = false;
    $("prog").textContent = t("running");

    const wantDmarc = types.indexOf("TXT") >= 0;
    const total = RESOLVERS.length * (types.length + (wantDmarc ? 1 : 0));
    let done = 0;
    const tick = () => { done++; setProgress(done, total); };
    const rdapP = loadRdap(norm.name, my);

    await Promise.all(RESOLVERS.map(async r => {
      let dead = null;
      for (const type of types) {
        if (my !== runId) return;
        if (dead) { addResult(type, err(r, type, "skipped")); tick(); if (state.tab === type) renderProp(); continue; }
        const res = await queryOne(r, norm.name, type, ctl.signal);
        if (my !== runId) return;
        addResult(type, res);
        if (res.status === "error" && (res.error === "timeout" || res.error === "network" || res.error === "http")) dead = res.error;
        tick();
        if (state.tab === type) renderProp();
      }
      if (wantDmarc && my === runId) {
        let res;
        if (dead) res = err(r, "TXT", "skipped");
        else res = await queryOne(r, "_dmarc." + norm.name, "TXT", ctl.signal);
        if (my !== runId) return;
        state.dmarc.push(res);
        tick();
      }
    }));

    if (my !== runId) return;
    state.finished = true;
    finish();
    await rdapP;
    if (my === runId) { renderRdap(); renderMail(); prepareShare(); }
  }

  function setGo(busy) {
    const b = $("go");
    b.disabled = busy;
    b.textContent = t(busy ? "running" : state.finished ? "go_again" : "go");
  }

  /* ---------------- RDAP ---------------- */
  function loadRdap(name, my) {
    $("rdap").hidden = false;
    $("rdapState").textContent = t("rd_loading");
    $("rdapBody").textContent = "";
    return fetchRdap(name).then(r => {
      if (my !== runId) return;
      state.rdap = r;
      renderRdap();
    });
  }

  /* ---------------- rendering: the whole result ---------------- */
  function resetUI() {
    $("verdict").hidden = true;
    $("records").hidden = true;
    $("prop").hidden = true;
    $("mail").hidden = true;
    $("rdap").hidden = true;
    $("findings").textContent = "";
    $("links").hidden = true;
    $("links").textContent = "";
    $("shareBtn").hidden = true;
    $("reportBtn").hidden = true;
    $("recBody").textContent = "";
    $("recCount").textContent = "";
    $("propRows").textContent = "";
    $("propTabs").textContent = "";
    $("mailBody").textContent = "";
    $("rdapBody").textContent = "";
    $("rdapState").textContent = "";
    $("vDot").className = "dot";
    $("vTitle").textContent = " ";
    $("vSub").textContent = " ";
    $("kAgree").textContent = $("kRecords").textContent = $("kResolvers").textContent = "—";
    $("kAgreeWho").textContent = $("kRecordsWho").textContent = $("kResolversWho").textContent = "";
    all(".shared-bar").forEach(n => n.parentNode.removeChild(n));
  }

  function finish() {
    state.merged = mergeAll(state.results);
    state.records = mergeRecords(state.results);
    renderTabs();
    renderProp();
    renderRecords();
    renderVerdict();
    renderMail();
    renderLinks();
    $("shareBtn").hidden = false;
    $("reportBtn").hidden = false;
    setGo(false);
    setProgress(1, 1);
    prepareShare();
  }

  /* ---------------- propagation ---------------- */
  function renderPropSkeleton() {
    const tabs = $("propTabs");
    tabs.textContent = "";
    state.types.forEach(type => {
      const b = el("button", "tab");
      b.type = "button"; b.setAttribute("role", "tab"); b.dataset.type = type;
      b.setAttribute("aria-selected", String(type === state.tab));
      b.appendChild(document.createTextNode(type));
      b.appendChild(el("span", "tab-n", ""));
      b.onclick = () => { state.tab = type; renderTabs(); renderProp(); };
      tabs.appendChild(b);
    });
    const rows = $("propRows");
    rows.textContent = "";
    RESOLVERS.forEach(r => {
      const row = el("div", "pr");
      row.dataset.id = r.id;
      const name = el("div", "pr-name", r.name);
      row.appendChild(name);
      row.appendChild(el("div", "pr-state", "…"));
      row.appendChild(el("div", "pr-val"));
      rows.appendChild(row);
    });
    $("propSum").textContent = "";
  }

  function renderTabs() {
    all("#propTabs .tab").forEach(b => {
      b.setAttribute("aria-selected", String(b.dataset.type === state.tab));
      const mt = state.merged ? state.merged[b.dataset.type] : null;
      const n = b.querySelector(".tab-n");
      if (n) n.textContent = mt && mt.ok.length ? " " + mt.distinct : "";
    });
  }

  const valueText = res => {
    if (res.rcode === 3) return t("e_nx");
    if (!res.records.length) return t("e_empty");
    return res.records.map(rec => rec.type === "CNAME" ? "CNAME → " + rec.data : rec.data).join(" · ");
  };
  const errText = res => res.error === "http" ? t("e_http", { s: res.statusCode })
    : res.error === "rcode" ? t("e_rcode", { s: res.rcodeName })
    : t("e_" + res.error);

  function renderProp() {
    const results = state.results[state.tab] || [];
    const byId = {};
    results.forEach(r => { byId[r.id] = r; });
    const mt = state.merged ? state.merged[state.tab] : mergeType(results);
    RESOLVERS.forEach(r => {
      const row = document.querySelector('#propRows .pr[data-id="' + r.id + '"]');
      if (!row) return;
      const res = byId[r.id];
      const st = row.children[1], val = row.children[2];
      if (!res) { st.className = "pr-state"; st.textContent = "…"; val.className = "pr-val muted"; val.textContent = ""; return; }
      if (res.status !== OK) {
        st.className = "pr-state err"; st.textContent = errText(res);
        val.className = "pr-val muted"; val.textContent = "";
        return;
      }
      const agree = !!mt.majority && answerKey(res.records) === mt.majority.key;
      st.className = "pr-state " + (agree ? "ok" : "diff"); st.textContent = t(agree ? "agree" : "differs");
      val.className = "pr-val" + (res.records.length || res.rcode === 3 ? "" : " muted");
      val.textContent = valueText(res);
    });
    const sum = $("propSum");
    if (!mt.ok.length && results.length >= RESOLVERS.length) sum.textContent = t("prop_none");
    else if (!mt.ok.length) sum.textContent = (results.length) + " / " + RESOLVERS.length;
    else if (mt.ok.length === 1) sum.textContent = t("v_one");
    else if (mt.consistency != null) sum.textContent = t("prop_summary", { a: mt.majority.resolvers.length, b: mt.ok.length });
    else sum.textContent = (results.length) + " / " + RESOLVERS.length;
  }

  /* ---------------- verdict ---------------- */
  // The type the conclusion and the card are about: the first one that has records, else the first that answered.
  function heroType() {
    const first = primaryType(state.merged || {});
    const m = first && state.merged ? state.merged[first] : null;
    if (m && m.majority && m.majority.records.length) return first;
    return state.records.length ? state.records[0].type : first;
  }

  function renderVerdict() {
    const total = RESOLVERS.length;
    const answered = {};
    Object.keys(state.results).forEach(type => state.results[type].forEach(r => { if (r.status === OK) answered[r.id] = 1; }));
    const okCount = Object.keys(answered).length;
    $("kResolvers").textContent = String(okCount);
    $("kResolversWho").textContent = "/ " + total;
    $("kRecords").textContent = String(state.records.length);
    $("kRecordsWho").textContent = state.types.join(" ");

    const primary = heroType();
    const m = primary ? state.merged[primary] : null;
    // Green only when most of the 12 answered: a handful of answers is not a healthy picture of propagation.
    const covered = !!m && m.ok.length * 2 >= total;
    let title = "", dot = "warn";
    if (!m || !m.ok.length) { title = t("v_allfail"); dot = "bad"; }
    else if (m.nx && m.nx === m.ok.length) { title = t("v_nx", { domain: state.domain }); dot = "warn"; }
    else if (!state.records.length) { title = t("v_empty", { type: primary }); dot = "warn"; }
    else if (!covered && m.consistency === 1) { title = t("v_few_all", { a: m.ok.length, b: total }); dot = ""; }
    else if (!covered) { title = t("v_few_most", { a: m.majority.resolvers.length, b: m.ok.length, c: total }); dot = ""; }
    else if (m.consistency === 1) { title = t("v_all", { n: m.ok.length }); dot = "ok"; }
    else if (m.consistency != null) { title = t("v_most", { a: m.majority.resolvers.length, b: m.ok.length }); dot = "warn"; }
    else { title = t("v_one"); dot = ""; }
    $("vTitle").textContent = title;
    $("vDot").className = "dot " + dot;
    $("kAgree").textContent = m && m.consistency != null ? pct(m.consistency) : "—";
    $("kAgreeWho").textContent = m && m.majority && m.ok.length >= 2 ? m.majority.resolvers.length + " / " + m.ok.length : "";
    $("vSub").textContent = m ? t("v_sub", { ok: m.ok.length, tot: total, fail: m.errors.length }) : t("v_allfail");

    // Findings, worst first, at most four.
    const F = [];
    const add = (level, text) => F.push({ level, text });
    const spf = spfInfo(), dmarc = dmarcInfo(), ns = nsInfo();
    if (m) {
      if (m.stale.length) add("warn", t("fd_stale", { n: m.stale.length, b: m.ok.length, names: m.stale.slice(0, 3).map(r => resName(r.id)).join(", ") }));
      if (m.errors.filter(r => r.error !== "skipped").length) add("warn", t("fd_fail", { n: m.errors.filter(r => r.error !== "skipped").length, b: total }));
    }
    if (spf && spf.checked) {
      if (spf.count === 0) add("warn", t("fd_spf_none"));
      else if (spf.issues.indexOf("plusAll") >= 0) add("bad", t("fd_spf_plus"));
      else if (spf.issues.indexOf("multiple") >= 0) add("warn", t("fd_spf_multi", { n: spf.count }));
      else if (spf.issues.indexOf("noAll") >= 0) add("warn", t("fd_spf_noall"));
      else if (spf.issues.indexOf("tooManyLookups") >= 0) add("warn", t("fd_spf_lookups", { n: spf.lookups }));
    }
    if (dmarc && dmarc.checked) {
      if (dmarc.count === 0) add("warn", t("fd_dmarc_none"));
      else if (dmarc.p === "none") add("warn", t("fd_dmarc_pnone"));
      else if (dmarc.issues.indexOf("noRua") >= 0) add("warn", t("fd_dmarc_norua"));
    }
    if (ns && ns.onlyRegistrar.length) add("warn", t("fd_ns", { names: ns.onlyRegistrar.slice(0, 3).join(", ") }));
    if (ns && ns.onlyResolver.length) add("warn", t("fd_ns_extra", { names: ns.onlyResolver.slice(0, 3).join(", ") }));
    if (!F.length && spf && spf.checked) add("ok", t("fd_ok"));
    F.sort((a, b) => (a.level === "bad" ? 0 : 1) - (b.level === "bad" ? 0 : 1));
    state.findings = F.slice(0, 4);
    const ul = $("findings");
    ul.textContent = "";
    state.findings.forEach(x => { const li = el("li", x.level, x.text); ul.appendChild(li); });
    $("verdict").hidden = false;
  }

  /* ---------------- records ---------------- */
  const PRIVATE4 = /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  const isPublic = ip => ip.indexOf(":") >= 0 ? !/^(::1?$|fe80:|fc|fd)/i.test(ip) : !PRIVATE4.test(ip);

  function renderRecords() {
    const tb = $("recBody");
    tb.textContent = "";
    state.records.forEach(row => {
      const tr = el("tr");
      tr.appendChild(el("td", "t", row.type));
      const v = el("td", "v");
      if ((row.type === "A" || row.type === "AAAA") && isPublic(row.data) && asnHref(row.data)) {
        const a = el("a", "", row.data);
        a.href = asnHref(row.data); a.target = "_blank"; a.rel = "noopener"; a.title = t("lk_asn");
        v.appendChild(a);
      } else v.textContent = row.data;
      const ttl = ttlText(row.ttlMin, row.ttlMax);
      const from = t("rec_n", { n: row.count, b: RESOLVERS.length });
      // On a phone the last two columns fold under the value instead of scrolling out of sight.
      v.appendChild(el("span", "v-meta", ttl + " · " + from));
      tr.appendChild(v);
      tr.appendChild(el("td", "n", ttl));
      const f = el("td", "f", from);
      f.title = row.resolvers.map(resName).join(", ");
      tr.appendChild(f);
      tb.appendChild(tr);
    });
    $("recCount").textContent = String(state.records.length);
    $("records").hidden = false;
  }

  /* ---------------- mail ---------------- */
  function majorityRecords(type) {
    const m = state.merged && state.merged[type];
    return m && m.majority ? m.majority.records : [];
  }
  function spfInfo() {
    if (state.types.indexOf("TXT") < 0) return { checked: false };
    const txts = majorityRecords("TXT").filter(r => r.type === "TXT");
    const c = spfCheck(txts);
    c.checked = true;
    return c;
  }
  function dmarcInfo() {
    if (state.types.indexOf("TXT") < 0) return { checked: false };
    const ok = state.dmarc.filter(r => r.status === OK);
    if (!ok.length) return { checked: true, failed: true, count: 0, issues: [], p: null, rua: [] };
    const mt = mergeType(state.dmarc);
    const records = mt.majority ? mt.majority.records.filter(r => r.type === "TXT") : [];
    const c = dmarcCheck(records);
    c.checked = true;
    return c;
  }
  function nsInfo() {
    const rows = majorityRecords("NS").map(r => r.data);
    const reg = state.rdap && state.rdap.data ? state.rdap.data.nameservers : null;
    if (!rows.length || !reg) return null;
    const c = compareNs(reg, rows);
    c.registrar = reg; c.resolvers = rows;
    return c;
  }

  function block(parent, title, status, cls) {
    const b = el("div", "blk");
    const h = el("div", "blk-h");
    h.appendChild(el("h4", "", title));
    if (status) h.appendChild(el("span", "st " + (cls || ""), status));
    b.appendChild(h);
    parent.appendChild(b);
    return b;
  }
  function line(b, text, cls) { b.appendChild(el("p", cls || "", text)); return b; }
  function pills(b, list, cls) {
    const p = el("div", "pills");
    list.forEach(x => p.appendChild(el("span", "pill " + (cls || ""), x)));
    b.appendChild(p);
  }

  function renderMail() {
    const body = $("mailBody");
    body.textContent = "";
    const hasMx = state.types.indexOf("MX") >= 0, hasTxt = state.types.indexOf("TXT") >= 0, hasNs = state.types.indexOf("NS") >= 0;
    if (!hasMx && !hasTxt && !hasNs) {
      block(body, t("h_mail"), null).appendChild(el("p", "m", t("mail_unchecked")));
      $("mail").hidden = false;
      return;
    }

    // MX
    if (!hasMx) line(block(body, t("mx_h"), null), t("mail_unchecked"), "m");
    else {
      const mx = majorityRecords("MX");
      // RFC 7505 null MX: one record, "0 .", meaning the domain takes no mail at all
      const nullMx = mx.length === 1 && /^0\s+\.?$/.test(mx[0].data.trim());
      if (!mx.length || nullMx) {
        const b = block(body, t("mx_h"), null, "warn");
        line(b, t(nullMx ? "mx_null" : "mx_none"), "m");
        if (nullMx) pills(b, mx.map(r => r.data));
      } else {
        const b = block(body, t("mx_h"), String(mx.length));
        pills(b, mx.map(r => r.data));
      }
    }

    // SPF
    const spf = spfInfo();
    if (!spf.checked) line(block(body, t("spf_h"), null), t("mail_unchecked"), "m");
    else if (spf.count === 0) line(block(body, t("spf_h"), t("spf_none")), t("spf_none"), "m");
    else {
      const st = spf.qualifier === "pass" ? { k: "spf_pass", c: "bad" } : spf.qualifier === "fail" ? { k: "spf_fail", c: "ok" }
        : spf.qualifier === "softfail" ? { k: "spf_softfail", c: "warn" } : spf.qualifier === "neutral" ? { k: "spf_neutral", c: "warn" } : { k: "spf_noall", c: "warn" };
      const b = block(body, t("spf_h"), t(st.k), st.c);
      line(b, spf.record, "val");
      line(b, t("spf_lookups", { n: spf.lookups }), "m");
      if (spf.count > 1) line(b, t("spf_records", { n: spf.count }), "m");
      line(b, t(spf.issues.length ? "spf_bad" : "spf_ok"), "m");
    }

    // DMARC
    const dm = dmarcInfo();
    if (!dm.checked) line(block(body, t("dmarc_h"), null), t("mail_unchecked"), "m");
    else if (dm.failed) line(block(body, t("dmarc_h"), t("dmarc_fail")), t("dmarc_fail"), "m");
    else if (dm.count === 0) line(block(body, t("dmarc_h"), t("dmarc_none")), t("dmarc_none"), "m");
    else {
      const st = dm.p === "reject" ? { k: "dmarc_p_reject", c: "ok" } : dm.p === "quarantine" ? { k: "dmarc_p_quarantine", c: "ok" } : { k: "dmarc_p_none", c: "warn" };
      const b = block(body, t("dmarc_h"), t(st.k), st.c);
      line(b, t("dmarc_p", { p: dm.p || "—" }), "m");
      if (dm.rua.length) line(b, t("dmarc_rua", { n: dm.rua.length }) + " · " + dm.rua.slice(0, 3).join(", "), "m");
      else line(b, t("dmarc_norua"), "m");
    }

    // Name servers
    if (!hasNs) line(block(body, t("ns_h"), null), t("mail_unchecked"), "m");
    else {
      const ns = nsInfo();
      const diffNs = ns && (ns.onlyRegistrar.length || ns.onlyResolver.length);
      const b = block(body, t("ns_h"), ns ? (diffNs ? t("differs") : t("ns_same")) : null, diffNs ? "warn" : ns ? "ok" : "");
      if (!ns) line(b, t("ns_unknown"), "m");
      else {
        b.appendChild(el("p", "m", t("ns_reg")));
        pills(b, ns.registrar);
        b.appendChild(el("p", "m", t("ns_res")));
        pills(b, ns.resolvers);
        const diff = ns.onlyRegistrar.concat(ns.onlyResolver);
        if (diff.length) line(b, t("ns_diff", { names: diff.slice(0, 4).join(", ") }), "m");
      }
    }
    $("mail").hidden = false;
  }

  /* ---------------- registration ---------------- */
  function renderRdap() {
    const body = $("rdapBody"), st = $("rdapState");
    body.textContent = "";
    st.textContent = "";
    if (!state.rdap) return;
    $("rdap").hidden = false;
    if (state.rdap.error) { st.textContent = t("rd_fail"); line(body, t("rd_fail"), "m"); return; }
    if (state.rdap.notFound) { st.textContent = t("rd_none"); line(body, t("rd_none"), "m"); return; }
    const d = state.rdap.data;
    const dl = el("dl", "rdap");
    const row = (k, v, node) => { dl.appendChild(el("dt", "", k)); const dd = el("dd"); if (node) dd.appendChild(node); else dd.textContent = v == null || v === "" ? "—" : String(v); dl.appendChild(dd); };
    row(t("rd_registrar"), d.registrar, d.registrarUrl ? (() => {
      const a = el("a", "ext", d.registrar);
      a.href = d.registrarUrl; a.target = "_blank"; a.rel = "noopener";
      const icon = el("span"); icon.innerHTML = EXT; a.appendChild(icon);
      return a;
    })() : null);
    row(t("rd_created"), fmtDate(d.created));
    row(t("rd_expires"), fmtDate(d.expires));
    if (d.updated) row(t("rd_updated"), fmtDate(d.updated));
    if (d.status.length) {
      const wrap = el("div", "pills");
      d.status.slice(0, 6).forEach(s => wrap.appendChild(el("span", "pill", s)));
      row(t("rd_status"), null, wrap);
    }
    if (d.nameservers.length) {
      const wrap = el("div", "pills");
      d.nameservers.forEach(s => wrap.appendChild(el("span", "pill", s)));
      row(t("rd_ns"), null, wrap);
    }
    body.appendChild(dl);
  }

  /* ---------------- links to other tools ---------------- */
  function renderLinks() {
    const box = $("links");
    box.textContent = "";
    const add = (id, key, href) => {
      const u = tool(id);
      if (!u) return;
      const a = el("a", "ext");
      a.href = href || u; a.target = "_blank"; a.rel = "noopener";
      a.appendChild(document.createTextNode(t(key)));
      const icon = el("span"); icon.innerHTML = EXT; a.appendChild(icon);
      box.appendChild(a);
    };
    add("dns", "lk_dns");
    add("ping", "lk_ping", tool("ping") + "?t=" + encodeURIComponent(state.domain));
    box.hidden = !box.children.length;
  }

  /* ---------------- sharing ---------------- */
  const errCode = e => (CODES[e] != null ? CODES[e] : 7);
  function snapshotOf() {
    const rows = [];
    state.types.forEach(type => (state.results[type] || []).forEach(r => {
      rows.push([r.id, type, r.status === OK ? (r.rcode === 3 ? 3 : 0) : errCode(r.error),
        r.records.map(rec => [rec.type, rec.ttl, rec.data])]);
    }));
    const dm = state.dmarc.map(r => [r.id, r.status === OK ? (r.rcode === 3 ? 3 : 0) : errCode(r.error),
      r.records.map(rec => [rec.type, rec.ttl, rec.data])]);
    const d = state.rdap && state.rdap.data ? {
      registrar: state.rdap.data.registrar, created: state.rdap.data.created, expires: state.rdap.data.expires,
      status: state.rdap.data.status, nameservers: state.rdap.data.nameservers,
    } : null;
    const xz = !state.rdap ? "fail" : state.rdap.data ? "ok" : state.rdap.notFound ? "none" : "fail";
    const primary = heroType();
    const m = primary && state.merged ? state.merged[primary] : null;
    const first = m && m.majority && m.majority.records.length ? m.majority.records[0] : null;
    return {
      v: 1, d: state.domain, t: state.types, at: state.startedAt, r: rows, m: dm, x: d, xz,
      s: { ty: primary || state.types[0] || "A", val: first ? first.data : "", ok: m ? m.ok.length : 0,
        tot: RESOLVERS.length, n: state.records.length },
    };
  }
  let sharePromise = null;
  function prepareShare() {
    if (!state.finished) return;
    sharePromise = encodeResult(snapshotOf()).then(code => { state.shareCode = code; return code; }).catch(() => "");
  }
  $("shareBtn").onclick = async () => {
    if (!state.shareCode) { prepareShare(); await sharePromise; }
    if (!state.shareCode) return;
    const mod = await import("/assets/share/share.js?v=9");
    mod.share({
      lang: LANG, name: t("app_name"), file: "dns-records", show: [], never: ["ip"],
      link: () => location.origin + (D.paths && D.paths[LANG] ? D.paths[LANG] : "/") + "r/" + state.shareCode,
      home: location.origin + (D.paths && D.paths[LANG] ? D.paths[LANG] : "/"),
      text: () => { const s = snapshotOf().s; return s.val ? t("share_title", { domain: state.domain, type: s.ty, value: s.val }) : t("share_title_none", { domain: state.domain, n: s.n }); },
      ts: state.startedAt, height: 760,
      draw: drawCard,
      foot: () => [t("card_foot")],
    }).open();
  };

  // The card: the domain, how much of it answered the same, and the four values a DNS answer is usually read for.
  // Values shrink before anything is dropped (docs/tool-contract.md, "Share card").
  function drawCard(x, kit) {
    const W = kit.W, P = kit.P, w = W - P * 2, F = kit.F, M = kit.M, v = kit.v;
    x.textBaseline = "alphabetic"; x.textAlign = "left";
    let z = 52;
    x.font = "700 " + z + "px " + F;
    while (z > 28 && x.measureText(state.domain).width > w) { z -= 2; x.font = "700 " + z + "px " + F; }
    let y = kit.top + 14;
    x.fillStyle = v("fg");
    const dl = kit.wrap(x, state.domain, w, 2);
    dl.forEach(l => { x.fillText(l, P, y); y += z + 8; });

    const primary = heroType();
    const m = primary && state.merged ? state.merged[primary] : null;
    y += 34;
    x.fillStyle = m && m.consistency != null && m.ok.length * 2 >= RESOLVERS.length ? v("ok") : v("muted");
    x.font = "700 64px " + M;
    const pctText = m && m.consistency != null ? pct(m.consistency) : "—";
    const pctW = x.measureText(pctText).width;
    x.fillText(pctText, P, y);
    x.fillStyle = v("muted"); x.font = "400 26px " + F;
    x.fillText(t("k_agree"), P + pctW + 20, y - 16);
    y += 40;
    const agree = m && m.consistency != null
      ? t("card_line", { a: m.majority.resolvers.length, b: m.ok.length, n: state.records.length })
      : t("card_line", { a: 0, b: RESOLVERS.length, n: state.records.length });
    x.fillStyle = v("muted"); x.font = "400 26px " + F;
    kit.wrap(x, agree, w, 1).forEach(l => { x.fillText(l, P, y); });

    // one value per type first (A, AAAA, CNAME, MX, NS…), then a second value of a type if there is room
    const order = ["A", "AAAA", "CNAME", "MX", "NS"];
    const rows = [];
    for (const ty of order) {
      const r = state.records.find(x => x.type === ty);
      if (r && rows.length < 4) rows.push(r);
    }
    state.records.forEach(r => { if (rows.length < 4 && rows.indexOf(r) < 0) rows.push(r); });
    let ry = kit.top + 232;
    rows.forEach(r => {
      x.fillStyle = v("muted"); x.font = "600 20px " + M;
      x.fillText(r.type, P, ry);
      x.fillStyle = v("fg");
      let size = 26;
      x.font = "500 " + size + "px " + M;
      while (size > 14 && x.measureText(r.data).width > w - 96) { size -= 1; x.font = "500 " + size + "px " + M; }
      const lines = kit.wrap(x, r.data, w - 96, 2);
      lines.forEach((l, i) => x.fillText(l, P + 84, ry + i * (size + 6)));
      ry += Math.max(58, lines.length * (size + 6) + 20);
    });
  }

  /* ---------------- shared result ---------------- */
  function showOldBrowser() {
    $("vDot").className = "dot warn";
    $("vTitle").textContent = t("v_old_browser");
    $("vSub").textContent = t("v_old_browser_sub");
    $("verdict").hidden = false;
  }

  // The shared banner (/assets/share/, the same one every tool uses): what this is, and the way to the visitor's own
  // lookup, which replaces it on this language's page.
  function sharedBanner(snap) {
    import("/assets/share/share.js?v=9").then(({ received }) => {
      received({
        lang: LANG, ts: snap.at, at: document.querySelector(".hero"),
        test: () => {
          try { history.replaceState(null, "", (D.paths && D.paths[LANG] ? D.paths[LANG] : "/") + location.search); } catch (e) {}
          lookup(state.domain, state.types);
        },
      });
    }, () => {});
  }

  function renderSnapshot(snap) {
    state = fresh();
    state.shared = true;
    state.domain = snap.d;
    state.types = snap.t.filter(x => ALL_TYPES.indexOf(x) >= 0);
    state.tab = state.types[0] || "A";
    state.startedAt = snap.at || Date.now();
    state.results = resultsFromSnapshot(snap);
    state.dmarc = snap.m && snap.m.length
      ? (resultsFromSnapshot({ r: snap.m.map(a => [a[0], "TXT", a[1], a[2] || []]) }).TXT || [])
      : [];
    state.rdap = snap.xz === "none" || (!snap.xz && !snap.x) ? { notFound: true }
      : snap.xz === "ok" || snap.x ? { data: { registrar: snap.x.registrar, created: snap.x.created, expires: snap.x.expires,
        updated: null, status: snap.x.status || [], nameservers: snap.x.nameservers || [], registrarUrl: null } }
      : { error: "snapshot" };
    $("domain").value = snap.d;
    $("err").hidden = true;
    resetUI();
    renderPropSkeleton();
    state.merged = mergeAll(state.results);
    state.records = mergeRecords(state.results);
    renderTabs(); renderProp(); renderRecords(); renderVerdict(); renderMail(); renderRdap(); renderLinks();
    sharedBanner(snap);
    $("shareBtn").hidden = false;
    $("reportBtn").hidden = false;
    $("go").textContent = t("go_again");
    setProgress(1, 1);
    state.finished = true;
    prepareShare();
  }

  /* ---------------- start ---------------- */
  const form = $("f");
  form.addEventListener("submit", e => {
    e.preventDefault();
    lookup($("domain").value, readTypes());
  });

  function boot() {
    const sp = sharePath(location.pathname);
    if (sp) {
      decodeResult(sp.code).then(snap => {
        if (snap) renderSnapshot(snap);
        else showOldBrowser();
      }).catch(() => showOldBrowser());
      return;
    }
    const q = new URLSearchParams(location.search).get("d");
    if (q) { $("domain").value = q; lookup(q, readTypes()); }
  }

  window.msReport = () => state.finished ? {
    summary: (primaryType(state.merged || {}) ? (document.getElementById("vTitle").textContent || "") : "") + " · " + state.domain,
    data: { domain: state.domain, types: state.types, records: state.records.slice(0, 40).map(r => [r.type, r.data, r.ttlMin, r.ttlMax, r.count]) },
    picks: (state.findings || []).slice(0, 8).map(f => f.text),
  } : null;

  boot();
})();
