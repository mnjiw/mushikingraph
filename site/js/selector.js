// Character-selection panel: search + sort + filter + checkbox list with a
// per-character color swatch. main.js mounts exactly one instance, shared
// by both the graph and table views (it lives outside both tab-panels, so
// switching tabs never touches its scroll position, search text or
// filters). SharedSelection still exists as its own small module in case a
// second instance is ever added later -- any instance's selection changes
// are visible to every other instance automatically.
const COLOR_PALETTE = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990",
  "#dcbeff", "#9A6324", "#800000", "#aaffc3", "#808000",
  "#000075", "#a9a9a9", "#000000",
];

// Shared across every createSelector() instance on the page.
const SharedSelection = (() => {
  const map = new Map(); // charId -> color
  const listeners = new Set();
  function subscribe(fn) { listeners.add(fn); }
  function notify() { listeners.forEach(fn => fn(map)); }
  return { map, subscribe, notify };
})();

let selectorInstanceCounter = 0;

function createSelector(containerEl, onChange) {
  const instanceId = "sel" + (selectorInstanceCounter++);
  const tpl = document.getElementById("tpl-selector");
  containerEl.innerHTML = "";
  containerEl.appendChild(tpl.content.cloneNode(true));

  const searchEl = containerEl.querySelector(".sel-search");
  const sortEl = containerEl.querySelector(".sel-sort");
  const genGroup = containerEl.querySelector(".filter-generation");
  const genderGroup = containerEl.querySelector(".filter-gender");
  const gradGroup = containerEl.querySelector(".filter-graduation");
  const clearFilterBtn = containerEl.querySelector(".filter-clear");
  const selectAllBtn = containerEl.querySelector(".sel-select-all");
  const deselectAllBtn = containerEl.querySelector(".sel-deselect-all");
  const countEl = containerEl.querySelector(".sel-count");
  const listEl = containerEl.querySelector(".sel-list");

  const selected = SharedSelection.map; // shared reference, not a private copy
  let paletteCursor = 0;

  function buildCheckboxGroup(groupEl, labelMap, filterKey, defaultChecked) {
    Object.keys(labelMap).forEach(k => {
      const id = instanceId + "-" + filterKey + "-" + k;
      const wrap = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = k;
      cb.id = id;
      if (defaultChecked && defaultChecked.includes(k)) cb.checked = true;
      cb.addEventListener("change", renderList);
      wrap.appendChild(cb);
      wrap.appendChild(document.createTextNode(labelMap[k]));
      groupEl.appendChild(wrap);
    });
  }
  buildCheckboxGroup(genGroup, App.GENERATION_LABELS, "generation");
  buildCheckboxGroup(genderGroup, App.GENDER_LABELS, "gender");
  // Default view: only currently-active (non-graduated) characters (1 = 在籍中).
  buildCheckboxGroup(gradGroup, App.GRADUATION_LABELS, "graduation", ["1"]);

  clearFilterBtn.addEventListener("click", () => {
    containerEl.querySelectorAll(".filter-options input[type=checkbox]")
      .forEach(cb => cb.checked = false);
    renderList();
  });

  deselectAllBtn.addEventListener("click", () => {
    selected.clear();
    SharedSelection.notify();
  });

  selectAllBtn.addEventListener("click", () => {
    filteredList().forEach(ch => {
      if (!selected.has(ch.id)) selected.set(ch.id, ch.color || nextColor());
    });
    SharedSelection.notify();
  });

  function checkedValues(groupEl) {
    return Array.from(groupEl.querySelectorAll("input:checked")).map(cb => cb.value);
  }

  function matchesFilters(ch) {
    const gens = checkedValues(genGroup);
    const genders = checkedValues(genderGroup);
    const grads = checkedValues(gradGroup);
    if (gens.length && !gens.includes(String(ch.generation))) return false;
    if (genders.length && !genders.includes(String(ch.gender))) return false;
    if (grads.length && !grads.includes(String(ch.graduation))) return false;
    return true;
  }

  function matchesSearch(ch, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return (ch.name && ch.name.toLowerCase().includes(q)) ||
           (ch.name_kana && ch.name_kana.toLowerCase().includes(q)) ||
           (ch.name_kana_sub && ch.name_kana_sub.toLowerCase().includes(q));
  }

  function filteredList() {
    const q = searchEl.value.trim();
    return App.characters.filter(ch => matchesFilters(ch) && matchesSearch(ch, q));
  }

  function sortList(list) {
    const key = sortEl.value;
    const copy = list.slice();
    if (key === "number_debut") {
      copy.sort((a, b) => a.number_debut - b.number_debut);
    } else if (key === "number_subscribe") {
      copy.sort((a, b) => b.number_subscribe - a.number_subscribe);
    } else if (key === "number_kana") {
      copy.sort((a, b) => a.number_kana - b.number_kana);
    }
    return copy;
  }

  function nextColor() {
    const c = COLOR_PALETTE[paletteCursor % COLOR_PALETTE.length];
    paletteCursor++;
    return c;
  }

  function toggle(charId) {
    if (selected.has(charId)) {
      selected.delete(charId);
    } else {
      const ch = App.characters[charId];
      selected.set(charId, (ch && ch.color) || nextColor());
    }
    SharedSelection.notify();
  }

  function setColor(charId, color) {
    if (selected.has(charId)) {
      selected.set(charId, color);
      SharedSelection.notify();
    }
  }

  function renderList() {
    let list = sortList(filteredList());

    countEl.textContent = `${App.characters.length}人中 ${list.length}人表示 / ${selected.size}人選択中`;

    listEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    list.forEach(ch => {
      const row = document.createElement("div");
      row.className = "sel-item" + (selected.has(ch.id) ? " checked" : "");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(ch.id);
      cb.addEventListener("change", () => toggle(ch.id));

      const nameEl = document.createElement("span");
      nameEl.className = "sel-name" + (ch.graduation === 2 ? " graduated" : "");
      nameEl.textContent = ch.name;
      nameEl.title = ch.name;
      nameEl.addEventListener("click", () => toggle(ch.id));

      const curColor = selected.get(ch.id) || ch.color || "#888888";

      // The native color input IS the swatch -- clicking it opens the
      // browser's own color dialog directly, no custom popover framing.
      // It commits on "change" (fired once, when that dialog closes),
      // never on "input" (fired continuously while dragging inside it) --
      // "input" was what used to trigger a full list re-render mid-pick
      // and destroy the still-open native dialog after a single click.
      const colorEl = document.createElement("input");
      colorEl.type = "color";
      colorEl.className = "color-swatch";
      colorEl.value = curColor;
      colorEl.title = "線の色を変更";
      colorEl.addEventListener("change", () => setColor(ch.id, colorEl.value));

      const resetBtn = document.createElement("button");
      resetBtn.type = "button";
      resetBtn.className = "color-reset";
      resetBtn.textContent = "↺";
      resetBtn.title = "既定の色に戻す";
      resetBtn.addEventListener("click", () => {
        const def = ch.color || "#888888";
        colorEl.value = def;
        setColor(ch.id, def);
      });

      row.appendChild(cb);
      row.appendChild(nameEl);
      row.appendChild(colorEl);
      row.appendChild(resetBtn);
      frag.appendChild(row);
    });
    listEl.appendChild(frag);
  }

  searchEl.addEventListener("input", renderList);
  sortEl.addEventListener("change", renderList);

  // Re-render (and notify the owning tab's view) whenever ANY instance
  // changes the shared selection.
  SharedSelection.subscribe(renderList);
  SharedSelection.subscribe(onChange);

  renderList();

  return {
    getSelected: () => selected,
  };
}
