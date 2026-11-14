/* chart.js - every chart drawn by hand on <canvas>, devicePixelRatio aware. No library.
   Home line chart, Coin candles, Analyst score ring. */
(function () {
  "use strict";
  const C = {green: "#00d35a", red: "#ff453a", orange: "#ff9f0a", blue: "#0a84ff", yellow: "#ffd60a",
    sec: "rgba(235,235,245,0.6)", ter: "rgba(235,235,245,0.3)", sep: "rgba(84,84,88,0.55)", card2: "#2c2c2e"};
  const reduced = () => window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FONT = '-apple-system,"SF Pro Text",BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif';

  function setup(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return {ctx, w, h};
  }

  function anim(ms, step) {
    if (reduced() || ms <= 0) { step(1); return; }
    const t0 = performance.now();
    function f(t) { const p = Math.min(1, (t - t0) / ms); step(p); if (p < 1) requestAnimationFrame(f); }
    requestAnimationFrame(f);
  }

  // ---------------------------------------------------------------- line chart
  const lineState = new WeakMap();
  function line(canvas, points, startValue, marks) {
    const prev = lineState.get(canvas) || {n: 0, marks: new Set()};
    const isNewPoint = prev.n > 0 && points.length > prev.n;
    const newMarks = (marks || []).filter(m => !prev.marks.has(m.ts + m.label));
    lineState.set(canvas, {n: points.length, marks: new Set((marks || []).map(m => m.ts + m.label))});
    const draw = (slide, fade) => drawLine(canvas, points, startValue, marks || [], slide, fade, newMarks);
    if (isNewPoint || newMarks.length) {
      const ms = Math.max(isNewPoint ? 250 : 0, newMarks.length ? 200 : 0);
      anim(ms, p => draw(isNewPoint ? Math.min(1, p * ms / 250) : 1, newMarks.length ? Math.min(1, p * ms / 200) : 1));
    } else draw(1, 1);
  }

  function drawLine(canvas, points, startValue, marks, slide, fade, newMarks) {
    const {ctx, w, h} = setup(canvas);
    const padTop = 44, padBot = 10, padX = 16;
    const vals = points.map(p => p[1]);
    if (startValue != null) vals.push(startValue);
    if (!vals.length) {  // empty: dashed start line only
      ctx.setLineDash([4, 4]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padX, h * 0.62); ctx.lineTo(w - padX, h * 0.62); ctx.stroke(); ctx.setLineDash([]);
      return;
    }
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
    const t0 = points.length ? points[0][0] : 0, t1 = points.length ? points[points.length - 1][0] : 1;
    const X = t => points.length < 2 ? w / 2 : padX + (t - t0) / Math.max(1, t1 - t0) * (w - 2 * padX);
    const Y = v => padTop + (1 - (v - lo) / (hi - lo)) * (h - padTop - padBot);
    // dashed start line
    if (startValue != null) {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = C.ter; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padX, Y(startValue)); ctx.lineTo(w - padX, Y(startValue)); ctx.stroke(); ctx.setLineDash([]);
    }
    if (!points.length) return;
    const pts = points.map(p => [X(p[0]), Y(p[1])]);
    if (pts.length > 1 && slide < 1) {  // new point slides in from the previous one
      const a = pts[pts.length - 2], b = pts[pts.length - 1];
      pts[pts.length - 1] = [a[0] + (b[0] - a[0]) * slide, a[1] + (b[1] - a[1]) * slide];
    }
    // gradient fill under the line
    const g = ctx.createLinearGradient(0, padTop, 0, h);
    g.addColorStop(0, "rgba(0,211,90,0.28)"); g.addColorStop(1, "rgba(0,211,90,0)");
    ctx.beginPath(); ctx.moveTo(pts[0][0], h);
    pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(pts[pts.length - 1][0], h); ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
    const last = pts[pts.length - 1];
    ctx.fillStyle = C.green; ctx.beginPath(); ctx.arc(last[0], last[1], 4, 0, Math.PI * 2); ctx.fill();
    // marks above the line; never overlap: a later mark moves up a row
    ctx.font = `600 12px ${FONT}`; ctx.textBaseline = "middle";
    const rows = [];  // rows[i] = right edge of last label in that row
    const colors = {blue: C.blue, green: C.green, red: C.red};
    const nm = new Set((newMarks || []).map(m => m.ts + m.label));
    marks.filter(m => m.ts >= t0 && m.ts <= t1).sort((a, b) => a.ts - b.ts).forEach(m => {
      const x = X(m.ts);
      let i = 0; while (i < pts.length - 1 && points[i + 1][0] < m.ts) i++;
      const y0 = pts[i][1];
      const tw = ctx.measureText(m.label).width + 12, left = Math.max(2, Math.min(w - tw - 2, x - tw / 2));
      let row = 0; while (rows[row] != null && rows[row] > left - 4) row++;
      rows[row] = left + tw;
      const y = Math.max(10, y0 - 18 - row * 22);
      ctx.globalAlpha = nm.has(m.ts + m.label) ? fade : 1;
      ctx.fillStyle = "#1c1c1e"; roundRect(ctx, left, y - 10, tw, 20, 10); ctx.fill();
      ctx.fillStyle = colors[m.color] || C.sec; ctx.fillText(m.label, left + 6, y + 0.5);
      ctx.strokeStyle = colors[m.color] || C.sec; ctx.globalAlpha *= 0.5; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y + 10); ctx.lineTo(x, y0 - 3); ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------- candles
  function candles(canvas, cs, exitLine, fmt) {
    const {ctx, w, h} = setup(canvas);
    const padX = 16, padTop = 12, volH = h * 0.2, priceH = h - volH - padTop - 8;
    if (!cs || !cs.length) {
      ctx.fillStyle = C.sec; ctx.font = `15px ${FONT}`; ctx.textAlign = "center";
      ctx.fillText("No candles yet", w / 2, h / 2); ctx.textAlign = "left"; return;
    }
    let lo = Math.min(...cs.map(c => c[3])), hi = Math.max(...cs.map(c => c[2]));
    if (exitLine) { lo = Math.min(lo, exitLine); hi = Math.max(hi, exitLine); }
    if (hi - lo < hi * 1e-6) { lo *= 0.99; hi *= 1.01; }
    const sp = hi - lo; lo -= sp * 0.05; hi += sp * 0.05;
    const Y = v => padTop + (1 - (v - lo) / (hi - lo)) * priceH;
    const n = Math.max(cs.length, 30), cw = (w - 2 * padX) / n, bw = Math.max(1.5, cw * 0.62);
    const vmax = Math.max(...cs.map(c => c[5] || 0)) || 1;
    cs.forEach((c, i) => {
      const x = padX + (n - cs.length + i) * cw + cw / 2, up = c[4] >= c[1], col = up ? C.green : C.red;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, Y(c[2])); ctx.lineTo(x, Y(c[3])); ctx.stroke();
      const y1 = Y(Math.max(c[1], c[4])), y2 = Y(Math.min(c[1], c[4]));
      ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
      const vh = (c[5] || 0) / vmax * (volH - 4);
      ctx.globalAlpha = 0.45; ctx.fillRect(x - bw / 2, h - vh, bw, vh); ctx.globalAlpha = 1;
    });
    if (exitLine) {  // orange dashed "Risk trailing stop"
      const y = Y(exitLine);
      ctx.setLineDash([6, 5]); ctx.strokeStyle = C.orange; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(w - padX, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = `600 12px ${FONT}`; ctx.fillStyle = C.orange; ctx.textBaseline = "bottom";
      ctx.fillText("Risk trailing stop" + (fmt ? " · " + fmt(exitLine) : ""), padX + 2, y - 3);
    }
  }

  // ---------------------------------------------------------------- score ring
  const ringState = new WeakMap();
  function ring(canvas, score, greenFrom) {
    const from = ringState.get(canvas) ?? 0;
    ringState.set(canvas, score ?? 0);
    let tries = 0;
    const draw = v => {
      const {ctx, w, h} = setup(canvas);
      const r = Math.min(w, h) / 2 - 8, cx = w / 2, cy = h / 2;
      if (r <= 0) { if (tries++ < 30) requestAnimationFrame(() => draw(v)); return; }   // not laid out yet
      ctx.lineWidth = 12; ctx.lineCap = "round"; ctx.strokeStyle = C.card2;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      if (score != null) {
        ctx.strokeStyle = score >= greenFrom ? C.green : C.yellow;
        ctx.beginPath(); ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, v / 100)); ctx.stroke();
      }
      ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(r * 0.62)}px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(score == null ? "–" : String(Math.round(v)), cx, cy + 1);
    };
    if (score == null) return draw(0);
    anim(600, p => draw(from + (score - from) * (1 - Math.pow(1 - p, 3))));
  }

  window.Charts = {line, candles, ring};
})();
