// Pure parsing helpers, shared by the content script (browser) and the node self-test.
// Loaded as a classic script before content.js; exposed on globalThis.MP.
(function (root) {
  function parseCoords(href) {
    let m = href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (m) return { latitude: Number(m[1]), longitude: Number(m[2]) };
    m = href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return { latitude: Number(m[1]), longitude: Number(m[2]) };
    return { latitude: null, longitude: null };
  }

  function parseCid(href) {
    let m = href.match(/!1s0x[0-9a-f]+:0x([0-9a-f]+)/i);
    if (m) {
      try {
        return BigInt("0x" + m[1]).toString();
      } catch {}
    }
    m = href.match(/[?&]cid=(\d+)/);
    return m ? m[1] : "";
  }

  function cleanWebsite(href) {
    if (!href) return "";
    try {
      const u = new URL(href);
      if (/(^|\.)google\.com$/.test(u.hostname) && u.pathname === "/url") {
        return u.searchParams.get("q") || href;
      }
    } catch {}
    return href;
  }

  // Best-effort split for the common "street, city, state postcode[, country]" shape.
  // `address` stays authoritative; these components are a convenience.
  function splitAddress(address) {
    if (!address) return { city: "", state: "", pincode: "", country: "" };
    const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return { city: "", state: "", pincode: "", country: "" };

    const pincode = (address.match(/\b(\d{4,6})\b(?!.*\b\d{4,6}\b)/) || ["", ""])[1] || "";
    let rest = parts.slice();
    let country = "";
    const last = rest[rest.length - 1];
    if (rest.length >= 3 && pincode && !/\d/.test(last)) {
      country = last;
      rest = rest.slice(0, -1);
    }
    const stateSeg = rest[rest.length - 1] || "";
    return {
      city: rest.length >= 2 ? rest[rest.length - 2] : "",
      state: stateSeg.replace(pincode, "").trim(),
      pincode,
      country,
    };
  }

  // Trim punctuation, keep leading +, drop obviously-truncated numbers.
  function normalizePhone(raw) {
    if (!raw) return "";
    let s = String(raw).replace(/\s+/g, " ").trim();
    const plus = s.startsWith("+");
    const digits = s.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) return "";
    return (plus ? "+" : "") + digits;
  }

  // Digits-only phone identity, for duplicate detection across formats (+91 98765... vs 098765...).
  function phoneKey(raw) {
    return String(raw == null ? "" : raw).replace(/\D/g, "");
  }

  // Keep the first row per phone; rows with no usable phone are always kept.
  // ponytail: phone is the identity — a chain sharing one number collapses to one lead.
  function dedupeByPhone(rows) {
    const seen = new Set();
    const keep = [];
    const dropped = [];
    for (const r of rows || []) {
      const k = phoneKey(r && r.phone);
      if (k.length < 7) { keep.push(r); continue; }
      if (seen.has(k)) { dropped.push(r); continue; }
      seen.add(k);
      keep.push(r);
    }
    return { keep, dropped };
  }

  const JUNK_EMAIL = /(^|@)(example|test|domain|sentry|wixpress|godaddy|wordpress|no-?reply|donotreply|privacy)\.|\.(png|jpe?g|gif|webp|svg|css|js)$|@\d|sentry\.io|\.sentry\.io/i;

  function isJunkEmail(email) {
    if (!email) return true;
    return JUNK_EMAIL.test(email);
  }

  function dedupeEmails(list) {
    const seen = new Set();
    const out = [];
    for (const raw of list || []) {
      const e = String(raw).trim().toLowerCase();
      if (!e || seen.has(e) || isJunkEmail(e)) continue;
      seen.add(e);
      out.push(e);
    }
    return out.slice(0, 5);
  }

  const MP = { parseCoords, parseCid, cleanWebsite, splitAddress, normalizePhone, phoneKey, dedupeByPhone, isJunkEmail, dedupeEmails };
  root.MP = MP;
  if (typeof module !== "undefined" && module.exports) module.exports = MP;
})(typeof globalThis !== "undefined" ? globalThis : this);
