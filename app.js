// Overnight Desk app (vanilla JS). Reads ONLY the desk's JSON: files on Pages (plan B, read-only) or /api/* with the app token.
// Every FOMO href comes from that data (links.py on the desk). No FOMO URL is built here.
(function () {
  "use strict";
  const KEY = "desk_data_path", TKEY = "desk_app_token", SEEN = "desk_seen_activity";
  const NS = "http://www.w3.org/2000/svg";
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- tiny DOM helpers (text only: data never goes through innerHTML) ----------
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const k in props || {}) {
      const v = props[k]; if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") el.setAttribute("style", v);
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
      else if (k === "href") { if (/^https:\/\//.test(v)) { el.setAttribute("href", v); el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener noreferrer"); } }
      else el.setAttribute(k, v === true ? "" : v);
    }
    add(el, kids); return el;
  }
  function add(el, kids) { for (const k of kids.flat(Infinity)) { if (k == null || k === false) continue; el.append(k.nodeType ? k : document.createTextNode(String(k))); } }
  function svg(tag, attrs, ...kids) { const el = document.createElementNS(NS, tag); for (const k in attrs || {}) el.setAttribute(k, attrs[k]); add(el, kids); return el; }
  const ICONS = {
    home: "M3 11.5 12 4l9 7.5M5.5 10v10h13V10", bots: "M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4",
    activity: "M4 6h16M4 12h16M4 18h10", account: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c1-4 4-6 7.5-6s6.500 2 7.500 6",
    search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4", bell: "M6 16V11a6 6 0 0 1 12 0v5l1.500 2h-15zM10 21h4",
    shield: "M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z", chev: "M9 6l6 6-6 6", back: "M15 6l-6 6 6 6",
  };
  function icon(name, extra) { return svg("svg", { viewBox: "0 0 24 24", ...(extra || {}) }, svg("path", { d: ICONS[name] })); }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };

  // ---------- formats (null is never a number: it prints as a dash) ----------
  const DASH = "—";
  const nf = (n, d) => Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (n, d = 2) => (n == null || isNaN(n) ? DASH : (n < 0 ? "-$" : "$") + nf(Math.abs(n), d));
  const smoney = (n) => (n == null || isNaN(n) ? DASH : (n < 0 ? "-$" : "+$") + nf(Math.abs(n), 2));
  const spct = (n, d = 2) => (n == null || isNaN(n) ? DASH : (n < 0 ? "-" : "+") + nf(Math.abs(n), d) + "%");
  const hm = (ts) => (ts == null ? DASH : new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }));
  const short = (m) => (m ? m.slice(0, 4) + "…" + m.slice(-4) : DASH);
  const clean = (t) => String(t == null ? "" : t).replace(/^PAPER · /, "");
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
  const SUB = "₀₁₂₃₄₅₆₇₈₉";
  function fmtPrice(p) {
    if (p == null || isNaN(p)) return DASH;
    const a = Math.abs(p);
    if (a >= 1000) return "$" + nf(p, 2);
    if (a >= 1) return "$" + nf(p, 4);
    if (a >= 0.001) return "$" + nf(p, 5);
    if (a === 0) return "$0";
    const s = a.toFixed(20), zeros = /^0\.(0*)/.exec(s)[1].length;
    const digits = s.slice(2 + zeros).replace(/0+$/, "").slice(0, 4);
    return "$0.0" + String(zeros).split("").map((d) => SUB[+d]).join("") + digits;
  }
  window.fmtPrice = fmtPrice;
  function age(min) { if (min == null) return DASH; if (min < 90) return Math.round(min) + "m"; if (min < 2880) return Math.round(min / 60) + "h"; return Math.round(min / 1440) + "d"; }
  const sym = (r) => r.symbol || short(r.mint);

  // ---------- data layer ----------
  const store = {
    token: () => localStorage.getItem(TKEY), path: () => localStorage.getItem(KEY),
    mode() { return this.token() ? "api" : this.path() ? "pages" : null; },
  };
  function storeFragment(raw) {
    const p = new URLSearchParams(raw), d = p.get("d"), t = p.get("t");
    if (d) localStorage.setItem(KEY, d); if (t) localStorage.setItem(TKEY, t);
    return !!(d || t);
  }
  function takeHash() {
    const raw = location.hash.replace(/^#/, "");
    if (/^[dt]=/.test(raw) || /[&]([dt])=/.test(raw)) { storeFragment(raw); history.replaceState(null, "", location.pathname + location.search + "#/home"); }
  }
  const fileOf = { state: "state.json", account: "account.json", settings: "settings.json", orders: "orders.json" };
  function urlFor(kind, arg) {
    const api = store.mode() === "api";
    if (api) {
      switch (kind) {
        case "chart": return "api/chart?range=" + arg; case "activity": return "api/activity" + (arg ? "?before=" + encodeURIComponent(arg) : "");
        case "coin": return "api/coin/" + arg; case "audit": return "api/audit/" + arg; case "bot": return "api/bots/" + arg + "/decisions";
        case "screen": return "api/screen.jpg?t=" + arg; default: return "api/" + kind;
      }
    }
    const base = "d/" + store.path() + "/";
    switch (kind) {
      case "chart": return base + "chart-" + arg.toLowerCase() + ".json"; case "activity": return base + (arg || "activity.json");
      case "coin": return base + "coin/" + arg + ".json"; case "audit": return base + "audit/" + arg + ".json"; case "bot": return base + "bots/" + arg + ".json";
      case "screen": return base + "screen.jpg?t=" + arg; default: return base + fileOf[kind];
    }
  }
  function headers(extra) { const t = store.token(); return Object.assign(t ? { Authorization: "Bearer " + t } : {}, extra || {}); }
  async function get(kind, arg, soft404) {
    const r = await fetch(urlFor(kind, arg) + (store.mode() === "pages" && kind !== "screen" ? (urlFor(kind, arg).includes("?") ? "&" : "?") + "t=" + Date.now() : ""), { cache: "no-store", headers: headers() });
    if (r.status === 404 && soft404) return null;
    if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
    return r.json();
  }
  async function post(path, body) {
    const r = await fetch(path, { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify(body || {}) });
    let j = {}; try { j = await r.json(); } catch (_) {}
    return { ok: r.ok, status: r.status, body: j };
  }
  const canWrite = () => store.mode() === "api";
  const READONLY = "Read-only here: this page is the published copy (plan B). Change settings from Telegram or the Grok Bot chat.";

  // ---------- odometer: changed digits roll 600ms ease-out, 30ms stagger ----------
  function Odo(cls) { this.el = h("span", { class: "odo " + (cls || "") }); this.cur = null; this.sig = null; this.strips = []; }
  Odo.prototype.set = function (str) {
    if (str === this.cur) return;
    const animate = this.cur !== null && !reduced();
    const sig = str.replace(/\d/g, "#");
    let rebuilt = false;
    if (sig !== this.sig) {
      clear(this.el); this.strips = []; rebuilt = true;
      for (const ch of str) {
        if (/\d/.test(ch)) { const s = h("span", { class: "strip" }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => h("span", null, d))); this.el.append(h("span", { class: "col" }, s)); this.strips.push(s); }
        else { this.el.append(h("span", { class: "ch" }, ch)); this.strips.push(null); }
      }
      this.sig = sig;
    }
    let order = 0;
    [...str].forEach((ch, i) => {
      const s = this.strips[i];
      if (!s) { this.el.children[i].textContent = ch; return; }
      const prev = this.cur && this.cur[i] === ch && !rebuilt;
      s.style.transition = animate && !rebuilt && !prev ? "transform 600ms ease-out " + order * 30 + "ms" : "none";
      if (!prev) order++;
      s.style.transform = "translateY(-" + ch + "em)";
    });
    this.el.setAttribute("aria-label", str); this.cur = str;
  };

  // ---------- app state ----------
  const S = { state: null, chart: {}, activity: null, activityMore: [], account: null, settings: null, bots: {}, coin: {}, audit: {}, rng: "LIVE", lastOk: null, err: null, retryAt: null, route: { name: "home" }, orders: null };
  const $screen = () => document.getElementById("screen");
  const POLL = () => (store.mode() === "api" ? 5000 : 15000);

  function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600); }
  function overlay(node, cls) { const o = document.getElementById("overlay"); clear(o); o.className = cls || ""; o.hidden = false; o.append(node); }
  function closeOverlay() { const o = document.getElementById("overlay"); o.hidden = true; clear(o); }
  function sheet(...kids) {
    const s = h("div", { class: "sheet", role: "dialog" }, h("div", { class: "grab" }), kids);
    const o = h("div", { onclick: (e) => { if (e.target === o) closeOverlay(); }, style: "display:flex;width:100%;height:100%;align-items:flex-end;justify-content:center" }, s);
    overlay(o); return s;
  }

  // ---------- global offline row: 'Desk offline · retrying in {n}s · last update {time}' ----------
  function renderOffline() {
    const el = document.getElementById("offline");
    if (!S.err) { el.hidden = true; return; }
    const n = Math.max(0, Math.ceil(((S.retryAt || Date.now()) - Date.now()) / 1000));
    el.textContent = "Desk offline · retrying in " + n + "s · last update " + (S.lastOk ? new Date(S.lastOk).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : DASH);
    el.hidden = false;
  }
  setInterval(renderOffline, 1000);

  // ---------- chrome: tab bar ----------
  const TABS = [["home", "Home"], ["bots", "Bots"], ["activity", "Activity"], ["account", "Account"]];
  function renderTabs() {
    const t = document.getElementById("tabs"); clear(t);
    const cur = S.route.name === "coin" || S.route.name === "audit" ? S.route.from || "home" : S.route.name;
    t.append(h("div", { class: "in" }, TABS.map(([k, label]) => h("button", { class: cur === k ? "on" : "", "aria-label": label, onclick: () => go(k) }, icon(k), label))));
  }
  function go(name, arg) { location.hash = "#/" + name + (arg ? "/" + arg : ""); }
  function parseRoute() {
    const m = location.hash.replace(/^#\/?/, "").split("/"); const name = m[0] || "home";
    const ok = ["home", "bots", "activity", "account", "coin", "audit"].includes(name);
    return { name: ok ? name : "home", arg: m[1] || null, from: S.route && S.route.name !== "coin" && S.route.name !== "audit" ? S.route.name : S.route && S.route.from };
  }

  function navbar(opts) {
    const a = S.account, L = (S.state && S.state.links) || {}, handle = (L.profile && L.profile.handle) || (a && a.profile && a.profile.handle);
    if (opts && opts.back) return h("div", { class: "navbar" }, h("button", { class: "back", onclick: () => history.length > 1 ? history.back() : go("home") }, icon("back", { width: 20, height: 20, style: "stroke:#0a84ff;fill:none;stroke-width:2.2;width:20px;height:20px" }), "Back"), h("div", { class: "title" }, opts.title || ""), opts.right || h("span", { style: "width:44px" }));
    return h("div", { class: "navbar" },
      h("button", { class: "iconbtn", "aria-label": "Account", onclick: () => go("account") }, h("span", { class: "avatar" }, (handle || "G")[0].toUpperCase())),
      h("button", { class: "title", onclick: () => go("bots") }, "Grok Bot ", h("span", { class: "t2", style: "margin-left:4px" }, "›")),
      h("button", { class: "iconbtn", "aria-label": "Search", onclick: openSearch }, icon("search")),
      h("button", { class: "iconbtn", "aria-label": "Notifications", onclick: () => go("activity") }, icon("bell"), hasUnseen() ? h("span", { class: "dot" }) : null));
  }
  function hasUnseen() { const rows = S.activity && S.activity.rows; if (!rows || !rows.length) return false; return rows[0].id > Number(localStorage.getItem(SEEN) || 0); }
  function markSeen() { const rows = S.activity && S.activity.rows; if (rows && rows.length) localStorage.setItem(SEEN, String(rows[0].id)); }

  // ---------- search ----------
  function openSearch() {
    const known = new Map();
    const L = (S.state && S.state.links) || {};
    (L.coins || []).forEach((c) => known.set(c.mint, c.symbol));
    ((S.state && S.state.positions) || []).forEach((p) => known.set(p.mint, p.symbol));
    ((S.activity && S.activity.rows) || []).forEach((r) => { if (r.mint) known.set(r.mint, (r.title || "").replace(/^PAPER · \w+ /, "")); });
    const res = h("div", { class: "list", style: "margin-top:12px" });
    const input = h("input", { type: "text", placeholder: "Search coins by name or address", autocapitalize: "off", autocomplete: "off", spellcheck: "false" });
    const draw = () => {
      clear(res); const q = input.value.trim().toLowerCase(); if (!q) { res.append(h("div", { class: "empty" }, "Coins the desk has seen tonight show up here.")); return; }
      const hits = [...known].filter(([m, s]) => m.toLowerCase().includes(q) || (s || "").toLowerCase().includes(q)).slice(0, 8);
      if (!hits.length && q.length >= 32) hits.push([input.value.trim(), null]);
      if (!hits.length) res.append(h("div", { class: "empty" }, "Nothing matches."));
      hits.forEach(([m, s]) => res.append(h("button", { class: "item", onclick: () => { closeOverlay(); go("coin", m); } }, h("span", { class: "ico" }, (s || "?")[0]), h("div", { class: "grow" }, h("div", { class: "ttl" }, s || "Coin"), h("div", { class: "sub mono" }, short(m))))));
    };
    input.addEventListener("input", draw);
    const box = h("div", { class: "searchbox" }, h("div", { class: "row gap8" }, h("div", { class: "grow" }, input), h("button", { class: "back", onclick: closeOverlay }, "Cancel")), res);
    overlay(box, "search"); draw(); setTimeout(() => input.focus(), 50);
  }

  // ---------- common pieces ----------
  function skeleton(...hs) { return hs.map((x) => h("div", { class: "sk", style: "height:" + x + "px;margin:12px 16px" })); }
  function modeBadge() { const m = S.state && S.state.mode; return m ? h("span", { class: "pill " + (m === "LIVE" ? "red" : "orange") }, m === "PAPER" ? "PAPER" : "LIVE") : null; }
  function actIcon(kind) { return { bought: ["↓", "blue"], sold: ["↑", "green"], stopped: ["■", "red"], copied: ["★", "blue"], rejected: ["×", "grey"], skipped: ["–", "grey"], error: ["!", "red"], killed: ["×", "grey"] }[kind] || ["•", "grey"]; }
  function activityRow(r, full) {
    const [g, c] = actIcon(r.kind);
    const val = r.value || "";
    const neg = /^-|·\s*-\$/.test(val), pos = /\+\$/.test(val);
    const go1 = () => { if (r.open === "audit" && r.mint) go("audit", r.mint); else if (r.mint) go("coin", r.mint); };
    return h("div", { class: "item", role: r.open ? "button" : null, tabindex: r.open ? "0" : null, style: r.open ? "cursor:pointer" : null, onclick: r.open ? go1 : null },
      h("span", { class: "ico " + c }, g),
      h("div", { class: "grow" }, h("div", { class: "ttl trunc" }, clean(r.title)), h("div", { class: "sub trunc" }, hm(r.ts) + (r.subtitle ? " · " + r.subtitle : "")),
        full && r.link ? h("a", { class: "chip", style: "margin:0;padding:0;min-height:44px;margin-bottom:-12px", href: r.link, onclick: (e) => e.stopPropagation() }, "Open on FOMO") : null),
      h("div", { class: "val " + (neg ? "red" : pos ? "green" : "") }, val));
  }
  function ring(score, pass) {
    const col = score == null ? "var(--text3)" : pass || score >= 70 ? "var(--green)" : "var(--red)";
    const c = 2 * Math.PI * 20, f = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
    return h("div", { class: "ring" }, svg("svg", { viewBox: "0 0 48 48" }, svg("circle", { cx: 24, cy: 24, r: 20, fill: "none", stroke: "#2c2c2e", "stroke-width": 5 }),
      svg("circle", { cx: 24, cy: 24, r: 20, fill: "none", stroke: col === "var(--text3)" ? "#48484a" : col, "stroke-width": 5, "stroke-linecap": "round", "stroke-dasharray": c * f + " " + c })), h("b", null, score == null ? DASH : Math.round(score)));
  }

  // ---------- bot cards ----------
  function botCard(b, full) {
    const lane = (S.state && S.state.lane) || {};
    const dotc = b.paused ? "#636366" : b.status === "quiet" ? "var(--orange)" : b.color;
    const status = b.paused ? "Paused" : b.status === "quiet" ? "Quiet" : "Running";
    const body = h("div", { class: "grow", style: "display:flex;flex-direction:column;gap:10px" });
    const nothing = () => h("div", { class: "t2 line" }, "Nothing yet tonight");
    if (b.name === "scanner") {
      const feed = (b.feed || []).slice(0, full ? 5 : 4);
      body.append(feed.length ? h("div", { class: "feed" }, feed.map((f) => h("div", { class: "f " + (f.verdict === "pass" ? "pass" : "kill") }, h("span", { class: "s" }, f.symbol || short(f.mint)), h("span", { class: "r trunc" }, f.verdict === "pass" ? "→ Analyst" : f.reason || f.verdict)))) : nothing());
    } else if (b.name === "analyst") {
      const L = b.layers || [];
      body.append(h("div", { class: "strips" }, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => { const l = L.find((x) => x.n === n); return h("div", { class: "strip8 " + (l ? (l.pass ? "ok" : l.pass === false ? "bad" : "") : "") }, n); })));
      const sc = b.last_score;
      body.append(sc || L.length ? h("div", { class: "row gap12" }, ring(sc ? sc.score : null, sc && sc.pass), h("div", null, h("div", { class: "line" }, sc ? "Score " + Math.round(sc.score) : "Auditing"), h("div", { class: "t2", style: "font-size:13px" }, b.social === "off" ? "Social: off" : "Social " + b.social))) : nothing());
    } else if (b.name === "brain") {
      const l = b.last, r = b.rule || {};
      body.append(l ? h("div", { class: "line big" }, money(l.usd) + " · " + (l.pct_of_cash == null ? DASH : nf(l.pct_of_cash, 0) + "%") + " of cash") : nothing());
      body.append(h("div", { class: "t2", style: "font-size:13px;display:flex;flex-direction:column;gap:3px" }, h("span", null, r.full || DASH), h("span", null, String(r.below || DASH).replace("50% size", "half size"))));
    } else if (b.name === "executor") {
      const holder = lane.holder, lo = lane.last_order;
      let txt;
      if (holder) txt = "Clicking " + (holder.side === "buy" ? "Buy" : "Sell") + " " + (holder.symbol || "…") + "…";
      else if ((b.waiting || []).length) txt = "Waiting for a dip -" + (b.dip_pct != null ? b.dip_pct : DASH) + "%";
      else if (lo && lo.status === "done") txt = "✓ " + (lo.side === "buy" ? "Bought" : "Sold") + (lo.checks && (lo.checks.screen || lo.checks.chain) ? " · verified" : "");
      else txt = "Idle";
      body.append(h("div", { class: "line big" }, txt));
      body.append(h("div", { class: "t2", style: "font-size:13px" }, (b.waiting || []).length ? (b.waiting.length + " order" + (b.waiting.length > 1 ? "s" : "") + " waiting") : (lane.webhook === "webhook not configured" ? "Click lane: webhook not configured" : "Click lane ready")));
    } else {
      const p = b.pills || {};
      body.append(h("div", { class: "row gap8" }, h("span", { class: "pill mono red" }, "stop -" + (p.stop_pct != null ? p.stop_pct : DASH) + "%"), h("span", { class: "pill mono green" }, "trail " + (p.trail_pct != null ? p.trail_pct : DASH) + "%")));
      body.append(h("div", { class: "line" }, b.count ? "Guarding " + b.count + " position" + (b.count > 1 ? "s" : "") : "Nothing to guard yet"));
      if (b.locked) body.append(h("div", { class: "t2", style: "font-size:13px" }, "Locked on while a position is open"));
    }
    const head = h("div", { class: "bhead" }, h("span", { class: "sdot", style: "background:" + dotc }), h("span", { class: "nm" }, cap(b.name)), h("span", { class: "t2", style: "font-size:13px" }, status), h("span", { class: "cnt" }, b.name === "brain" ? "Sizing" : b.name === "risk" ? "Guarding" : (b.count != null ? b.count : DASH) + " " + (b.label || "")));
    const card = h("div", { class: "bot" + (full ? " full" : ""), style: "border-top:3px solid " + b.color + (b.paused ? ";opacity:.7" : "") }, head, body);
    return card;
  }

  // ---------- LIVE SCREEN card ----------
  function LiveCard() {
    this.imgs = [h("img", { alt: "" }), h("img", { alt: "" })]; this.front = 0; this.ts = null; this.url = null; this.obj = null; this.has = false;
    this.nof = h("div", { class: "nof" }, h("b", { style: "color:#fff" }, "No frame yet"), h("span", null, "The desk's browser lane has not taken a picture."));
    this.tl = h("div", { class: "tl" }); this.tr = h("div", { class: "tr" });
    this.card = h("button", { class: "live", "aria-label": "Open the live screen", onclick: () => this.open() }, h("div", { class: "frame" }, this.imgs, this.nof, this.tl, this.tr));
    this.line = h("div", { class: "lastorder pad" }); this.el = h("div", null, this.card, this.line);
  }
  LiveCard.prototype.update = function () {
    const st = S.state; if (!st) return;
    const sc = st.screen || {}, lane = st.lane || {};
    const live = sc.exists && Date.now() / 1000 - sc.ts < 5; // red dot only while the frame is under 5s old
    clear(this.tl); this.tl.append(h("span", { class: "dotc" + (live ? " live" : "") }), sc.exists ? (live ? "Live · Bot's computer" : "Last frame " + hm(sc.ts)) : "No frame");
    clear(this.tr);
    const hd = lane.holder; this.tr.append(hd ? h("span", { style: "color:" + (BOTCOLOR[hd.bot] || "#fff") }, cap(hd.bot) + " · " + (hd.side === "buy" ? "buying" : "selling")) : "Idle");
    this.nof.hidden = this.has;
    if (sc.exists && sc.ts !== this.ts) { this.ts = sc.ts; this.load(sc.ts); }
    const lo = lane.last_order;
    clear(this.line);
    if (lo) {
      const c = lo.checks || {}, okAny = c.screen === true || c.api === true || c.chain === true, bad = c.screen === false || c.api === false || c.chain === false;
      const chk = (k, n) => h("i", { class: c[k] === true ? "ok" : c[k] === false ? "bad" : "" }, (c[k] === true ? "✓ " : c[k] === false ? "✕ " : "– ") + n);
      const what = (lo.side === "buy" ? "Bought " : "Sold ") + (lo.symbol || short(lo.mint)) + " · " + money(lo.fill_usd != null ? lo.fill_usd : lo.usd) + " · " + (lo.status === "unverified" ? "unverified" : lo.status === "done" ? (okAny && !bad ? "verified" : "done") : lo.status);
      this.line.append(h("span", { class: "trunc" }, what), h("span", { class: "checks" }, chk("screen", "screen"), chk("api", "api"), chk("chain", "chain")));
    } else this.line.append("No orders yet");
    if (lane.webhook === "webhook not configured") this.line.append(h("div", { class: "t3", style: "flex-basis:100%;font-size:12px" }, "Click lane: webhook not configured"));
  };
  LiveCard.prototype.load = async function (ts) {
    try {
      let src;
      if (store.mode() === "api") { const r = await fetch(urlFor("screen", ts), { cache: "no-store", headers: headers() }); if (!r.ok) throw new Error("no frame"); src = URL.createObjectURL(await r.blob()); }
      else src = urlFor("screen", ts);
      const probe = new Image();
      probe.onload = () => { // double-buffered: load off screen, then swap, so the card never blinks
        const back = this.imgs[1 - this.front], front = this.imgs[this.front];
        back.src = src; back.classList.add("on"); front.classList.remove("on"); this.front = 1 - this.front;
        if (this.obj) URL.revokeObjectURL(this.obj); this.obj = store.mode() === "api" ? src : null; this.url = src; this.has = true; this.nof.hidden = true;
      };
      probe.onerror = () => {}; probe.src = src;
    } catch (_) { /* keep the last good frame (or the no-frame state) */ }
  };
  LiveCard.prototype.open = function () {
    if (!this.has) { toast("No frame yet"); return; }
    const lane = (S.state && S.state.lane) || {}, lk = (lane.holder && lane.holder.link) || (lane.last_order && lane.last_order.link);
    const img = h("img", { src: this.url, alt: "Live screen" });
    const box = h("div", { class: "fs" }, img, h("button", { class: "x", "aria-label": "Close", onclick: closeOverlay }, "×"), lk ? h("a", { class: "btn primary open", href: lk }, "Open on FOMO") : null);
    let sc = 1, tx = 0, ty = 0, d0 = 0, s0 = 1, p0 = null;
    const apply = () => (img.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + sc + ")");
    box.addEventListener("touchstart", (e) => { if (e.touches.length === 2) { d0 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY); s0 = sc; } else p0 = { x: e.touches[0].clientX - tx, y: e.touches[0].clientY - ty }; }, { passive: true });
    box.addEventListener("touchmove", (e) => { if (e.touches.length === 2 && d0) { sc = Math.min(5, Math.max(1, s0 * Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY) / d0)); apply(); } else if (sc > 1 && p0) { tx = e.touches[0].clientX - p0.x; ty = e.touches[0].clientY - p0.y; apply(); } }, { passive: true });
    box.addEventListener("touchend", () => { d0 = 0; p0 = null; if (sc === 1) { tx = 0; ty = 0; apply(); } });
    box.addEventListener("dblclick", () => { sc = sc > 1 ? 1 : 2.5; tx = ty = 0; apply(); });
    overlay(box, "full");
  };

  // ---------- HOME ----------
  const home = { el: null };
  const BOTCOLOR = { scanner: "#64d2ff", analyst: "#ffd60a", brain: "#bf5af2", executor: "#00d35a", risk: "#ff6b9a" };
  function marksOf(c) {
    if (!c || !c.marks) return [];
    return c.marks.map((m) => {
      const first = String(m.value || "").split("·")[0].trim();
      if (m.kind === "bought") return { t: m.ts, label: "Bought " + clean(m.title).replace(/^Bought /, ""), color: "#0a84ff" };
      if (m.kind === "sold") return { t: m.ts, label: first || clean(m.title), color: first.startsWith("-") ? "#ff453a" : "#00d35a" };
      const pc = /(-?\d+(?:\.\d+)?)%/.exec(m.subtitle || ""); // "Risk · -25% stop" + "-$N"
      return { t: m.ts, label: (pc ? "-" + Math.abs(Math.round(parseFloat(pc[1]))) + "% · " : "") + first, color: "#ff453a" };
    });
  }
  function buildHome() {
    const o = {};
    o.nav = h("div"); o.odo = new Odo(); o.today = new Odo("sm"); o.mult = new Odo("md");
    o.badge = h("span"); o.todayWrap = h("span", { class: "today" }, o.today.el, h("span", { class: "t2", style: "font-weight:500;font-size:15px" }, "Today"));
    o.multPill = h("span", { class: "pill green" }, o.mult.el); o.market = h("span", { class: "pill" });
    o.canvas = h("canvas", { "aria-label": "Balance chart" }); o.waiting = h("div", { class: "waiting" }, "Waiting for the first trade"); o.csk = h("div", { class: "sk", style: "position:absolute;inset:50px 16px 14px;border-radius:14px" });
    o.chartcard = h("div", { class: "chartcard" }, o.canvas, o.waiting, o.csk);
    o.ranges = h("div", { class: "ranges" }, ["LIVE", "1H", "4H", "1D", "1W", "ALL"].map((r) => h("button", { "data-r": r, onclick: () => { S.rng = r; updateHome(); refresh(); } }, r)));
    o.line = new Charts.LineChart(o.canvas); o.live = new LiveCard();
    o.botsHost = h("div"); o.actHost = h("div"); o.botsSig = ""; o.actSig = "";
    o.skel = h("div", null, skeleton(66, 28, 232, 200, 120));
    o.content = h("div", null,
      h("div", { class: "hero" }, h("div", { class: "bal" }, o.odo.el, h("span", { style: "margin-left:auto" }, o.badge))),
      h("div", { class: "stats" }, o.todayWrap, o.multPill, o.market), o.chartcard, o.ranges, o.live.el, o.botsHost, o.actHost);
    o.el = h("div", { class: "home" }, o.nav, o.skel, o.content);
    home.el = o; return o;
  }
  function updateHome() {
    const o = home.el, st = S.state;
    clear(o.nav); o.nav.append(navbar());
    o.skel.hidden = !!st; o.content.hidden = !st;
    [...o.ranges.children].forEach((b) => b.classList.toggle("on", b.dataset.r === S.rng));
    if (!st) return;
    clear(o.badge); if (modeBadge()) o.badge.append(modeBadge());
    o.odo.set(money(st.balance));
    const tp = st.today_pct; o.today.set(spct(tp)); o.todayWrap.className = "today " + (tp == null ? "t2" : tp < 0 ? "red" : "green");
    o.mult.set(st.multiplier == null ? DASH : nf(st.multiplier, 2) + "x"); o.multPill.className = "pill " + (st.multiplier != null && st.multiplier < 1 ? "red" : "green");
    const m = st.market || {}; clear(o.market);
    let mt = "Market: no data", mc = "pill";
    if (m.mode === "RED") { mt = "Red mode · SOL " + spct(m.sol_h1, 1) + " 1h"; mc = "pill red"; } else if (m.mode === "GREEN") mt = "Green market"; else if (m.mode === "QUIET") mt = "Quiet";
    o.market.className = mc; o.market.append(mt);
    const c = S.chart[S.rng];
    o.csk.hidden = !!c;
    if (c) {
      const marks = marksOf(c), pts = c.points || [];
      o.line.setData({ points: pts, start: c.start_line, marks });
      const traded = marks.length > 0 || (st.trades_tonight || 0) > 0;
      o.waiting.hidden = traded; o.waiting.style.top = pts.length > 1 ? "22px" : "96px";
      if (!pts.length) { o.waiting.hidden = false; o.waiting.textContent = traded ? "Nothing yet tonight" : "Waiting for the first trade"; } else o.waiting.textContent = "Waiting for the first trade";
    }
    o.live.update();
    const sigB = JSON.stringify(st.bots) + JSON.stringify(st.lane);
    if (sigB !== o.botsSig) {
      o.botsSig = sigB; const sl = o.botsHost.querySelector(".carousel"); const left = sl ? sl.scrollLeft : 0; clear(o.botsHost);
      const running = (st.bots || []).filter((b) => !b.paused).length;
      o.botsHost.append(h("div", { class: "sect" }, h("h2", null, "Bots · " + running + " running")), h("div", { class: "carousel" }, (st.bots || []).map((b) => botCard(b, false))));
      o.botsHost.querySelector(".carousel").scrollLeft = left;
    }
    const rows = S.activity ? S.activity.rows.slice(0, 5) : null, sigA = JSON.stringify(rows);
    if (sigA !== o.actSig) {
      o.actSig = sigA; clear(o.actHost);
      o.actHost.append(h("div", { class: "sect" }, h("h2", null, "Activity"), h("button", { onclick: () => go("activity") }, "See all")),
        h("div", { class: "list" }, rows === null ? h("div", { class: "sk", style: "height:120px;border-radius:0" }) : rows.length ? rows.map((r) => activityRow(r, false)) : h("div", { class: "empty" }, "Nothing yet tonight")));
    }
  }
  function drawHome() { const root = $screen(); if (!home.el || !root.contains(home.el.el)) { buildHome(); clear(root); root.append(home.el.el); } updateHome(); }

  // ---------- BOTS TAB ----------
  function drawBots() {
    const root = $screen(), st = S.state; clear(root);
    root.append(h("div", null, navbar()));
    root.append(h("div", { class: "sect", style: "padding-top:8px" }, h("h2", null, "Bots"), modeBadge()));
    if (!st) { root.append(skeleton(200, 200, 200)); return; }
    st.bots.forEach((b) => {
      const card = botCard(b, true);
      const d = S.bots[b.name];
      const sw = h("button", { class: "switch" + (b.paused ? "" : " on"), "aria-label": (b.paused ? "Resume " : "Pause ") + b.name, disabled: !canWrite() || (b.name === "risk" && b.locked && !b.paused) || null, onclick: async () => { const r = await post("api/bots/" + b.name + "/" + (b.paused ? "resume" : "pause")); toast(r.ok ? cap(b.name) + (b.paused ? " resumed" : " paused") : (r.body.detail || "Could not change")); refresh(); } });
      card.querySelector(".bhead").append(sw);
      card.append(h("div", { class: "row" }, h("div", { class: "t2 grow", style: "font-size:13px;font-weight:600" }, "Latest decisions"), h("button", { class: "chip", style: "margin:-10px -6px -10px 0", onclick: () => { openGroups.add(b.name); go("account"); } }, "Settings")));
      card.append(d === undefined ? h("div", { class: "sk", style: "height:90px" }) : d && d.decisions.length ? h("div", { class: "decs" }, d.decisions.slice(0, 6).map((x) => h("div", { class: "dec" }, h("span", { class: "tm" }, hm(x.ts)), h("span", { class: "tx" }, x.symbol ? h("b", null, x.symbol + " ") : "", x.text || x.verdict),
        x.link ? h("a", { class: "chip", href: x.link, style: "margin:-12px 0" }, "FOMO") : null))) : h("div", { class: "t2 line" }, "Nothing yet tonight"));
      root.append(card);
    });
    if (!canWrite()) root.append(h("div", { class: "note" }, "Pausing is read-only on this published copy (plan B). Use Telegram or the Grok Bot chat."));
  }

  // ---------- ACTIVITY TAB ----------
  function drawActivity() {
    const root = $screen(); clear(root); root.append(h("div", null, navbar()));
    root.append(h("div", { class: "sect", style: "padding-top:8px" }, h("h2", null, "Activity")));
    const a = S.activity;
    if (!a) { root.append(skeleton(70, 70, 70, 70)); return; }
    const rows = [...a.rows]; S.activityMore.forEach((r) => { if (!rows.some((x) => x.id === r.id)) rows.push(r); });
    root.append(h("div", { class: "list" }, rows.length ? rows.map((r) => activityRow(r, true)) : h("div", { class: "empty" }, "Nothing yet tonight")));
    const more = S.actNext !== undefined ? S.actNext : (a.next_file || a.next_before);
    if (more) root.append(h("div", { class: "btns" }, h("button", { class: "btn", onclick: async () => {
      try { const p = store.mode() === "api" ? await get("activity", more) : await get("activity", more); S.activityMore.push(...p.rows); S.actNext = store.mode() === "api" ? p.next_before : p.next_file; drawActivity(); } catch (e) { S.err = e; S.retryAt = Date.now() + POLL(); renderOffline(); }
    } }, "Load more")));
    markSeen();
  }

  // ---------- COIN SCREEN ----------
  const compact = (n) => (n == null ? DASH : n >= 1e6 ? "$" + nf(n / 1e6, 2) + "M" : n >= 1e3 ? "$" + nf(n / 1e3, 1) + "K" : "$" + nf(n, 0));
  function shieldChip(au, onclick) {
    if (!au) return h("span", { class: "shield none" }, icon("shield", { width: 14, height: 14, style: "width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2" }), "Not audited");
    const n = au.passed_layers, cls = n === 8 ? "" : n >= 6 ? " warn" : " bad";
    return h("button", { class: "shield" + cls, onclick, "aria-label": n + " of 8 layers passed" }, icon("shield", { width: 14, height: 14, style: "width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2" }), n + "/8");
  }
  function drawCoin() {
    const root = $screen(), mint = S.route.arg; clear(root);
    const c = S.coin[mint], au = S.audit[mint];
    root.append(navbar({ back: true, title: c && c.symbol ? c.symbol : short(mint), right: h("span", { style: "min-width:44px;display:flex;justify-content:flex-end;padding-right:8px" }, modeBadge()) }));
    if (c === undefined) { root.append(skeleton(40, 60, 260, 90)); return; }
    if (c === null) { root.append(h("div", { class: "empty" }, "No data for this coin yet."), h("div", { class: "note", style: "text-align:center" }, short(mint))); return; }
    const pos = c.position;
    root.append(h("div", { class: "coinhead" }, h("div", { class: "name" }, c.symbol || short(mint), shieldChip(au, () => go("audit", mint))))); 
    root.append(h("div", { class: "t2", style: "padding:2px 16px 0" }, [c.name && c.name !== c.symbol ? c.name : c.symbol, "Solana", age(c.age_min != null && c.scan ? c.age_min + (Date.now() / 1000 - c.scan.ts) / 60 : null) === DASH ? null : age(c.age_min != null && c.scan ? c.age_min + (Date.now() / 1000 - c.scan.ts) / 60 : null) + " old"].filter(Boolean).join(" · ")));
    root.append(h("div", { class: "bigprice" }, fmtPrice(c.price)));
    root.append(h("div", { class: "since " + (c.since_entry_pct == null ? "t2" : c.since_entry_pct < 0 ? "red" : "green") }, c.since_entry_pct != null ? (c.since_entry_pct < 0 ? "▼ " : "▲ ") + nf(Math.abs(c.since_entry_pct), 1) + "% since entry" : c.price_ts ? "Price at " + hm(c.price_ts) : "No price yet"));
    const cv = h("canvas", { "aria-label": "Price candles" });
    root.append(h("div", { class: "chartcard" }, cv, !c.candles.length ? h("div", { class: "waiting", style: "top:104px" }, "Nothing yet tonight") : null));
    cv.style.height = "260px";
    new Charts.CandleChart(cv).setData({ candles: c.candles, exit: pos ? pos.stop_price : null, entry: pos ? pos.entry_price : null });
    const scanAge = c.age_min != null && c.scan ? c.age_min + (Date.now() / 1000 - c.scan.ts) / 60 : null;
    root.append(h("div", { class: "metrics" }, [["Market cap", compact(c.market_cap)], ["Liquidity", compact(c.liquidity_usd)], ["Holders", c.holders == null ? DASH : nf(c.holders, 0)], ["Age", age(scanAge)], ["Top 10", c.top10_pct == null ? DASH : nf(c.top10_pct, 1) + "%"], ["Score", c.audit ? Math.round(c.audit.score) : DASH]].map(([k, v]) => h("div", null, h("small", null, k), h("b", null, v)))));
    if (pos) root.append(h("div", { class: "card poscard" }, h("div", { class: "row" }, h("b", { class: "grow" }, "Your position"), h("span", { class: "t2" }, "Executor")),
      h("div", { class: "row", style: "margin-top:8px" }, h("div", { class: "grow" }, h("div", { class: "t2", style: "font-size:13px" }, "In"), h("b", null, money(pos.size_usd))), h("div", { class: "grow" }, h("div", { class: "t2", style: "font-size:13px" }, "Now"), h("b", null, money(pos.value_usd))), h("div", { style: "text-align:right" }, h("div", { class: "t2", style: "font-size:13px" }, "P&L"), h("b", { class: pos.pnl_usd < 0 ? "red" : "green" }, smoney(pos.pnl_usd)))),
      h("div", { class: "t2", style: "font-size:13px;margin-top:8px" }, "Exit " + fmtPrice(pos.stop_price) + " · stop -" + pos.exit.stop_pct + "% · trail " + pos.exit.trail_pct + "%")));
    else root.append(h("div", { class: "note" }, c.last_closed ? "Closed " + hm(c.last_closed.closed_at) + " · " + (c.last_closed.exit_reason || "") + (c.last_closed.pnl_usd != null ? " · " + smoney(c.last_closed.pnl_usd) : "") : "No position in this coin."));
    root.append(h("div", { class: "btns" }, c.link ? h("a", { class: "btn primary", href: c.link }, "Open on FOMO") : h("button", { class: "btn", disabled: true }, "Open on FOMO"), h("button", { class: "btn red", disabled: !pos || null, onclick: () => sellSheet(c) }, "Sell now")));
    root.append(h("div", { class: "note", style: "padding-bottom:8px" }, "Price from DexScreener, updated each minute. " + (pos ? "" : "Sell now needs an open position.")));
  }
  function sellSheet(c) {
    let pct = 50; const seg = h("div", { class: "seg" });
    const draw = () => { clear(seg); [25, 50, 100].forEach((p) => seg.append(h("button", { class: pct === p ? "on" : "", onclick: () => { pct = p; draw(); } }, p + "%"))); };
    draw();
    const msg = h("div", { class: "t2", style: "font-size:13px;margin-top:10px;min-height:18px" });
    const sh = sheet(h("h3", null, "Sell " + (c.symbol || short(c.mint))), h("p", null, "Choose how much of the position to sell."), seg, msg,
      canWrite() ? h("div", { class: "btns", style: "padding:14px 0 0" }, h("button", { class: "btn", onclick: closeOverlay }, "Cancel"), h("button", { class: "btn red", onclick: async (e) => {
        e.target.disabled = true; msg.textContent = "Sending…";
        const r = await post("api/sell/" + c.mint, { pct, confirm: true });
        if (r.ok) { closeOverlay(); toast("Sell sent · " + pct + "%"); refresh(); } else { msg.textContent = r.body.detail || "Sell failed (HTTP " + r.status + ")"; msg.className = "red"; e.target.disabled = false; }
      } }, "Confirm sell")) : h("div", { class: "note", style: "padding:14px 0 0" }, "Sell from Telegram or the Grok Bot chat. This published copy is read-only (plan B)."));
    return sh;
  }

  // ---------- AUDIT SCREEN ----------
  const auditPlayed = new Set();
  function drawAudit() {
    const root = $screen(), mint = S.route.arg; clear(root);
    const au = S.audit[mint], c = S.coin[mint];
    root.append(navbar({ back: true, title: (au && au.symbol) || (c && c.symbol) || short(mint), right: h("span", { style: "min-width:44px;display:flex;justify-content:flex-end;padding-right:8px" }, modeBadge()) }));
    if (au === undefined) { root.append(skeleton(200, 300)); return; }
    if (au === null) { root.append(h("div", { class: "empty" }, "Nothing yet tonight"), h("div", { class: "note", style: "text-align:center" }, "This coin has no audit yet.")); return; }
    const first = !auditPlayed.has(mint) && !reduced(); auditPlayed.add(mint);
    const names = ["Mint authority", "Dev wallet", "Top holders", "Liquidity lock", "Age and speed", "Bundles and insiders", "Fresh wallets", "Delegations"], shorts = ["Mint", "Dev", "Top 10", "Lock", "Age", "Bundles", "Fresh", "Delegate"];
    const beam = h("div", { class: "beam" });
    const grid = h("div", { class: "discs" }, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
      const l = au.layers.find((x) => x.n === n), cls = !l ? "na" : l.pass ? "ok" : l.pass === false ? "bad" : "na";
      const d = h("div", { class: "disc " + cls + (first ? "" : " read") }, h("span", null, !l ? "–" : l.pass ? "✓" : l.pass === false ? "✕" : "–"), h("b", { class: "trunc", style: "max-width:100%;padding:0 4px" }, shorts[n - 1]));
      if (first) setTimeout(() => d.classList.add("read"), 200 + (n - 1) * 180);
      return d;
    }));
    root.append(h("div", { class: "beamwrap" }, grid, beam));
    if (first) setTimeout(() => beam.classList.add("go"), 30);
    root.append(h("div", { class: "row gap12", style: "padding:16px 16px 0" }, ring(au.score ? au.score.score : null, au.score && au.score.pass), h("div", { class: "grow" }, h("div", { style: "font-weight:700;font-size:17px" }, au.passed_layers + " of 8 layers passed"), h("div", { class: "t2", style: "font-size:13px" }, au.score ? (au.score.pass ? "Passed" : "Rejected") + (au.score.reason ? " · " + au.score.reason : "") : "No score yet"))));
    root.append(h("div", { class: "list", style: "margin-top:14px" }, au.layers.map((l) => h("div", { class: "layerrow " + (l.pass ? "ok" : l.pass === false ? "bad" : "") }, h("span", { class: "n" }, l.n), h("div", { class: "grow" }, h("div", { class: "ttl", style: "font-weight:600" }, l.name || names[l.n - 1]), h("div", { class: "t2 trunc", style: "font-size:13px" }, l.value || DASH)), h("span", { class: "t3", style: "font-size:11px" }, l.source || "")))));
    root.append(h("div", { class: "list", style: "margin-top:12px" }, h("div", { class: "layerrow" }, h("span", { class: "n" }, "S"), h("div", { class: "grow ttl", style: "font-weight:600" }, au.social ? au.social.text : "Social: off"))));
    root.append(h("div", { class: "btns" }, au.link ? h("a", { class: "btn primary", href: au.link }, "Open on FOMO") : null, h("button", { class: "btn", onclick: () => go("coin", mint) }, "Chart")));
  }

  // ---------- ACCOUNT TAB ----------
  const openGroups = new Set();
  const GROUP_ORDER = ["scanner", "analyst", "brain", "executor", "risk", "desk"];
  const GROUP_COLOR = { scanner: "#64d2ff", analyst: "#ffd60a", brain: "#bf5af2", executor: "#00d35a", risk: "#ff6b9a" };
  function b64(s) { const p = "=".repeat((4 - (s.length % 4)) % 4), r = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); }
  async function enablePush(key) {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) { toast("Add this app to your Home Screen first"); return; }
      if ((await Notification.requestPermission()) !== "granted") { toast("Notifications are off for this app"); return; }
      const reg = await navigator.serviceWorker.register("sw.js"); await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) });
      const r = await post("api/push", sub.toJSON()); toast(r.ok ? "Notifications on" : r.body.detail || "Could not save"); refresh();
    } catch (e) { toast("Could not turn on notifications"); }
  }
  function settingRow(s, writable) {
    const err = h("div", { class: "err", hidden: true });
    const save = async (v, revert) => {
      err.hidden = true; const r = await post("api/settings", { key: s.key, value: v });
      if (r.ok) { toast("Saved " + s.name); refresh(); } else { err.textContent = r.body.detail || "Refused (HTTP " + r.status + ")"; err.hidden = false; if (revert) revert(); }
    };
    const dis = !writable || !s.editable || null;
    let ctl, extra = null;
    if (s.type === "int" || s.type === "float") {
      const num = h("input", { type: "number", inputmode: "decimal", step: "any", min: s.min, max: s.max, value: s.value, disabled: dis, "aria-label": s.key });
      const step = s.type === "int" ? 1 : Math.max(0.01, +(((s.max - s.min) / 200).toPrecision(1)));
      const rng = h("input", { type: "range", min: s.min, max: s.max, step, value: s.value, disabled: dis, "aria-label": s.key + " slider" });
      rng.addEventListener("input", () => (num.value = rng.value));
      rng.addEventListener("change", () => save(Number(rng.value), () => { rng.value = num.value = s.value; }));
      num.addEventListener("change", () => { rng.value = num.value; save(Number(num.value), () => { rng.value = num.value = s.value; }); });
      ctl = num; extra = [rng, h("div", { class: "rng" }, h("span", null, s.min), h("span", null, s.max))];
    } else if (s.type === "enum") {
      ctl = h("select", { disabled: dis, onchange: (e) => save(e.target.value, () => (e.target.value = s.value)) }, s.options.map((o) => h("option", { value: o, selected: String(o) === String(s.value) || null }, o)));
    } else if (s.type === "time") {
      ctl = h("input", { type: "time", value: s.value, disabled: dis, onchange: (e) => save(e.target.value, () => (e.target.value = s.value)) });
    } else if (s.type === "bool") {
      ctl = h("button", { class: "switch" + (s.value ? " on" : ""), disabled: dis, "aria-label": s.key, onclick: (e) => { const v = !e.currentTarget.classList.contains("on"); e.currentTarget.classList.toggle("on", v); save(v, () => e.currentTarget.classList.toggle("on", !v)); } });
    } else ctl = h("span", { class: "t2 mono" }, String(s.value));
    return h("div", { class: "setrow" }, h("div", { class: "top" }, h("span", { class: "k mono" }, s.name), ctl), extra, err);
  }
  let accSig = "";
  function drawAccount() {
    const root = $screen(), a = S.account, st = S.settings;
    const sig = JSON.stringify([a, st, S.state && S.state.mode]);
    if (sig === accSig && root.querySelector(".acc")) return; accSig = sig;
    const scroll = window.scrollY; clear(root); const wrap = h("div", { class: "acc" }); root.append(wrap);
    wrap.append(navbar());
    wrap.append(h("div", { class: "sect", style: "padding-top:8px" }, h("h2", null, "Account"), modeBadge()));
    if (!a || !st) { skeleton(120, 160, 200).forEach((x) => wrap.append(x)); return; }
    const w = canWrite();
    if (!w) wrap.append(h("div", { class: "note", style: "padding-top:0;padding-bottom:10px" }, READONLY));
    // mode
    const modeSeg = h("div", { class: "seg" }, ["PAPER", "LIVE"].map((m) => h("button", { class: a.mode === m ? "on" : "", disabled: !w || null, onclick: () => (m === a.mode ? null : setMode(m, a)) }, m)));
    const liveLine = a.live_warning || "LIVE trades real cash on FOMO. New coins can go to 0 in minutes. Only put in what you can lose.";
    wrap.append(h("div", { class: "list" }, h("div", { class: "note", style: "padding:12px 14px 0" }, liveLine),
      h("div", { class: "field" }, h("label", null, "Mode", h("small", null, a.mode === "PAPER" ? "Simulated money. Nothing is clicked on FOMO." : "Real money.")), h("div", { style: "width:170px" }, modeSeg)),
      a.mode === "PAPER" && !(a.gates && a.gates.live_allowed) ? h("div", { class: "field" }, h("label", { class: "t2", style: "font-size:13px" }, "LIVE stays locked until the acceptance tests pass and one full PAPER night is done.")) : null));
    // cash + profile + invite
    const cash = a.cash || {}, all0 = {}; st.groups.forEach((g) => g.settings.forEach((s) => (all0[s.key] = s)));
    wrap.append(h("div", { class: "list", style: "margin-top:12px" },
      h("div", { class: "field" }, h("label", null, a.mode === "LIVE" ? "Cash (USDC on chain)" : "Cash (PAPER)", h("small", null, "What the desk can spend now")), h("b", null, a.mode === "LIVE" ? money(cash.chain_usdc) : money(cash.paper_cash))),
      h("div", { class: "field" }, h("label", null, "PAPER start cash", h("small", null, "Each night starts from this")), h("input", { type: "number", inputmode: "decimal", step: "any", min: (all0["desk.paper_start_cash"] || {}).min, max: (all0["desk.paper_start_cash"] || {}).max, value: cash.paper_start_cash, disabled: !w || null, "aria-label": "PAPER start cash", onchange: async (e) => { const r = await post("api/settings", { key: "desk.paper_start_cash", value: Number(e.target.value) }); toast(r.ok ? "Saved" : r.body.detail || "Refused"); if (!r.ok) e.target.value = cash.paper_start_cash; refresh(); } })),
      h("div", { class: "field" }, h("label", null, "Your FOMO profile", h("small", null, a.profile ? "@" + a.profile.handle : "Not set")), a.profile ? h("a", { class: "chip", href: a.profile.url }, "Open on FOMO") : h("span", { class: "t2" }, DASH)),
      h("div", { class: "field" }, h("label", null, "Invite a friend", h("small", null, "Share your FOMO sign-up link")), a.signup_url ? h("button", { class: "chip", onclick: async () => {
        try { if (navigator.share) await navigator.share({ title: "FOMO", url: a.signup_url }); else { await navigator.clipboard.writeText(a.signup_url); toast("Link copied"); } } catch (e) { if (e && e.name !== "AbortError") { try { await navigator.clipboard.writeText(a.signup_url); toast("Link copied"); } catch (_) { toast("Could not share"); } } }
      } }, "Share") : h("span", { class: "t2" }, DASH))));
    // copy picks
    const all = {}; st.groups.forEach((g) => g.settings.forEach((s) => (all[s.key] = s)));
    const every = all["picks.every"], ptime = all["picks.time"];
    if (every) {
      const sg = h("div", { class: "seg" }, every.options.map((o) => h("button", { class: String(every.value) === String(o) ? "on" : "", disabled: !w || null, onclick: async () => { const r = await post("api/settings", { key: "picks.every", value: o }); toast(r.ok ? "Saved" : r.body.detail || "Refused"); refresh(); } }, o)));
      wrap.append(h("div", { class: "sect", style: "padding-bottom:8px" }, h("h2", null, "Copy picks")));
      wrap.append(h("div", { class: "list" }, h("div", { class: "field", style: "flex-direction:column;align-items:stretch" }, h("label", null, "How often", h("small", null, "The Brain's picks, sent as a note with a FOMO button")), sg), ptime ? h("div", { class: "field" }, h("label", null, "At"), h("input", { type: "time", value: ptime.value, disabled: !w || null, onchange: async (e) => { const r = await post("api/settings", { key: "picks.time", value: e.target.value }); toast(r.ok ? "Saved" : r.body.detail || "Refused"); refresh(); } })) : null));
    }
    // pushes, vault, watch
    const p = a.pushes || {};
    wrap.append(h("div", { class: "sect", style: "padding-bottom:8px" }, h("h2", null, "Alerts")));
    wrap.append(h("div", { class: "list" },
      h("div", { class: "field" }, h("label", null, "Push alerts", h("small", null, w ? (p.connected ? "Connected on this phone" : "Not connected") : "Not connected · plan B sends alerts through Telegram only")), p.connected ? h("span", { class: "pill green" }, "On") : h("span", { class: "pill" }, "Off")),
      h("div", { class: "field" }, h("label", null, "Telegram", h("small", null, p.telegram === "connected" ? "Alerts and commands go to your chat" : "Send /start to your desk bot to connect")), p.telegram === "connected" ? h("span", { class: "pill green" }, "On") : h("span", { class: "pill" }, p.telegram ? "Waiting" : "Off")),
      h("div", { class: "field" }, h("label", null, "Enable notifications", h("small", null, "Works from the home-screen app")), h("button", { class: "chip", disabled: !w || !p.vapid_public_key || null, style: !w || !p.vapid_public_key ? "opacity:.4" : "", onclick: () => enablePush(p.vapid_public_key) }, "Turn on")),
      h("div", { class: "field" }, h("label", null, "Send test push"), h("button", { class: "chip", disabled: !w || null, style: !w ? "opacity:.4" : "", onclick: async () => { const r = await post("api/push", { test: true }); toast(r.ok ? "Test sent (" + r.body.sent + ")" : r.body.detail || "Could not send"); } }, "Send"))));
    wrap.append(h("div", { class: "list", style: "margin-top:12px" },
      h("div", { class: "field" }, h("label", null, "Vault", h("small", null, (a.vault && a.vault.note) || a.vault_note || "Vault: files not on iPhone")), a.vault ? h("div", { class: "seg", style: "width:150px" }, ["plugin", "files"].map((m) => h("button", { class: (a.vault.mode || a.vault) === m ? "on" : "", disabled: true }, m))) : h("span", { class: "t2" }, DASH)),
      h("div", { class: "field" }, h("label", null, "Repos", h("small", null, (a.repos && a.repos.note) || "Repos: all off")), h("span", { class: "pill" }, (a.repos && !a.repos.all_off) ? "On" : "Off")),
      h("div", { class: "field" }, h("label", null, "Watch in Grok Bot", h("small", null, a.watch_url ? "See the desk's computer" : "Not linked yet")), a.watch_url ? h("a", { class: "chip", href: a.watch_url }, "Watch") : h("span", { class: "t2" }, DASH))));
    // settings per bot
    wrap.append(h("div", { class: "sect", style: "padding-bottom:4px" }, h("h2", null, "Settings")));
    const skip = new Set(["picks"]);
    const groups = st.groups.filter((g) => !skip.has(g.group)).sort((x, y) => (GROUP_ORDER.indexOf(x.group) + 99) % 99 - (GROUP_ORDER.indexOf(y.group) + 99) % 99);
    groups.forEach((g) => {
      const det = h("details", { class: "grp" }, h("summary", null, GROUP_COLOR[g.group] ? h("span", { class: "sdot", style: "background:" + GROUP_COLOR[g.group] + ";margin-right:10px" }) : null, cap(g.group), h("span", { class: "t2", style: "margin-left:8px;font-weight:500;font-size:13px" }, g.settings.length)), g.settings.map((s) => settingRow(s, w)));
      if (openGroups.has(g.group)) det.open = true;
      det.addEventListener("toggle", () => (det.open ? openGroups.add(g.group) : openGroups.delete(g.group)));
      wrap.append(det);
    });
    const sp = st.special || {};
    wrap.append(h("div", { class: "note", style: "padding-top:14px" }, "RPC: " + (sp.rpc || DASH) + " · Withdraw address: " + (sp.withdraw_address || DASH) + ". Both are changed in the desk's own files, never in this app."));
    wrap.append(h("div", { class: "note", style: "padding-bottom:12px" }, "Plan " + (a.plan || DASH) + " · Click lane: " + ((a.click_lane && a.click_lane.webhook) || DASH)));
    window.scrollTo(0, scroll);
  }
  function setMode(m, a) {
    if (m === "PAPER") { post("api/mode", { mode: "PAPER" }).then((r) => { toast(r.ok ? "PAPER mode" : "Could not switch"); refresh(); }); return; }
    const inp = h("input", { type: "text", placeholder: "Type LIVE", autocapitalize: "characters", autocomplete: "off" }), msg = h("div", { class: "red", style: "font-size:13px;margin-top:8px" });
    sheet(h("h3", null, "Switch to LIVE"), h("p", null, (a && a.live_warning) || "LIVE trades real cash on FOMO. New coins can go to 0 in minutes. Only put in what you can lose."), inp, msg, h("div", { class: "btns", style: "padding:14px 0 0" }, h("button", { class: "btn", onclick: closeOverlay }, "Cancel"), h("button", { class: "btn red", onclick: async () => {
      const r = await post("api/mode", { mode: "LIVE", confirm: inp.value.trim() }); if (r.ok) { closeOverlay(); toast("LIVE mode"); refresh(); } else msg.textContent = [r.body.detail].concat(r.body.missing || []).filter(Boolean).join(" · ") || "Refused";
    } }, "Go LIVE")));
  }

  // ---------- paste-your-link screen ----------
  function drawLink(msg) {
    const root = $screen(); clear(root);
    const inp = h("input", { type: "text", id: "link", placeholder: "Paste your desk link", autocomplete: "off", autocapitalize: "off", spellcheck: "false" }), err = h("p", { class: "t2" }, msg || "");
    root.append(h("div", { style: "padding:80px 16px 0" }, h("h1", { style: "font-family:var(--font-display);margin:0 0 6px" }, "Grok Bot"), h("p", { class: "t2", style: "margin:0 0 18px" }, "Paste the link you were sent to open your desk."),
      h("form", { onsubmit: (e) => { e.preventDefault(); const s = inp.value.trim(), i = s.indexOf("#"); if (storeFragment(i >= 0 ? s.slice(i + 1) : s)) { S.err = null; refresh(); } else err.textContent = "That link has no key in it. Paste the full link you were sent."; } }, inp, h("div", { class: "btns", style: "padding:12px 0 0" }, h("button", { class: "btn primary", type: "submit" }, "Open")), err)));
  }

  // ---------- routing, polling ----------
  const fetchers = {
    async home() { const [st, ch, ac] = await Promise.all([get("state"), get("chart", S.rng), get("activity")]); S.state = st; S.chart[S.rng] = ch; S.activity = ac; },
    async bots() {
      const [st, ...ds] = await Promise.all([get("state"), ...["scanner", "analyst", "brain", "executor", "risk"].map((n) => get("bot", n).catch(() => null))]);
      S.state = st; ["scanner", "analyst", "brain", "executor", "risk"].forEach((n, i) => (S.bots[n] = ds[i]));
    },
    async activity() { const [st, ac] = await Promise.all([get("state"), get("activity")]); S.state = st; S.activity = ac; },
    async account() { const [st, ac, se] = await Promise.all([get("state"), get("account"), get("settings")]); S.state = st; S.account = ac; S.settings = se; },
    async coin(r) { const [st, c, au] = await Promise.all([get("state"), get("coin", r.arg, true), get("audit", r.arg, true)]); S.state = st; S.coin[r.arg] = c; S.audit[r.arg] = au; },
  };
  fetchers.audit = fetchers.coin;
  let busy = false;
  async function refresh() {
    if (!store.mode() || busy) return; busy = true;
    const r = S.route;
    try { await fetchers[r.name](r); S.lastOk = Date.now(); S.err = null; }
    catch (e) {
      S.err = e; S.retryAt = Date.now() + POLL();
      if (e.status === 404 && !S.state && store.mode() === "pages") { localStorage.removeItem(KEY); busy = false; S.err = null; drawLink("That link doesn't match the desk any more. Paste the newest one."); return; }
    }
    busy = false; renderOffline(); draw();
  }
  function draw() {
    renderTabs();
    if (!store.mode()) { drawLink(); return; }
    switch (S.route.name) { case "home": drawHome(); break; case "bots": drawBots(); break; case "activity": drawActivity(); break; case "account": drawAccount(); break; case "coin": drawCoin(); break; case "audit": drawAudit(); break; }
    if (!document.querySelector(".fs")) document.documentElement.scrollTop = document.documentElement.scrollTop;
  }
  window.addEventListener("hashchange", () => { takeHash(); S.route = parseRoute(); closeOverlay(); window.scrollTo(0, 0); accSig = ""; draw(); refresh(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  (function loop() { refresh().finally(() => setTimeout(loop, POLL())); })();
  takeHash(); S.route = parseRoute(); draw();
})();
