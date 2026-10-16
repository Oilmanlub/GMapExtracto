// Run: node selftest.js   (asserts the pure parsers behave)
const assert = require("assert");
const MP = require("./lib/parse.js");

// coordinates from the @lat,lng form
assert.deepStrictEqual(MP.parseCoords("https://www.google.com/maps/place/X/@37.7749,-122.4194,15z"), {
  latitude: 37.7749,
  longitude: -122.4194,
});

// coordinates from the !3d..!4d form, negative both
assert.deepStrictEqual(MP.parseCoords("https://x/maps/place/!3d-33.8688!4d151.2093"), {
  latitude: -33.8688,
  longitude: 151.2093,
});

// no coordinates -> nulls
assert.deepStrictEqual(MP.parseCoords("https://x/maps/place/Y"), { latitude: null, longitude: null });

// CID from the hex form -> decimal string
assert.strictEqual(
  MP.parseCid("https://www.google.com/maps/place/X/!1s0x89c25a1b2c3d4e5f:0x1f2ab3/data=!3m1"),
  "2042547"
);

// CID from the ?cid= form
assert.strictEqual(MP.parseCid("https://www.google.com/maps?cid=123456789"), "123456789");

// website redirect unwrapping
assert.strictEqual(MP.cleanWebsite("https://www.google.com/url?q=https://example.com/x"), "https://example.com/x");
assert.strictEqual(MP.cleanWebsite("https://example.com/x"), "https://example.com/x");

// address split (US shape)
assert.deepStrictEqual(MP.splitAddress("123 Main St, Austin, TX 78701"), {
  city: "Austin",
  state: "TX",
  pincode: "78701",
  country: "",
});

// address split with trailing country
assert.deepStrictEqual(MP.splitAddress("1 George St, Sydney NSW 2000, Australia"), {
  city: "1 George St",
  state: "Sydney NSW",
  pincode: "2000",
  country: "Australia",
});

// phone normalization
assert.strictEqual(MP.normalizePhone("+1 (555) 123-4567"), "+15551234567");
assert.strictEqual(MP.normalizePhone("12"), "");
assert.strictEqual(MP.normalizePhone("12345678901"), "12345678901");

// email junk filter + dedupe
assert.strictEqual(MP.isJunkEmail("logo@2x.png"), true);
assert.strictEqual(MP.isJunkEmail("hello@example.com"), true);
assert.strictEqual(MP.isJunkEmail("info@realshop.com"), false);
assert.deepStrictEqual(MP.dedupeEmails(["Info@Real.COM", "info@real.com", "a@example.com", "sales@real.com"]), [
  "info@real.com",
  "sales@real.com",
]);

// phone identity ignores formatting (+91 98765 43210 == 09876543210)
assert.strictEqual(MP.phoneKey("+91 98765 43210"), "919876543210");
assert.strictEqual(MP.phoneKey("(555) 123-4567"), "5551234567");

// phone dedupe: same digits in different punctuation collapse; first wins. blank phones kept.
const dPhil = MP.dedupeByPhone([
  { company_name: "A", phone: "+1 (555) 123-4567" },
  { company_name: "B (dup)", phone: "1-555-123-4567" },
  { company_name: "C", phone: "" },
  { company_name: "D", phone: "" },
  { company_name: "E", phone: "1800 111 222" },
]);
assert.deepStrictEqual(dPhil.keep.map((r) => r.company_name), ["A", "C", "D", "E"]);
assert.deepStrictEqual(dPhil.dropped.map((r) => r.company_name), ["B (dup)"]);

// Tier 2: embedded-JSON extractor internals load under node (no DOM needed)
require("./lib/json-extract.js");
const X = globalThis.JSONX._internal;
const place = [];
place[11] = "Joe's Pizza";
place[10] = "0x89c25a1b2c3d4e5f:0x1f2ab3";
place[9] = [[8], [null, null, 40.7128, -74.006]];
place[4] = [null, null, null, null, null, null, null, "4.6", "1024"];
place[13] = ["Pizza restaurant"];
place[7] = ["https://joes.example"];
place[39] = "123 Bleecker St, New York, NY 10012";
place[178] = [[, , , "+1 212-555-0100"]];
const rec = new Array(15).fill(null);
rec[14] = place;
assert.strictEqual(X.mapsPlace(rec).company_name, "Joe's Pizza");
assert.strictEqual(X.mapsPlace(rec).cid, "0x89c25a1b2c3d4e5f:0x1f2ab3");

// balanced slice keeps nested arrays intact
assert.strictEqual(X.sliceBalanced("data:[[1,[2,3]],4]", 5), "[[1,[2,3]],4]");

// ---- lead segregation ----
const SEG = require("./lib/segregate.js");

// no prefilled keywords: nothing matches until the user defines their lists
assert.strictEqual(SEG.DEFAULT_TIER1.length, 0);
assert.strictEqual(SEG.tierOf({ company_name: "Anything Ltd" }), 3);

const KW = {
  tier1: ["wholesale", "distributor", "stockist", "agency"],
  tier2: ["retail", "shop"],
  tier3: ["kiosk", "stall"],
};

// tier assignment from name / category / keyword
assert.strictEqual(SEG.tierOf({ company_name: "Alpha Wholesale" }, KW), 1);
assert.strictEqual(SEG.tierOf({ company_name: "Beta Shop", category: "retail" }, KW), 2);
assert.strictEqual(SEG.tierOf({ company_name: "Gamma Kiosk" }, KW), 3);
// unmatched rows default to the low-priority tier
assert.strictEqual(SEG.tierOf({ company_name: "Delta Traders", category: "misc" }, KW), 3);

// word-boundary safety: "Wholesaler" must NOT count as "wholesale"
assert.strictEqual(SEG.tierOf({ company_name: "Wholesaler Hub" }, KW), 3);

// custom keyword lists override the defaults
assert.strictEqual(SEG.tierOf({ company_name: "Xyz", category: "retail" }, { tier1: ["retail"], tier2: ["shop"] }), 1);

// AI-fallback candidates
assert.strictEqual(SEG.isUnclear({ company_name: "Some Shop", category: "general" }), true);
assert.strictEqual(SEG.isUnclear({ company_name: "Alpha Wholesale" }, KW), false);

// action rules
assert.strictEqual(SEG.action(1, ""), "No Phone — Skip");
assert.strictEqual(SEG.action(1, "9876543210"), "Call First");
assert.strictEqual(SEG.action(2, "9876543210"), "Call Second");
assert.strictEqual(SEG.action(3, "9876543210"), "Call Last");
// toll-free care numbers: keep the row, but don't call it
assert.strictEqual(SEG.isCareNumber("1800 123 4567"), true);
assert.strictEqual(SEG.isCareNumber("+91 1860 500 000"), true);
assert.strictEqual(SEG.isCareNumber("9876543210"), false);
assert.strictEqual(SEG.action(1, "1800 123 4567"), "Care No. — Skip");

// counts + top-10 (Tier 1 with a phone, sorted by rating)
const segRows = [
  { company_name: "Low Priority Co", phone: "", rating: "4.9" },
  { company_name: "Alpha Wholesale", phone: "111", rating: "4.0" },
  { company_name: "Beta Agency", phone: "222", rating: "4.9" },
  { company_name: "Gamma Shop", phone: "333", rating: "5.0" },
];
const seg = SEG.segregate(segRows, KW);
assert.deepStrictEqual(seg.counts, { 1: 2, 2: 1, 3: 1 });
assert.strictEqual(seg.top10.length, 2); // Tier 1 with a phone only
assert.strictEqual(seg.top10[0].company_name, "Beta Agency"); // higher rating first
// a care number is never a priority call even with a top rating
assert.strictEqual(SEG.segregate([{ company_name: "Alpha Wholesale", phone: "1800 111 222", rating: "5.0" }], KW).top10.length, 0);

// ---- per-location workbook (one tab per Locations-box entry) ----
const XLS = require("./lib/excel.js");
const xml = XLS.buildExcelXml(
  [
    { company_name: "A & Co", location: "Surat", city: "Vadodara" },
    { company_name: "B Ltd", location: "Surat", city: "Rajkot" },
    { company_name: "C", location: "Mumbai", city: "Mumbai" },
    { company_name: "D", location: "", city: "Ahmedabad" },
  ],
  ["company_name", "location", "city"]
);
assert.strictEqual((xml.match(/<Worksheet /g) || []).length, 4); // All + Surat + Mumbai + (no location)
assert.ok(xml.includes('ss:Name="Surat"'), "surat sheet present");
assert.ok(xml.includes("A &amp; Co"), "cell text escaped");
// grouping must follow r.location, never the address-derived city
assert.ok(!xml.includes('ss:Name="Vadodara"'), "city must NOT become a tab");
assert.ok(xml.includes('ss:Name="(no location)"'), "blank location grouped");
const used = new Set(["all"]);
assert.strictEqual(XLS.sheetName("a/b:c", used), "a b c"); // illegal chars stripped
assert.strictEqual(XLS.sheetName("a b c", used), "a b c 2"); // duplicate names uniquified
// XML-illegal control chars are dropped; tab/newline/CR are legal and kept
assert.strictEqual(XLS.xesc("a\u0000b\u0007c"), "abc");
assert.strictEqual(XLS.xesc("ok\ttab\nnl"), "ok\ttab\nnl");
assert.strictEqual(XLS.xesc('A & "B" <C>'), "A &amp; &quot;B&quot; &lt;C&gt;");

// ---- human-pace engine ----
const PACE = require("./lib/pace.js");

// seeded RNG is deterministic
const g1 = PACE.mulberry32(42), g2 = PACE.mulberry32(42);
assert.deepStrictEqual([g1(), g1(), g1()], [g2(), g2(), g2()]);

// log-normal page delay stays in bounds and hovers near the median
const rg = PACE.mulberry32(7);
const paceP = PACE.profileFor("balanced");
let sum = 0;
for (let i = 0; i < 2000; i++) { const d = PACE.delay(paceP, "page", rg); assert.ok(d >= 300 && d <= 120000); sum += d; }
const mean = sum / 2000;
assert.ok(mean > paceP.pageMedianMs * 0.8 && mean < paceP.pageMedianMs * 3, "page delay near median: " + mean);

// break kinds stay inside their configured bands
const brk = PACE.delay(paceP, "taskBreak", rg);
assert.ok(brk >= paceP.taskBreakMinMs && brk <= paceP.taskBreakMaxMs);

// shuffle: deterministic, lossless, input untouched
const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
assert.deepStrictEqual(PACE.shuffle(src, PACE.mulberry32(99)), PACE.shuffle(src, PACE.mulberry32(99)));
assert.deepStrictEqual([...PACE.shuffle(src, PACE.mulberry32(99))].sort((a, b) => a - b), src);
assert.deepStrictEqual(src, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

// token bucket: a full burst passes free, then the next request waits; refill frees it
const t0 = 1000000;
let bkt = PACE.newBucket(paceP, t0);
for (let i = 0; i < paceP.burstCapacity; i++) { const t = PACE.take(bkt, paceP, t0); assert.strictEqual(t.waitMs, 0); bkt = t.bucket; }
const over = PACE.take(bkt, paceP, t0);
assert.ok(over.waitMs > 0, "burst exhausted -> must wait");
assert.strictEqual(PACE.take(over.bucket, paceP, t0 + 60000).waitMs, 0);

// backoff ladder: 5 -> 15 -> 60 min, then stop for the day
assert.deepStrictEqual(PACE.nextBackoff(0), { level: 1, minutes: 5, stop: false });
assert.deepStrictEqual(PACE.nextBackoff(1), { level: 2, minutes: 15, stop: false });
assert.deepStrictEqual(PACE.nextBackoff(2), { level: 3, minutes: 60, stop: false });
assert.strictEqual(PACE.nextBackoff(3).stop, true);

// a rest pushes the "last progress" horizon past the break, so the stall
// watchdog doesn't fire mid-break (background.js waits >90s without progress)
assert.strictEqual(PACE.restUntil(1000, 90000), 91000);
assert.strictEqual(PACE.restUntil(5000, -10), 5000); // negative clamps to "now"
assert.ok(PACE.restUntil(Date.now(), 300000) - Date.now() >= 299000);

// ---- DOM selectors (pure selection policy, fake scope) ----
const SELX = require("./lib/selectors.js");
const fakeScope = (map) => ({ querySelectorAll: (s) => map[s] || [] });
// one stale element in an older selector must not starve a later group of real cards
assert.strictEqual(SELX.queryAll(fakeScope({ a: [{ id: 1 }], b: [{ id: 2 }, { id: 3 }] }), ["a", "b"]).length, 2);
// a confident first group still wins outright
assert.strictEqual(SELX.queryAll(fakeScope({ a: [{ id: 1 }, { id: 2 }], b: [{ id: 3 }, { id: 4 }, { id: 5 }] }), ["a", "b"]).length, 2);
// a single-result page keeps the lone fallback
assert.strictEqual(SELX.queryAll(fakeScope({ a: [{ id: 1 }], b: [] }), ["a", "b"]).length, 1);
assert.deepStrictEqual(SELX.queryAll(fakeScope({}), ["a", "b"]), []);
// an invalid selector is skipped, not thrown
assert.strictEqual(SELX.queryAll({ querySelectorAll: (s) => { if (s === "bad[") throw new Error("nope"); return [{ id: 9 }]; } }, ["bad[", "ok"]).length, 1);

// ---- licensing (Keygen state machine, pure logic) ----
const LIC = require("./lib/license.js");
assert.strictEqual(LIC.FREE_LIMIT, 50);

// Keygen meta.code -> short state
assert.strictEqual(LIC.interpret("VALID"), "valid");
assert.strictEqual(LIC.interpret("EXPIRING"), "valid");
assert.strictEqual(LIC.interpret("EXPIRED"), "expired");
assert.strictEqual(LIC.interpret("SUSPENDED"), "revoked");
assert.strictEqual(LIC.interpret("BANNED"), "revoked");
assert.strictEqual(LIC.interpret("TOO_MANY_MACHINES"), "seat_limit");
assert.strictEqual(LIC.interpret("NOT_FOUND"), "bad_key");
assert.strictEqual(LIC.interpret("WAT"), "invalid");

// licensed = valid, or offline within the 7-day grace window
const now = 1_000_000_000_000;
assert.strictEqual(LIC.isLicensed(null), false);
assert.strictEqual(LIC.isLicensed({ key: "K", status: "valid" }, now), true);
assert.strictEqual(LIC.isLicensed({ key: "K", status: "offline", lastValidated: now - 1000 }, now), true);
assert.strictEqual(LIC.isLicensed({ key: "K", status: "offline", lastValidated: now - LIC.GRACE_MS - 1 }, now), false);
assert.strictEqual(LIC.isLicensed({ key: "K", status: "expired" }, now), false);

// stateOf: no key = free; grace-expired offline collapses to expired
assert.strictEqual(LIC.stateOf(null), "free");
assert.strictEqual(LIC.stateOf({ key: "K", status: "valid" }, now), "valid");
assert.strictEqual(LIC.stateOf({ key: "K", status: "offline", lastValidated: now }, now), "offline");
assert.strictEqual(LIC.stateOf({ key: "K", status: "offline", lastValidated: now - LIC.GRACE_MS - 1 }, now), "expired");
assert.strictEqual(LIC.stateOf({ key: "K", status: "revoked" }, now), "revoked");

// watermark tag: stable for the same machine, differs across machines
assert.strictEqual(LIC.shortTag({ machineId: "abc-123" }), LIC.shortTag({ machineId: "abc-123" }));
assert.notStrictEqual(LIC.shortTag({ machineId: "abc-123" }), LIC.shortTag({ machineId: "xyz-789" }));
assert.strictEqual(typeof LIC.shortTag(null), "string");

// account id is a non-empty string (configured build); empty key is rejected offline.
assert.ok(typeof LIC.CONFIG.account === "string" && LIC.CONFIG.account.length > 0, "account id is set");
LIC.activate("").then((r) => {
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "empty");
  console.log("selftest OK");
});
