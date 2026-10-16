# Google Map Extractor — Complete First-Time User Tutorial (Production Grade)

This is a step-by-step, beginner-friendly guide to installing, configuring, and using Google Map Extractor correctly and safely.

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [First Launch](#first-launch)
5. [Interface Overview](#interface-overview)
6. [Quick Start (5-Minute Tutorial)](#quick-start-5-minute-tutorial)
7. [Understanding Free vs Licensed](#understanding-free-vs-licensed)
8. [License Activation & Device Binding](#license-activation--device-binding)
9. [Building Your Search](#building-your-search)
10. [Extraction Modes](#extraction-modes)
11. [Human Pace & Anti-CAPTCHA](#human-pace--anti-captcha)
12. [Email Enrichment](#email-enrichment)
13. [Lead Segregation](#lead-segregation)
14. [Data Management & Filtering](#data-management--filtering)
15. [Exporting Leads](#exporting-leads)
16. [Runs, History & Exports](#runs-history--exports)
17. [Moving License to Another PC](#moving-license-to-another-pc)
18. [Troubleshooting](#troubleshooting)
19. [Best Practices](#best-practices)
20. [Security & Privacy](#security--privacy)

## 1. Introduction
Google Map Extractor is a Chrome extension that extracts local business leads (name, phone, website, address, emails, ratings, GPS, etc.) from Google Maps search results. All processing happens locally on your device — no data is uploaded to third-party servers.

## 2. Prerequisites
- Google Chrome, Brave, Microsoft Edge (Chromium-based)
- Stable internet connection
- Windows 10/11, macOS, or Linux

## 3. Installation
### Option A: Chrome Web Store (Recommended)
1. Visit the product page on Chrome Web Store
2. Click **Add to Chrome → Add extension**
3. Click the puzzle icon (Extensions) → pin **Google Map Extractor**

### Option B: Manual (Unpacked)
1. Extract the `maps-scraper/` folder to a safe location (do not move after loading)
2. Go to `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `maps-scraper` folder
6. Pin the extension to your toolbar

## 4. First Launch
1. Click the **Google Map Extractor** icon in your toolbar
2. The control panel opens in a new window
3. You'll see license status in the **top header** (Free) and in the **Data → License** panel

## 5. Interface Overview
- **Header**: App name, credit, license status chip + Activate/Deactivate button, Dark/Light theme toggle
- **Toolbar**: Start/Pause/Resume/Stop, CSV/Excel/JSON (export), Extract Emails, Clear Data, Results count
- **Tabs**: Data, Tasks, Settings & History
- **Data Tab**: Source/query, Email enrichment, Human pace, Presets, Diagnostics, License (top)
- **Tasks Tab**: Active task, progress, task queue, results table with filters
- **Settings & History Tab**: Lead segregation, Scraping history, Downloads history, License

## 6. Quick Start (5-Minute Tutorial)
1. Open the extension panel
2. **Data → Keywords**: Add one per line (e.g., `restaurants`, `dentists`)
3. **Data → Locations**: Add one per line (e.g., `Nagpur, Maharashtra`, `Pune, Maharashtra`)
4. **Human pace**: Keep Balanced (recommended)
5. Click **Start Extracting**
6. The extension opens Google Search tabs and extracts results automatically
7. Watch progress in **Tasks** tab
8. When complete, go to **Tasks** → filter/results table
9. **Activate license** (if you want to export) → see Section 8
10. Export: CSV/Excel/JSON (toolbar) — requires an active license

## 7. Understanding Free vs Licensed
| Feature | Free | Licensed |
|---|---|---|
| **Scrape/Collect Leads** | Allowed (up to practical limits) | Unlimited |
| **Export (CSV/Excel/JSON)** | **Blocked** | **Enabled** |
| **Watermark on exports** | N/A (cannot export) | Filename includes a short license tag |
| **Offline Grace** | N/A | Up to 7 days after last validation |

**Important:** Free users can scrape and collect data in the table, but **downloading/exporting leads requires an active license**.

## 8. License Activation & Device Binding
### Activate
1. Open panel → **Header** license chip → **Activate** (or **Data → License → Activate license**)
2. Paste your full license key (format `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`)
3. Click **Activate**
4. Status becomes **Licensed** (green chip). Exports unlock immediately.

### One License = One Device
- Each license is bound to **exactly one computer/device**.
- You **cannot** activate the same key on a second PC while it's active on the first.
- If you try, you'll see: *"This key is already active on too many devices."*

### Moving License to Another PC
To move your license to a different computer:

1. On the **original PC**: Open panel → Header or Data → License → **Deactivate**
2. Deactivation frees the device slot (takes a moment)
3. On the **new PC**: Install the extension → Activate with the same key
4. Do **not** skip step 1. If you lost access to the original PC before deactivating, contact support to release the slot.

## 9. Building Your Search
- **Keywords** (one per line): e.g., `restaurants`, `dentists`, `plumbers`
- **Locations** (one per line): City/Region names (e.g., `Nagpur, Maharashtra`, `Pune, Maharashtra`). Leave blank carefully if needed.
- **Data Source**: `Google Search (scrape)` (default) or `Places API (official)` (requires billing-enabled Places API key)

## 10. Extraction Modes
- **Deep Details** (slower, more complete): Opens each result card for richer data
- **Fast Mode** (faster): Fetches pages without full reloads; throttled intelligently to reduce risk
- **Max pages per keyword** (0 = all available)

## 11. Human Pace & Anti-CAPTCHA
Use **Pace Profile**:
- **Conservative** (safest, slowest) — best for sensitive targets or if you see CAPTCHAs
- **Balanced** (recommended) — good safety/speed trade-off
- **Aggressive** (faster, higher risk)

Enable **Human motion** for more natural behavior. The extension uses randomized delays, breaks between pages/tasks, and session caps to reduce detection risk.

## 12. Email Enrichment
- **Off**: No website crawling for emails
- **After scraping (queue)**: Extracts emails after collecting results (recommended)
- **During scraping (inline)**: Extracts while scraping (slower)
- **Max seconds per website**: Controls how long to crawl each site for emails

## 13. Lead Segregation
Classifies leads into tiers (T1/T2/T3) based on category/keywords:
- **T1** (Call First): Your top-priority keyword list (Tier 1 keywords box)
- **T2** (Call Second): Your secondary keyword list (Tier 2 keywords box)
- **T3** (Call Last): Everything else / low priority (Tier 3 keywords box)
- **Care No. — Skip**: Toll-free/care numbers excluded
- **Auto-segregate after each scrape**: Apply automatically

## 14. Data Management & Filtering
- **Filter results**: Search by company/name/address/phone/etc.
- **Tier filter**: All/Tier 1/Tier 2/Tier 3
- **Only with email** / **No duplicate phones**
- **Remove duplicates**: Purges duplicate phone numbers from DB (keeps first occurrence)
- **Clear Data**: Removes all collected results (irreversible)

## 15. Exporting Leads
Exports require an **active license**.

1. Collect results (Tasks/Data table shows them)
2. Apply filters if desired
3. Click **CSV**, **Excel**, or **JSON** in the toolbar
4. File downloads with a short license tag in the filename (e.g., `leads-2026-10-16-ABC123.csv`)
5. Export history appears in **Settings → Downloads history**

**Excel exports** create one workbook with a separate tab per **Location** (blank locations become `(no location)`).

## 16. Runs, History & Exports
- **Scraping history** (Settings): View past runs, timestamps, counts
- **Downloads history** (Settings): Re-download previous exports (byte-identical)
- **Tasks tab**: Real-time progress, queue, banner status, risk chip

## 17. Moving License to Another PC
See Section 8. Remember: **Deactivate on original PC first**, then activate on new PC. Without deactivation, the new PC cannot activate (device slot is in use).

## 18. Troubleshooting
| Issue | Cause | Solution |
|---|---|---|
| **"License required to export/download leads"** | Not licensed/free tier | Activate license |
| **"This key is already active on too many devices"** | License still active on another PC | Deactivate on original PC first |
| **CAPTCHAs appear** | Aggressive pace | Switch to Conservative/Balance, enable Human motion, reduce pages |
| **Selectors fail/Test selectors shows few results** | Google DOM changed | Use "Test selectors"/"Dump page JSON", retry later |
| **Offline grace** | Network lost | Reconnect within 7 days (license remains valid during grace) |
| **Exports disabled** | License check failed/offline | Ensure online, click refresh, retry |

## 19. Best Practices
- **Start small**: Test with 1–2 keywords + 1 location first
- **Use Balanced + Human motion** for most cases
- **Respect rate limits**: Don't run aggressive 24/7
- **Review filters** before export (dedupe phones, tier/action)
- **Keep extension loaded from its original folder** (if using Load unpacked)
- **Deactivate before uninstalling/moving** to free the slot cleanly

## 20. Security & Privacy
- All data stays **local** on your machine (IndexedDB + localStorage)
- No telemetry, no external uploads
- License validation uses HTTPS (Keygen Cloud) only for activation/periodic recheck
- API keys (Places/AI) are stored locally in your extension storage
- Keep your license key **confidential**

**Need help?** Check Troubleshooting first. For licensing/device issues, include your license tag (shown in chip) when contacting support.
