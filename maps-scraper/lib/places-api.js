// Tier 4: optional data source using the official Google Places API (New).
// Accurate, legal, scalable, no captchas. Needs the user's API key (billing on).
// ES module, used by background.js.
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.location",
  "places.primaryTypeDisplayName",
  "nextPageToken",
].join(",");

function toRow(p) {
  return {
    company_name: (p.displayName && p.displayName.text) || "",
    cid: p.id || "",
    category: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || "",
    address: p.formattedAddress || "",
    phone: p.internationalPhoneNumber || "",
    website: p.websiteUri || "",
    rating: p.rating != null ? String(p.rating) : "",
    reviews: p.userRatingCount != null ? String(p.userRatingCount) : "",
    latitude: p.location ? p.location.latitude : null,
    longitude: p.location ? p.location.longitude : null,
    source: "places",
  };
}

// Yields rows page by page; calls onPage({added}) so the caller can update progress.
export async function runPlacesSearch({ apiKey, query, maxPages = 3, onPage }) {
  if (!apiKey) throw new Error("Missing Places API key");
  let pageToken = "";
  let total = 0;
  for (let page = 0; page < maxPages; page++) {
    const body = { textQuery: query, pageSize: 20 };
    if (pageToken) body.pageToken = pageToken;
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || "HTTP " + res.status);
    const rows = (data.places || []).map(toRow);
    total += rows.length;
    if (onPage) await onPage(rows, { query, page: page + 1 });
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
    await new Promise((r) => setTimeout(r, 800));
  }
  return total;
}
