// Google Map Extractor - control panel (app window). ES module.
import { allRows, clearRows, saveExport, allExports, deleteExport, clearExports, deleteRows } from "./lib/db.js";

const KEY = "ms_state";
const FORM_KEY = "ms_form";
const PRESET_KEY = "ms_presets";
const RUNS_KEY = "ms_runs";
const RENDER_LIMIT = 500;
const MP = globalThis.MP;
const LIC = globalThis.LIC;
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14"/></svg>';

const CSV_COLS = [
  "company_name", "tier", "action", "category", "address", "city", "state", "pincode", "country",
  "phone", "website", "emails", "rating", "reviews", "latitude", "longitude",
  "cid", "plus_code", "keyword", "location", "url", "source", "scraped_at",
];

const $ = (id) => document.getElementById(id);
const lines = (v) => String(v || "").split("\n").map((x) => x.trim()).filter(Boolean);
const getState = async () => (await chrome.storage.local.get(KEY))[KEY] || null;

let ROWS = [];
let sortKey = "company_name";
let sortDir = "asc";

// ---- licensing -------------------------------------------------------------
let LIC_ST = { licensed: false, state: "free", lic: null, freeLimit: 50, configured: true };
let gateAutoShown = false;
const LIC_MSG = {
  empty: "Enter your license key.",
  bad_key: "That key wasn't found. Check it and try again.",
  expired: "This license has expired. Renew to continue.",
  revoked: "This license has been revoked.",
  seat_limit: "This key is already active on too many devices.",
  not_configured: "Licensing isn't configured in this build — running on the free tier.",
  network: "Couldn't reach the license server. Check your connection and retry.",
  invalid: "That key is not valid.",
  http_404: "Account or key not found — check the account id in the license config.",
  http_401: "The license server rejected the request.",
};
const capped = () => !LIC_ST.licensed && ROWS.length >= LIC_ST.freeLimit;

function renderLicense() {
  const chip = $("licChip");
  const info = $("licInfo");
  const hdrChip = $("hdrLicChip");
  const hdrBtn = $("hdrLicBtn");
  const dChip = $("dataLicChip");
  const dInfo = $("dataLicInfo");
  const dOpen = $("dataLicOpen");
  const dBuy = $("dataLicBuy");
  const dDeact = $("dataLicDeactivate");
  if (LIC_ST.licensed) {
    const exp = LIC_ST.lic && LIC_ST.lic.expiry ? new Date(LIC_ST.lic.expiry).toLocaleDateString() : "perpetual";
    const txt = LIC_ST.state === "offline" ? "Licensed (offline)" : "Licensed";
    if (chip) { chip.textContent = txt; chip.className = "chip ok"; }
    if (hdrChip) { hdrChip.textContent = txt; hdrChip.className = "chip ok"; }
    if (dChip) { dChip.textContent = txt; dChip.className = "chip ok"; }
    if (info) info.textContent = `Plan: ${(LIC_ST.lic && LIC_ST.lic.plan) || "Licensed"} · expires ${exp}`;
    if (dInfo) dInfo.textContent = `Plan: ${(LIC_ST.lic && LIC_ST.lic.plan) || "Licensed"} · expires ${exp}`;
    if (hdrBtn) { hdrBtn.textContent = "Deactivate"; hdrBtn.onclick = () => { if ($("licDeactivate")) $("licDeactivate").click(); }; }
    if (dOpen) dOpen.hidden = true;
    if (dDeact) dDeact.hidden = false;
    if ($("licDeactivate")) $("licDeactivate").hidden = false;
  } else {
    const txt = "Free";
    if (chip) { chip.textContent = txt; chip.className = "chip"; }
    if (hdrChip) { hdrChip.textContent = txt; hdrChip.className = "chip"; }
    if (dChip) { dChip.textContent = txt; dChip.className = "chip"; }
    if (info) info.textContent = `Free tier — up to ${LIC_ST.freeLimit} rows (${ROWS.length} used).`;
    if (dInfo) dInfo.textContent = `Free — up to ${LIC_ST.freeLimit} rows. Export requires license.`;
    if (hdrBtn) { hdrBtn.textContent = "Activate"; hdrBtn.onclick = () => openGate(""); }
    if (dOpen) dOpen.hidden = false;
    if (dDeact) dDeact.hidden = true;
    if ($("licDeactivate")) $("licDeactivate").hidden = true;
  }
  const buy = LIC.CONFIG.buyUrl;
  const buyable = buy && !/REPLACE_WITH/.test(buy);
  for (const id of ["licBuy", "licBuy2", "dataLicBuy"]) {
    const a = $(id);
    if (a) { if (buyable) { a.href = buy; a.hidden = false; } else a.hidden = true; }
  }
}
async function refreshLicense() {
  LIC_ST = await LIC.status();
  renderLicense();
  const csvB = $("csv"), xlsB = $("excel"), jsonB = $("json");
  if (csvB) csvB.disabled = !LIC_ST.licensed;
  if (xlsB) xlsB.disabled = !LIC_ST.licensed;
  if (jsonB) jsonB.disabled = !LIC_ST.licensed;
}
function openGate(msg, isErr) {
  $("licenseMsg").textContent = msg || "";
  $("licenseMsg").className = "gate-msg" + (isErr ? " err" : "");
  $("licenseGate").hidden = false;
  $("licKey").focus();
}
function closeGate() { $("licenseGate").hidden = true; }

async function doActivate(btn) {
  const key = $("licKey").value.trim();
  if (!key) return openGate(LIC_MSG.empty, true);
  btn.disabled = true;
  $("licenseMsg").textContent = "Checking…";
  $("licenseMsg").className = "gate-msg";
  const res = await LIC.activate(key);
  btn.disabled = false;
  if (res.ok) {
    await refreshLicense();
    closeGate();
    render();
    toast("License activated. Limits removed.");
  } else {
    const base = LIC_MSG[res.code] || LIC_MSG.invalid;
    const extra = res.detail || res.raw || (res.status ? "HTTP " + res.status : "");
    if (res.status === 400) return openGate("The key wasn't sent. Reload the extension (chrome://extensions → ↻) and reopen this window, then retry.", true);
    const hint = res.status === 404 ? " — check the account id in lib/license.js" : "";
    openGate((extra ? base + " (" + extra + ")" : base) + hint, true);
  }
}

// ---- lead segregation (Oilman India) ---------------------------------------
let SEG_ON = false;
let lastSegCount = -1;
const TIER_OVERRIDE = new Map(); // key -> tier, filled by the AI fallback

const keyOfRow = (r) => r.cid || (r.company_name || "") + "|" + (r.address || "");
const listsOpts = () => ({
  tier1: lines($("tier1").value),
  tier2: lines($("tier2").value),
  tier3: lines($("tier3").value),
});
const compiledLists = () => SEG.compile(listsOpts());
function tierOfRow(r, c) {
  const k = keyOfRow(r);
  if (TIER_OVERRIDE.has(k)) return TIER_OVERRIDE.get(k);
  if (r.tier) return r.tier;
  return SEG.tierOf(r, c);
}
function exportRow(r, c) {
  if (!SEG_ON) return r;
  const tier = tierOfRow(r, c);
  return { ...r, tier, action: SEG.action(tier, r.phone) };
}
function badge(tier) {
  return tier ? `<span class="badge t${tier}">${tier}</span>` : "";
}
function updateSummary() {
  const el = $("segSummary");
  if (!SEG_ON) { el.hidden = true; return; }
  const c = compiledLists();
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const r of ROWS) counts[tierOfRow(r, c)]++;
  const top = ROWS
    .filter((r) => tierOfRow(r, c) === 1 && SEG.usable(r.phone))
    .sort((a, b) => SEG.priority({ phone: a.phone, rating: a.rating, reviews: a.reviews }, { phone: b.phone, rating: b.rating, reviews: b.reviews }))
    .slice(0, 10);
  const list = top.length
    ? top.map((r, i) => `<li><b>${i + 1}.</b> ${escHtml(r.company_name)} <span class="muted">${escHtml(r.phone)} · ★${escHtml(r.rating || "-")}</span></li>`).join("")
    : `<li class="muted">No Tier 1 rows with a phone.</li>`;
  el.hidden = false;
  el.innerHTML =
    `<div class="tier-counts">` +
    `<span class="badge t1">1</span> ${counts[1]} &nbsp; ` +
    `<span class="badge t2">2</span> ${counts[2]} &nbsp; ` +
    `<span class="badge t3">3</span> ${counts[3]}</div>` +
    `<div class="top10-title">Top 10 priority calls (Tier 1, by rating)</div><ol>${list}</ol>`;
}

function esc(v) {
  v = v == null ? "" : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function escHtml(v) {
  return String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function toCSV(rows) {
  return [CSV_COLS.join(",")]
    .concat(rows.map((r) => CSV_COLS.map((c) => esc(r[c])).join(",")))
    .join("\n");
}
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2800);
}
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

// ---- form persistence ------------------------------------------------------
function readForm() {
  return {
    source: $("source").value,
    apiKey: $("apiKey").value,
    keywords: $("keywords").value,
    locations: $("locations").value,
    regexList: $("regexList").value,
    enrichMode: $("enrichMode").value,
    maxEmailTime: Math.max(1, Number($("maxEmailTime").value) || 8),
    delaySeconds: Math.max(0, Number($("delaySeconds").value) || 0),
    maxPages: Math.max(0, Number($("maxPages").value) || 0),
    repeatMinutes: Math.max(0, Number($("repeatMinutes").value) || 0),
    fastMode: $("fastMode").checked,
    deepDetails: $("deepDetails").checked,
    paceProfile: $("paceProfile").value,
    motion: $("motion").checked,
    noDupePhones: $("noDupePhones").checked,
    tier1: $("tier1").value,
    tier2: $("tier2").value,
    tier3: $("tier3").value,
    aiOn: $("aiOn").checked,
    aiBase: $("aiBase").value,
    aiKey: $("aiKey").value,
    aiModel: $("aiModel").value,
    segAuto: $("segAuto").checked,
    segOn: SEG_ON,
  };
}
function writeForm(f) {
  if (!f) return;
  $("source").value = f.source || "search";
  $("apiKey").value = f.apiKey || "";
  $("keywords").value = f.keywords || "";
  $("locations").value = f.locations || "";
  $("regexList").value = f.regexList || "";
  $("enrichMode").value = f.enrichMode || "after";
  $("maxEmailTime").value = f.maxEmailTime ?? 8;
  $("delaySeconds").value = f.delaySeconds ?? 1.5;
  $("maxPages").value = f.maxPages ?? 0;
  $("repeatMinutes").value = f.repeatMinutes ?? 0;
  $("fastMode").checked = !!f.fastMode;
  $("deepDetails").checked = !!f.deepDetails;
  $("paceProfile").value = f.paceProfile || "balanced";
  $("motion").checked = f.motion !== false;
  $("noDupePhones").checked = !!f.noDupePhones;
  $("tier1").value = f.tier1 ?? SEG.DEFAULT_TIER1.join("\n");
  $("tier2").value = f.tier2 ?? SEG.DEFAULT_TIER2.join("\n");
  $("tier3").value = f.tier3 ?? SEG.DEFAULT_TIER3.join("\n");
  $("aiOn").checked = !!f.aiOn;
  $("aiBase").value = f.aiBase ?? "";
  $("aiKey").value = f.aiKey ?? "";
  $("aiModel").value = f.aiModel ?? "";
  $("segAuto").checked = !!f.segAuto;
  SEG_ON = !!f.segOn;
  toggleApiKey();
}
function saveForm() {
  chrome.storage.local.set({ [FORM_KEY]: readForm() });
}
function settings() {
  const f = readForm();
  return {
    delayMs: f.delaySeconds * 1000,
    maxPages: f.maxPages,
    deepDetails: f.deepDetails,
    extractEmail: f.enrichMode !== "off",
    enrichMode: f.enrichMode,
    fastMode: f.fastMode,
    maxEmailTime: f.maxEmailTime,
    blacklist: lines(f.regexList),
    paceProfile: f.paceProfile,
    motion: f.motion,
  };
}
function toggleApiKey() {
  $("apiKey").hidden = $("source").value !== "places";
}

// ---- presets ---------------------------------------------------------------
async function loadPresets() {
  const all = (await chrome.storage.local.get(PRESET_KEY))[PRESET_KEY] || {};
  const sel = $("presetList");
  sel.innerHTML = Object.keys(all).map((k) => `<option>${escHtml(k)}</option>`).join("");
}
async function presetSave() {
  const name = $("presetName").value.trim();
  if (!name) return toast("Name the preset first.");
  const all = (await chrome.storage.local.get(PRESET_KEY))[PRESET_KEY] || {};
  all[name] = readForm();
  await chrome.storage.local.set({ [PRESET_KEY]: all });
  await loadPresets();
  $("presetList").value = name;
  toast("Preset saved.");
}
async function presetLoad() {
  const name = $("presetList").value;
  if (!name) return;
  const all = (await chrome.storage.local.get(PRESET_KEY))[PRESET_KEY] || {};
  writeForm(all[name]);
  saveForm();
  toast("Preset loaded.");
}
async function presetDel() {
  const name = $("presetList").value;
  const all = (await chrome.storage.local.get(PRESET_KEY))[PRESET_KEY] || {};
  delete all[name];
  await chrome.storage.local.set({ [PRESET_KEY]: all });
  await loadPresets();
}

// ---- rendering -------------------------------------------------------------
function filtered() {
  const text = $("filter").value.trim().toLowerCase();
  const onlyEmail = $("onlyEmail").checked;
  const tierFilter = $("tierFilter").value;
  let rows = ROWS;
  if (onlyEmail) rows = rows.filter((r) => r.emails);
  if (text) rows = rows.filter((r) => CSV_COLS.some((c) => String(r[c] || "").toLowerCase().includes(text)));

  const c = compiledLists();
  let dec = rows.map((r) => ({ r, t: SEG_ON ? tierOfRow(r, c) : 0, a: SEG_ON ? SEG.action(tierOfRow(r, c), r.phone) : "" }));
  if (SEG_ON && tierFilter) dec = dec.filter((d) => String(d.t) === tierFilter);

  const dir = sortDir === "asc" ? 1 : -1;
  const val = (d) => {
    if (sortKey === "tier") return d.t;
    if (sortKey === "action") return d.a;
    return d.r[sortKey];
  };
  dec.sort((x, y) => String(val(x) || "").localeCompare(String(val(y) || ""), undefined, { numeric: true }) * dir);
  let out = dec.map((d) => d.r);
  // First row per phone survives (so sort by rating first for the "best" copy).
  if ($("noDupePhones").checked) out = MP.dedupeByPhone(out).keep;
  return out;
}

function renderTable() {
  const rows = filtered();
  const shown = rows.slice(0, RENDER_LIMIT);
  const c = compiledLists();
  const keys = ["company_name", "tier", "action", "category", "phone", "website", "emails", "rating", "reviews", "address", "city", "state", "cid", "url"];
  $("resultsBody").innerHTML = shown.map((r, i) => {
    const tier = SEG_ON ? tierOfRow(r, c) : 0;
    const cells = keys.map((k) => {
      if (k === "tier") return `<td class="c">${SEG_ON ? badge(tier) : ""}</td>`;
      if (k === "action") return `<td>${SEG_ON ? escHtml(SEG.action(tier, r.phone)) : ""}</td>`;
      if (k === "website" || k === "url") {
        const href = r[k];
        return `<td>${href ? `<a href="${escHtml(href)}" target="_blank" rel="noreferrer">${escHtml(String(href).slice(0, 40))}</a>` : ""}</td>`;
      }
      const cls = k === "rating" || k === "reviews" ? "num" : k === "phone" || k === "cid" ? "mono" : "";
      return `<td class="${cls}" title="${escHtml(r[k])}">${escHtml(r[k])}</td>`;
    }).join("");
    return `<tr><td>${i + 1}</td>${cells}</tr>`;
  }).join("");
  $("shownCount").textContent = rows.length > RENDER_LIMIT ? `showing ${RENDER_LIMIT} of ${rows.length}` : `${rows.length} rows`;
  document.querySelectorAll("thead th[data-key]").forEach((th) => {
    const on = th.dataset.key === sortKey;
    th.classList.toggle("sorted-asc", on && sortDir === "asc");
    th.classList.toggle("sorted-desc", on && sortDir === "desc");
    if (on) th.setAttribute("aria-sort", sortDir === "asc" ? "ascending" : "descending");
    else th.removeAttribute("aria-sort");
  });
}

async function render() {
  const s = await getState();
  const running = !!(s && s.running);
  const paused = !!(s && s.paused);
  const total = (s && s.totalTasks) || 0;
  const remaining = s && s.tasks ? s.tasks.length : 0;
  const done = Math.max(0, total - remaining);

  $("start").disabled = running || capped();
  $("pause").disabled = !running || paused;
  $("resume").disabled = !running || !paused;
  $("stop").disabled = !running;
  const hasRows = ROWS.length > 0;
  $("csv").disabled = !hasRows;
  $("excel").disabled = !hasRows;
  $("json").disabled = !hasRows;
  $("dot").classList.toggle("on", running && !paused);
  $("resultCount").textContent = ROWS.length;

  const banner = $("banner");
  if (paused && s && s.pauseReason) {
    banner.hidden = false;
    banner.textContent = "Paused: " + s.pauseReason + (/consent|captcha/.test(s.pauseReason) ? " — solve it in the Google tab, then Resume." : "");
    banner.classList.toggle("warn", !/consent|captcha/.test(s.pauseReason));
  } else if (!running && s && s.stopReason) {
    banner.hidden = false;
    banner.textContent = "Last task stopped: " + s.stopReason;
    banner.classList.add("warn");
  } else {
    banner.hidden = true;
  }

  if (s && s.mode === "places") {
    $("progressText").textContent = `${s.done || 0} API calls`;
    $("fill").style.width = running ? "60%" : "0%";
  } else {
    $("progressText").textContent = `${running ? done : total}/${total}`;
    $("fill").style.width = (total ? Math.round((done / total) * 100) : hasRows ? 100 : 0) + "%";
  }
  $("activeQuery").textContent = s && s.activeTask ? s.activeTask.replace("~in~", " in ").trim() : "-";
  renderTasks(s);

  const p = PACE.profileFor($("paceProfile").value);
  $("paceInfo").textContent = `${p.steadyRpm} req/min · pause ~${(p.pageMedianMs / 1000).toFixed(1)}s · long break every ${p.breakEveryPages} pages`;
  const chip = $("riskChip");
  const level = s && s.running ? s.backoffLevel || 0 : 0;
  if (paused && level) { chip.textContent = "backoff " + level + "/3"; chip.className = "chip bad"; }
  else if (paused) { chip.textContent = "paused"; chip.className = "chip warn"; }
  else if (running) { chip.textContent = "running"; chip.className = "chip run"; }
  else { chip.textContent = "idle"; chip.className = "chip"; }

  $("kwCount").textContent = lines($("keywords").value).length;
  $("locCount").textContent = lines($("locations").value).length;
  $("rxCount").textContent = lines($("regexList").value).length;

  updateSummary();
  renderTable();
  renderLicense();
  // Nudge unlicensed users to activate the moment they hit the free cap.
  if (capped() && !running) {
    if (!gateAutoShown && $("licenseGate").hidden) { gateAutoShown = true; openGate("You've reached the free limit of " + LIC_ST.freeLimit + " rows."); }
  } else {
    gateAutoShown = false;
  }
  if (!running && s) await tickActiveRun();
}

function renderTasks(s) {
  const total = (s && s.totalTasks) || 0;
  const rem = (s && s.tasks) || [];
  const done = Math.max(0, total - rem.length);
  $("taskCounts").textContent = `${done}/${total} done`;
  const items = [];
  if (s && s.activeTask) items.push(`<li class="task-active">${escHtml(s.activeTask.replace("~in~", " in ").trim())}</li>`);
  items.push(...rem.slice(0, 100).map((t) => `<li>${escHtml(t.replace("~in~", " in ").trim())}</li>`));
  if (rem.length > 100) items.push(`<li class="muted">…and ${rem.length - 100} more</li>`);
  $("taskList").innerHTML = items.length ? items.join("") : `<li class="muted">No queued tasks.</li>`;
}

async function loadRows() {
  ROWS = await allRows();
  if ($("segAuto").checked && ROWS.length && ROWS.length !== lastSegCount) {
    lastSegCount = ROWS.length;
    SEG_ON = true;
    TIER_OVERRIDE.clear();
  }
  renderTable();
  updateSummary();
}

// ---- actions ---------------------------------------------------------------
function buildTasks() {
  const kw = lines($("keywords").value);
  const loc = lines($("locations").value);
  const tasks = [];
  if (kw.length && loc.length) kw.forEach((k) => loc.forEach((l) => tasks.push(`${k}~in~${l}`)));
  else if (kw.length) kw.forEach((k) => tasks.push(`${k}~in~`));
  else loc.forEach((l) => tasks.push(`~in~${l}`));
  return tasks;
}

async function start() {
  const f = readForm();
  const tasks = buildTasks();
  if (!tasks.length) return toast("Enter at least one keyword or location.");

  if (f.repeatMinutes > 0) chrome.runtime.sendMessage({ type: "SET_REPEAT", minutes: f.repeatMinutes });
  else chrome.runtime.sendMessage({ type: "SET_REPEAT", minutes: 0 });

  logRunStart({ ts: Date.now(), source: f.source, keywords: lines(f.keywords).join(", ").slice(0, 80), locations: lines(f.locations).join(", ").slice(0, 80), tasks: tasks.length, rows: 0 });
  showTab("tasks");

  if (f.source === "places") {
    if (!f.apiKey) return toast("Enter your Places API key.");
    const res = await chrome.runtime.sendMessage({ type: "START_PLACES", tasks, settings: settings(), apiKey: f.apiKey });
    if (res && res.ok === false) return toast("Failed: " + (res.error || "unknown"));
    toast("Places API run started.");
  } else {
    const res = await chrome.runtime.sendMessage({ type: "START_SEARCH", tasks, settings: settings() });
    if (res && res.ok === false) return toast("Failed: " + (res.error || "unknown"));
    toast("Started. A Google tab was opened; keep it running.");
  }
  render();
}

async function stop() {
  await chrome.runtime.sendMessage({ type: "STOP" });
  chrome.runtime.sendMessage({ type: "SET_REPEAT", minutes: 0 });
  render();
  toast("Stopped.");
}
async function pause() { await chrome.runtime.sendMessage({ type: "PAUSE" }); render(); }
async function resume() { await chrome.runtime.sendMessage({ type: "RESUME" }); render(); }

async function clear() {
  await clearRows();
  const s = (await getState()) || {};
  s.tasks = [];
  s.totalTasks = 0;
  s.activeTask = "";
  s.done = 0;
  if (!s.running) s.phase = "idle";
  await chrome.storage.local.set({ [KEY]: s });
  await loadRows();
  render();
  toast("Data cleared.");
}

async function removeDupes() {
  if (!ROWS.length) return toast("No data to dedupe.");
  const { dropped } = MP.dedupeByPhone(ROWS);
  if (!dropped.length) return toast("No duplicate phones found.");
  if (!confirm(`Remove ${dropped.length} duplicate-phone lead(s)? This cannot be undone.`)) return;
  await deleteRows(dropped.map((r) => r.key));
  await loadRows();
  render();
  toast(`Removed ${dropped.length} duplicates.`);
}

// ---- export history --------------------------------------------------------
const fmtSize = (n) => (n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB");
async function renderExports() {
  const list = (await allExports()).sort((a, b) => b.ts - a.ts);
  const el = $("exportsList");
  el.innerHTML = list.length
    ? list.map((e) => `<div class="exp-item"><span class="exp-name" title="${escHtml(e.name)}">${escHtml(e.name)}</span><span class="muted">${e.count ?? ""} rows · ${fmtSize(e.body.length)}</span><button class="btn ghost tiny" data-dl="${e.id}">Download</button><button class="btn ghost icon tiny" data-del="${e.id}" aria-label="Delete export" title="Delete export">${TRASH_SVG}</button></div>`).join("")
    : `<div class="muted">No saved exports yet. CSV / Excel / JSON files are kept here for re-download.</div>`;
  $("exportsClear").hidden = !list.length;
}
async function downloadHistory(id) {
  const e = (await allExports()).find((x) => x.id === id);
  if (e) download(e.name, e.body, e.mime);
}

// ---- scraping run history --------------------------------------------------
const getRuns = async () => (await chrome.storage.local.get(RUNS_KEY))[RUNS_KEY] || [];
async function saveRuns(runs) { await chrome.storage.local.set({ [RUNS_KEY]: runs.slice(0, 50) }); }

async function logRunStart(rec) {
  const runs = await getRuns();
  runs.unshift({ ...rec, open: true });
  await saveRuns(runs);
  renderRuns();
}
// Close the open run once the scraper stops; self-heals a stale run on open.
async function tickActiveRun() {
  const runs = await getRuns();
  const open = runs.find((r) => r.open);
  if (!open) return;
  open.open = false;
  open.rows = ROWS.length;
  await saveRuns(runs);
  renderRuns();
}
async function renderRuns() {
  const runs = await getRuns();
  const el = $("runsList");
  el.innerHTML = runs.length
    ? runs.map((r) => {
        const what = [r.keywords, r.locations].filter(Boolean).join(" · ") || "-";
        return `<div class="exp-item"><span class="exp-name" title="${escHtml(what)}">${escHtml(r.source || "")} — ${escHtml(r.keywords || "-")}</span><span class="muted">${r.tasks || 0} tasks · ${r.open ? "running" : (r.rows ?? 0) + " rows"} · ${new Date(r.ts).toLocaleString()}</span></div>`;
      }).join("")
    : `<div class="muted">No scraping runs yet.</div>`;
  $("runsClear").hidden = !runs.length;
}

async function exportAs(kind) {
  await refreshLicense();
  if (!LIC_ST.licensed) {
    toast("License required to export/download leads. Activate to unlock exports.");
    openGate("Activate your license to export results.");
    return;
  }
  const c = compiledLists();
  const rows = filtered().map((r) => exportRow(r, c));
  const tag = LIC_ST.licensed && LIC_ST.lic ? "-" + LIC.shortTag(LIC_ST.lic) : "";
  let name, body, mime;
  if (kind === "csv") {
    name = `google-map-extractor-${stamp()}${tag}.csv`;
    body = "\uFEFF" + toCSV(rows);
    mime = "text/csv;charset=utf-8";
  } else if (kind === "json") {
    name = `google-map-extractor-${stamp()}${tag}.json`;
    body = JSON.stringify(rows, null, 2);
    mime = "application/json";
  } else if (kind === "excel") {
    name = `google-map-extractor-${stamp()}${tag}.xls`;
    body = XLSX.buildExcelXml(rows, CSV_COLS);
    mime = "application/vnd.ms-excel";
  } else return;
  download(name, body, mime);
  saveExport({ name, kind, mime, body, count: rows.length }).then(renderExports);
  toast(`Exported ${rows.length} rows (saved to history).`);
}

async function emailAll() {
  const f = readForm();
  const res = await chrome.runtime.sendMessage({ type: "ENQUEUE_ALL", blacklist: lines(f.regexList), timeoutMs: f.maxEmailTime * 1000 });
  toast(`Queued ${res && res.queued != null ? res.queued : "?"} sites.`);
}

// ---- lead segregation (Oilman India) ---------------------------------------
async function segregate() {
  if (!ROWS.length) return toast("No data to segregate yet.");
  SEG_ON = true;
  TIER_OVERRIDE.clear();
  const c = compiledLists();

  if ($("aiOn").checked && $("aiKey").value) {
    const unclear = ROWS.filter((r) => SEG.isUnclear(r, c));
    if (unclear.length) {
      toast(`AI: classifying ${unclear.length} unclear rows…`);
      const items = unclear.map((r, i) => ({
        i,
        name: r.company_name || "",
        category: r.category || "",
        keyword: [r.keyword, r.query, r.location].filter(Boolean).join(" "),
      }));
      const res = await chrome.runtime
        .sendMessage({
          type: "CLASSIFY_LEADS",
          items,
          baseUrl: $("aiBase").value || "https://api.openai.com/v1",
          apiKey: $("aiKey").value,
          model: $("aiModel").value || "gpt-4o-mini",
        })
        .catch(() => null);
      const tiers = (res && res.tiers) || [];
      tiers.forEach((t) => {
        const r = unclear[t.i];
        if (r) TIER_OVERRIDE.set(keyOfRow(r), t.tier);
      });
      if (tiers.length) toast(`AI classified ${tiers.length} of ${unclear.length} unclear rows.`);
    }
  }

  saveForm();
  updateSummary();
  render();
  toast("Leads segregated.");
}

async function googleTab() {
  const tabs = await chrome.tabs.query({ url: "*://www.google.com/search*" });
  return tabs[0] || null;
}
async function diagnose() {
  const tab = await googleTab();
  if (!tab) return toast("Open a Google results tab first.");
  const res = await chrome.tabs.sendMessage(tab.id, { type: "DIAGNOSE" }).catch(() => null);
  if (!res) return toast("No response — reload the Google tab and retry.");
  const pre = $("diag");
  pre.hidden = false;
  pre.textContent = JSON.stringify(res, null, 2);
  toast(`Cards found: ${res.cards}`);
}
async function dump() {
  const tab = await googleTab();
  if (!tab) return toast("Open a Google results tab first.");
  const res = await chrome.tabs.sendMessage(tab.id, { type: "DUMP" }).catch(() => null);
  if (!res) return toast("No response — reload the Google tab and retry.");
  download(`gme-page-dump-${stamp()}.json`, JSON.stringify(res, null, 2), "application/json");
  toast(`JSON rows found: ${res.rows}`);
}

// ---- theme toggle ----------------------------------------------------------
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  const b = $("theme");
  if (b) b.setAttribute("aria-pressed", t === "dark" ? "true" : "false");
}
function initTheme() {
  let stored = null;
  try { stored = localStorage.getItem("ms_theme"); } catch { /* storage blocked */ }
  const sys = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(stored || sys);
  $("theme").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    try { localStorage.setItem("ms_theme", next); } catch { /* storage blocked */ }
    applyTheme(next);
  });
}

// ---- product tour ----------------------------------------------------------
const TOUR_KEY = "ms_tour_seen";
const TOUR_STEPS = [
  { tab: "data", el: "hdrLicChip", title: "License status", text: "Free tier scrapes up to 50 rows; exporting CSV/Excel/JSON needs a license. Click Activate next to this chip and paste your key — one key binds to this device only. Moving to another PC? Deactivate here first, then activate there." },
  { tab: "data", el: "start", title: "Main controls", text: "Start Extracting begins a run; Pause, Resume and Stop work mid-run. 'Results found' counts collected rows. Fill keywords and locations first (next steps), then press Start." },
  { tab: "data", el: "csv", title: "Export buttons", text: "CSV, Excel (one sheet per location) and JSON download your collected leads. Disabled until the extension is licensed — scrape free, export after activating." },
  { tab: "data", el: "emailAll", title: "Email finder", text: "Extract Emails visits each result's website and fills the Emails column. Run it manually from here, or automatically via Email enrichment below." },
  { tab: "data", el: "source", title: "Data source", text: "Google Search (scrape) works out of the box with no key. Places API is the official Google API — needs your own key with billing enabled. Stay on Search unless you have API credits." },
  { tab: "data", el: "keywords", title: "Keywords × locations", text: "One keyword per line × one location per line = one task each: 'restaurants' + 'Austin, TX' is 1 task. Every combination shows up as its own task in the Tasks tab." },
  { tab: "data", el: "enrichMode", title: "Email enrichment & run controls", text: "Off, After scraping (queue) or During scraping. Also set seconds per website, delay between pages, max pages per keyword, and Repeat run every N minutes for hands-off collection." },
  { tab: "data", el: "paceProfile", title: "Human pace (anti-CAPTCHA)", text: "Mimics real human browsing so Google doesn't block you. Conservative = safest and slowest, Aggressive = faster but riskier. Keep Human motion on; the chip shows live risk while running." },
  { tab: "data", el: "presetName", title: "Presets", text: "Save this whole setup (keywords, locations, options) under a name, reload it later with Load — keep one preset per client or niche." },
  { tab: "tasks", el: "taskList", title: "Task queue", text: "This tab shows every keyword × location task. The bar tracks progress, and tasks turn done as they finish — this is what happens while scraping runs." },
  { tab: "tasks", el: "filter", title: "Your results", text: "Filter by text, tier, only-with-email or no-duplicate phones; click column headers to sort; Remove duplicates cleans the list. This table is exactly what you export." },
  { tab: "settings", el: "segregate", title: "Segregate leads", text: "Sorts every row into Tier 1/2/3 by keyword lists — edit the lists, or switch on AI fallback for unclear rows. Auto-segregate can run after every scrape." },
  { tab: "settings", el: "runsList", title: "History", text: "Every scrape run and every download is logged here — re-download an export any time without re-scraping." },
  { tab: "data", el: null, title: "You're ready", text: "The full flow: Data tab → keywords + locations → Start Extracting → watch the Tasks tab → export CSV/Excel/JSON. Replay this tour any time with 'Take a tour' in the header." },
];
let tourI = 0;
function tourShow() {
  const s = TOUR_STEPS[tourI];
  $("tourCount").textContent = `Step ${tourI + 1} of ${TOUR_STEPS.length} · ${s.tab[0].toUpperCase() + s.tab.slice(1)} tab`;
  $("tourTitle").textContent = s.title;
  $("tourText").textContent = s.text;
  $("tourBack").disabled = tourI === 0;
  $("tourNext").textContent = tourI === TOUR_STEPS.length - 1 ? "Finish" : "Next";
  showTab(s.tab);
  requestAnimationFrame(tourPlace);
}
function tourPlace() {
  const s = TOUR_STEPS[tourI];
  const spot = $("tourSpot");
  const card = $("tourCard");
  const el = s.el && $(s.el);
  if (!el) {
    spot.style.display = "none";
    card.style.left = Math.max(8, (innerWidth - card.offsetWidth) / 2) + "px";
    card.style.top = Math.max(8, (innerHeight - card.offsetHeight) / 2) + "px";
    return;
  }
  el.scrollIntoView({ block: "center" });
  const r = el.getBoundingClientRect();
  const pad = 5;
  spot.style.display = "";
  spot.style.left = r.left - pad + "px";
  spot.style.top = r.top - pad + "px";
  spot.style.width = r.width + pad * 2 + "px";
  spot.style.height = r.height + pad * 2 + "px";
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  let left = Math.min(Math.max(8, r.left), innerWidth - cw - 8);
  let top = r.bottom + pad + 12;
  if (top + ch > innerHeight - 8) top = r.top - ch - pad - 12;
  if (top < 8) top = 8;
  card.style.left = left + "px";
  card.style.top = top + "px";
}
function tourStart() { tourI = 0; $("tour").hidden = false; tourShow(); }
function tourEnd() {
  $("tour").hidden = true;
  try { localStorage.setItem(TOUR_KEY, "1"); } catch { /* storage blocked */ }
}
function tourStep(d) {
  tourI += d;
  if (tourI >= TOUR_STEPS.length) return tourEnd();
  if (tourI < 0) tourI = 0;
  tourShow();
}
$("tourNext").addEventListener("click", () => tourStep(1));
$("tourBack").addEventListener("click", () => tourStep(-1));
$("tourSkip").addEventListener("click", tourEnd);
$("tourBtn").addEventListener("click", tourStart);
addEventListener("keydown", (e) => {
  if ($("tour").hidden) return;
  if (e.key === "Escape") tourEnd();
  if (e.key === "ArrowRight") tourStep(1);
  if (e.key === "ArrowLeft") tourStep(-1);
});
addEventListener("resize", () => { if (!$("tour").hidden) tourPlace(); });
addEventListener("scroll", () => { if (!$("tour").hidden) tourPlace(); }, true);

// ---- wiring ----------------------------------------------------------------
function showTab(name) {
  document.querySelectorAll(".tabbtn").forEach((b) => {
    const on = b.dataset.tab === name;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll(".tabpanel").forEach((p) => (p.hidden = p.id !== "tab-" + name));
}
const TABS = [...document.querySelectorAll(".tabbtn")];
TABS.forEach((b, i) => {
  b.addEventListener("click", () => showTab(b.dataset.tab));
  b.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = TABS[(i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length];
    showTab(n.dataset.tab);
    n.focus();
  });
});
$("start").addEventListener("click", start);
$("stop").addEventListener("click", stop);
$("pause").addEventListener("click", pause);
$("resume").addEventListener("click", resume);
$("clear").addEventListener("click", clear);
$("csv").addEventListener("click", () => exportAs("csv"));
$("excel").addEventListener("click", () => exportAs("excel"));
$("json").addEventListener("click", () => exportAs("json"));
$("exportsList").addEventListener("click", (e) => {
  const dl = e.target.closest("[data-dl]");
  const del = e.target.closest("[data-del]");
  if (dl) downloadHistory(dl.dataset.dl);
  if (del) deleteExport(del.dataset.del).then(renderExports);
});
$("exportsClear").addEventListener("click", () => clearExports().then(renderExports));
$("emailAll").addEventListener("click", emailAll);
$("segregate").addEventListener("click", segregate);
$("segAuto").addEventListener("change", () => {
  if ($("segAuto").checked && ROWS.length) segregate();
});
$("tierFilter").addEventListener("change", renderTable);
$("diagBtn").addEventListener("click", diagnose);
$("dumpBtn").addEventListener("click", dump);
$("presetSave").addEventListener("click", presetSave);
$("presetLoad").addEventListener("click", presetLoad);
$("presetDel").addEventListener("click", presetDel);
$("filter").addEventListener("input", renderTable);
$("onlyEmail").addEventListener("change", renderTable);
$("noDupePhones").addEventListener("change", () => { saveForm(); renderTable(); });
$("dedupe").addEventListener("click", removeDupes);
$("licOpen").addEventListener("click", () => openGate(LIC_ST.licensed ? "This device is already licensed." : ""));
if ($("dataLicOpen")) $("dataLicOpen").addEventListener("click", () => openGate(LIC_ST.licensed ? "This device is already licensed." : ""));
if ($("dataLicDeactivate")) $("dataLicDeactivate").addEventListener("click", async () => {
  if (!confirm("Deactivate this license on this device? The free cap returns.")) return;
  await LIC.deactivate();
  await refreshLicense();
  render();
  toast("License deactivated.");
});
$("licActivate").addEventListener("click", (e) => doActivate(e.currentTarget));
$("licContinue").addEventListener("click", closeGate);
$("licKey").addEventListener("keydown", (e) => { if (e.key === "Enter") doActivate($("licActivate")); });
$("licDeactivate").addEventListener("click", async () => {
  if (!confirm("Deactivate this license on this device? The free cap returns.")) return;
  await LIC.deactivate();
  await refreshLicense();
  render();
  toast("License deactivated.");
});
$("runsClear").addEventListener("click", async () => { await chrome.storage.local.set({ [RUNS_KEY]: [] }); renderRuns(); });
$("source").addEventListener("change", () => { toggleApiKey(); saveForm(); });
document.querySelectorAll("thead th[data-key]").forEach((th) => th.addEventListener("click", () => {
  const k = th.dataset.key;
  if (sortKey === k) sortDir = sortDir === "asc" ? "desc" : "asc";
  else { sortKey = k; sortDir = "asc"; }
  renderTable();
}));
["keywords", "locations", "regexList", "maxEmailTime", "delaySeconds", "maxPages", "repeatMinutes", "fastMode", "deepDetails", "enrichMode", "apiKey",
  "tier1", "tier2", "tier3", "aiOn", "aiBase", "aiKey", "aiModel", "segAuto", "paceProfile", "motion", "noDupePhones"].forEach(
  (id) => $(id).addEventListener("change", saveForm)
);
$("paceProfile").addEventListener("change", render);
["tier1", "tier2", "tier3"].forEach((id) =>
  $(id).addEventListener("input", () => {
    if (SEG_ON) { updateSummary(); renderTable(); }
  })
);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[KEY]) render();
  if (area === "local" && changes.ms_lic) refreshLicense().then(render);
});
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === "EMAILS_UPDATED") loadRows();
  if (msg.type === "STATE" || msg.type === "PROGRESS") render();
});

// periodic refresh of rows while running (emails land asynchronously)
setInterval(async () => {
  const s = await getState();
  if (s && s.running) loadRows();
}, 3000);

(async () => {
  initTheme();
  await refreshLicense();
  const form = (await chrome.storage.local.get(FORM_KEY))[FORM_KEY];
  writeForm(form);
  await loadPresets();
  await loadRows();
  await renderExports();
  await renderRuns();
  render();
  try {
    if (localStorage.getItem(TOUR_KEY) !== "1") setTimeout(tourStart, 400);
  } catch { /* storage blocked */ }
})();
