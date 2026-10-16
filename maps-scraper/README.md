# Google Map Extractor — Client Setup Guide

## 1. Installation
### Option A: Chrome Web Store (if published)
1. Open the product page in Chrome/Brave/Edge
2. Click **Add to Chrome → Add extension**
3. Pin the extension: click the puzzle icon → pin **Google Map Extractor**

### Option B: Manual (Unpacked/CRX)
1. Download/unzip the extension folder: `maps-scraper/`
2. Open `chrome://extensions` in Chrome
3. Turn on **Developer mode** (top-right)
4. Click **Load unpacked**
5. Select the `maps-scraper` folder
6. Pin the extension from the toolbar

## 2. Free Tier
- The extension works out of the box on the **Free** tier (up to **50 results**).
- You can view and export those results without a license.

## 3. Activate Your License
1. Click the extension icon in the toolbar to open the panel
2. Go to **Settings & History → License**
3. Click **Activate license**
4. Paste your license key: `XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`
5. Click **Activate**
6. Once successful, the chip becomes **Licensed** (limits removed)

## 4. One License = One Device
- Each license is bound to **exactly one computer** (1 device).
- You cannot use the same key on a second PC while it's active on another.
- If you try to activate on a second device without deactivating the first, you'll get: **"This key is already active on too many devices."**

## 5. Moving to a New PC
To move your license to a different PC:

1. On the **original PC**: open the panel → **Settings & History → License → Deactivate**
2. Wait a moment (deactivation frees the device slot)
3. On the **new PC**: install the extension and activate with the same key

## 6. Troubleshooting
| Error | Meaning | Fix |
|---|---|---|
| **Enter your license key.** | Empty field | Paste the full key |
| **This key wasn't found. Check it and try again.** | Wrong/typo in key | Re-check the key (no extra spaces) |
| **This key is already active on too many devices.** | Slot in use | Deactivate on the old device first (Step 5) |
| **Couldn't reach the license server...** | Network offline | Check internet; offline grace applies for up to **7 days** after last check |
| **License has expired.** | Expired subscription | Renew from your purchase link |

## 7. Notes
- Keep your license key private and secure
- If you lose access to the original PC before deactivating, you may need to ask support to release the slot
- Data and exports stay on your local PC (nothing is uploaded)

**Admin: one-device binding (recommendation)**
For strict "one license = one device" enforcement (no auto-release from floating pruning), set the Keygen Policy to **node-locked** (`floating: false`). If left `floating: true`, machines can be pruned over time and occasionally allow reuse.