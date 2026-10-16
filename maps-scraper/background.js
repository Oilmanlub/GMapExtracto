// Maps Lead Scraper - background service worker (ES module).
// Owns: row storage (IndexedDB), the email work-queue, the Places API source,
// alarms (stall watchdog + repeat), and run initiation. Nothing leaves the machine.
import { upsertRows, allRows } from "./lib/db.js";
import { runPlacesSearch } from "./lib/places-api.js";
import "./lib/license.js"; // side-effect: sets globalThis.LIC
const LIC = globalThis.LIC;

const KEY = "ms_state";
const LAST = "ms_lastrun";
const EMAIL_RE = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
const JUNK = /(\.png|\.jpg|\.jpeg|\.gif|\.webp|\.svg|\.css|\.js|wixpress|sentry|@2x|@3x|example\.(com|org|net)|domain\.com|yourdomain|email\.com)$/i;
const CONTACT_HINT = /(contact|about|impressum|kontakt|team|support|reach|info)/i;

const getState = () => new Promise((r) => chrome.storage.local.get(KEY, (o) => r(o[KEY] || null)));
const setState = (s) => new Promise((r) => chrome.storage.local.set({ [KEY]: s }, r));
const getLast = () => new Promise((r) => chrome.storage.local.get(LAST, (o) => r(o[LAST] || null)));

function broadcast(msg) {
  try {
    chrome.runtime.sendMessage(msg).catch(() => {});
  } catch {}
}

function notify(title, message) {
  try {
    chrome.notifications.create("", { type: "basic", iconUrl: "icons/icon128.png", title, message, priority: 2 });
  } catch {}
}

// ---- licensing: free tier caps total rows at FREE_LIMIT --------------------
// Licensed users save everything; free users get the remaining free slots only.
async function saveRows(rows) {
  const lic = await LIC.status();
  if (lic.licensed) return { added: await upsertRows(rows) };
  const existing = await allRows();
  const remaining = Math.max(0, LIC.FREE_LIMIT - existing.length);
  if (remaining <= 0) return { added: 0, limit: true, total: existing.length };
  const added = rows.length ? await upsertRows(rows.slice(0, remaining)) : 0;
  const total = Math.min(LIC.FREE_LIMIT, existing.length + added);
  return { added, limit: total >= LIC.FREE_LIMIT, total };
}

// Refuse to start a run when an unlicensed user is already at the cap.
async function licenseGate() {
  const lic = await LIC.status();
  if (lic.licensed) return null;
  if ((await allRows()).length >= LIC.FREE_LIMIT) {
    return { ok: false, error: "Free limit reached — activate a license to keep extracting." };
  }
  return null;
}

// Reload the live Google tab (or open one) so a resumed run picks up where it left off.
async function resumeGoogleTab(st) {
  const tabs = await chrome.tabs.query({ url: "*://www.google.com/search*" });
  if (tabs.length) chrome.tabs.reload(tabs[0].id);
  else chrome.tabs.create({ url: buildSearchUrl(st.query || "", st.pageStart || 0), active: true });
}

// ---- AI fallback: classify unclear leads (OpenAI-compatible endpoint) --------
// Prompt is built from the user's own tier keyword lists (no industry assumptions).
function classifySystemPrompt(tier1, tier2, tier3) {
  const fmt = (a, fallback) => (a && a.length ? a.join(", ") : fallback);
  return (
    "You sort business leads into 3 priority tiers for cold-calling. " +
    "Tier 1 = strongest fit, keywords: " + fmt(tier1, "the customer's top-priority terms") + ". " +
    "Tier 2 = secondary fit, keywords: " + fmt(tier2, "the customer's secondary terms") + ". " +
    "Tier 3 = low priority or unrelated to the customer's business. " +
    'Reply with ONLY a JSON array of {"i":<index>,"tier":<1|2|3>} for every item, same order, no prose.'
  );
}

async function classifyLeads({ items, baseUrl, apiKey, model, tier1, tier2, tier3 }) {
  if (!apiKey || !baseUrl || !model || !items || !items.length) return [];
  const body = {
    model,
    temperature: 0,
    messages: [
      { role: "system", content: classifySystemPrompt(tier1, tier2, tier3) },
      { role: "user", content: JSON.stringify(items) },
    ],
  };
  let res;
  try {
    res = await fetch(baseUrl.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return [];
  }
  if (!res.ok) return [];
  const data = await res.json().catch(() => null);
  const text = data && data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "";
  const m = String(text).match(/\[[\s\S]*\]/);
  if (!m) return [];
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch { return []; }
  return (Array.isArray(parsed) ? parsed : [])
    .map((x) => ({ i: Number(x.i), tier: Number(x.tier) }))
    .filter((x) => Number.isInteger(x.i) && (x.tier === 1 || x.tier === 2 || x.tier === 3));
}

// ---- toolbar ---------------------------------------------------------------
chrome.action.onClicked.addListener(() => {
  chrome.windows.create({ url: chrome.runtime.getURL("app.html"), type: "popup", width: 1200, height: 840 });
});

// ---- email harvesting ------------------------------------------------------
async function fetchText(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", credentials: "omit" });
    if (!res.ok) return "";
    const ct = res.headers.get("content-type") || "";
    if (!/text|html|json|xml/i.test(ct)) return "";
    const text = await res.text();
    return text.length > 500000 ? text.slice(0, 500000) : text;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function harvest(text, found, blacklist) {
  if (!text) return;
  for (const raw of text.match(EMAIL_RE) || []) {
    const email = raw.toLowerCase();
    if (JUNK.test(email)) continue;
    if (blacklist.some((b) => b && email.includes(String(b).toLowerCase()))) continue;
    found.add(email);
  }
}

async function findEmails(url, blacklist, timeoutMs) {
  const found = new Set();
  const home = await fetchText(url, timeoutMs);
  harvest(home, found, blacklist);
  let origin = "";
  try { origin = new URL(url).origin; } catch { return [...found]; }
  const links = [...home.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const seen = new Set();
  const candidates = [];
  for (const href of links) {
    if (!CONTACT_HINT.test(href)) continue;
    let abs;
    try { abs = new URL(href, url).href; } catch { continue; }
    if (!abs.startsWith(origin) || seen.has(abs)) continue;
    seen.add(abs);
    candidates.push(abs);
    if (candidates.length >= 5) break;
  }
  for (const page of candidates) {
    harvest(await fetchText(page, timeoutMs), found, blacklist);
    if (found.size >= 20) break;
  }
  return [...found].slice(0, 20);
}

// ---- email work queue (concurrency 3) --------------------------------------
const queue = [];
let activeCount = 0;
const MAX_CONCURRENCY = 3;

function enqueue(items, blacklist, timeoutMs) {
  for (const it of items || []) {
    if (it && it.website) queue.push({ key: it.key, website: it.website, blacklist, timeoutMs });
  }
  pump();
}

function pump() {
  while (activeCount < MAX_CONCURRENCY && queue.length) {
    const job = queue.shift();
    activeCount++;
    runJob(job).finally(() => {
      activeCount--;
      if (!queue.length && activeCount === 0) broadcast({ type: "EMAILS_UPDATED", done: true });
      pump();
    });
  }
}

async function runJob(job) {
  const emails = await findEmails(job.website, job.blacklist || [], job.timeoutMs || 8000);
  if (emails.length) {
    await upsertRows([{ key: job.key, emails: emails.join("; ") }]);
    broadcast({ type: "EMAILS_UPDATED" });
  }
}

// ---- run initiation --------------------------------------------------------
function buildSearchUrl(query, start) {
  const u = new URL("https://www.google.com/search");
  u.searchParams.set("q", query);
  u.searchParams.set("tbm", "lcl");
  u.searchParams.set("num", "20");
  if (start) u.searchParams.set("start", String(start));
  return u.toString();
}

async function startSearch(lr) {
  const [first] = lr.tasks;
  const [kw = "", loc = ""] = (first || "").split("~in~");
  const state = {
    running: true,
    paused: false,
    pauseReason: "",
    mode: "search",
    phase: "next",
    tasks: lr.tasks.slice(),
    totalTasks: lr.tasks.length,
    settings: lr.settings,
    activeTask: "",
    keyword: kw.trim(),
    location: loc.trim(),
    query: [kw.trim(), loc.trim()].filter(Boolean).join(" "),
    startPage: 0,
    pageStart: 0,
    startedAt: Date.now(),
    lastProgressAt: Date.now(),
    // human-pace state
    bucket: null,
    backoffLevel: 0,
    resolveAt: 0,
    pagesSinceBreak: 0,
    tasksSinceBreak: 0,
    sessionStart: Date.now(),
    shuffled: false,
    fastDisabled: false,
  };
  await setState(state);
  await chrome.tabs.create({ url: buildSearchUrl(state.query, 0), active: true });
}

async function startPlaces(lr) {
  const state = {
    running: true, paused: false, pauseReason: "", mode: "places", phase: "search",
    tasks: lr.tasks.slice(), totalTasks: lr.tasks.length, settings: lr.settings, activeTask: "", done: 0,
    startedAt: Date.now(), lastProgressAt: Date.now(),
  };
  await setState(state);
  broadcast({ type: "STATE" });
  let done = 0;
  for (const task of lr.tasks) {
    if (!((await getState()) || state).running) break;
    while (((await getState()) || state).paused) await sleep(1000);
    const [kw = "", loc = ""] = task.split("~in~");
    const query = [kw.trim(), loc.trim()].filter(Boolean).join(" ");
    try {
      await runPlacesSearch({
        apiKey: lr.apiKey,
        query,
        maxPages: lr.settings.maxPages || 3,
        onPage: async (rows) => {
          await upsertRows(rows.map((r) => ({ ...r, keyword: kw.trim(), location: loc.trim() })));
          done++;
          const cur = (await getState()) || state;
          cur.activeTask = task;
          cur.done = done;
          cur.lastProgressAt = Date.now();
          await setState(cur);
          broadcast({ type: "PROGRESS", done });
        },
      });
    } catch (e) {
      const cur = (await getState()) || state;
      cur.pauseReason = "API error: " + String(e.message || e);
      cur.paused = true;
      await setState(cur);
      broadcast({ type: "STATE" });
      return;
    }
  }
  const done2 = (await getState()) || state;
  done2.phase = "done";
  done2.running = false;
  await setState(done2);
  broadcast({ type: "STATE" });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startFromLastRun(lr) {
  if (!lr) return;
  if (lr.mode === "places") return startPlaces(lr);
  return startSearch(lr);
}

// ---- alarms: stall watchdog + repeat ---------------------------------------
chrome.alarms.create("watchdog", { periodInMinutes: 1 });
chrome.alarms.create("license", { periodInMinutes: LIC.RECHECK_MIN });
chrome.runtime.onStartup.addListener(() => { LIC.validate().catch(() => {}); });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "watchdog") {
    const st = await getState();
    if (st && st.running && !st.paused && Date.now() - (st.lastProgressAt || 0) > 90000) {
      st.paused = true;
      st.pauseReason = "stalled (no progress for 90s)";
      await setState(st);
      broadcast({ type: "STATE" });
    }
  }
  if (alarm.name === "repeat") {
    const lr = await getLast();
    if (lr) startFromLastRun(lr);
  }
  if (alarm.name === "license") {
    LIC.validate().catch(() => {});
  }
  if (alarm.name === "backoff") {
    const st = await getState();
    if (st && st.running && st.paused && st.resolveAt && Date.now() >= st.resolveAt) {
      st.paused = false;
      st.pauseReason = "";
      st.resolveAt = 0;
      st.lastProgressAt = Date.now();
      await setState(st);
      if (st.mode !== "places") await resumeGoogleTab(st);
      broadcast({ type: "STATE" });
      notify("Google Map Extractor resumed", "Backoff finished — continuing the run.");
    }
  }
});

// ---- message router --------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return false;
  switch (msg.type) {
    case "FIND_EMAILS":
      findEmails(msg.url, msg.blacklist || [], msg.timeoutMs || 8000)
        .then((emails) => sendResponse({ emails }))
        .catch(() => sendResponse({ emails: [] }));
      return true;

    case "SAVE_ROWS":
      saveRows(msg.rows || []).then((r) => sendResponse(r)).catch(() => sendResponse({ added: 0 }));
      return true;

    case "ENQUEUE_EMAILS":
      enqueue(msg.items, msg.blacklist, msg.timeoutMs);
      sendResponse({ ok: true });
      return false;

    case "ENQUEUE_ALL":
      allRows().then((rows) => {
        const items = rows.filter((r) => r.website && !r.emails).map((r) => ({ key: r.key, website: r.website }));
        enqueue(items, msg.blacklist, msg.timeoutMs);
        sendResponse({ ok: true, queued: items.length });
      }).catch(() => sendResponse({ ok: false }));
      return true;

    case "START_SEARCH": {
      licenseGate().then((blocked) => {
        if (blocked) return sendResponse(blocked);
        const lr = { mode: "search", tasks: msg.tasks || [], settings: msg.settings || {} };
        chrome.storage.local.set({ [LAST]: lr });
        startSearch(lr).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
      });
      return true;
    }

    case "START_PLACES": {
      licenseGate().then((blocked) => {
        if (blocked) return sendResponse(blocked);
        const lr = { mode: "places", tasks: msg.tasks || [], settings: msg.settings || {}, apiKey: msg.apiKey || "" };
        chrome.storage.local.set({ [LAST]: lr });
        startPlaces(lr).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
      });
      return true;
    }

    case "STOP":
      chrome.alarms.clear("backoff");
      getState().then((st) => {
        if (st) { st.running = false; st.paused = false; st.phase = "done"; st.resolveAt = 0; return setState(st).then(() => sendResponse({ ok: true })); }
        sendResponse({ ok: true });
      });
      return true;

    case "PAUSE":
      getState().then((st) => {
        if (st) { st.paused = true; st.pauseReason = "paused"; return setState(st).then(() => sendResponse({ ok: true })); }
        sendResponse({ ok: true });
      });
      return true;

    case "RESUME":
      chrome.alarms.clear("backoff");
      getState().then(async (st) => {
        if (!st) return sendResponse({ ok: false });
        st.paused = false;
        st.pauseReason = "";
        st.backoffLevel = 0; // manual resume clears the escalation
        st.resolveAt = 0;
        st.lastProgressAt = Date.now();
        await setState(st);
        if (st.mode !== "places") await resumeGoogleTab(st);
        broadcast({ type: "STATE" });
        sendResponse({ ok: true });
      });
      return true;

    case "NOTIFY":
      notify(msg.title || "Google Map Extractor", String(msg.message || ""));
      sendResponse({ ok: true });
      return false;

    case "SCHEDULE_BACKOFF":
      chrome.alarms.create("backoff", { when: msg.resolveAt || Date.now() + 300000 });
      sendResponse({ ok: true });
      return false;

    case "SET_REPEAT":
      if (msg.minutes > 0) chrome.alarms.create("repeat", { periodInMinutes: msg.minutes });
      else chrome.alarms.clear("repeat");
      sendResponse({ ok: true });
      return false;

    case "CLASSIFY_LEADS":
      classifyLeads(msg)
        .then((tiers) => sendResponse({ tiers }))
        .catch(() => sendResponse({ tiers: [] }));
      return true;

    default:
      return false;
  }
});
