// Tier 2: read business records straight out of Google's embedded page JSON
// (AF_initDataCallback / APP_INITIALIZATION_STATE). More accurate than the DOM
// (exact cid, coords, all fields), no clicking. Best-effort + configurable, with
// a dump() so the index signature can be calibrated against a live page.
// Loaded as a classic script; exposed on globalThis.JSONX.
(function (root) {
  function collectScripts(doc) {
    const out = [];
    const scripts = doc.querySelectorAll("script");
    for (const s of scripts) {
      const t = s.textContent;
      if (t && (t.indexOf("AF_initDataCallback") !== -1 || t.indexOf("APP_INITIALIZATION_STATE") !== -1)) {
        out.push(t);
      }
    }
    return out;
  }

  // Slice a balanced bracket/brace region starting at the open char.
  function sliceBalanced(text, startIdx) {
    const open = text[startIdx];
    const close = open === "[" ? "]" : "}";
    let depth = 0;
    let inStr = false;
    let quote = "";
    for (let i = startIdx; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === "\\") { i++; continue; }
        if (c === quote) inStr = false;
        continue;
      }
      if (c === '"' || c === "'") { inStr = true; quote = c; continue; }
      if (c === open) depth++;
      else if (c === close) { depth--; if (depth === 0) return text.slice(startIdx, i + 1); }
    }
    return null;
  }

  function safeParse(jsonish) {
    try { return JSON.parse(jsonish); } catch {}
    try {
      // Google sometimes emits \xNN / trailing commas; nudge it toward JSON.
      const fixed = jsonish.replace(/\\x([0-9a-fA-F]{2})/g, "\\u00$1").replace(/,\s*([\]}])/g, "$1");
      return JSON.parse(fixed);
    } catch {}
    return null;
  }

  // Pull every `data:[...]` / state array value out of the collected scripts.
  function parseBlobs(texts) {
    const blobs = [];
    for (const text of texts) {
      let idx = 0;
      while (true) {
        const at = text.indexOf("data:", idx);
        if (at === -1) break;
        let b = text.indexOf("[", at);
        if (b === -1) break;
        const sub = sliceBalanced(text, b);
        if (sub) {
          const val = safeParse(sub);
          if (Array.isArray(val)) blobs.push(val);
          idx = b + sub.length;
        } else {
          idx = at + 5;
        }
      }
      const stateAt = text.indexOf("APP_INITIALIZATION_STATE");
      if (stateAt !== -1) {
        const b = text.indexOf("[", stateAt);
        if (b !== -1) {
          const sub = sliceBalanced(text, b);
          const val = sub && safeParse(sub);
          if (Array.isArray(val)) blobs.push(val);
        }
      }
    }
    return blobs;
  }

  function isCidLike(s) {
    return typeof s === "string" && (/^0x[0-9a-f]+:0x[0-9a-f]+$/i.test(s) || /^\d{6,}$/.test(s));
  }

  function coordPair(a) {
    if (!Array.isArray(a) || a.length < 2) return null;
    const lat = Number(a[a.length - 2]);
    const lng = Number(a[a.length - 1]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (lat || lng)) {
      return { latitude: lat, longitude: lng };
    }
    return null;
  }

  function str(v) { return typeof v === "string" ? v : ""; }

  function at(a, ...path) {
    let cur = a;
    for (const p of path) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  // The classic Maps place record: a length-15 array whose [14] holds the fields.
  function mapsPlace(a) {
    if (!Array.isArray(a) || a.length !== 15 || !Array.isArray(a[14])) return null;
    const p = a[14];
    const name = str(p[11]);
    const cid = str(p[10]);
    if (!name || !isCidLike(cid)) return null;
    const coords = coordPair(at(p, 9, 2)) || coordPair(p[9]) || { latitude: null, longitude: null };
    const row = {
      company_name: name,
      cid,
      category: str(at(p, 13, 0)),
      phone: str(at(p, 178, 0, 3)) || str(p[178]),
      website: str(at(p, 7, 0)),
      rating: p[4] && p[4][7] != null ? str(p[4][7]) : "",
      reviews: p[4] && p[4][8] != null ? str(p[4][8]) : "",
      address: str(p[39]) || str(at(p, 2, 0)) || "",
      latitude: coords.latitude,
      longitude: coords.longitude,
      source: "json",
    };
    return row;
  }

  function deepWalk(value, visit, depth) {
    if (depth > 40 || value == null) return;
    if (Array.isArray(value)) {
      visit(value);
      for (const v of value) deepWalk(v, visit, depth + 1);
    } else if (typeof value === "object") {
      for (const k in value) deepWalk(value[k], visit, depth + 1);
    }
  }

  function extractFromTexts(texts) {
    const blobs = parseBlobs(texts);
    const found = new Map();
    for (const blob of blobs) {
      deepWalk(blob, (arr) => {
        const row = mapsPlace(arr);
        if (row) {
          const key = row.cid || row.company_name;
          if (!found.has(key)) found.set(key, row);
        }
      }, 0);
    }
    return { rows: Array.from(found.values()), blobCount: blobs.length };
  }

  function extract(doc) {
    try {
      return extractFromTexts(collectScripts(doc));
    } catch (e) {
      return { rows: [], blobCount: 0, error: String(e) };
    }
  }

  function dump(doc) {
    const texts = collectScripts(doc);
    const blobs = parseBlobs(texts);
    return {
      selectorVersion: (root.SEL && root.SEL.version) || "?",
      scriptCount: texts.length,
      blobCount: blobs.length,
      rows: extractFromTexts(texts).rows.length,
      sample: blobs.slice(0, 3).map((b) => JSON.stringify(b).slice(0, 400)),
      cardCount: root.SELX ? root.SELX.queryAll(doc, root.SEL.cardContainers).length : 0,
    };
  }

  root.JSONX = { extract, dump, _internal: { sliceBalanced, parseBlobs, mapsPlace, deepWalk } };
})(typeof globalThis !== "undefined" ? globalThis : this);
