// Lead segregation for Oilman India (lubricant manufacturer).
// Rule-based keyword classification into 3 tiers, with a hook for AI fallback.
// Classic script: exposed as globalThis.SEG (+ module.exports for the node self-test).
(function (root) {
  const DEFAULT_TIER1 = [
    "oil", "oils", "lubricant", "lubricants", "lube", "lubricating", "petroleum",
    "wholesale", "wholesaler", "distributor", "distributors", "stockist",
    "super stockist", "agency", "castrol", "mobil", "gulf", "servo", "veedol",
    "bharat", "grease", "hydraulic", "engine oil", "motor oil", "fuel",
  ];
  const DEFAULT_TIER2 = [
    "auto parts", "spare parts", "spares", "motor parts", "automobile",
    "auto accessories", "car accessories", "bike accessories", "accessories", "auto spare",
  ];
  const DEFAULT_TIER3 = [
    "garage", "service center", "service centre", "repair", "workshop",
    "bike repair", "car wash", "servicing", "mechanic", "tyre", "puncture",
  ];

  function norm(v) {
    if (Array.isArray(v)) return v.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    if (typeof v === "string") return v.split(/[\n,]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
    return [];
  }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matchers = (list) => list.map((k) => new RegExp("\\b" + esc(k) + "\\b", "i"));
  const anyMatch = (h, mats) => mats.some((re) => re.test(h));

  let memo = { sig: "", out: null };
  function compile(opts) {
    opts = opts || {};
    const t1 = norm(opts.tier1);
    const t2 = norm(opts.tier2);
    const t3 = norm(opts.tier3);
    const raw = {
      tier1: t1.length ? t1 : DEFAULT_TIER1,
      tier2: t2.length ? t2 : DEFAULT_TIER2,
      tier3: t3.length ? t3 : DEFAULT_TIER3,
    };
    const sig = raw.tier1.join("|") + "~" + raw.tier2.join("|") + "~" + raw.tier3.join("|");
    if (memo.sig === sig) return memo.out;
    const out = { raw, m1: matchers(raw.tier1), m2: matchers(raw.tier2), m3: matchers(raw.tier3) };
    memo = { sig, out };
    return out;
  }

  function hay(row) {
    return [row.company_name, row.category, row.keyword, row.query].filter(Boolean).join(" ").toLowerCase();
  }

  function tierOf(row, lists) {
    const c = lists && lists.m1 ? lists : compile(lists);
    const h = hay(row || {});
    if (anyMatch(h, c.m1)) return 1;
    if (anyMatch(h, c.m2)) return 2;
    if (anyMatch(h, c.m3)) return 3;
    return 3; // unmatched -> low priority
  }

  // True only when no tier keyword matched at all (candidate for AI fallback).
  function isUnclear(row, lists) {
    const c = lists && lists.m1 ? lists : compile(lists);
    const h = hay(row || {});
    return !anyMatch(h, c.m1) && !anyMatch(h, c.m2) && !anyMatch(h, c.m3);
  }

  // Toll-free customer-care numbers (India): 1800/1860/1600/1900. Not a dial-out lead.
  function isCareNumber(phone) {
    let d = String(phone == null ? "" : phone).replace(/\D/g, "");
    if (d.startsWith("91") && d.length > 10) d = d.slice(2);
    return /^(1800|1860|1600|1900)/.test(d);
  }
  const usable = (phone) => !!phone && !isCareNumber(phone);

  function action(tier, phone) {
    if (!phone) return "No Phone — Skip";
    if (isCareNumber(phone)) return "Care No. — Skip";
    return tier === 1 ? "Call First" : tier === 2 ? "Call Second" : "Call Last";
  }

  const num = (v) => {
    const n = parseFloat(String(v == null ? "" : v).replace(",", "."));
    return Number.isFinite(n) ? n : -1;
  };
  // Priority: has a usable phone, then rating desc, then reviews desc.
  function priority(a, b) {
    const pa = usable(a.phone) ? 1 : 0;
    const pb = usable(b.phone) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    if (num(b.rating) !== num(a.rating)) return num(b.rating) - num(a.rating);
    return num(b.reviews) - num(a.reviews);
  }

  function segregate(rows, opts) {
    const lists = compile(opts);
    const tiered = (rows || []).map((r) => {
      const tier = r.tier || tierOf(r, lists);
      return { ...r, tier, action: action(tier, r.phone) };
    });
    const counts = { 1: 0, 2: 0, 3: 0 };
    for (const r of tiered) counts[r.tier]++;
    const top10 = tiered.filter((r) => r.tier === 1 && usable(r.phone)).sort(priority).slice(0, 10);
    return { tiered, counts, top10, raw: lists.raw };
  }

  const SEG = { DEFAULT_TIER1, DEFAULT_TIER2, DEFAULT_TIER3, compile, tierOf, isUnclear, action, priority, isCareNumber, usable, segregate };
  root.SEG = SEG;
  if (typeof module !== "undefined" && module.exports) module.exports = SEG;
})(typeof globalThis !== "undefined" ? globalThis : this);
