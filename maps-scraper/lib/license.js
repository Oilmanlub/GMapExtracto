// lib/license.js - Keygen Cloud license state machine (classic script).
//
// Exposes globalThis.LIC so the app page (classic <script>) and the background
// worker (side-effect `import`) can share one implementation. Pure logic is
// chrome-free so selftest.js can require() it under Node.
//
// Free tier: FREE_LIMIT rows, fully usable (view + export). A valid license
// removes the cap. Validation is online (Keygen), with a GRACE_MS offline window
// so a paying user is never locked out by a flaky network.
(() => {
  // ---- config ---------------------------------------------------------------
  // Fill these in from your Keygen dashboard before distributing.
  const CONFIG = {
    account: "ec76292c-8de4-47a3-87f7-d2ac3fb92933",
    buyUrl: "REPLACE_WITH_BUY_URL",
  };
  const API = "https://api.keygen.sh/v1/accounts";
  const STORE_KEY = "ms_lic";
  const DEVICE_KEY = "ms_device";
  const FREE_LIMIT = 50;
  const GRACE_MS = 7 * 24 * 60 * 60 * 1000; // offline tolerance
  const RECHECK_MIN = 720; // re-validate every 12h
  // Keygen codes that mean "this policy tracks machines, so activate one".
  const MACHINE_CODES = new Set(["NO_MACHINES", "NO_MACHINE", "FINGERPRINT_SCOPE_MISMATCH", "FINGERPRINT_SCOPE_REQUIRED"]);

  const hasChrome = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  const configured = () => !/REPLACE_WITH/.test(CONFIG.account);

  // ---- pure logic (no chrome) ----------------------------------------------
  // Keygen validate-key meta.code -> our short state (case-insensitive)
  function interpret(code) {
    switch (String(code || "").toUpperCase()) {
      case "VALID":
      case "EXPIRING":
        return "valid";
      case "EXPIRED":
      case "OLL_EXPIRED":
        return "expired";
      case "SUSPENDED":
      case "BANNED":
        return "revoked";
      case "TOO_MANY_MACHINES":
      case "MACHINE_LIMIT_EXCEEDED":
        return "seat_limit";
      case "NOT_FOUND":
      case "NO_KEY":
        return "bad_key";
      default:
        return "invalid";
    }
  }

  function isLicensed(lic, now = Date.now()) {
    if (!lic || !lic.key) return false;
    if (lic.status === "valid") return true;
    if (lic.status === "offline") return now - (lic.lastValidated || 0) < GRACE_MS;
    return false;
  }

  function stateOf(lic, now = Date.now()) {
    if (!lic || !lic.key) return "free";
    if (lic.status === "valid") return "valid";
    if (lic.status === "offline") return isLicensed(lic, now) ? "offline" : "expired";
    return lic.status || "invalid";
  }

  function shortTag(lic) {
    const s = (lic && (lic.machineId || lic.licenseId || lic.key)) || "";
    let h = 0;
    for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h.toString(36).slice(0, 6).toUpperCase();
  }

  // ---- storage --------------------------------------------------------------
  const read = (k) => new Promise((r) => (hasChrome ? chrome.storage.local.get(k, (o) => r(o[k])) : r(null)));
  const write = (k, v) => new Promise((r) => (hasChrome ? chrome.storage.local.set({ [k]: v }, r) : r()));
  const uuid = () =>
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => ((Math.random() * 16) | (c === "x" ? 8 : 4)).toString(16));

  async function getDeviceId() {
    let id = await read(DEVICE_KEY);
    if (!id) { id = uuid(); await write(DEVICE_KEY, id); }
    return id;
  }
  const getLic = () => read(STORE_KEY);
  const setLic = (lic) => write(STORE_KEY, lic);

  // ---- Keygen calls ---------------------------------------------------------
  async function createMachine(key, fingerprint, licenseId) {
    const data = { type: "machines", attributes: { fingerprint, name: "Chrome Extension", platform: "Chrome", metadata: {} } };
    // Keygen requires the license relationship on machine create, even with license-key auth.
    if (licenseId) data.relationships = { license: { data: { type: "licenses", id: licenseId } } };
    const res = await fetch(`${API}/${CONFIG.account}/machines`, {
      method: "POST",
      headers: { "Content-Type": "application/vnd.api+json", Accept: "application/vnd.api+json", Authorization: `License ${key}` },
      body: JSON.stringify({ data }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, machineId: body.data && body.data.id };
    const err = (body.errors && body.errors[0]) || {};
    return { ok: false, code: err.code || (body.meta && body.meta.code) || "invalid", detail: err.detail || err.title || "" };
  }

  async function validateKey(key, fingerprint, depth = 0) {
    const payload = { meta: fingerprint ? { key, scope: { fingerprint } } : { key } };
    if (typeof console !== "undefined") console.debug("[LIC] request", { hasKey: !!key, keyLen: (key || "").length, scoped: !!fingerprint });
    let res;
    try {
      res = await fetch(`${API}/${CONFIG.account}/licenses/actions/validate-key`, {
        method: "POST",
        headers: { "Content-Type": "application/vnd.api+json", Accept: "application/vnd.api+json" },
        body: JSON.stringify(payload),
      });
    } catch {
      return { ok: false, code: "network" };
    }
    const body = await res.json().catch(() => null);
    if (!body) return { ok: false, code: "network" };
    const meta = body.meta || {};
    const err = (body.errors && body.errors[0]) || {};
    const license = body.data || null;
    if (meta.valid) return { ok: true, license, machineId: meta.scope && meta.scope.machine, code: "valid" };

    const code = meta.code || err.code || (res.ok ? "invalid" : "http_" + res.status);
    const detail = meta.detail || err.detail || err.title || "";
    if (typeof console !== "undefined") console.debug("[LIC] validate", res.status, code, detail);
    if (depth === 0 && fingerprint && MACHINE_CODES.has(code)) {
      const m = await createMachine(key, fingerprint, license && license.id);
      if (m.ok || m.code === "FINGERPRINT_TAKEN") return validateKey(key, fingerprint, depth + 1);
      if (m.code === "MACHINE_LIMIT_EXCEEDED" || m.code === "TOO_MANY_MACHINES") return { ok: false, code: "seat_limit", rawCode: m.code, detail: m.detail };
      return { ok: false, code: interpret(m.code), rawCode: m.code, detail: m.detail };
    }
    return { ok: false, code: interpret(code), rawCode: code, detail, status: res.status, license };
  }

  // Try a plain validation first (works for policies that don't track machines).
  // Only when Keygen asks for a machine do we activate one and retry with scope.
  async function resolveLicense(key) {
    let r = await validateKey(key, null);
    if (r.ok) return r;
    if (MACHINE_CODES.has(r.rawCode)) {
      const deviceId = await getDeviceId();
      r = await validateKey(key, deviceId);
      if (r.ok) r.deviceId = deviceId;
    }
    return r;
  }

  // ---- public API -----------------------------------------------------------
  async function status() {
    const lic = await getLic();
    return { licensed: isLicensed(lic), state: stateOf(lic), lic: lic || null, freeLimit: FREE_LIMIT, configured: configured() };
  }

  async function activate(key) {
    key = String(key || "").trim();
    if (!key) return { ok: false, code: "empty" };
    if (!configured()) return { ok: false, code: "not_configured" };
    const r = await resolveLicense(key);
    if (!r.ok) return { ok: false, code: r.code, raw: r.rawCode, detail: r.detail, status: r.status };
    const a = (r.license && r.license.attributes) || {};
    const lic = {
      key,
      licenseId: (r.license && r.license.id) || null,
      machineId: r.machineId || null,
      plan: a.name || "Licensed",
      expiry: a.expiry || null,
      status: "valid",
      lastValidated: Date.now(),
      deviceId: r.deviceId || null,
    };
    await setLic(lic);
    return { ok: true, lic };
  }

  async function validate() {
    const lic = await getLic();
    if (!lic || !lic.key) return { ok: false, code: "free" };
    if (!configured()) return { ok: false, code: "not_configured", lic };
    const r = await resolveLicense(lic.key);
    if (r.ok) {
      const a = (r.license && r.license.attributes) || {};
      lic.status = "valid";
      lic.lastValidated = Date.now();
      lic.licenseId = (r.license && r.license.id) || lic.licenseId;
      lic.machineId = r.machineId || lic.machineId;
      if (r.deviceId) lic.deviceId = r.deviceId;
      if (a.expiry) lic.expiry = a.expiry;
      if (a.name) lic.plan = a.name;
      await setLic(lic);
      return { ok: true, lic };
    }
    if (r.code === "network") {
      lic.status = "offline"; // keep lastValidated; isLicensed() applies the grace window
      await setLic(lic);
      return { ok: isLicensed(lic), code: "offline", lic };
    }
    lic.status = r.code; // expired | revoked | seat_limit | bad_key | invalid
    await setLic(lic);
    return { ok: false, code: r.code, lic };
  }

  async function deactivate() {
    const lic = await getLic();
    if (lic && lic.key && lic.machineId && configured()) {
      try {
        await fetch(`${API}/${CONFIG.account}/machines/${lic.machineId}`, {
          method: "DELETE",
          headers: { Accept: "application/vnd.api+json", Authorization: `License ${lic.key}` },
        });
      } catch { /* release is best-effort; local clear still happens */ }
    }
    await setLic(null);
    return { ok: true };
  }

  const LIC = { CONFIG, FREE_LIMIT, GRACE_MS, RECHECK_MIN, interpret, isLicensed, stateOf, shortTag, status, activate, validate, deactivate, getLic };
  globalThis.LIC = LIC;
  if (typeof module !== "undefined" && module.exports) module.exports = LIC;
})();
