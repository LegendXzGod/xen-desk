/* app.js - Xen Desk iPhone app, STEP 8, hosting plan B (read-only polling).
   Data: {R2 public base}/d/{DATA_PATH}/*.json written by the desk every 15 s (api.py).
   DATA_PATH and APP_TOKEN arrive once in the URL fragment (#d=...&t=..., any order),
   are kept in localStorage, and the fragment is stripped. They are never in this file.
   Every FOMO URL shown here comes from the JSON (built server-side by links.py). */
(function () {
  "use strict";
  const DEFAULT_BASE = "https://pub-c750b864e5cd4cb7b2300b1bbd124a2a.r2.dev"; // public, not secret
  const POLL_S = 15, STALE_S = 60;
  const LS = {d: "xd.d", t: "xd.t", seen: "xd.seen", range: "xd.range"};
  const AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  const NAMES = {scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk"};
  const COLORS = {scanner: "#64d2ff", auditor: "#ffffff", analyst: "#ffd60a", executor: "#00d35a", risk: "#ff6b9a"};
  const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

  // ---------------------------------------------------------------- fragment + base
  (function readFragment() {
    const h = location.hash.replace(/^#/, "");
    if (!h) return;
    const p = new URLSearchParams(h);
    if (p.get("d")) localStorage.setItem(LS.d, p.get("d"));
    if (p.get("t")) localStorage.setItem(LS.t, p.get("t"));
    history.replaceState(null, "", location.pathname + location.search);
  })();
  function base() {
    const dev = new URLSearchParams(location.search).get("devbase");   // dev-only, localhost only
    if (dev && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return dev.replace(/\/$/, "");
    return DEFAULT_BASE;
  }
  const dataPath = () => localStorage.getItem(LS.d);
  const url = name => `${base()}/d/${encodeURIComponent(dataPath())}/${name}`;

  // ---------------------------------------------------------------- formatting
  const fmtUsd = (n, d = 2) => n == null ? "–" : (n < 0 ? "-" : "") + "$" + Math.abs(n).toLocaleString("en-US", {minimumFractionDigits: d, maximumFractionDigits: d});
  const fmtShort = n => n == null ? "n/a" : n >= 1e6 ? "$" + (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? "$" + (n / 1e3).toFixed(1) + "K" : "$" + n.toFixed(0);
  function fmtPrice(p) {
    if (p == null) return "–";
    if (p >= 1) return "$" + p.toLocaleString("en-US", {maximumFractionDigits: 4});
    const s = p.toPrecision(4); return "$" + (s.includes("e") ? Number(s).toFixed(10).replace(/0+$/, "") : s);
  }
  const pct = (v, d = 2) => v == null ? "–" : (v >= 0 ? "+" : "") + v.toFixed(d) + "%";
  const hhmm = iso => iso ? new Date(iso).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", hour12: false}) : "–";
  function age(iso) {
    if (!iso) return "";
    const m = Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
    return m < 60 ? Math.floor(m) + "m old" : m < 1440 ? Math.floor(m / 60) + "h old" : Math.floor(m / 1440) + "d old";
  }
  const left = iso => { const s = Math.max(0, (Date.parse(iso) - Date.now()) / 1000); return Math.floor(s / 3600) + "h " + String(Math.floor(s % 3600 / 60)).padStart(2, "0") + "m"; };
  const short = m => m ? m.slice(0, 4) + "…" + m.slice(-4) : "";

  // ---------------------------------------------------------------- data + polling
  const S = {state: null, chart: null, activity: null, account: null, settings: null, decisions: {}, coins: {}, audits: {},
    olderPages: {}, ok: false, offline: false, lastGood: null, nextPoll: 0, loaded: false,
    tab: "home", screen: null, range: localStorage.getItem(LS.range) || "LIVE", search: false, q: ""};

  async function getJSON(name) {
    const r = await fetch(url(name), {cache: "no-store"});
    if (r.status === 404) return null;
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  async function poll() {
    S.nextPoll = Date.now() + POLL_S * 1000;
    if (!dataPath()) { S.loaded = true; render(); return; }
    try {
      const [st, ch, ac] = await Promise.all([getJSON("state.json"), getJSON("chart.json"), getJSON("activity.json")]);
      if (!st) throw new Error("no state");
      S.state = st; if (ch) S.chart = ch; if (ac) S.activity = ac;
      const need = [];
      if (!S.account || S.tab === "account" || S.tab === "home") need.push(getJSON("account.json").then(x => x && (S.account = x)));
      if (!S.settings || S.tab === "account") need.push(getJSON("settings.json").then(x => x && (S.settings = x)));
      if (S.tab === "agents" || !Object.keys(S.decisions).length)
        AGENTS.forEach(a => need.push(getJSON(`agents/${a}/decisions.json`).then(x => x && (S.decisions[a] = x))));
      if (S.screen && S.screen.type === "coin") need.push(getJSON(`coin/${S.screen.mint}.json`).then(x => S.coins[S.screen.mint] = x || {missing: true}));
      if (S.screen && S.screen.type === "audit") need.push(getJSON(`audit/${S.screen.mint}.json`).then(x => S.audits[S.screen.mint] = x || {missing: true}));
      await Promise.allSettled(need);
      S.lastGood = st.generated_at;
      S.offline = (Date.now() - Date.parse(st.generated_at)) / 1000 > STALE_S;   // desk stopped writing
    } catch (e) {
      S.offline = true;   // keep the last good numbers on screen
    }
    S.loaded = true;
    render();
  }

  // ---------------------------------------------------------------- odometer
  function setOdo(el, text) {
    if (el.dataset.text === text) return;
    const old = el.dataset.text; el.dataset.text = text;
    const sameShape = old && old.length === text.length && [...old].every((c, i) => /\d/.test(c) === /\d/.test(text[i]));
    if (!sameShape || reduced()) {
      el.innerHTML = [...text].map(c => /\d/.test(c)
        ? `<span class="d"><span class="strip" style="transform:translateY(-${+c * 1.05}em)">${[0,1,2,3,4,5,6,7,8,9].map(n => `<span>${n}</span>`).join("")}</span></span>`
        : `<span class="c">${esc(c)}</span>`).join("");
      return;
    }
    const strips = el.querySelectorAll(".strip"); const digits = [...text].filter(c => /\d/.test(c));
    const oldDigits = [...old].filter(c => /\d/.test(c));
    let k = 0;   // 30 ms stagger right to left, among the digits that changed
    for (let i = digits.length - 1; i >= 0; i--) {
      if (digits[i] !== oldDigits[i]) { strips[i].style.transitionDelay = (k++ * 30) + "ms"; }
      strips[i].style.transform = `translateY(-${+digits[i] * 1.05}em)`;
    }
    [...el.querySelectorAll(".c")].forEach((n, i) => { const cs = [...text].filter(c => !/\d/.test(c)); n.textContent = cs[i]; });
  }

  // ---------------------------------------------------------------- shell
  const ICON = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 004 0"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9h-5v-6h-6v6H4z"/></svg>',
    agents: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/></svg>',
    activity: '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-7 4 14 3-7h4"/></svg>',
    account: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  };
  const app = $("#app");
  function shell() {
    app.innerHTML = `<div id="top"></div><div id="err"></div><main id="view"></main>`;
    const tb = document.createElement("nav"); tb.className = "tabbar";
    tb.innerHTML = `<div class="in">${["home", "agents", "activity", "account"].map(t =>
      `<button data-tab="${t}" aria-label="${t}">${ICON[t]}<span>${t[0].toUpperCase() + t.slice(1)}</span></button>`).join("")}</div>`;
    document.body.appendChild(tb);
    tb.addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) go(b.dataset.tab); });
  }
  function go(tab, after) {
    S.tab = tab; S.screen = null; S.search = false; mounted = null; render(); window.scrollTo(0, 0);
    if (["agents", "account"].includes(tab)) poll();
    if (after) setTimeout(after, 50);
  }
  function open(type, mint, coinUrl) {
    S.screen = {type, mint, coinUrl}; mounted = null; render(); window.scrollTo(0, 0); poll();
  }

  // ---------------------------------------------------------------- error / states
  function errRow() {
    const el = $("#err");
    if (!dataPath()) {
      el.innerHTML = `<div class="errrow">No desk link on this device yet. Open your desk link from Telegram once (it ends with #d=…).</div>`;
      return;
    }
    if (S.offline) {
      const n = Math.max(0, Math.ceil((S.nextPoll - Date.now()) / 1000));
      el.innerHTML = `<div class="errrow">Desk offline · retrying in ${n}s · last update ${S.lastGood ? hhmm(S.lastGood) : "never"}</div>`;
    } else el.innerHTML = "";
  }
  const loading = () => !S.state && S.loaded === false;
  const hasData = () => !!S.state;

  // ---------------------------------------------------------------- render
  let mounted = null;
  function render() {
    document.querySelectorAll(".tabbar button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab));
    const key = S.screen ? S.screen.type + ":" + S.screen.mint : S.tab;
    if (mounted !== key) { mounted = key; const v = $("#view"); v.innerHTML = ""; delete v.dataset.m; $("#top").innerHTML = ""; }
    if (S.screen) (S.screen.type === "coin" ? renderCoin : renderAudit)(S.screen);
    else ({home: renderHome, agents: renderAgents, activity: renderActivity, account: renderAccount})[S.tab]();
    errRow();
  }

  function navHome() {
    const h = S.account ? (S.account.fomo_handle || "?")[0].toUpperCase() : "";
    const unread = (S.activity?.rows || []).filter(r => r.id > +(localStorage.getItem(LS.seen) || 0)).length;
    return `<div class="navbar">
      <button class="avatar" data-act="account" aria-label="Account"><span>${esc(h)}</span></button>
      <button class="brand" data-act="agents">Grok Bot<span class="chev">›</span></button>
      <button class="icon-btn" data-act="search" aria-label="Search">${ICON.search}</button>
      <button class="icon-btn" data-act="bell" aria-label="Notifications">${ICON.bell}${unread ? '<i class="dot"></i>' : ""}</button></div>`;
  }
  function backbar(title, right = "") {
    return `<div class="backbar"><button class="back" data-act="back">‹ Back</button><div class="title">${title}</div>${right}</div>`;
  }

  // ---------------------------------------------------------------- HOME
  function renderHome() {
    const v = $("#view");
    $("#top").innerHTML = navHome() + (S.search ? `<div class="search"><input id="q" placeholder="Name, symbol or mint" value="${esc(S.q)}" autocomplete="off"></div><div id="results"></div>` : "");
    if (S.search) { const q = $("#q"); q.oninput = () => { S.q = q.value; searchResults(); }; if (document.activeElement !== q) q.focus(); searchResults(); }
    if (!v.dataset.m) {
      v.dataset.m = 1;
      v.innerHTML = `<section class="hero"><div class="balrow"><div class="balance odo" id="bal"></div><span class="paper hidden" id="pb">PAPER</span></div>
        <div class="todayrow"><span id="today" class="sec"></span><span class="mult hidden" id="mult"></span></div></section>
        <div class="chartwrap"><canvas id="line"></canvas><div class="chart-empty hidden" id="cempty">Waiting for the first trade</div></div>
        <div class="ranges" id="ranges">${["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(r => `<button data-range="${r}">${r}</button>`).join("")}</div>
        <div class="sechead"><span>Agents · <span id="running" class="muted">5 running</span></span></div>
        <div class="carousel" id="cards">${AGENTS.map(a => `<div class="agent-card" id="card-${a}" data-card="${a}"></div>`).join("")}</div>
        <div class="sechead"><span>Activity</span><button class="link" data-act="activity">See all</button></div>
        <div id="last5"></div>`;
    }
    if (!hasData()) {   // loading or never loaded: blocks in the final layout
      const bal = $("#bal"); bal.innerHTML = `<div class="sk" style="width:240px;height:70px"></div>`; bal.dataset.text = "";
      $("#today").innerHTML = `<span class="sk" style="display:inline-block;width:120px;height:18px"></span>`;
      if (!dataPath() || S.loaded) { Charts.line($("#line"), [], null, []); $("#cempty").classList.remove("hidden"); }
      AGENTS.forEach(a => { $("#card-" + a).innerHTML = dataPath() && !S.loaded ? `<div class="sk" style="height:100%"></div>` : cardEmpty(a); });
      $("#last5").innerHTML = dataPath() && !S.loaded ? `<div class="sk" style="height:180px;margin:0 16px"></div>` : `<div class="empty-card">Nothing yet tonight</div>`;
      $("#running").textContent = dataPath() && !S.loaded ? "" : "0 running";
      ranges(); return;
    }
    const st = S.state;
    setOdo($("#bal"), st.balance == null ? "–" : fmtUsd(st.balance));
    $("#pb").classList.toggle("hidden", !st.paper);
    const t = $("#today"); t.textContent = st.today_pct == null ? "" : pct(st.today_pct) + " today"; t.className = st.today_pct < 0 ? "red" : "green";
    const m = $("#mult"); m.classList.toggle("hidden", st.multiplier == null); m.textContent = (st.multiplier ?? 0).toFixed(2) + "×";
    const ch = S.chart || {ranges: {}};
    const pts = ch.ranges[S.range] || [];
    Charts.line($("#line"), pts, ch.start_value, ch.marks || []);
    $("#cempty").classList.toggle("hidden", !!(ch.marks && ch.marks.length));
    ranges();
    const run = AGENTS.filter(a => st.agents[a].status === "running").length;
    $("#running").textContent = run + " running";
    AGENTS.forEach(a => card(a, st.agents[a]));
    const rows = (S.activity?.rows || []).slice(0, 5);
    $("#last5").innerHTML = rows.length ? `<div class="list">${rows.map(actRow).join("")}</div>` : `<div class="empty-card">Nothing yet tonight</div>`;
  }
  function ranges() { document.querySelectorAll("#ranges button").forEach(b => b.classList.toggle("on", b.dataset.range === S.range)); }

  function cardHead(a, extra = "") {
    const st = S.state?.agents?.[a]; const run = st && st.status === "running";
    return `<div class="ac-head"><span class="sdot" style="background:${run ? COLORS[a] : "rgba(235,235,245,0.3)"}"></span><span class="nm" style="color:${COLORS[a]}">${NAMES[a]}</span>${extra}</div>`;
  }
  function cardEmpty(a) {
    const msg = {scanner: "Listening for graduations", auditor: "No coin taken apart yet", analyst: "Scoring", executor: "No trades yet", risk: "Nothing to guard"}[a];
    return cardHead(a) + `<div class="ac-big">${a === "scanner" ? "0 pools" : a === "auditor" ? "0 taken apart" : a === "executor" ? "0 trades" : a === "analyst" ? "Scoring" : "Guarding"}</div><div class="ac-body"><div class="empty-line">${msg}</div></div>`;
  }
  const execAnim = {};
  function card(a, d) {
    const el = $("#card-" + a);
    if (a === "scanner") {
      el.innerHTML = cardHead(a) + `<div class="ac-big">${d.pools} pools</div><div class="ac-sub">${d.waiting} waiting</div><div class="ac-body feed">${
        d.feed.length ? d.feed.map(f => f.verdict === "kill"
          ? `<div class="row kill"><span class="l">${esc(f.name)} · liq ${fmtShort(f.liquidityUsd)}</span><span class="r">${esc(f.reason)}</span></div>`
          : `<div class="row pass"><span class="l">${esc(f.name)} · liq ${fmtShort(f.liquidityUsd)}</span><span class="r">→ auditor</span></div>`).join("")
          : `<div class="empty-line">Listening for graduations</div>`}</div>`;
    } else if (a === "auditor") {
      const L = d.last; const lay = n => L ? L.layers.find(x => x.n === n) : null;
      el.innerHTML = cardHead(a) + `<div class="ac-big">${d.taken_apart} taken apart</div><div class="ac-sub">${d.rejected} rejected</div>
        <div class="ac-body">${L ? `<div class="sec" style="font-size:14px;margin-bottom:8px">${esc(L.name)}</div><div class="strips">${[1,2,3,4,5,6,7,8].map(n => {
          const x = lay(n); const c = !x ? (L.running ? "run" : "") : x.pass === true ? "ok" : x.pass === false ? "bad" : "";
          return `<div class="strip-l ${c}">${n}</div>`; }).join("")}</div>
          <div style="margin-top:10px;font-size:15px" class="${L.running ? "cyan" : L.result && L.result.startsWith("8/8") ? "green" : "red"}">${L.running ? "taking apart..." : esc(L.result || "")}</div>`
          : `<div class="empty-line">No coin taken apart yet</div>`}</div>`;
      el.onclick = () => L && open("audit", L.mint, L.coin_url);
    } else if (a === "analyst") {
      if (!el.querySelector("canvas")) el.innerHTML = cardHead(a) + `<div class="ac-big">Scoring</div><div class="ac-sub" id="an-sub"></div><div class="ac-body ringwrap"><canvas id="ring"></canvas></div>`;
      const L = d.last;
      $("#an-sub").textContent = L ? `${L.name} · ${L.passed ? "passed" : (L.reason || "rejected")}` : `${d.scored} scored`;
      Charts.ring($("#ring"), L ? L.score : null, d.ring_green_from);
    } else if (a === "executor") {
      const L = d.last; const key = L ? L.mint + L.status : "";
      if (!el.querySelector(".bar")) el.innerHTML = cardHead(a) + `<div class="ac-big" id="ex-n"></div><div class="ac-sub" id="ex-s"></div><div class="ac-body"><div id="ex-l" style="font-size:15px"></div><div class="bar"><i id="ex-b"></i></div></div>`;
      $("#ex-n").textContent = `${d.trades} trades`;
      $("#ex-s").textContent = L && L.size_usd != null ? `${fmtUsd(L.size_usd)} · ${(+d.stack_pct).toString()}% of stack` : `${d.stack_pct}% of stack`;
      const lab = $("#ex-l"), bar = $("#ex-b");
      if (!L) { lab.textContent = "No trades yet"; lab.className = "sec"; bar.style.width = "0"; }
      else if (L.status === "bought") {
        if (execAnim.key && execAnim.key !== key && L.mode === "PAPER" && !reduced()) {   // new fill: bar runs 1.2 s
          const t0 = performance.now(); lab.className = "";
          (function f(t) { const p = Math.min(1, (t - t0) / 1200); bar.style.width = (p * 100) + "%"; lab.textContent = `Executing... ${Math.round(p * 100)}%`;
            if (p < 1) requestAnimationFrame(f); else { lab.textContent = "✓ Filled"; lab.className = "green"; } })(t0);
        } else { bar.style.width = "100%"; lab.textContent = "✓ Filled"; lab.className = "green"; }
      } else if (L.status === "sent") { bar.style.width = "50%"; lab.textContent = "Executing... waiting for your tap"; lab.className = ""; }
      else { bar.style.width = "0"; lab.textContent = L.status; lab.className = "sec"; }
      execAnim.key = key;
    } else if (a === "risk") {
      el.innerHTML = cardHead(a) + `<div class="ac-big">${d.guarding ? "Guarding" : "Guarding"}</div><div class="ac-sub">${d.guarding ? d.guarding + " open" : "Nothing open"}${d.last_exit ? " · last: " + esc(d.last_exit) : ""}</div>
        <div class="ac-body"><div class="pills"><span class="pill red">${esc(d.pills.stop)}</span><span class="pill green">${esc(d.pills.trail)}</span></div></div>`;
    }
  }

  function actRow(r) {
    const color = {bought: "var(--blue)", sold: "var(--green)", stopped: "var(--red)", rejected: "var(--ter)"}[r.kind];
    const glyph = {bought: "↗", sold: "$", stopped: "↓", rejected: "×"}[r.kind];
    const vcls = r.kind === "sold" ? (String(r.value).startsWith("-") ? "red" : "green") : r.kind === "stopped" ? "red" : r.kind === "rejected" ? "sec" : "";
    return `<button class="row-a" data-row="${r.tap}" data-mint="${esc(r.mint || "")}" data-url="${esc(r.coin_url || "")}">
      <span class="ic" style="background:${color}22;color:${color}">${glyph}</span>
      <span class="tx"><div class="t1">${esc(r.title)}</div><div class="t2">${esc(r.subtitle)}</div></span>
      <span class="rv ${vcls}">${esc(r.value)}</span></button>`;
  }

  function knownCoins() {
    const m = new Map();
    const add = (mint, name, u) => { if (mint && !m.has(mint)) m.set(mint, {mint, name: name || short(mint), url: u}); };
    (S.activity?.rows || []).forEach(r => add(r.mint, r.title.replace(/^(Bought|Sold|Stopped|Rejected) /, ""), r.coin_url));
    AGENTS.forEach(a => (S.decisions[a]?.decisions || []).forEach(d => add(d.mint, d.name, d.coin_url)));
    (S.state?.agents?.scanner?.feed || []).forEach(f => add(f.mint, f.name, f.coin_url));
    return [...m.values()];
  }
  function searchResults() {
    const q = S.q.trim().toLowerCase(); const el = $("#results"); if (!el) return;
    if (!q) { el.innerHTML = ""; return; }
    const hits = knownCoins().filter(c => c.name.toLowerCase().includes(q) || c.mint.toLowerCase().startsWith(q));
    el.innerHTML = hits.length ? `<div class="list" style="margin-bottom:10px">${hits.slice(0, 8).map(c =>
      `<button class="row-a" data-row="coin" data-mint="${esc(c.mint)}" data-url="${esc(c.url || "")}"><span class="tx"><div class="t1">${esc(c.name)}</div><div class="t2">${esc(short(c.mint))}</div></span><span class="rv sec">›</span></button>`).join("")}</div>`
      : `<div class="empty-card" style="margin-bottom:10px">Not on the desk tonight</div>`;
  }

  // ---------------------------------------------------------------- AGENTS TAB
  function renderAgents() {
    $("#top").innerHTML = `<div class="navbar"><div class="brand" style="padding-left:10px;font-size:22px;font-weight:700">Agents</div></div>`;
    const v = $("#view");
    if (!hasData() && dataPath() && !S.loaded) { v.innerHTML = AGENTS.map(() => `<div class="agent-full sk" style="height:180px"></div>`).join(""); return; }
    const openPos = S.state?.agents?.risk?.guarding || 0;
    v.innerHTML = `<div class="pt"></div>` + AGENTS.map(a => {
      const d = S.decisions[a]; const st = S.state?.agents?.[a];
      const running = st ? st.status === "running" : false;
      const locked = a === "risk" && openPos > 0;
      const decs = d?.decisions || [];
      return `<section class="agent-full" id="ag-${a}">
        <div class="af-head"><span class="sdot" style="background:${running ? "var(--green)" : st && st.status === "paused" ? "var(--orange)" : "var(--ter)"}"></span>
          <span class="nm" style="color:${COLORS[a]}">${NAMES[a]}</span>
          <span class="swtap" aria-label="pause or resume"><span class="switch ${running ? "on" : ""} disabled"></span></span></div>
        <div class="af-meta">${st ? st.status : "down"} · ${d ? d.today : 0} today${locked ? " · locked while a position is open" : ""} · pause/resume in Telegram</div>
        <div class="dec">${decs.length ? decs.map(x => `<div class="r"><span class="sec">${hhmm(x.ts)}</span>
            <a href="${esc(x.coin_url)}" target="_blank" rel="noopener"><span>${esc(x.name)}</span>${x.reason ? `<span class="rs">${esc(x.reason)}</span>` : ""}</a>
            <span class="v-${["pass", "kill", "red", "reject", "stop"].includes(x.verdict) ? x.verdict : "other"}">${esc(x.verdict)}</span></div>`).join("")
          : `<div class="empty-line" style="padding:10px 0">${a === "scanner" ? "Listening for graduations" : a === "auditor" ? "No coin taken apart yet" : "Nothing yet tonight"}</div>`}</div>
        <div class="af-foot"><button data-settings="${a}">Settings ›</button></div></section>`;
    }).join("");
  }

  // ---------------------------------------------------------------- ACTIVITY
  function renderActivity() {
    $("#top").innerHTML = `<div class="navbar"><div class="brand" style="padding-left:10px;font-size:22px;font-weight:700">Activity</div></div>`;
    localStorage.setItem(LS.seen, String(Math.max(0, ...(S.activity?.rows || []).map(r => r.id))));
    const v = $("#view");
    if (!hasData() && dataPath() && !S.loaded) { v.innerHTML = `<div class="pt"></div><div class="sk" style="height:360px;margin:0 16px"></div>`; return; }
    const rows = [...(S.activity?.rows || [])];
    const seen = new Set(rows.map(r => r.id));
    Object.keys(S.olderPages).sort((a, b) => b - a).forEach(k => S.olderPages[k].rows.forEach(r => { if (!seen.has(r.id)) { seen.add(r.id); rows.push(r); } }));
    const pages = S.activity?.pages || 0;
    const nextK = Math.min(pages - 1, ...Object.keys(S.olderPages).map(Number)) - 1;
    const loadedTo = Object.keys(S.olderPages).length ? Math.min(...Object.keys(S.olderPages).map(Number)) : pages;
    v.innerHTML = `<div class="pt"></div>` + (rows.length ? `<div class="list">${rows.map(actRow).join("")}</div>
      ${loadedTo > 0 && pages > 1 ? `<button class="more" data-more="${loadedTo - 1}">Load more</button>` : ""}` : `<div class="empty-card">Nothing yet tonight</div>`);
  }

  // ---------------------------------------------------------------- AUDITOR SCREEN
  const beam = {};   // mint -> layers revealed so far
  function renderAudit(sc) {
    const A = S.audits[sc.mint];
    $("#top").innerHTML = backbar(esc(A && A.name || "Auditor"));
    const v = $("#view");
    if (!A) { v.innerHTML = `<div class="discs sk" style="width:220px"></div><div class="sk" style="height:360px;margin:12px 16px"></div>`; return; }
    if (A.missing || A.status === "none") {
      v.innerHTML = `<div class="empty-card" style="margin-top:16px">No coin taken apart yet</div>${sc.coinUrl ? `<a class="bigbtn" href="${esc(sc.coinUrl)}" target="_blank" rel="noopener">Open on FOMO</a>` : ""}`; return;
    }
    if (!v.dataset.m) {
      v.dataset.m = 1;
      v.innerHTML = `<div class="discs" id="discs">${[1,2,3,4,5,6,7,8].map(n => `<div class="disc" id="disc-${n}" style="top:${(n - 1) * 34}px">${n}</div>`).join("")}<div class="beamline" id="beam"></div></div>
        <div class="verdict"><div class="h" id="vh"></div><div class="s" id="vs"></div></div>
        <div class="vrows" id="vrows"></div>
        <div class="setrow"><span>Take apart before buying</span><span class="swtap"><span class="switch disabled" id="aud-en"></span></span></div>
        <div class="note">Read-only here. Change it in Telegram: set auditor.enabled to false (asks twice).</div>
        <a class="bigbtn" id="fomo" target="_blank" rel="noopener">Open on FOMO</a>`;
    }
    $("#aud-en").classList.toggle("on", !!A.auditor_enabled);
    $("#fomo").href = A.coin_url;
    const L = A.layers;
    $("#vrows").innerHTML = [1,2,3,4,5,6,7,8].map(n => { const x = L.find(l => l.n === n) || {name: "", value: "", pass: null};
      return `<div class="vrow"><span class="n">${n}</span><span class="k">${esc(x.name)}</span><span class="v ${x.pass === true ? "ok" : x.pass === false ? "bad" : ""}" id="vv-${n}">${(beam[sc.mint] || 0) >= n || reduced() ? esc(x.value) : ""}</span></div>`; }).join("");
    runBeam(sc.mint, A);
  }
  let beamTimer = null;
  function runBeam(mint, A) {
    const L = A.layers, ready = n => { const x = L.find(l => l.n === n); return x && (x.pass !== null || A.status !== "running"); };
    const show = n => { const x = L.find(l => l.n === n); const d = $("#disc-" + n); if (!d) return;
      d.classList.remove("beam"); d.classList.toggle("ok", x && x.pass === true); d.classList.toggle("bad", x && x.pass === false);
      const vv = $("#vv-" + n); if (vv && x) vv.textContent = x.value; };
    const verdict = () => {
      if (A.status === "running") { $("#vh").textContent = "taking apart..."; $("#vs").textContent = ""; return; }
      $("#vh").textContent = A.headline || ""; $("#vh").className = "h " + (A.status === "rejected" ? "red" : "green");
      $("#vs").textContent = A.subline || "";
    };
    let done = beam[mint] || 0;
    for (let n = 1; n <= done; n++) show(n);
    if (reduced()) { for (let n = 1; n <= 8; n++) if (ready(n)) { show(n); done = n; } beam[mint] = done; $("#beam").style.opacity = 0; verdict(); return; }
    clearTimeout(beamTimer);
    const bl = $("#beam");
    const step = () => {
      const n = done + 1;
      if (n > 8) { bl.style.opacity = 0; verdict(); return; }
      bl.style.opacity = 1; bl.style.top = ((n - 1) * 34 + 23) + "px";
      const d = $("#disc-" + n); if (d) d.classList.add("beam");
      if (!ready(n)) { verdict(); return; }               // the beam waits on this layer for the server
      beamTimer = setTimeout(() => { show(n); done = n; beam[mint] = n;
        beamTimer = setTimeout(step, 150); }, 350);       // 350 ms per layer, then 150 ms to green or red
    };
    step();
  }

  // ---------------------------------------------------------------- COIN SCREEN
  function renderCoin(sc) {
    const c = S.coins[sc.mint];
    const paper = S.state ? S.state.paper : false;
    $("#top").innerHTML = backbar(esc(c && c.name || ""), paper ? `<span class="paper" style="margin-right:4px">PAPER</span>` : "");
    if (paper) $(".backbar .title").style.paddingRight = "0";
    const v = $("#view");
    if (!c) { v.innerHTML = `<div class="coinhead"><div class="sk" style="width:60%;height:30px"></div><div class="sk" style="width:80%;height:66px;margin-top:12px"></div></div><div class="sk" style="height:260px;margin:12px 16px"></div><div class="stats">${"<div class='sk' style='height:62px'></div>".repeat(4)}</div>`; return; }
    if (c.missing) {
      v.innerHTML = `<div class="empty-card" style="margin-top:16px">No data for this coin yet</div>${sc.coinUrl ? `<a class="bigbtn" href="${esc(sc.coinUrl)}" target="_blank" rel="noopener">Buy on FOMO</a>` : ""}`; return;
    }
    if (!v.dataset.m) {
      v.dataset.m = 1;
      v.innerHTML = `<div class="coinhead"><div class="nmrow"><span class="nm" id="cn"></span><span class="shield hidden" id="sh"></span></div><div class="meta" id="cm"></div>
        <div class="price" id="cp"></div><div id="ce" style="font-size:17px;margin-top:2px"></div></div>
        <div class="candwrap"><canvas id="cand"></canvas></div>
        <div class="stats" id="cs"></div><div id="cpos"></div><div id="cexit"></div>
        <a class="bigbtn" id="cbtn" target="_blank" rel="noopener"></a>`;
    }
    $("#cn").textContent = c.name || short(c.mint);
    const sh = $("#sh"); sh.classList.toggle("hidden", !c.shield); sh.textContent = "⛨ " + (c.shield || ""); sh.classList.toggle("bad", c.shield && c.shield !== "8/8");
    $("#cm").textContent = `${c.symbol || ""} · Solana${c.migrated_at ? " · " + age(c.migrated_at) : ""}`;
    const cp = $("#cp"); cp.textContent = fmtPrice(c.price);   // big price stays on one line: shrink to fit
    let fs = 66; cp.style.fontSize = fs + "px";
    while (cp.scrollWidth > cp.clientWidth && fs > 30) { fs -= 2; cp.style.fontSize = fs + "px"; }
    const ce = $("#ce");
    if (c.since_entry_pct != null) { ce.textContent = `${c.since_entry_pct >= 0 ? "▲" : "▼"} ${Math.abs(c.since_entry_pct).toFixed(2)}% since entry`; ce.className = c.since_entry_pct >= 0 ? "green" : "red"; }
    else ce.textContent = "";
    Charts.candles($("#cand"), c.candles, c.exit ? c.exit.current_exit_line : null, fmtPrice);
    const s = c.stats || {};
    $("#cs").innerHTML = [["Market cap", fmtShort(s.market_cap)], ["Liquidity", fmtShort(s.liquidity_usd)], ["24h volume", fmtShort(s.volume_24h)],
      ["Holders", s.holders == null || s.holders === "n/a" ? "n/a" : Number(s.holders).toLocaleString("en-US")]]
      .map(([k, x]) => `<div class="stat"><div class="k">${k}</div><div class="v">${x}</div></div>`).join("");
    const p = c.position;
    $("#cpos").innerHTML = p ? `<div class="poscard"><div style="font-size:17px">${esc(p.label)}</div><div class="sec" style="font-size:14px;margin-top:2px">${p.mode} · ${p.status}${p.pnl_usd != null ? " · " + fmtUsd(p.pnl_usd) : ""}</div></div>` : "";
    const e = c.exit;   // no exit card without an open position
    $("#cexit").innerHTML = e ? `<div class="exitcard"><div class="r"><span>Stop line</span><span class="red">${fmtPrice(e.stop_line)} · -${e.stop_pct}%</span></div>
      <div class="r"><span>Trail line</span><span class="${e.trail_active ? "green" : "sec"}">${e.trail_active ? fmtPrice(e.trail_line) : "not active"}</span></div>
      <div class="r"><span>Time left to timeout</span><span>${left(e.timeout_at)}</span></div></div>` : "";
    const b = $("#cbtn"); const open_ = p && p.open;
    b.textContent = c.button; b.href = c.coin_url; b.classList.toggle("sell", !!open_);
  }

  // ---------------------------------------------------------------- ACCOUNT
  function renderAccount() {
    $("#top").innerHTML = `<div class="navbar"><div class="brand" style="padding-left:10px;font-size:22px;font-weight:700">Account</div></div>`;
    const v = $("#view"); const A = S.account; const T = S.settings;
    if (!A && dataPath() && !S.loaded) { v.innerHTML = `<div class="pt"></div><div class="sk" style="height:160px;margin:0 16px"></div><div class="sk" style="height:300px;margin:16px"></div>`; return; }
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true || window.__forceStandalone;
    const mode = A ? A.mode : null;
    const sec = (title, inner) => `<div class="glabel">${title}</div><div class="group">${inner}</div>`;
    let html = `<div class="pt"></div>` + sec("Desk", `
      <div class="grow"><span class="k">Mode</span><span class="seg"><span class="${mode === "PAPER" ? "on" : ""}">PAPER</span><span class="${mode === "LIVE" ? "on" : ""}">LIVE</span></span></div>
      <div class="grow"><span class="k">Stack</span><span class="setting" style="padding:0"><input type="text" disabled value="${A && A.stack != null ? esc(fmtUsd(A.stack)) : "not set"}"></span></div>`) +
      `<div class="note">Read-only here. To switch, type LIVE in Telegram (needs 1 full PAPER night). Stack: send "stack 1240" in Telegram.</div>` +
      sec("FOMO", A ? `<a class="grow" href="${esc(A.profile_url)}" target="_blank" rel="noopener"><span class="k">Your FOMO profile</span><span class="v">${esc(A.fomo_handle)}</span><span class="chev">›</span></a>
        <button class="grow" data-act="invite"><span class="k">Invite a friend</span><span class="chev">›</span></button>` : `<div class="grow"><span class="k sec">Waiting for the desk</span></div>`) +
      sec("Telegram", `<div class="grow"><span class="k">Telegram</span><span class="v ${A && A.telegram_connected ? "green" : "red"}">${A ? (A.telegram_connected ? "connected" : "not connected") : "–"}</span></div>
        <div class="grow"><span class="k ter">Send test push</span><span class="v ter">in Telegram</span></div>
        ${standalone ? `<div class="grow"><span class="k ter">Enable notifications</span></div>` : ""}`) +
      (standalone ? `<div class="note">Web push isn't available on this setup. Pushes come through Telegram.</div>` : `<div class="note">The test push runs from Telegram on this setup.</div>`);
    if (T) {
      html += `<div class="note" style="padding-top:18px">Settings are read-only here. Change them in Telegram, e.g. "set stop to -8%".</div>`;
      Object.entries(T.groups).forEach(([g, items]) => {
        html += `<div class="glabel" id="set-${g}">${g[0].toUpperCase() + g.slice(1)}</div><div class="group">${items.map(it => {
          const num = it.type === "int" || it.type === "float";
          const step = it.type === "int" ? 1 : ((it.max - it.min) <= 1 ? 0.01 : (it.max - it.min) <= 100 ? 0.5 : 1);
          return `<div class="setting"><div class="top"><span class="kk">${esc(it.key.split(".").slice(1).join("."))}</span>
            <input type="${num ? "number" : "text"}" disabled value="${esc(it.value)}"></div>
            ${num ? `<input type="range" disabled min="${it.min}" max="${it.max}" step="${step}" value="${esc(it.value)}">` : ""}
            <div class="rg">${esc(it.range)}</div></div>`; }).join("")}</div>`;
      });
    } else html += `<div class="sk" style="height:200px;margin:16px"></div>`;
    v.innerHTML = html;
  }

  // ---------------------------------------------------------------- events
  function toast(msg) { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }
  document.addEventListener("click", async e => {
    const a = e.target.closest("[data-act]");
    if (a) {
      const act = a.dataset.act;
      if (act === "account") go("account");
      else if (act === "agents") go("agents");
      else if (act === "activity") go("activity");
      else if (act === "bell") go("activity");
      else if (act === "search") { S.search = !S.search; render(); }
      else if (act === "back") { S.screen = null; mounted = null; render(); }
      else if (act === "invite" && S.account) {
        const u = S.account.signup_url;
        try { if (navigator.share) { await navigator.share({title: "FOMO", url: u}); return; } } catch (err) { if (err && err.name === "AbortError") return; }
        try { await navigator.clipboard.writeText(u); } catch (err) { /* ignore */ }
        toast("Link copied");
      }
      return;
    }
    const r = e.target.closest("[data-range]");
    if (r) { S.range = r.dataset.range; localStorage.setItem(LS.range, S.range); render(); return; }
    const row = e.target.closest("[data-row]");
    if (row && row.dataset.mint) { open(row.dataset.row === "audit" ? "audit" : "coin", row.dataset.mint, row.dataset.url); return; }
    const st = e.target.closest("[data-settings]");
    if (st) { go("account", () => { const el = $("#set-" + st.dataset.settings); if (el) el.scrollIntoView(); }); return; }
    const more = e.target.closest("[data-more]");
    if (more) { const k = +more.dataset.more; try { const p = await getJSON(`activity/${k}.json`); if (p) S.olderPages[k] = p; } catch (err) { S.offline = true; } render(); }
  });
  window.addEventListener("resize", () => { mounted = null; render(); });

  // ---------------------------------------------------------------- start
  shell();
  render();
  poll();
  setInterval(poll, POLL_S * 1000);
  setInterval(errRow, 1000);   // countdown in the error row
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost"))
    navigator.serviceWorker.register("sw.js").catch(() => {});
})();
