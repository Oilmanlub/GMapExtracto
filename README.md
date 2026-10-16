# Google Map Extractor

**Bulk-extract business leads from Google — names, phones, websites, emails, ratings, addresses and GPS — straight into CSV, Excel or JSON.**

A Chrome (Manifest V3) extension that turns Google local results into a clean, exportable lead list. Runs entirely on your own machine: no servers, no accounts, no data uploads.

![version](https://img.shields.io/badge/version-1.5.0-blue)
![manifest](https://img.shields.io/badge/manifest-v3-success)
![platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge%20%7C%20Brave-lightgrey)
![license](https://img.shields.io/badge/license-Commercial-orange)
![runs locally](https://img.shields.io/badge/data-stays%20on%20your%20PC-informational)

---

## Table of contents

- [What it does](#what-it-does)
- [Features](#features)
- [Installation](#installation)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Exports](#exports)
- [Email enrichment](#email-enrichment)
- [Human pace (anti-CAPTCHA)](#human-pace-anti-captcha)
- [Lead segregation & tiers](#lead-segregation--tiers)
- [Presets & automation](#presets--automation)
- [Licensing](#licensing)
- [Data & privacy](#data--privacy)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Development](#development)
- [Credits](#credits)
- [Disclaimer](#disclaimer)

---

## What it does

You give it **keywords** (`restaurants`, `dentists`, `plumbers`) and **locations** (`Austin, TX`, `Miami, FL`). Every combination becomes one task. The extension opens Google, walks through the results, extracts the business details from each listing, enriches them with emails from their websites, and builds one deduplicated table you can export.

| Column | Example |
|---|---|
| Company | Blue Bottle Coffee |
| Category | Coffee shop |
| Phone | +1 555-0100 |
| Website | bluebottlecoffee.com |
| Emails | hello@bluebottlecoffee.com |
| Rating / Reviews | 4.6 / 1,204 |
| Address | 300 Webster St, Oakland, CA 94607 |
| City / State / Pincode | Oakland / CA / 94607 |
| Latitude / Longitude | 37.8044 / -122.2712 |
| CID / Plus code / URL | 1234567890 / 849V+ / google.com/maps/... |

---

## Features

- **Keyword × location tasks** — one task per combination, all queued and tracked live.
- **Two data sources** — scrape Google Search results (no key needed) or use the official **Places API** (your billing key, higher fidelity).
- **Email enrichment** — visits each website and pulls contact emails, either inline or as a background queue.
- **Human pace engine** — token-bucket rate limiting + realistic motion profiles (Conservative / Balanced / Aggressive) to reduce CAPTCHA and blocks.
- **Pause / Resume / Stop** — full control mid-run, state survives panel closes.
- **Built-in dedupe & filters** — filter by text, tier, "only with email" or "no duplicate phones"; one click removes duplicates.
- **Lead segregation** — sorts every row into Tier 1 / 2 / 3 using your own keyword lists, with an optional AI fallback for unclear rows.
- **Rich exports** — CSV, Excel (one sheet per location) and JSON. Every download is kept in history so you can re-download later.
- **Presets** — save the whole setup (keywords, locations, options) and reload it per client or niche.
- **Repeat runs** — schedule the same scrape every N minutes for hands-off collection.
- **Scraping & download history** — every run is logged with counts and timestamps.
- **Guided tour** — a built-in walkthrough of every screen on first launch, replayable any time.
- **Dark mode**, keyboard-friendly tabs, and a diagnostics panel ("Test selectors", "Dump page JSON").
- **Runs 100% locally** — results live in your browser's local storage (IndexedDB), never on a server.

---

## Installation

### Option A — Load unpacked (recommended)

1. Download the repository and unzip it (or unzip `GoogleMapExtractor_v1.5.0_portable.zip`).
2. Open `chrome://extensions` in Chrome / Edge / Brave.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the **`maps-scraper`** folder.
5. Pin the extension from the toolbar (puzzle-piece icon → pin).

### Option B — Chrome Web Store

Not published yet. Use Option A.

> Requires any Chromium-based browser (Chrome 88+, Edge, Brave, Opera).

---

## Quick start

1. Click the extension icon to open the panel.
2. On the **Data** tab, type keywords and locations — one per line:

   ```
   restaurants          Austin, TX
   dentists             Miami, FL
   plumbers
   ```

   3 keywords × 2 locations = **6 tasks**.
3. Press **Start Extracting**.
4. Watch progress on the **Tasks** tab (task queue, live progress bar, status dots).
5. Filter/dedupe the results, then export to **CSV**, **Excel** or **JSON**.

> First launch auto-plays a short guided tour of every screen. Replay it via **Take a tour** in the header.

---

## How it works

```
Data tab                 Tasks tab                 Exports
┌──────────────┐   ┌───────────────────┐   ┌──────────────────┐
│ keywords ×   │   │ task queue        │   │ CSV              │
│ locations    │──▶│ progress + status │──▶│ Excel (per-loc)  │
│ options      │   │ results table     │   │ JSON             │
└──────────────┘   └───────────────────┘   └──────────────────┘
        │                    ▲                      ▲
        ▼                    │                      │
  background worker ──▶ content script on Google ──▶ IndexedDB
                          (+ email enrichment)
```

- The **background service worker** queues tasks, honors the pace engine, and stores rows.
- The **content script** runs on Google result pages, extracts listings (DOM + embedded JSON), and follows pagination.
- Everything lands in **IndexedDB**, so data survives restarts.

---

## Exports

| Format | Contents |
|---|---|
| **CSV** | All columns, UTF-8, spreadsheet-safe |
| **Excel (.xlsx)** | One sheet per location — great for per-city delivery |
| **JSON** | Full structured rows, including nested fields and metadata |

Export history keeps every download so you can re-fetch a file without re-scraping.

---

## Email enrichment

| Mode | Behaviour |
|---|---|
| **Off** | No email discovery |
| **After scraping (queue)** | Scrape first, then visit websites to find emails in the background |
| **During scraping (inline)** | Find emails as each row is discovered |

Options: max seconds per website, delay between pages, max pages per keyword, and an **email regex blacklist** (e.g. skip `noreply@`) to filter junk addresses.

---

## Human pace (anti-CAPTCHA)

Scraping too fast triggers Google's bot checks. The pace engine uses a **token bucket** (burst capacity + steady refill rate) plus optional **human motion** to look organic.

| Profile | Speed | Risk |
|---|---|---|
| **Conservative** | Slowest | Safest |
| **Balanced** | Medium | Low |
| **Aggressive** | Fastest | Higher |

The live **risk chip** tells you how hard the current run is pressing. If you see blocks, drop to Conservative and keep **Human motion** on.

---

## Lead segregation & tiers

Sort leads into quality tiers using your own keyword lists (fully editable in **Settings & History → Lead segregation**):

- **Tier 1** — best fit (e.g. `wholesale`, `distributor`, `stockist`)
- **Tier 2** — related (e.g. `spare parts`, `auto accessories`)
- **Tier 3** — lower fit (e.g. `garage`, `repair`, `mechanic`)

Turn on **Auto-segregate after each scrape** to classify automatically, or use **AI fallback** (bring your own API key: base URL, key, model) for ambiguous rows.

---

## Presets & automation

- **Presets** save the entire form (keywords, locations, all options) under a name — load one per client instantly.
- **Repeat run every N minutes** re-runs the same scrape automatically.
- **Fast mode** fetches pages without full reloads (quicker, slightly more detectable).
- **Open each result** pulls extra detail from each listing page (slower, richer rows).

---

## Licensing

The extension is **free for up to 50 rows**. Exporting requires a license — scraping and previewing stay free.

| | Free | Licensed |
|---|---|---|
| Scrape & collect | up to 50 rows | unlimited |
| Export (CSV / Excel / JSON) | — | yes |
| Email enrichment | up to the free cap | unlimited |
| Segregation, presets, history | yes | yes |
| Offline grace | — | 7 days |

### Activate

1. Open the panel → **Settings & History → License** (or the header button).
2. Click **Activate license**, paste your key `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`, confirm.
3. The chip turns **Licensed** and limits are removed.

### One license = one device

Each key is bound to **one computer**. Activating on a second PC while the first is still active returns *"This key is already active on too many devices."*

### Moving to a new PC

1. On the **old PC**: **License → Deactivate**.
2. On the **new PC**: install and activate with the same key.

> Offline? After a successful check the license keeps working for up to **7 days** without internet.

---

## Data & privacy

- **Everything is local.** Rows, presets, history and exports live in your browser's IndexedDB — nothing is uploaded to any server.
- The **only** outbound calls are to Google (scraping/Places) and to the license server (activation/periodic re-check).
- Your license key is stored locally and sent only to the license API; never to Google.
- Emails, phone numbers and addresses you collect are your responsibility to handle lawfully (GDPR/CAN-SPAM/CCPA).

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Panel opens but nothing scrapes | Open a Google search tab first, then press Start |
| "No response — reload the Google tab" | Reload the Google tab and retry |
| Google shows a CAPTCHA | Switch pace to **Conservative**, keep **Human motion** on, wait a few minutes |
| Exports are greyed out | You're on the free tier — activate a license |
| "This key is already active on too many devices" | Deactivate on the other PC first |
| "Couldn't reach the license server" | Check internet; 7-day offline grace applies |
| Stale behaviour after an update | `chrome://extensions` → ↻ reload, then reopen the panel |
| Nothing extracted on a new Google layout | Use **Test selectors** / **Dump page JSON** and report it |

---

## FAQ

**Do I need an API key?**
No. Scraping Google Search works out of the box. A Places API key is optional and only for the official API source.

**Where is my data stored?**
Locally, in your browser. Nothing leaves your machine except Google requests and license checks.

**Can I use it on multiple computers?**
One license = one device. Deactivate on the old PC, then activate on the new one.

**Does it solve CAPTCHAs or rotate proxies?**
No — and by design. It avoids blocks with human pace instead. No UA spoofing, no proxy rotation, no CAPTCHA solving.

**Can I run it unattended?**
Yes — set **Repeat run every N minutes** and use **After scraping (queue)** email enrichment.

---

## Tech stack

- **Manifest V3** Chrome extension — service worker + content scripts
- **Vanilla JavaScript** (ES modules), no build step, no framework
- **IndexedDB** for local persistence
- **Keygen Cloud** for license validation and device binding
- Zero external runtime dependencies

---

## Project structure

```
maps-scraper/
├── manifest.json          # MV3 manifest
├── background.js          # service worker: task queue, pace, storage, license gate
├── content.js             # runs on Google pages: extract, paginate, enrich
├── app.html / app.js      # control panel UI (3 tabs) + guided tour
├── app.css                # design-token based UI (light/dark)
├── selftest.js            # dependency-free assertions
├── lib/
│   ├── parse.js           # parsing helpers
│   ├── selectors.js       # Google DOM selectors + diagnostics
│   ├── json-extract.js    # pull listings from embedded page JSON
│   ├── pace.js            # token-bucket rate limiter + pace profiles
│   ├── db.js              # IndexedDB wrapper
│   ├── segregate.js       # tier classification (+ optional AI fallback)
│   ├── excel.js           # per-location XLSX writer
│   ├── places-api.js      # Google Places API source
│   ├── license.js         # Keygen validate + machine activation
│   └── theme.js           # no-flash theme bootstrap
└── tools/
    ├── keygen-admin.mjs   # issue/revoke keys (admin only; token via env)
    └── make-icons.js      # generate icons
```

---

## Development

No build step. Node is only needed for the checks:

```bash
node maps-scraper/selftest.js        # run assertions
node --check maps-scraper/app.js     # syntax check (use a .mjs copy for ESM)
```

To test: `chrome://extensions` → **Load unpacked** → select `maps-scraper` → **↻** after each change.

---

## Credits

Created by **@NAPX10** · maintained by **Oilmanlub**.

---

## Disclaimer

This tool is provided for legitimate lead research and data collection. You are responsible for complying with Google's Terms of Service and all applicable data-protection and anti-spam laws (GDPR, CCPA, CAN-SPAM). The authors are not liable for misuse. Licensing is enforced to support continued development.
