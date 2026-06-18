// Daily snapshot for the ADO Command Center trend history.
// Writes snapshots/YYYY-MM-DD.json capturing the active scope's backlog state
// (counts by state/type/assignee + aging buckets). Reuses config.js + auth.js,
// so it shares the same AzureAuth broker sign-in as the server. Run via the scheduler or:
//   node snapshot.js

const fs = require("fs");
const path = require("path");
const cfgMod = require("./config");
const { Auth } = require("./auth");

const SNAP_DIR = path.join(__dirname, "snapshots");

async function main() {
  const CONFIG = cfgMod.load();
  if (!CONFIG) { console.error("No config.json — run setup first."); process.exit(1); }
  const auth = new Auth({ tenant: CONFIG.tenant });
  let token;
  try { token = await auth.getToken(); }
  catch { console.error("Not signed in. Start the server and sign in once (AzureAuth), then retry."); process.exit(2); }

  const ORG = cfgMod.normalizeOrg(CONFIG.org);
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json", Accept: "application/json" };
  const scope = cfgMod.activeScope(CONFIG);

  async function ids() {
    if (scope.type === "query") {
      const r = await (await fetch(`${ORG}/${encodeURIComponent(CONFIG.project)}/_apis/wit/wiql/${scope.queryId}?api-version=7.0`, { headers })).json();
      return (r.workItems || []).map((w) => w.id);
    }
    const wiql = cfgMod.buildWiql(CONFIG, scope);
    const r = await (await fetch(`${ORG}/${encodeURIComponent(CONFIG.project)}/_apis/wit/wiql?api-version=7.0`, { method: "POST", headers, body: JSON.stringify({ query: wiql }) })).json();
    return (r.workItems || []).map((w) => w.id);
  }

  const idList = await ids();
  const items = [];
  for (let i = 0; i < idList.length; i += 200) {
    const batch = idList.slice(i, i + 200);
    const r = await (await fetch(`${ORG}/_apis/wit/workitemsbatch?api-version=7.0`, {
      method: "POST", headers,
      body: JSON.stringify({ ids: batch, fields: ["System.WorkItemType", "System.State", "System.AssignedTo", "System.ChangedDate"] }),
    })).json();
    items.push(...(r.value || []));
  }

  const now = new Date();
  const byState = {}, byType = {}, byAssignee = {}, aging = { "0-14": 0, "14-30": 0, "30plus": 0 };
  for (const w of items) {
    const f = w.fields;
    const st = f["System.State"], ty = f["System.WorkItemType"];
    const as = f["System.AssignedTo"] ? f["System.AssignedTo"].displayName : "Unassigned";
    const age = Math.floor((now - new Date(f["System.ChangedDate"])) / 86400000);
    byState[st] = (byState[st] || 0) + 1;
    byType[ty] = (byType[ty] || 0) + 1;
    byAssignee[as] = (byAssignee[as] || 0) + 1;
    if (age >= CONFIG.staleDays) aging["30plus"]++; else if (age >= 14) aging["14-30"]++; else aging["0-14"]++;
  }

  if (!fs.existsSync(SNAP_DIR)) fs.mkdirSync(SNAP_DIR, { recursive: true });
  const date = now.toISOString().slice(0, 10);
  const snap = { date, timestamp: now.toISOString(), scope: scope.name, openTotal: items.length, staleCount: aging["30plus"], byState, byType, byAssignee, aging };
  fs.writeFileSync(path.join(SNAP_DIR, `${date}.json`), JSON.stringify(snap, null, 2), "utf8");
  console.log(`Snapshot written: snapshots/${date}.json (open=${items.length}, stale=${aging["30plus"]})`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
