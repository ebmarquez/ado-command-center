// Config loading + WIQL scope building for the ADO Command Center.
// config.json is gitignored (per-user). config.example.json ships as a template.
// The first-run setup wizard writes config.json; nothing here is hard-coded.

const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");

const DEFAULTS = {
  org: "",
  project: "",
  port: 7421,
  staleDays: 30,
  wipLimit: 10,
  // Each scope defines "who/what" the board shows. type: people | areaPath | query
  scopes: [],
  activeScope: 0,
  // States considered "closed" — excluded from people/areaPath scopes.
  closedStates: ["Done", "Removed", "Closed", "Resolved"],
};

function exists() {
  return fs.existsSync(CONFIG_PATH);
}

function load() {
  if (!exists()) return null;
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  return { ...DEFAULTS, ...raw };
}

function save(cfg) {
  const merged = { ...DEFAULTS, ...cfg, org: normalizeOrg(cfg.org) };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

function escWiql(s) {
  return String(s).replace(/'/g, "''");
}

// Normalize an Azure DevOps organization/collection URL to the base used for
// REST calls, stripping any trailing project (or deeper) path the user may have
// pasted. Projects are listed at the collection level, and project-scoped calls
// are built as `${base}/${project}/...`, so `base` must NOT include a project.
//   https://dev.azure.com/org/Project        -> https://dev.azure.com/org
//   https://acct.visualstudio.com/DefaultCollection/Project
//                                             -> https://acct.visualstudio.com/DefaultCollection
//   https://acct.visualstudio.com/Project     -> https://acct.visualstudio.com
function normalizeOrg(url) {
  if (!url) return url;
  const s = String(url).trim().replace(/\/+$/, "");
  let u;
  try { u = new URL(s); } catch { return s; }
  const host = u.hostname.toLowerCase();
  const segs = u.pathname.split("/").filter(Boolean);
  if (host === "dev.azure.com" || host.endsWith(".dev.azure.com")) {
    // dev.azure.com/{org} — the org segment is the collection.
    return `${u.protocol}//${u.host}${segs[0] ? "/" + segs[0] : ""}`;
  }
  if (host.endsWith(".visualstudio.com")) {
    // Keep a leading collection segment (…Collection); otherwise the account
    // root lists every project and serves project-scoped calls just fine.
    if (segs[0] && /collection$/i.test(segs[0])) return `${u.protocol}//${u.host}/${segs[0]}`;
    return `${u.protocol}//${u.host}`;
  }
  // Unknown/on-prem host — best effort: just drop the trailing slash.
  return s;
}

// Build a WIQL string for a people/areaPath scope. areaPath scopes accept an
// array of area paths (areaPaths) — each is matched with UNDER and OR'd
// together. Returns null for query scopes (those are run by stored-query id).
function buildWiql(cfg, scope) {
  const closed = (cfg.closedStates || DEFAULTS.closedStates)
    .map((s) => `'${escWiql(s)}'`)
    .join(",");
  const notClosed = `[System.State] NOT IN (${closed})`;

  if (scope.type === "people") {
    const people = (scope.people || []).map((p) => `'${escWiql(p)}'`).join(",");
    if (!people) throw new Error("people scope has no people");
    return `SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] IN (${people}) AND ${notClosed} ORDER BY [System.ChangedDate] DESC`;
  }
  if (scope.type === "areaPath") {
    // Accept an array of area paths (areaPaths) or a single legacy areaPath.
    const paths = (scope.areaPaths && scope.areaPaths.length ? scope.areaPaths : (scope.areaPath ? [scope.areaPath] : []))
      .map((a) => String(a).trim())
      .filter(Boolean);
    if (!paths.length) throw new Error("areaPath scope has no area paths");
    const under = paths.map((a) => `[System.AreaPath] UNDER '${escWiql(a)}'`).join(" OR ");
    // Optional people filter — narrows the area to specific assignees.
    const ppl = (scope.people || []).map((p) => String(p).trim()).filter(Boolean);
    const peopleClause = ppl.length
      ? ` AND [System.AssignedTo] IN (${ppl.map((p) => `'${escWiql(p)}'`).join(",")})` : "";
    return `SELECT [System.Id] FROM WorkItems WHERE (${under})${peopleClause} AND ${notClosed} ORDER BY [System.ChangedDate] DESC`;
  }
  if (scope.type === "query") {
    return null; // run by stored-query id
  }
  throw new Error("unknown scope type: " + scope.type);
}

function activeScope(cfg) {
  const i = Math.max(0, Math.min(cfg.activeScope || 0, (cfg.scopes || []).length - 1));
  return cfg.scopes[i] || null;
}

module.exports = { CONFIG_PATH, DEFAULTS, exists, load, save, buildWiql, activeScope, escWiql, normalizeOrg };
