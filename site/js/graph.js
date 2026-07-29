// Canvas line-chart renderer for the graph tab. Only known data points are
// plotted; consecutive known points are connected directly with a line, so
// gaps in a character's data (temporary absence, or simply no crawl that
// day) are bridged visually without drawing anything AT the missing dates.
// Characters that debut/graduate mid-range simply have no points outside
// their actual data span, so the line naturally starts/stops there.
const Graph = (() => {
  let canvas, ctx, tooltipEl, containerEl;
  let selectedMap = new Map();
  let fromDate = null, toDate = null;
  let dpr = window.devicePixelRatio || 1;
  let plotArea = { x: 0, y: 0, w: 0, h: 0 };
  let curTMin = 0, curTMax = 1;
  let hoverSeries = [];
  let bgColor = "#ffffff";

  function init(canvasEl, tooltipElement) {
    canvas = canvasEl;
    containerEl = canvas.parentElement;
    ctx = canvas.getContext("2d");
    tooltipEl = tooltipElement;
    window.addEventListener("resize", () => resizeCanvas(true));
    canvas.addEventListener("mousemove", onHover);
    canvas.addEventListener("mouseleave", () => { tooltipEl.hidden = true; });
    resizeCanvas(false);
  }

  function resizeCanvas(rerender) {
    const rect = containerEl.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    if (rerender) render();
  }

  function update(selectedMapIn, fromIso, toIso) {
    selectedMap = selectedMapIn;
    fromDate = new Date(fromIso + "T00:00:00");
    toDate = new Date(toIso + "T00:00:00");
    resizeCanvas(false);
    render();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function setBackgroundColor(color) {
    bgColor = color;
    render();
  }

  function render() {
    const emptyMsg = document.getElementById("graph-empty");
    if (!ctx || !fromDate || !toDate) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (selectedMap.size === 0) {
      if (emptyMsg) emptyMsg.style.display = "block";
      hoverSeries = [];
      return;
    }
    if (emptyMsg) emptyMsg.style.display = "none";

    const fromIso = toLocalIsoDate(fromDate);
    const toIso = toLocalIsoDate(toDate);
    const fromIdx = App.dateIndexCeil(fromIso);
    const toIdx = App.dateIndexFloor(toIso);

    const charsById = new Map(App.characters.map(c => [c.id, c]));
    let vMin = Infinity, vMax = -Infinity;
    const seriesList = [];
    if (fromIdx <= toIdx) {
      selectedMap.forEach((color, charId) => {
        const pts = App.pointsInRange(charId, fromIdx, toIdx);
        const points = pts.map(([di, c]) => [App.dateTimestamps[di], c]);
        points.forEach(([, c]) => { if (c < vMin) vMin = c; if (c > vMax) vMax = c; });
        seriesList.push({ id: charId, color, name: charsById.get(charId).name, points });
      });
    }
    hoverSeries = seriesList;

    if (!isFinite(vMin)) { vMin = 0; vMax = 1; }
    if (vMin === vMax) { vMin = Math.max(0, vMin - 1); vMax = vMax + 1; }
    const pad = (vMax - vMin) * 0.08;
    const yMin = Math.max(0, vMin - pad);
    const yMax = vMax + pad;

    const W = canvas.width, H = canvas.height;
    const marginL = 78 * dpr, marginR = 20 * dpr, marginT = 16 * dpr, marginB = 34 * dpr;
    plotArea = { x: marginL, y: marginT, w: Math.max(1, W - marginL - marginR), h: Math.max(1, H - marginT - marginB) };

    curTMin = fromDate.getTime();
    curTMax = toDate.getTime();
    if (curTMax <= curTMin) curTMax = curTMin + 1;

    const xOf = ts => plotArea.x + (ts - curTMin) / (curTMax - curTMin) * plotArea.w;
    const yOf = v => plotArea.y + (1 - (v - yMin) / (yMax - yMin)) * plotArea.h;

    ctx.font = `${12 * dpr}px sans-serif`;

    // y gridlines + labels — registrant counts are always recorded in
    // increments of 1000 (last 3 digits are 0), so snap tick values to a
    // "nice" step that is itself a multiple of 1000 rather than dividing
    // the range into equal but arbitrary fractions.
    const yTicksTarget = 5;
    const rawStep = (yMax - yMin) / yTicksTarget;
    const stepPow = Math.pow(10, Math.floor(Math.log10(Math.max(rawStep, 1))));
    const stepFrac = rawStep / stepPow;
    const niceFrac = stepFrac <= 1 ? 1 : stepFrac <= 2 ? 2 : stepFrac <= 5 ? 5 : 10;
    const yStep = Math.max(1000, Math.ceil(niceFrac * stepPow / 1000) * 1000);
    let tickStart = Math.ceil(yMin / yStep) * yStep;
    if (tickStart > yMax) tickStart = Math.round(yMin / yStep) * yStep;
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    for (let v = tickStart; v <= yMax + yStep * 0.001; v += yStep) {
      const y = yOf(v);
      ctx.strokeStyle = "#eee";
      ctx.beginPath(); ctx.moveTo(plotArea.x, y); ctx.lineTo(plotArea.x + plotArea.w, y); ctx.stroke();
      ctx.fillStyle = "#555";
      ctx.fillText(Math.round(v).toLocaleString(), plotArea.x - 8 * dpr, y);
    }
    // x ticks + labels
    const xTicks = 6;
    ctx.textAlign = "center"; ctx.textBaseline = "top";
    for (let i = 0; i <= xTicks; i++) {
      const ts = curTMin + (curTMax - curTMin) * i / xTicks;
      const x = xOf(ts);
      ctx.strokeStyle = "#eee";
      ctx.beginPath(); ctx.moveTo(x, plotArea.y); ctx.lineTo(x, plotArea.y + plotArea.h); ctx.stroke();
      ctx.fillStyle = "#555";
      ctx.fillText(fmtDate(ts), x, plotArea.y + plotArea.h + 6 * dpr);
    }
    // axes
    ctx.strokeStyle = "#999"; ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(plotArea.x, plotArea.y);
    ctx.lineTo(plotArea.x, plotArea.y + plotArea.h);
    ctx.lineTo(plotArea.x + plotArea.w, plotArea.y + plotArea.h);
    ctx.stroke();

    // series lines (connect known points directly -> bridges gaps visually)
    seriesList.forEach(s => {
      if (s.points.length === 0) return;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      s.points.forEach(([ts, c], i) => {
        const x = xOf(ts), y = yOf(c);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = s.color;
      s.points.forEach(([ts, c]) => {
        const x = xOf(ts), y = yOf(c);
        ctx.beginPath(); ctx.arc(x, y, 1.8 * dpr, 0, Math.PI * 2); ctx.fill();
      });
    });
  }

  function onHover(evt) {
    if (!hoverSeries.length) { tooltipEl.hidden = true; return; }
    const rect = canvas.getBoundingClientRect();
    const mx = (evt.clientX - rect.left) * dpr;
    if (mx < plotArea.x || mx > plotArea.x + plotArea.w) { tooltipEl.hidden = true; return; }
    const targetTs = curTMin + (mx - plotArea.x) / plotArea.w * (curTMax - curTMin);

    const lines = [];
    hoverSeries.forEach(s => {
      if (!s.points.length) return;
      let best = s.points[0], bestDist = Math.abs(s.points[0][0] - targetTs);
      for (const p of s.points) {
        const dist = Math.abs(p[0] - targetTs);
        if (dist < bestDist) { best = p; bestDist = dist; }
      }
      lines.push({ name: s.name, color: s.color, ts: best[0], count: best[1], dist: bestDist });
    });
    if (!lines.length) { tooltipEl.hidden = true; return; }
    // Header date comes from whichever line is nearest the cursor; the
    // list itself is ordered by registrant count at that date (highest first).
    const nearest = lines.reduce((a, b) => (a.dist <= b.dist ? a : b));
    lines.sort((a, b) => b.count - a.count);

    tooltipEl.innerHTML = `<div>${fmtDate(nearest.ts)}</div>` + lines.map(l =>
      `<div><span style="color:${l.color}">●</span> ${escapeHtml(l.name)}: ${l.count.toLocaleString()}</div>`
    ).join("");
    tooltipEl.hidden = false;
    const wrapRect = containerEl.getBoundingClientRect();
    tooltipEl.style.left = (evt.clientX - wrapRect.left) + "px";
    tooltipEl.style.top = (evt.clientY - wrapRect.top) + "px";
  }

  // The canvas here is drawn entirely with shape/text primitives (never an
  // <img>/foreignObject), so, unlike the table's old export attempt, this
  // never taints -- toBlob() just works.
  function exportAsImage() {
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) { alert("画像の生成に失敗しました。"); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.download = `graph_${ts}.jpg`;
      a.click();
    }, "image/jpeg", 0.92);
  }

  return { init, update, resizeCanvas, setBackgroundColor, exportAsImage };
})();
