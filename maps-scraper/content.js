// Google Map Extractor - content script.
//
// Drives a persisted state machine over Google local results:
//   next   -> pop the next keyword~in~location task, open its results page
//   search -> parse every card (DOM + embedded JSON), save to IndexedDB via the
//             background worker, then paginate (start += 20)
//
// Rows live in IndexedDB (background owns writes); only control state is here.
// Depends on: lib/parse.js (MP), lib/selectors.js (SEL/SELX), lib/json-extract.js (JSONX).
(() => {
  const KEY = "ms_state";
  const PAGE_SIZE = 20;
  const PAGE_HARD_CAP = 300; // ponytail: runaway guard when "max pages" is 0/unlimited

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rng = () => Math.random();

  // ---- human pace ------------------------------------------------------------
  // Every navigation/fetch draws one token from a shared bucket (persisted in
  // ms_state), so the request rate stays capped no matter how the loop behaves.
  const prof = (s) => PACE.profileFor(s.settings && s.settings.paceProfile);
  const motionOn = (s) => !s || !s.settings || s.settings.motion !== false;

  async function paceGate(s, kind) {
    const p = prof(s);
    const { waitMs, bucket } = PACE.take(s.bucket, p, Date.now());
    s.bucket = bucket;
    if (waitMs > 0) await sleep(waitMs);
    await sleep(PACE.delay(p, kind, rng));
  }

  // Between pages: rate + human delay + periodic long break / session break.
  async function pagePause(s) {
    const p = prof(s);
    s.pagesSinceBreak = (s.pagesSinceBreak || 0) + 1;
    s.sessionStart = s.sessionStart || Date.now();
    await paceGate(s, "page");
    if (s.pagesSinceBreak >= p.breakEveryPages) {
      s.pagesSinceBreak = 0;
      await sleep(PACE.delay(p, "break", rng));
    }
    if (Date.now() - s.sessionStart >= p.sessionMinutes * 60000) {
      s.sessionStart = Date.now();
      await sleep(PACE.delay(p, "session", rng));
    }
  }

  // Between tasks: rate + human delay + a longer break every N tasks.
  async function taskPause(s) {
    const p = prof(s);
    s.tasksSinceBreak = (s.tasksSinceBreak || 0) + 1;
    await paceGate(s, "task");
    if (s.tasksSinceBreak >= p.breakEveryTasks) {
      s.tasksSinceBreak = 0;
      await sleep(PACE.delay(p, "taskBreak", rng));
    }
  }

  // ---- human motion ----------------------------------------------------------
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function smoothTo(el, to, ms) {
    if (el.scrollTop === to) return Promise.resolve();
    const from = el.scrollTop;
    return new Promise((res) => {
      const start = performance.now();
      (function step() {
        const t = Math.min(1, (performance.now() - start) / ms);
        try { el.scrollTop = from + (to - from) * ease(t); } catch {}
        if (t < 1) requestAnimationFrame(step);
        else res();
      })();
    });
  }

  async function humanClick(el) {
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    try { el.dispatchEvent(new PointerEvent("pointerover", opts)); } catch {}
    el.dispatchEvent(new MouseEvent("mouseover", opts));
    el.dispatchEvent(new MouseEvent("mousemove", opts));
    await sleep(80 + Math.floor(rng() * 170)); // hover before pressing
    try { el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, buttons: 1 })); } catch {}
    el.dispatchEvent(new MouseEvent("mousedown", { ...opts, buttons: 1 }));
    await sleep(40 + Math.floor(rng() * 90));
    try { el.dispatchEvent(new PointerEvent("pointerup", { ...opts, buttons: 0 })); } catch {}
    el.dispatchEvent(new MouseEvent("mouseup", { ...opts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", opts));
  }

  const { parseCoords, parseCid, cleanWebsite, splitAddress, normalizePhone } = MP;

  const getState = () => new Promise((r) => chrome.storage.local.get(KEY, (o) => r(o[KEY] || null)));
  const setState = (s) => new Promise((r) => chrome.storage.local.set({ [KEY]: s }, r));
  const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, (res) => r(res || {})));

  async function waitFor(fn, timeout = 20000, interval = 300) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try { const v = fn(); if (v) return v; } catch {}
      await sleep(interval);
    }
    return null;
  }

  const cardCount = () => SELX.queryAll(document, SEL.cardContainers).length;

  // ---- card parsing ----------------------------------------------------------
  function firstText(card, selectors) {
    return SELX.firstText(card, selectors);
  }

  function ratingOf(card) {
    const direct = firstText(card, SEL.rating);
    const m = (direct || "").match(/\d+([.,]\d+)?/);
    if (m) return m[0].replace(",", ".");
    const aria = card.querySelector("[aria-label*='star'], [aria-label*='Rated']");
    if (aria) {
      const mm = (aria.getAttribute("aria-label") || "").match(/\d+([.,]\d+)?/);
      if (mm) return mm[0].replace(",", ".");
    }
    return "";
  }

  function reviewsOf(card) {
    const raw = firstText(card, SEL.reviews);
    const m = raw.replace(/[()]/g, "").match(/[\d.,]+/);
    return m ? m[0].replace(/[.,]/g, "") : "";
  }

  function detailRows(card) {
    return [...card.querySelectorAll(".rllt__details > div, .lqhpac")].map((d) => d.textContent.replace(/\s+/g, " ").trim());
  }

  function phoneFromCard(card, rows) {
    const attr = card.querySelector("[data-phone-number]");
    if (attr) return normalizePhone(attr.getAttribute("data-phone-number") || "");
    for (const row of rows) {
      for (const part of row.split(/\s·\s|·/)) {
        const t = part.trim();
        const digits = (t.match(/\d/g) || []).length;
        if (/^[+\d\s\-()]+$/.test(t) && digits >= 7 && digits <= 15) return normalizePhone(t);
      }
    }
    return "";
  }

  function splitDetails(rows) {
    let address = "";
    let category = "";
    for (const row of rows) {
      const parts = row.split(/\s·\s|·/).map((p) => p.trim()).filter(Boolean);
      const nonPhone = parts.filter((p) => !/^[+\d\s\-()]+$/.test(p) || (p.match(/\d/g) || []).length < 7);
      const hasBoth = nonPhone.some((p) => /\d/.test(p) && /[a-z]/i.test(p));
      if (!address && hasBoth) address = row;
      else if (!category && row !== address && nonPhone.join(" ").trim()) category = row;
    }
    return { address, category };
  }

  function linksFromCard(card) {
    const anchors = [...card.querySelectorAll("a[href], a[data-url]")];
    let website = "";
    let mapUrl = "";
    let cid = "";
    for (const a of anchors) {
      const href = a.getAttribute("href") || a.getAttribute("data-url") || "";
      const text = (a.textContent || "").toLowerCase();
      const abs = /^https?:/i.test(href) ? href : href.startsWith("/") ? "https://www.google.com" + href : "";
      if (!abs) continue;
      if (abs.includes("/maps/place/") || abs.includes("/maps/dir/")) {
        if (!mapUrl) mapUrl = abs;
        if (!cid) cid = parseCid(abs);
        continue;
      }
      const cleaned = cleanWebsite(abs);
      let host = "";
      try { host = new URL(cleaned).hostname; } catch {}
      if (!host || SELX.isGoogleHost(host) || /\/maps\//.test(abs)) continue;
      const looksWebsite = /website|site|visit|^https?:/.test(text) || /\/url\?/.test(abs) || !text;
      if (!website && looksWebsite) website = cleaned;
    }
    return { website, mapUrl, cid };
  }

  function parseCard(card) {
    const name = firstText(card, SEL.name);
    const rows = detailRows(card);
    const { website, mapUrl, cid } = linksFromCard(card);
    const mapAnchor = SELX.firstMatch(card, SEL.mapsLink);
    const coords = parseCoords(mapAnchor ? mapAnchor.getAttribute("href") || "" : "");
    const details = splitDetails(rows);
    const addr = firstText(card, SEL.address) || details.address;
    const category = firstText(card, SEL.category) || details.category;
    const { city, state, pincode, country } = splitAddress(addr);
    return {
      company_name: name,
      category,
      address: addr,
      city,
      state,
      pincode,
      country,
      phone: phoneFromCard(card, rows),
      website,
      emails: "",
      rating: ratingOf(card),
      reviews: reviewsOf(card),
      latitude: coords.latitude,
      longitude: coords.longitude,
      cid: cid || "",
      plus_code: "",
      keyword: "",
      location: "",
      url: mapUrl || "",
      source: "dom",
      scraped_at: new Date().toISOString(),
    };
  }

  function keyOf(row) {
    return row.cid || (row.company_name || "") + "|" + (row.address || "");
  }

  // ---- block detection -------------------------------------------------------
  function detectBlock(root, url) {
    const u = url || location.href;
    if (/consent\.google\.com/.test(u) || SELX.firstMatch(root, SEL.consent)) return "consent";
    if (/\/sorry\//.test(u) || SELX.firstMatch(root, SEL.captcha)) return "captcha";
    const body = root && root.body ? root.body.textContent || "" : "";
    if (/detected unusual traffic|unusual traffic from your computer/i.test(body.slice(0, 40000))) return "captcha";
    return "";
  }

  async function pauseFor(s, reason) {
    s.paused = true;
    s.pauseReason = reason;
    await setState(s);
  }

  // Escalating backoff: 5 -> 15 -> 60 min, then stop for the day. The actual
  // wait runs in the background (alarm), so it survives navigation.
  async function handleBlock(s, reason) {
    const { level, minutes, stop } = PACE.nextBackoff(s.backoffLevel || 0);
    s.backoffLevel = level;
    s.paused = true;
    if (stop) {
      s.running = false;
      s.phase = "done";
      s.pauseReason = `${reason}: backoff limit reached — stopped. Let it cool down, then Start again.`;
      await setState(s);
      send({ type: "NOTIFY", title: "Google Map Extractor stopped", message: s.pauseReason });
      return;
    }
    s.resolveAt = Date.now() + minutes * 60000;
    s.pauseReason = `${reason}: backing off ${minutes} min (level ${level}/3)`;
    await setState(s);
    send({ type: "NOTIFY", title: "Google Map Extractor paused", message: s.pauseReason });
    send({ type: "SCHEDULE_BACKOFF", resolveAt: s.resolveAt });
  }

  // ---- process a results document (DOM + JSON) -------------------------------
  async function processDocument(root, s) {
    const map = new Map();

    for (const card of SELX.queryAll(root, SEL.cardContainers)) {
      const r = parseCard(card);
      if (!r.company_name) continue;
      r.keyword = s.keyword || "";
      r.location = s.location || "";
      r.query = s.query || "";
      map.set(keyOf(r), Object.assign(map.get(keyOf(r)) || {}, r));
    }

    // Tier 2: embedded JSON is authoritative where present (exact cid/coords).
    const jx = JSONX.extract(root);
    for (const jr of jx.rows) {
      const k = keyOf(jr);
      const base = map.get(k);
      if (base) {
        for (const f in jr) if (jr[f] !== "" && jr[f] != null) base[f] = jr[f];
      } else {
        jr.keyword = s.keyword || "";
        jr.location = s.location || "";
        jr.query = s.query || "";
        map.set(k, jr);
      }
    }

    const rows = [...map.values()];
    // A "category" is always text; reject numeric/rating junk from selectors or JSON.
    for (const r of rows) if (!/[a-z]/i.test(String(r.category || ""))) r.category = "";

    if (s.settings.extractEmail && s.settings.enrichMode === "during") {
      for (const r of rows) {
        if (r.website && !r.emails) {
          const res = await send({ type: "FIND_EMAILS", url: r.website, blacklist: s.settings.blacklist || [], timeoutMs: (s.settings.maxEmailTime || 8) * 1000 });
          r.emails = (res.emails || []).join("; ");
        }
      }
    }

    const { added, limit } = await send({ type: "SAVE_ROWS", rows });

    if (s.settings.extractEmail && s.settings.enrichMode === "after") {
      const items = rows.filter((r) => r.website).map((r) => ({ key: keyOf(r), website: r.website }));
      if (items.length) send({ type: "ENQUEUE_EMAILS", items, blacklist: s.settings.blacklist || [], timeoutMs: (s.settings.maxEmailTime || 8) * 1000 });
    }

    return { parsed: rows.length, added, limit: !!limit };
  }

  // Free tier hit its row cap: stop the run and tell the user to activate.
  async function licenseStop(s) {
    s.running = false;
    s.paused = false;
    s.phase = "done";
    s.stopReason = "Free limit reached (50 rows). Activate a license to keep extracting.";
    await setState(s);
    send({ type: "NOTIFY", title: "Google Map Extractor", message: s.stopReason });
  }

  function searchUrl(query, start) {
    const u = new URL("https://www.google.com/search");
    u.searchParams.set("q", query);
    u.searchParams.set("tbm", "lcl");
    u.searchParams.set("num", String(PAGE_SIZE));
    if (start) u.searchParams.set("start", String(start));
    return u.toString();
  }

  // Google's own next-page link (language-independent, carries the real params).
  function nextPageLink(root) {
    const scope = root || document;
    const direct = SELX.firstMatch(scope, SEL.nextLink);
    if (direct) return direct;
    const links = [...scope.querySelectorAll('a[href*="start="]')];
    return links.find((a) => /next|weiter|suivant|siguiente|sonraki|次/i.test((a.getAttribute("aria-label") || a.textContent || "").trim())) || null;
  }

  function nextPageHref(root) {
    const link = nextPageLink(root);
    return link && link.href ? link.href : "";
  }

  // A clickable next control (local finder panel) when there is no link to follow.
  function nextPageButton(root) {
    const scope = root || document;
    const cands = [...scope.querySelectorAll('[role="button"], button, a, [jsaction], [aria-label]')];
    return (
      cands.find((el) => {
        if (el.tagName === "A" && el.href) return false;
        if (!el.offsetParent) return false; // must be visible (i.e. after scrolling)
        const al = (el.getAttribute("aria-label") || "").trim();
        const js = el.getAttribute("jsaction") || "";
        const tx = (el.textContent || "").trim();
        return (
          /next page|^next$|weiter|suivant|siguiente|sonraki/i.test(al) ||
          /next/i.test(js) ||
          /^(next|next page)$/i.test(tx)
        );
      }) || null
    );
  }

  // Prefer a real clickable control (link first, then button); href alone as last resort.
  function findNextNow(root) {
    const link = nextPageLink(root);
    if (link && link.href) return { el: link, href: link.href };
    const btn = nextPageButton(root);
    if (btn) return { el: btn };
    if (link) return { href: link.href };
    return {};
  }

  // The local-finder pagination only renders at the END of the scrollable panel,
  // so scroll down in small human steps, then look again.
  function scrollers() {
    return [
      document.scrollingElement,
      ...document.querySelectorAll('[role="feed"], #search, #rso, .m6QErb, c-wiz, div[tabindex="0"]'),
    ].filter(Boolean);
  }

  async function revealNext(s) {
    const motion = motionOn(s);
    for (let i = 0; i < 8; i++) {
      for (const el of scrollers()) {
        if (!motion) { try { el.scrollTop = el.scrollHeight; } catch {} continue; }
        const target = el.scrollHeight;
        const steps = 3 + Math.floor(rng() * 3);
        for (let k = 0; k < steps; k++) {
          const cur = el.scrollTop;
          const remaining = target - cur;
          if (remaining <= 2) break;
          const step = Math.min(remaining, 200 + Math.floor(rng() * 500));
          await smoothTo(el, cur + step, 120 + Math.floor(rng() * 240));
          if (rng() < 0.2) await sleep(150 + Math.floor(rng() * 350)); // pause as if reading
        }
      }
      if (motion) { try { window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); } catch {} }
      await sleep(300);
      const found = findNextNow();
      if (found.href || found.el) return found;
    }
    return {};
  }

  // Robust to both "replace the list" and "append to the list" pagination.
  function pageSignature() {
    const cards = SELX.queryAll(document, SEL.cardContainers);
    const norm = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim().slice(0, 60) : "");
    return cards.length + "|" + norm(cards[0]) + "|" + norm(cards[cards.length - 1]);
  }

  async function stillRunning() {
    const cur = await getState();
    return !!(cur && cur.running && !cur.paused);
  }

  // ---- phases ----------------------------------------------------------------
  async function doSearchFast(s) {
    const FAST_PAGE_CAP = 8; // burst cap: then force one real navigation
    let page = s.startPage || 0;
    let url = searchUrl(s.query, page * PAGE_SIZE);
    s.visited = s.visited || {};
    let fastPages = 0;
    for (;;) {
      if (s.visited[url]) break;
      s.visited[url] = 1;
      let html = "";
      try {
        const res = await fetch(url, { credentials: "include" });
        if (res.status === 429 || res.status === 503) return handleBlock(s, "HTTP " + res.status);
        if (res.ok) html = await res.text();
      } catch {}
      if (!html) return doSearchNav(s); // fall back to navigation mode
      const doc = new DOMParser().parseFromString(html, "text/html");
      const block = detectBlock(doc, "https://www.google.com/search");
      if (block) return handleBlock(s, block);
      const { parsed, added, limit } = await processDocument(doc, s);
      if (limit) return licenseStop(s);
      await sleep(Math.min(parsed * 200, 2500)); // reading dwell
      const href = nextPageHref(doc);
      s.lastProgressAt = Date.now();
      page++;
      fastPages++;
      const underMax = (!s.settings.maxPages || page < s.settings.maxPages) && page < PAGE_HARD_CAP;
      if (!underMax || (added === 0 && !href)) break;
      if (!(await stillRunning())) return;
      s.startPage = page;
      s.pageStart = page * PAGE_SIZE;
      await setState(s);
      url = href || searchUrl(s.query, page * PAGE_SIZE);
      if (fastPages >= FAST_PAGE_CAP) {
        s.fastDisabled = true; // finish the run with real navigation
        await setState(s);
        return location.assign(url);
      }
      await pagePause(s);
    }
    await setState(s);
    return nextTask(s);
  }

  async function doSearchNav(s) {
    const block = detectBlock(document);
    if (block) return handleBlock(s, block);
    await waitFor(() => cardCount() || SELX.firstMatch(document, SEL.resultRoot), 20000);
    await sleep(Math.min(cardCount() * 200, 2500)); // read the first screen like a human

    const seen = new Set();
    for (let guard = 0; guard < PAGE_HARD_CAP; guard++) {
      s.lastProgressAt = Date.now();
      const { added, limit } = await processDocument(document, s);
      if (limit) return licenseStop(s);

      const page = (s.startPage || 0) + 1;
      if (s.settings.maxPages && page >= s.settings.maxPages) {
        s.stopReason = "max pages reached";
        await setState(s);
        return nextTask(s);
      }

      const sig = pageSignature();
      if (seen.has(sig)) {
        s.stopReason = "end of results (pagination loop)";
        await setState(s);
        return nextTask(s);
      }
      seen.add(sig);

      // Scroll to the end of the page/panel, THEN look for the next control.
      let next = findNextNow();
      if (!next.href && !next.el) next = await revealNext(s);

      if (!next.href && !next.el) {
        // Scrolling may have lazily loaded more rows (infinite-scroll case).
        const again = await processDocument(document, s);
        if (again.limit) return licenseStop(s);
        if (again.added > 0) {
          s.startPage = page;
          s.pageStart = page * PAGE_SIZE;
          s.lastProgressAt = Date.now();
          seen.add(pageSignature());
          await setState(s);
          await pagePause(s);
          if (!(await stillRunning())) return;
          continue;
        }
        // Last resort: try Google's start= paging even without a detected control.
        const fallback = searchUrl(s.query, page * PAGE_SIZE);
        s.visited = s.visited || {};
        if (added > 0 && !s.visited[fallback]) {
          s.visited[fallback] = 1;
          s.startPage = page;
          s.pageStart = page * PAGE_SIZE;
          s.lastProgressAt = Date.now();
          await setState(s);
          await pagePause(s);
          if (!(await stillRunning())) return;
          return location.assign(fallback);
        }
        s.stopReason = added === 0 ? "end of results" : "end of results (no next button)";
        await setState(s);
        return nextTask(s);
      }

      s.startPage = page;
      s.pageStart = page * PAGE_SIZE;
      s.lastProgressAt = Date.now();
      s.visited = s.visited || {};
      if (next.href) {
        if (s.visited[next.href]) {
          s.stopReason = "next page already visited";
          await setState(s);
          return nextTask(s);
        }
        s.visited[next.href] = 1;
      }
      await setState(s);
      await pagePause(s);
      if (!(await stillRunning())) return;

      // Prefer a real click on Google's own next control (more human than a URL jump).
      if (next.el && next.el.tagName === "A" && next.el.href) return humanClick(next.el);
      if (next.el) {
        const before = sig;
        await humanClick(next.el);
        const changed = await waitFor(() => pageSignature() !== before, 8000);
        if (!changed) {
          s.stopReason = "next click had no effect";
          await setState(s);
          return nextTask(s);
        }
        continue; // paginated in place -> re-parse
      }
      if (next.href) return location.assign(next.href); // no clickable control: follow the URL
    }
  }

  function doSearch(s) {
    if (s.settings && s.settings.fastMode && !s.fastDisabled) return doSearchFast(s);
    return doSearchNav(s);
  }

  async function nextTask(s) {
    if (!(await stillRunning())) return;
    s.tasks = s.tasks || [];
    if (!s.shuffled) {
      s.tasks = PACE.shuffle(s.tasks, PACE.mulberry32(Date.now() ^ 0x9e3779b9));
      s.shuffled = true;
    }
    if (!s.tasks.length) {
      s.phase = "done";
      s.running = false;
      return setState(s);
    }
    const task = s.tasks.shift();
    const [kw = "", loc = ""] = task.split("~in~");
    s.activeTask = task;
    s.keyword = kw.trim();
    s.location = loc.trim();
    s.query = [s.keyword, s.location].filter(Boolean).join(" ");
    s.startPage = 0;
    s.pageStart = 0;
    s.phase = "search";
    s.visited = {};
    s.fastDisabled = false;
    s.backoffLevel = 0; // a completed task means we are not blocked
    s.stopReason = "";
    s.lastProgressAt = Date.now();
    await setState(s);
    await taskPause(s);
    if (!(await stillRunning())) return;
    location.assign(searchUrl(s.query, 0));
  }

  let started = false;
  async function main() {
    if (started) return;
    const s = await getState();
    if (!s || !s.running || s.paused) return;
    if (/consent\.google\.com/.test(location.host)) return pauseFor(s, "consent");
    started = true;
    try {
      if (s.phase === "next") return nextTask(s);
      if (s.phase === "search") return doSearch(s);
    } catch (e) {
      s.log = (s.log || []).concat(`${new Date().toISOString()} ${String(e)}`).slice(-50);
      await setState(s);
    }
  }

  // ---- diagnostics (Tier 1) --------------------------------------------------
  function diagnose() {
    const counts = {};
    for (const group in SEL) {
      if (group === "version" || !Array.isArray(SEL[group])) continue;
      let n = 0;
      for (const sel of SEL[group]) {
        try { n += document.querySelectorAll(sel).length; } catch {}
      }
      counts[group] = n;
    }
    const visibleControls = [...document.querySelectorAll('button, [role="button"], a, [jsaction], [aria-label]')]
      .filter((el) => el.offsetParent)
      .map((el) => ({ tag: el.tagName, al: (el.getAttribute("aria-label") || "").slice(0, 40), tx: (el.textContent || "").trim().slice(0, 25) }))
      .filter((x) => x.al || x.tx)
      .slice(-40);
    return {
      url: location.href,
      selectorVersion: SEL.version,
      cards: cardCount(),
      counts,
      pagination: { nextHref: nextPageHref(), hasButton: !!nextPageButton(), controls: visibleControls },
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === "DIAGNOSE") { sendResponse(diagnose()); return true; }
    if (msg.type === "DUMP") { sendResponse(JSONX.dump(document)); return true; }
    return false;
  });

  main();
})();
