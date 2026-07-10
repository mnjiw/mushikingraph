// Comparison-table renderer for the table tab. If a requested date has no
// collection at all, falls back to the nearest earlier collection date (and
// displays that actual date, per spec). A character with no data point at
// the effective date at all (not yet debuted, already graduated, or in a
// temporary absence) is shown as 0.
const TableView = (() => {
  // Column layout shared by the on-screen table (via colgroup in index.html)
  // and the JPG export (drawn independently on canvas, see below).
  const COLS = [
    { key: "rank", width: 50, align: "right" },
    { key: "name", width: 190, align: "left" },
    { key: "old", width: 110, align: "right" },
    { key: "new", width: 110, align: "right" },
    { key: "delta", width: 120, align: "right" },
  ];

  // Populated by the most recent render(); exportAsJpg() draws from this
  // structured snapshot instead of scraping the live DOM.
  let lastSnapshot = null;

  function render(selectedMap, oldIso, newIso, sortKey) {
    const emptyMsg = document.getElementById("table-empty");
    const tbody = document.querySelector("#result-table tbody");
    const effDatesEl = document.getElementById("table-effective-dates");
    const thOld = document.querySelector("#result-table .th-old");
    const thNew = document.querySelector("#result-table .th-new");

    if (selectedMap.size === 0) {
      tbody.innerHTML = "";
      emptyMsg.style.display = "block";
      effDatesEl.textContent = "";
      lastSnapshot = null;
      return;
    }
    emptyMsg.style.display = "none";

    const oldIdx = App.dateIndexFloor(oldIso);
    const newIdx = App.dateIndexFloor(newIso);
    const oldEff = oldIdx >= 0 ? App.dates[oldIdx] : oldIso;
    const newEff = newIdx >= 0 ? App.dates[newIdx] : newIso;

    thOld.textContent = oldEff;
    thNew.textContent = newEff;

    let note = "";
    if (oldEff !== oldIso) note += `前 ${oldIso} にはデータがないため ${oldEff} の値を使用しています。 `;
    if (newEff !== newIso) note += `後 ${newIso} にはデータがないため ${newEff} の値を使用しています。`;
    effDatesEl.textContent = note;

    const charsById = new Map(App.characters.map(c => [c.id, c]));
    const rows = [];
    selectedMap.forEach((color, charId) => {
      const ch = charsById.get(charId);
      const oldVal = oldIdx >= 0 ? (App.valueAt(charId, oldIdx) ?? 0) : 0;
      const newVal = newIdx >= 0 ? (App.valueAt(charId, newIdx) ?? 0) : 0;
      rows.push({
        id: charId,
        name: ch.name,
        number_debut: ch.number_debut,
        oldVal, newVal,
        delta: newVal - oldVal,
      });
    });

    rows.sort((a, b) => {
      let d;
      if (sortKey === "old") d = b.oldVal - a.oldVal;
      else if (sortKey === "delta") d = b.delta - a.delta;
      else d = b.newVal - a.newVal;
      if (d !== 0) return d;
      return a.number_debut - b.number_debut;
    });

    tbody.innerHTML = "";
    const frag = document.createDocumentFragment();
    rows.forEach((r, i) => {
      const tr = document.createElement("tr");
      const deltaClass = r.delta < 0 ? "delta-neg" : "delta-pos";
      const deltaText = (r.delta > 0 ? "+" : "") + r.delta.toLocaleString();
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${r.oldVal.toLocaleString()}</td>
        <td>${r.newVal.toLocaleString()}</td>
        <td class="${deltaClass}">${deltaText}</td>
      `;
      frag.appendChild(tr);
    });
    tbody.appendChild(frag);

    lastSnapshot = { headerOld: oldEff, headerNew: newEff, rows };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function fitText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const candidate = text.slice(0, mid) + "…";
      if (ctx.measureText(candidate).width <= maxWidth) lo = mid; else hi = mid - 1;
    }
    return text.slice(0, lo) + "…";
  }

  // Draws the last rendered result set directly on a canvas (fillRect /
  // fillText only -- no drawImage of any kind) and downloads it as a JPEG.
  // Deliberately avoids the SVG-foreignObject-to-canvas trick: Chrome
  // marks canvases "tainted" after drawing a foreignObject-based image,
  // which makes toBlob()/toDataURL() throw a SecurityError even though
  // everything involved is same-origin. Plain shape/text drawing has no
  // such restriction.
  function exportAsJpg() {
    if (!lastSnapshot || lastSnapshot.rows.length === 0) {
      alert("表が空です。キャラクターを選択してください。");
      return;
    }
    const { headerOld, headerNew, rows } = lastSnapshot;
    const scale = 2;
    const rowH = 26;
    const headerH = 30;
    const pad = 10;
    const width = COLS.reduce((a, c) => a + c.width, 0);
    const height = headerH + rowH * rows.length;

    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.textBaseline = "middle";

    const headerLabels = { rank: "", name: "", old: headerOld, new: headerNew, delta: "増加数" };

    function colX(colIndex) {
      let x = 0;
      for (let i = 0; i < colIndex; i++) x += COLS[i].width;
      return x;
    }

    function drawCell(colIndex, y, rowHeight, text, color) {
      const col = COLS[colIndex];
      const x0 = colX(colIndex);
      ctx.fillStyle = color || "#111";
      const maxWidth = col.width - pad * 2;
      const clipped = fitText(ctx, text, maxWidth);
      if (col.align === "right") {
        ctx.textAlign = "right";
        ctx.fillText(clipped, x0 + col.width - pad, y + rowHeight / 2);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(clipped, x0 + pad, y + rowHeight / 2);
      }
    }

    // header
    ctx.font = "bold 13px sans-serif";
    COLS.forEach((col, i) => drawCell(i, 0, headerH, headerLabels[col.key], "#111"));
    ctx.strokeStyle = "#ccc";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, headerH);
    ctx.lineTo(width, headerH);
    ctx.stroke();

    // rows
    ctx.font = "13px sans-serif";
    rows.forEach((r, i) => {
      const y = headerH + i * rowH;
      const rank = i + 1;
      if (rank % 2 === 1) {
        ctx.fillStyle = "#f7f7f7";
        ctx.fillRect(0, y, width, rowH);
      }
      const deltaText = (r.delta > 0 ? "+" : "") + r.delta.toLocaleString();
      const deltaColor = r.delta < 0 ? "#d63333" : "#111";
      drawCell(0, y, rowH, String(rank), "#111");
      drawCell(1, y, rowH, r.name, "#111");
      drawCell(2, y, rowH, r.oldVal.toLocaleString(), "#111");
      drawCell(3, y, rowH, r.newVal.toLocaleString(), "#111");
      drawCell(4, y, rowH, deltaText, deltaColor);

      ctx.strokeStyle = "#eee";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + rowH);
      ctx.lineTo(width, y + rowH);
      ctx.stroke();
    });

    canvas.toBlob(blob => {
      if (!blob) { alert("画像の生成に失敗しました。"); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      a.download = `table_${ts}.jpg`;
      a.click();
    }, "image/jpeg", 0.92);
  }

  return { render, exportAsJpg };
})();
