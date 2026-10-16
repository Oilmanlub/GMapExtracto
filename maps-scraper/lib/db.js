// Tier 3: row storage in IndexedDB (extension origin). Content scripts can't use
// it directly (they'd write to google.com's origin), so background handles writes
// and the app page reads directly. ES module, imported by background.js and app.js.
const DB_NAME = "gme";
const STORE = "rows";
const EXPORTS = "exports";
const digits = (p) => String(p == null ? "" : p).replace(/\D/g, "");

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 3);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      const st = db.objectStoreNames.contains(STORE) ? req.transaction.objectStore(STORE) : db.createObjectStore(STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(EXPORTS)) db.createObjectStore(EXPORTS, { keyPath: "id" });
      // v3: phone identity for duplicate detection at scrape time.
      if (!st.indexNames.contains("phoneKey")) st.createIndex("phoneKey", "phoneKey", { unique: false });
      if (e.oldVersion < 3) {
        st.openCursor().onsuccess = (ev) => {
          const cur = ev.target.result;
          if (!cur) return;
          const v = cur.value;
          if (v.phoneKey == null) { v.phoneKey = digits(v.phone); st.put(v); }
          cur.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function keyOf(row) {
  return row.cid || (row.company_name || "") + "|" + (row.address || "");
}

// Upsert; counts rows that did not already exist. Merges non-empty fields.
// ponytail: phone is treated as unique — a chain sharing one number collapses to one lead.
export async function upsertRows(rows) {
  if (!rows || !rows.length) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    const idx = st.index("phoneKey");
    const seenPhones = new Set();
    let added = 0;

    const put = (key, r) => {
      const req = st.get(key);
      req.onsuccess = () => {
        if (req.result) {
          const merged = { ...req.result };
          for (const k in r) if (r[k] !== "" && r[k] != null) merged[k] = r[k];
          st.put(merged);
        } else {
          st.put({ ...r, key });
          added++;
        }
      };
    };

    for (const raw of rows) {
      const r = { ...raw, phoneKey: digits(raw.phone) };
      const key = keyOf(r);
      if (r.phoneKey.length < 7) { put(key, r); continue; }
      if (seenPhones.has(r.phoneKey)) continue;
      seenPhones.add(r.phoneKey);
      const q = idx.get(r.phoneKey);
      q.onsuccess = () => {
        if (q.result && q.result.key !== key) return; // phone already stored under another lead
        put(key, r);
      };
    }
    tx.oncomplete = () => resolve(added);
    tx.onerror = () => reject(tx.error);
  });
}

// Delete stored rows by their primary key (used by "Remove duplicates").
export async function deleteRows(keys) {
  if (!keys || !keys.length) return 0;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    keys.forEach((k) => st.delete(k));
    tx.oncomplete = () => resolve(keys.length);
    tx.onerror = () => reject(tx.error);
  });
}

export async function allRows() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out = [];
    const tx = db.transaction(STORE, "readonly");
    tx.objectStore(STORE).openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { out.push(cur.value); cur.continue(); }
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearRows() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

// ---- export history (so past files can be re-downloaded any time) ----------
export async function saveExport(rec) {
  const db = await openDB();
  const id = Date.now() + "-" + Math.random().toString(36).slice(2, 7);
  const entry = { id, ts: Date.now(), ...rec };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EXPORTS, "readwrite");
    tx.objectStore(EXPORTS).put(entry);
    tx.oncomplete = () => resolve(entry);
    tx.onerror = () => reject(tx.error);
  });
}

export async function allExports() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const out = [];
    const tx = db.transaction(EXPORTS, "readonly");
    tx.objectStore(EXPORTS).openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { out.push(cur.value); cur.continue(); }
    };
    tx.oncomplete = () => resolve(out.sort((a, b) => b.ts - a.ts));
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteExport(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EXPORTS, "readwrite");
    tx.objectStore(EXPORTS).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearExports() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(EXPORTS, "readwrite");
    tx.objectStore(EXPORTS).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}
