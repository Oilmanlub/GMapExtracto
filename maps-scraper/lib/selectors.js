// Central, versioned selector map. Google renames classes; patch them HERE only.
// Loaded as a classic script before content.js; exposed on globalThis.SEL.
(function (root) {
  const SEL = {
    version: "2024-01",
    // Containers that hold one local-result card each.
    cardContainers: ['[jscontroller="AtSb"]', "div.VkpGBb", "div.lQKkwd", "div.g"],
    // Field selectors, tried in order; first non-empty wins.
    name: [".dbg0pd", ".qBF1Pd", ".OSrXXb", '[role="heading"]', "h3"],
    rating: [".yi40Hd", ".e4rVHe", ".z3HNkc span", 'span[role="img"]'],
    reviews: [".RDApEe", ".UY7F9", ".e4rVHe"],
    category: [".Y0A0hc", ".lqhpac .nblRk", ".rllt__details .Y0A0hc"],
    address: [
      ".lqhpac",
      '[data-attrid="kc:/location/location:address"]',
      ".rllt__details > div:not(:has(span))",
    ],
    phone: ["[data-phone-number]", '[data-attrid*="phone"]', ".rllt__details .rllt__wrapped"],
    websiteLink: ["a[data-url]", "a[href][data-ved]"],
    mapsLink: ['a[href*="/maps/place/"]', 'a[href*="/maps/dir/"]', 'a[href*="google.com/maps"]'],
    endOfList: ["#pnnext"],
    nextLink: ["#pnnext", 'a[aria-label="Next page"]', 'a[aria-label="Next"]', 'a[title="Next page"]'],
    noResults: ["#topstuff .med", ".g-blk .fUj1eb", "#topstuff .n5448"],
    consent: ['form[action*="consent"]', "#consent", '[aria-modal="true"] form[action*="consent"]'],
    captcha: ["#captcha-form", 'iframe[src*="recaptcha"]', 'form[action*="/sorry/"]'],
    resultRoot: ["#search", "#rso", "#main"],
  };

  // True if host is google-owned. Used to reject non-website links.
  function isGoogleHost(host) {
    return /(^|\.)google\.[a-z.]+$/i.test(host || "") || /(^|\.)googleusercontent\.com$/i.test(host || "");
  }

  function firstMatch(scope, selectors) {
    for (const s of selectors) {
      try {
        const el = scope.querySelector(s);
        if (el) return el;
      } catch {}
    }
    return null;
  }

  function firstText(scope, selectors) {
    const el = firstMatch(scope, selectors);
    return el ? (el.textContent || "").trim() : "";
  }

  // First group with a confident match wins, so a single stale element left in an
  // older selector can't starve the 20 real cards in a later group. A lone match
  // is kept only as a fallback for genuinely single-result pages.
  function queryAll(scope, selectors) {
    let single = null;
    for (const s of selectors) {
      let els;
      try { els = scope.querySelectorAll(s); } catch { continue; }
      if (els.length > 1) return Array.from(els);
      if (els.length === 1 && !single) single = Array.from(els);
    }
    return single || [];
  }

  root.SEL = SEL;
  root.SELX = { isGoogleHost, firstMatch, firstText, queryAll };
  if (typeof module !== "undefined" && module.exports) module.exports = root.SELX;
})(typeof globalThis !== "undefined" ? globalThis : this);
