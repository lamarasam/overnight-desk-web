/* Canvas charts, DPR-aware, no libraries. LineChart (balance) and CandleChart (coin). */
(function () {
  "use strict";
  const GREEN = "#00d35a", RED = "#ff453a", ORANGE = "#ff9f0a", BLUE = "#0a84ff", GRID = "rgba(84,84,88,0.45)", T2 = "rgba(235,235,245,0.6)";
  const FONT = '"SF Mono", ui-monospace, "JetBrains Mono", Menlo, monospace';
  const TEXT = '"SF Pro Text", -apple-system, "Inter", system-ui, sans-serif';
  const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setup(canvas) {
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.max(10, canvas.clientWidth), h = Math.max(10, canvas.clientHeight);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }
  function watch(self) {
    if (window.ResizeObserver) { self._ro = new ResizeObserver(() => self.draw()); self._ro.observe(self.canvas); }
    window.addEventListener("resize", () => self.draw());
  }
  function money(v) { return (v < 0 ? "-$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function LineChart(canvas) { this.canvas = canvas; this.data = { points: [], start: null, marks: [] }; this.anim = 1; this.prevLast = null; watch(this); }
  LineChart.prototype.setData = function (d) {
    const old = this.data.points, np = d.points || [];
    // a new point slides in from the previous last point (250ms ease-out); never when the range switched or motion is reduced
    if (!reduced() && old.length && np.length === old.length + 1 && np[np.length - 2].t === old[old.length - 1].t) {
      this.prevLast = old[old.length - 1]; this.anim = 0; this._t0 = performance.now();
      const step = (now) => { this.anim = Math.min(1, (now - this._t0) / 250); this.anim = 1 - Math.pow(1 - this.anim, 3); this.draw(); if ((now - this._t0) < 250) requestAnimationFrame(step); else { this.anim = 1; this.draw(); } };
      requestAnimationFrame(step);
    } else { this.anim = 1; this.prevLast = null; }
    this.data = { points: np, start: d.start, marks: d.marks || [] };
    this.draw();
  };
  LineChart.prototype.draw = function () {
    const { ctx, w, h } = setup(this.canvas);
    const P = this.data.points, start = this.data.start;
    if (!P || P.length < 1) return;
    const padL = 16, padR = 16, padT = 50, padB = 14;
    let pts = P.map((p) => ({ t: p.t, v: p.v }));
    if (this.prevLast && this.anim < 1 && pts.length > 1) { const l = pts[pts.length - 1], a = this.prevLast; pts[pts.length - 1] = { t: a.t + (l.t - a.t) * this.anim, v: a.v + (l.v - a.v) * this.anim }; }
    let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
    if (start != null) { lo = Math.min(lo, start); hi = Math.max(hi, start); }
    if (hi - lo < Math.abs(hi) * 0.002) { const m = Math.max(Math.abs(hi) * 0.01, 0.5); lo -= m; hi += m; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t, span = Math.max(1, t1 - t0);
    const X = (t) => padL + ((Math.min(Math.max(t, t0), t1) - t0) / span) * (w - padL - padR);
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
    // dashed start line
    if (start != null) { ctx.save(); ctx.setLineDash([4, 5]); ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, Y(start)); ctx.lineTo(w, Y(start)); ctx.stroke(); ctx.restore(); }
    // gradient under the line
    if (pts.length > 1) {
      const g = ctx.createLinearGradient(0, padT, 0, h); g.addColorStop(0, "rgba(0,211,90,0.22)"); g.addColorStop(1, "rgba(0,211,90,0)");
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v))));
      ctx.lineTo(X(t1), h); ctx.lineTo(X(t0), h); ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(X(p.t), Y(p.v)) : ctx.moveTo(X(p.t), Y(p.v))));
      ctx.strokeStyle = GREEN; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
    }
    const last = pts[pts.length - 1];
    ctx.beginPath(); ctx.arc(X(last.t), Y(last.v), 4, 0, 7); ctx.fillStyle = GREEN; ctx.fill();
    // marks: a dot on the line and a label above it; later labels climb a row so none overlap
    const placed = [];
    ctx.font = "600 11px " + TEXT; ctx.textBaseline = "middle";
    (this.data.marks || []).forEach((m) => {
      const x = X(m.t); let py = Y(interp(pts, m.t));
      ctx.beginPath(); ctx.arc(x, py, 3.5, 0, 7); ctx.fillStyle = m.color; ctx.fill();
      const tw = ctx.measureText(m.label).width + 14, bw = tw, bh = 20;
      let bx = Math.min(Math.max(x - bw / 2, 4), w - bw - 4), by = py - 28, row = 0;
      while (row < 3 && placed.some((r) => bx < r.x + r.w + 3 && bx + bw + 3 > r.x && Math.abs(by - r.y) < bh + 2)) { by -= bh + 3; row++; }
      by = Math.max(by, 2);
      placed.push({ x: bx, y: by, w: bw });
      ctx.beginPath(); roundRect(ctx, bx, by, bw, bh, 10); ctx.fillStyle = hexA(m.color, 0.18); ctx.fill();
      ctx.fillStyle = m.color; ctx.textAlign = "center"; ctx.fillText(m.label, bx + bw / 2, by + bh / 2 + 0.5);
    });
  };
  function interp(pts, t) {
    if (t <= pts[0].t) return pts[0].v; if (t >= pts[pts.length - 1].t) return pts[pts.length - 1].v;
    for (let i = 1; i < pts.length; i++) if (pts[i].t >= t) { const a = pts[i - 1], b = pts[i], f = (t - a.t) / Math.max(1e-9, b.t - a.t); return a.v + (b.v - a.v) * f; }
    return pts[pts.length - 1].v;
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

  // ---- candles ----
  function CandleChart(canvas) { this.canvas = canvas; this.data = { candles: [], exit: null, entry: null }; watch(this); }
  CandleChart.prototype.setData = function (d) { this.data = d; this.draw(); };
  CandleChart.prototype.draw = function () {
    const { ctx, w, h } = setup(this.canvas);
    const C = this.data.candles || [];
    if (!C.length) return;
    const padR = 82, padT = 14, padB = 22, padL = 8, ex = this.data.exit, en = this.data.entry;
    let lo = Math.min(...C.map((c) => c.l)), hi = Math.max(...C.map((c) => c.h));
    [ex, en].forEach((v) => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } });
    if (hi <= lo) { const m = Math.abs(hi) * 0.01 || 1e-9; lo -= m; hi += m; }
    const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    const cw = (w - padL - padR) / Math.max(C.length, 30);
    const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
    ctx.font = "10.5px " + FONT; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) { const v = lo + ((hi - lo) * (i + 0.5)) / 4, y = Y(v); ctx.strokeStyle = GRID; ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke(); ctx.fillStyle = T2; ctx.fillText(window.fmtPrice ? window.fmtPrice(v) : String(v), w - padR + 6, y); }
    C.forEach((c, i) => {
      const x = padL + i * cw + cw / 2, up = c.c >= c.o, col = up ? GREEN : RED;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, Y(c.h)); ctx.lineTo(x, Y(c.l)); ctx.stroke();
      const top = Y(Math.max(c.o, c.c)), bh = Math.max(1.5, Math.abs(Y(c.o) - Y(c.c)));
      ctx.fillRect(x - Math.max(1, cw * 0.32), top, Math.max(2, cw * 0.64), bh);
    });
    if (en != null) { ctx.save(); ctx.setLineDash([2, 4]); ctx.strokeStyle = T2; ctx.beginPath(); ctx.moveTo(padL, Y(en)); ctx.lineTo(w - padR, Y(en)); ctx.stroke(); ctx.restore(); }
    if (ex != null) {
      ctx.save(); ctx.setLineDash([6, 4]); ctx.strokeStyle = ORANGE; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(padL, Y(ex)); ctx.lineTo(w - padR, Y(ex)); ctx.stroke(); ctx.restore();
      const label = "Exit"; ctx.font = "600 11px " + TEXT; const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = ORANGE; ctx.beginPath(); roundRect(ctx, padL + 4, Y(ex) - 20, tw, 17, 8); ctx.fill(); ctx.fillStyle = "#000"; ctx.textAlign = "left"; ctx.fillText(label, padL + 10, Y(ex) - 11.5);
    }
    // time axis: first and last candle
    ctx.fillStyle = T2; ctx.font = "11px " + FONT; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
    const tf = (t) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    ctx.fillText(tf(C[0].t), padL, h - 5); ctx.textAlign = "right"; ctx.fillText(tf(C[C.length - 1].t), w - padR, h - 5);
  };

  window.Charts = { LineChart, CandleChart, money };
})();
