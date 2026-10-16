// Issue / manage license keys for the extension via the Keygen admin API.
// This NEVER ships in the extension - the admin token must stay secret.
//
//   set KEYGEN_ACCOUNT_ID=...      (or --account)
//   set KEYGEN_ADMIN_TOKEN=...     (Product or admin token; never commit)
//   set KEYGEN_POLICY_ID=...       (the "lifetime" or "yearly" policy id)
//
//   node tools/keygen-admin.mjs create --policy <id> --name "Ali - lifetime" [--email a@b.com]
//   node tools/keygen-admin.mjs list [--policy <id>]
//   node tools/keygen-admin.mjs revoke <licenseId>
//   node tools/keygen-admin.mjs renew <licenseId>
//
// ponytail: raw fetch over the REST API; no SDK needed for four calls.
const API = "https://api.keygen.sh/v1/accounts";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : undefined;
}
const cmd = process.argv[2];

const ACCOUNT = process.env.KEYGEN_ACCOUNT_ID || arg("--account");
const TOKEN = process.env.KEYGEN_ADMIN_TOKEN;
const POLICY = process.env.KEYGEN_POLICY_ID || arg("--policy");

if (!ACCOUNT || !TOKEN) {
  console.error("Set KEYGEN_ACCOUNT_ID and KEYGEN_ADMIN_TOKEN first.");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/vnd.api+json",
  Accept: "application/vnd.api+json",
  Authorization: `Bearer ${TOKEN}`,
};

async function req(method, path, body) {
  const res = await fetch(`${API}/${ACCOUNT}/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, JSON.stringify(data.errors || data, null, 2));
    process.exit(1);
  }
  return data;
}

const uuidRe = /^[0-9a-f]{8}-/i;

(async () => {
  if (cmd === "create") {
    if (!POLICY) { console.error("A policy id is required: --policy <id>."); process.exit(1); }
    const name = arg("--name") || "customer";
    const attrs = { name };
    const email = arg("--email");
    if (email) attrs.metadata = { email };
    const data = await req("POST", "licenses", {
      data: {
        type: "licenses",
        attributes: attrs,
        relationships: { policy: { data: { type: "policies", id: POLICY } } },
      },
    });
    console.log("license id:", data.data.id);
    console.log("key:       ", data.data.attributes.key);
    console.log("expiry:    ", data.data.attributes.expiry || "(perpetual)");
  } else if (cmd === "list") {
    const data = await req("GET", "licenses" + (POLICY ? `?policy=${POLICY}` : ""));
    for (const l of data.data || []) {
      console.log(l.id, l.attributes.key, l.attributes.status, l.attributes.expiry || "(perpetual)", l.attributes.name || "");
    }
  } else if (cmd === "revoke" && uuidRe.test(process.argv[3] || "")) {
    await req("DELETE", `licenses/${process.argv[3]}`);
    console.log("revoked", process.argv[3]);
  } else if (cmd === "renew" && uuidRe.test(process.argv[3] || "")) {
    const data = await req("POST", `licenses/${process.argv[3]}/actions/renew`);
    console.log("renewed — new expiry:", data.data.attributes.expiry);
  } else {
    console.error("Usage: create --policy <id> [--name X] [--email Y] | list [--policy <id>] | revoke <id> | renew <id>");
    process.exit(1);
  }
})();
