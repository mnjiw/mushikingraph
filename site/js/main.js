(async function () {
  const loadingEl = document.getElementById("loading");
  const appEl = document.getElementById("app");

  await App.load();

  // The date pickers' bounds/defaults come from the loaded data, not from
  // hardcoded HTML attributes -- the data grows every day (the fetch
  // workflow appends a new collection date), so a baked-in max would keep
  // the UI stuck at whatever the latest date was when the HTML was written.
  const firstDate = App.dates[0];
  const lastDate = App.dates[App.dates.length - 1];
  for (const id of ["graph-date-from", "graph-date-to", "table-date-old", "table-date-new"]) {
    const el = document.getElementById(id);
    el.min = firstDate;
    el.max = lastDate;
  }
  document.getElementById("graph-date-from").value = firstDate;
  document.getElementById("graph-date-to").value = lastDate;
  document.getElementById("table-date-old").value = firstDate;
  document.getElementById("table-date-new").value = lastDate;
  document.getElementById("data-range-hint").textContent =
    `データ範囲: ${firstDate} 〜 ${lastDate}`;

  loadingEl.hidden = true;
  appEl.hidden = false;

  // ---- tabs (only the main-panel content swaps; the sidebar is outside
  // both panels and is never touched by this). "select" is a mobile-only
  // pseudo-tab (see CSS): it has no panel of its own, it just tells the
  // mobile layout to show the character selector full-screen instead of
  // the graph/table content, via appEl's data-active-tab attribute --
  // that's also how mobile avoids nesting two independently-scrollable
  // areas (selector list + page) at once, which caused scroll conflicts.
  const tabBtns = document.querySelectorAll(".tab-btn");
  const panels = {
    graph: document.getElementById("tab-graph"),
    table: document.getElementById("tab-table"),
  };
  appEl.dataset.activeTab = "graph";
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      appEl.dataset.activeTab = btn.dataset.tab;
      const target = panels[btn.dataset.tab];
      if (target) {
        Object.values(panels).forEach(p => p.classList.remove("active"));
        target.classList.add("active");
        if (btn.dataset.tab === "graph") {
          Graph.resizeCanvas(true);
        }
      }
    });
  });

  // ---- graph tab ----
  const graphFrom = document.getElementById("graph-date-from");
  const graphTo = document.getElementById("graph-date-to");
  const graphBgColor = document.getElementById("graph-bg-color");
  const canvas = document.getElementById("chart-canvas");
  const tooltip = document.getElementById("chart-tooltip");
  Graph.init(canvas, tooltip);

  function renderGraph() {
    Graph.update(charSelector.getSelected(), graphFrom.value, graphTo.value);
  }
  graphFrom.addEventListener("change", renderGraph);
  graphTo.addEventListener("change", renderGraph);
  graphBgColor.addEventListener("input", () => Graph.setBackgroundColor(graphBgColor.value));

  document.getElementById("graph-fit-debut").addEventListener("click", () => {
    const selected = charSelector.getSelected();
    if (selected.size === 0) return;
    let minIdx = Infinity;
    selected.forEach((color, charId) => {
      const idx = App.firstDateIndex(charId);
      if (idx !== null && idx < minIdx) minIdx = idx;
    });
    if (!isFinite(minIdx)) return;
    graphFrom.value = App.dates[minIdx]; // right edge (graphTo) is left untouched
    renderGraph();
  });
  document.getElementById("graph-export-image").addEventListener("click", () => Graph.exportAsImage());

  // ---- table tab ----
  const tableOld = document.getElementById("table-date-old");
  const tableNew = document.getElementById("table-date-new");
  const tableSortKey = document.getElementById("table-sort-key");

  function renderTable() {
    TableView.render(charSelector.getSelected(), tableOld.value, tableNew.value, tableSortKey.value);
  }
  tableOld.addEventListener("change", renderTable);
  tableNew.addEventListener("change", renderTable);
  tableSortKey.addEventListener("change", renderTable);
  document.getElementById("table-export-jpg").addEventListener("click", () => TableView.exportAsJpg());

  function setOldDateRelativeToNew(shiftFn) {
    const base = new Date(tableNew.value + "T00:00:00");
    if (isNaN(base.getTime())) return;
    shiftFn(base);
    const min = new Date(tableOld.min + "T00:00:00");
    const clamped = base < min ? min : base;
    tableOld.value = toLocalIsoDate(clamped);
    tableOld.dispatchEvent(new Event("change", { bubbles: true }));
  }
  document.getElementById("table-quick-week").addEventListener("click", () => {
    setOldDateRelativeToNew(d => d.setDate(d.getDate() - 7));
  });
  document.getElementById("table-quick-month").addEventListener("click", () => {
    setOldDateRelativeToNew(d => d.setMonth(d.getMonth() - 1));
  });

  // ---- admin notice popover ----
  const noticeBtn = document.getElementById("notice-btn");
  const noticePopover = document.getElementById("notice-popover");
  noticeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    noticePopover.hidden = !noticePopover.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!noticePopover.hidden && !noticePopover.contains(e.target)) {
      noticePopover.hidden = true;
    }
  });

  // ---- shared character selector (single instance, feeds both views) ----
  const charSelector = createSelector(document.getElementById("char-selector"), () => {
    renderGraph();
    renderTable();
  });

  // initial paint
  renderGraph();
  renderTable();
})();
