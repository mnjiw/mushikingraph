// Formats a Date as a "YYYY-MM-DD" string using its LOCAL fields, never
// Date#toISOString() (which converts to UTC first -- in any timezone ahead
// of UTC, a local midnight can print as the previous day, e.g. local
// 2026-06-01 00:00 becomes "2026-05-31" through toISOString()). All date
// boundaries in this app (graph from/to, quick-range buttons) are built
// from and displayed as local calendar dates, so they must round-trip
// through this instead.
function toLocalIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Loads the static data files once (the only network traffic this app makes)
// and exposes read-only helpers for looking up values. All graph/table
// computation after this point happens purely in the browser.
//
// The per-character time series (~136k data points total) is fetched as a
// single compact binary blob (data/series.bin) instead of JSON -- see
// scripts/build_data.py for the exact format. Each character's own slice is
// delta + varint encoded, which shrinks it to about a fifth of the
// equivalent JSON, and skips JSON.parse entirely. Decoding a slice back
// into plain (dateIndex, count) arrays only happens the first time that
// character is touched, and the result is cached, so repeated lookups stay
// as fast as they were with plain arrays.
const App = (() => {
  let dates = null;        // ["2019-06-11", ...] ascending
  let dateTimestamps = null; // parallel array of Date.getTime() values
  let characters = null;   // [{name, name_kana, ..., generation}, ...]

  let seriesBuf = null;       // Uint8Array over the whole series.bin payload
  let blobOffsets = null;     // Uint32Array, length N+1, byte offsets into seriesBuf
  let decodedCache = null;    // per-character lazy-decode cache: {d:[...], c:[...]} | null

  const GENERATION_LABELS = {
    1: "1期生", 2: "2期生", 3: "ゲーマーズ", 4: "SEEDs1期生", 5: "SEEDs2期生",
    6: "2019年1〜3月", 7: "2019年4〜6月", 8: "2019年7〜9月", 9: "2019年10〜12月",
    10: "2020年", 11: "2021年", 12: "2022年", 13: "2023年", 14: "2024年",
    15: "2025年", 16: "2026年",
  };
  const GENDER_LABELS = { 1: "男", 2: "女" };
  const GRADUATION_LABELS = { 1: "在籍中", 2: "卒業" };

  async function load() {
    // "no-cache" = always revalidate with the server (cheap 304 when
    // unchanged), never serve straight from the browser cache -- these
    // files gain a new day's data daily, so a stale cached copy would
    // silently pin the whole app to an old date range.
    const [d, c, seriesBinBuf] = await Promise.all([
      fetch("data/dates.json", { cache: "no-cache" }).then(r => r.json()),
      fetch("data/characters.json", { cache: "no-cache" }).then(r => r.json()),
      fetch("data/series.bin", { cache: "no-cache" }).then(r => r.arrayBuffer()),
    ]);
    dates = d;
    dateTimestamps = d.map(iso => new Date(iso + "T00:00:00").getTime());
    characters = c.map((ch, i) => ({ ...ch, id: i }));

    const view = new DataView(seriesBinBuf);
    const n = view.getUint32(0, true);
    blobOffsets = new Uint32Array(n + 1);
    for (let i = 0; i <= n; i++) blobOffsets[i] = view.getUint32(4 + i * 4, true);
    const payloadStart = 4 + (n + 1) * 4;
    seriesBuf = new Uint8Array(seriesBinBuf, payloadStart);
    decodedCache = new Array(n).fill(null);
  }

  // ---- varint / zigzag decoding (mirrors scripts/build_data.py) ----
  // `pos` is passed/returned as a plain number via a 1-element array trick
  // (readUvarint(buf, posRef) mutates posRef[0]) to avoid allocating an
  // object per call in what can be a ~135k-iteration decode loop.
  // Accumulates with plain number multiplication/addition rather than
  // bitwise shifts, since JS bitwise ops truncate to 32 bits and this
  // needs to stay correct for values into the low billions (safe up to
  // Number.MAX_SAFE_INTEGER either way).
  function readUvarint(buf, posRef) {
    let result = 0, mult = 1, pos = posRef[0];
    for (;;) {
      const byte = buf[pos++];
      result += (byte & 0x7f) * mult;
      if ((byte & 0x80) === 0) break;
      mult *= 128;
    }
    posRef[0] = pos;
    return result;
  }
  function unzigzag(zz) {
    return (zz % 2 !== 0) ? -((zz + 1) / 2) : zz / 2;
  }
  function readSvarint(buf, posRef) {
    return unzigzag(readUvarint(buf, posRef));
  }

  function decodeSeries(charId) {
    if (decodedCache[charId]) return decodedCache[charId];
    const start = blobOffsets[charId], end = blobOffsets[charId + 1];
    const buf = seriesBuf.subarray(start, end);
    const posRef = [0];
    const numPoints = readUvarint(buf, posRef);
    const d = new Array(numPoints);
    let prevD = 0;
    for (let i = 0; i < numPoints; i++) {
      prevD += readUvarint(buf, posRef);
      d[i] = prevD;
    }
    const c = new Array(numPoints);
    let prevC = 0;
    for (let i = 0; i < numPoints; i++) {
      prevC += readSvarint(buf, posRef);
      c[i] = prevC;
    }
    const s = { d, c };
    decodedCache[charId] = s;
    return s;
  }

  // Exact index of an ISO date string in the global `dates` array, or -1.
  function dateIndexExact(iso) {
    let lo = 0, hi = dates.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] === iso) return mid;
      if (dates[mid] < iso) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }

  // Largest global date index whose date <= iso (floor). Returns -1 if
  // iso is before the very first collection date.
  function dateIndexFloor(iso) {
    let lo = 0, hi = dates.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] <= iso) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  // Exact count for a character at a given global date index, or null if
  // that character has no data point there.
  function valueAt(charId, dateIdx) {
    const s = decodeSeries(charId);
    const arr = s.d;
    let lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] === dateIdx) return s.c[mid];
      if (arr[mid] < dateIdx) lo = mid + 1; else hi = mid - 1;
    }
    return null;
  }

  // All (dateIdx, count) points for a character within [fromIdx, toIdx]
  // inclusive, in ascending order.
  function pointsInRange(charId, fromIdx, toIdx) {
    const s = decodeSeries(charId);
    const arr = s.d;
    let lo = 0, hi = arr.length - 1, start = arr.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] >= fromIdx) { start = mid; hi = mid - 1; } else lo = mid + 1;
    }
    const out = [];
    for (let i = start; i < arr.length && arr[i] <= toIdx; i++) {
      out.push([arr[i], s.c[i]]);
    }
    return out;
  }

  // A character's very first data-point date index (their earliest known
  // appearance -- used as a stand-in for "debut date" since we don't have
  // a separate literal debut-date field). Returns null if they have no
  // data at all.
  function firstDateIndex(charId) {
    const arr = decodeSeries(charId).d;
    return arr.length ? arr[0] : null;
  }

  // Smallest global date index whose date >= iso (ceil). Returns dates.length
  // if iso is after the very last collection date.
  function dateIndexCeil(iso) {
    let lo = 0, hi = dates.length - 1, ans = dates.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (dates[mid] >= iso) { ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans;
  }

  return {
    load,
    get dates() { return dates; },
    get dateTimestamps() { return dateTimestamps; },
    get characters() { return characters; },
    GENERATION_LABELS, GENDER_LABELS, GRADUATION_LABELS,
    dateIndexExact, dateIndexFloor, dateIndexCeil, valueAt, pointsInRange, firstDateIndex,
  };
})();
