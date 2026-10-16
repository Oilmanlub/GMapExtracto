// Human-pace engine: rate limiting + human-shaped delays, so scraping a real
// Google session stays under the CAPTCHA/ban radar without crawling.
//
// Classic script: exposed on globalThis.PACE (+ module.exports for the node self-test).
// State (bucket, backoff level) is plain JSON so it can live in ms_state across
// page reloads.
(function (root) {
  // ---- seeded RNG (deterministic for tests) ---------------------------------
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Box-Muller; guards against log(0).
  function normal(rng) {
    let u = 0;
    while (u === 0) u = rng();
    const v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // Log-normal: mostly near the median, with an occasional long tail -- far less
  // machine-like than a flat uniform range.
  function logNormal(medianMs, sigma, rng) {
    const ms = medianMs * Math.exp(sigma * normal(rng));
    return Math.max(300, Math.min(120000, Math.round(ms)));
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---- token bucket ----------------------------------------------------------
  // capacity tokens (a short burst), refilled at steadyRpm. Every page AND task
  // draws one token, so the request rate is capped no matter what the loop does.
  function newBucket(profile, now) {
    return { tokens: profile.burstCapacity, ts: now };
  }

  // Returns { waitMs, bucket }: caller sleeps waitMs, then stores the bucket.
  function take(bucket, profile, now) {
    const rate = profile.steadyRpm / 60000; // tokens per ms
    const b = bucket && typeof bucket.tokens === "number" ? bucket : newBucket(profile, now);
    let tokens = Math.min(profile.burstCapacity, b.tokens + (now - b.ts) * rate);
    if (tokens >= 1) return { waitMs: 0, bucket: { tokens: tokens - 1, ts: now } };
    const waitMs = Math.ceil((1 - tokens) / rate);
    return { waitMs, bucket: { tokens: 0, ts: now } };
  }

  // ---- backoff ladder --------------------------------------------------------
  // 5 -> 15 -> 60 minutes, then stop for the day. Never retry instantly.
  const BACKOFF_MINUTES = [5, 15, 60];
  function nextBackoff(level) {
    const lv = level || 0;
    if (lv >= BACKOFF_MINUTES.length) return { level: lv, minutes: 0, stop: true };
    return { level: lv + 1, minutes: BACKOFF_MINUTES[lv], stop: false };
  }

  // ---- profiles --------------------------------------------------------------
  const PROFILES = {
    conservative: {
      steadyRpm: 8, burstCapacity: 4,
      pageMedianMs: 3400, pageSigma: 0.6,
      taskMedianMs: 6000, taskSigma: 0.6,
      breakEveryPages: 4, breakMinMs: 30000, breakMaxMs: 60000,
      breakEveryTasks: 3, taskBreakMinMs: 90000, taskBreakMaxMs: 150000,
      sessionMinutes: 15, sessionBreakMinMs: 300000, sessionBreakMaxMs: 600000,
      motion: true,
    },
    balanced: {
      steadyRpm: 14, burstCapacity: 8,
      pageMedianMs: 2200, pageSigma: 0.55,
      taskMedianMs: 4500, taskSigma: 0.55,
      breakEveryPages: 5, breakMinMs: 20000, breakMaxMs: 45000,
      breakEveryTasks: 3, taskBreakMinMs: 60000, taskBreakMaxMs: 120000,
      sessionMinutes: 20, sessionBreakMinMs: 300000, sessionBreakMaxMs: 600000,
      motion: true,
    },
    aggressive: {
      steadyRpm: 18, burstCapacity: 12,
      pageMedianMs: 1500, pageSigma: 0.5,
      taskMedianMs: 3000, taskSigma: 0.5,
      breakEveryPages: 8, breakMinMs: 15000, breakMaxMs: 30000,
      breakEveryTasks: 5, taskBreakMinMs: 45000, taskBreakMaxMs: 90000,
      sessionMinutes: 30, sessionBreakMinMs: 240000, sessionBreakMaxMs: 420000,
      motion: true,
    },
  };

  const profileFor = (name) => PROFILES[name] || PROFILES.balanced;

  // Delay for a given kind of pause. "break"/"session" are uniform; page/task
  // are log-normal.
  function delay(profile, kind, rng) {
    const r = rng || Math.random;
    if (kind === "break") return Math.round(profile.breakMinMs + r() * (profile.breakMaxMs - profile.breakMinMs));
    if (kind === "session") return Math.round(profile.sessionBreakMinMs + r() * (profile.sessionBreakMaxMs - profile.sessionBreakMinMs));
    if (kind === "taskBreak") return Math.round(profile.taskBreakMinMs + r() * (profile.taskBreakMaxMs - profile.taskBreakMinMs));
    if (kind === "task") return logNormal(profile.taskMedianMs, profile.taskSigma, r);
    return logNormal(profile.pageMedianMs, profile.pageSigma, r);
  }

  root.PACE = {
    PROFILES, profileFor, mulberry32, normal, logNormal, shuffle,
    newBucket, take, nextBackoff, delay, BACKOFF_MINUTES,
    _internal: { mulberry32, normal, logNormal, shuffle },
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.PACE;
})(typeof globalThis !== "undefined" ? globalThis : this);
