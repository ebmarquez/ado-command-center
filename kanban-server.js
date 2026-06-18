// ADO Command Center — local server.
// Serves a Kanban board (drag-to-update) + analytics dashboard for Azure DevOps
// work items. Auth via AzureAuth (auth.js — broker-based ADO tokens). All
// scope/config comes from
// config.json (written by the first-run setup wizard) — nothing is hard-coded.
//
//   npm install && npm start      (or use Start-Kanban.ps1)
//   then open the printed URL.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const cfgMod = require("./config");
const { Auth } = require("./auth");

const HIERARCHY_CAP = 2000;
const PUBLIC = path.join(__dirname, "public");

// ---- launch token (gates every route) --------------------------------------
const LAUNCH_TOKEN = crypto.randomBytes(32).toString("hex");
const SESSION_COOKIE = "acc_session";
const sessions = new Set();

// ---- Windows "start at login" shortcut (toggled from Settings) --------------
// A .lnk in the user's Startup folder that launches the tray host hidden via
// Launch-CommandCenter.vbs. Windows-only; no-ops elsewhere.
function startupLnkPath() {
  const appData = process.env.APPDATA;
  if (!appData) return null;
  return path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "ADO Command Center.lnk");
}
function autostartSupported() {
  return process.platform === "win32" && !!startupLnkPath();
}
function autostartEnabled() {
  const lnk = startupLnkPath();
  try { return !!lnk && fs.existsSync(lnk); } catch { return false; }
}
function setAutostart(enabled) {
  return new Promise((resolve, reject) => {
    if (!autostartSupported()) return reject(new Error("Start at login is only supported on Windows."));
    const lnk = startupLnkPath();
    if (!enabled) {
      try { if (fs.existsSync(lnk)) fs.unlinkSync(lnk); return resolve(false); }
      catch (e) { return reject(e); }
    }
    const vbs = path.join(__dirname, "Launch-CommandCenter.vbs");
    const ico = path.join(__dirname, "command-center.ico");
    const wscript = path.join(process.env.WINDIR || "C:\\Windows", "System32", "wscript.exe");
    const psq = (s) => "'" + String(s).replace(/'/g, "''") + "'";
    const script = [
      "$s = New-Object -ComObject WScript.Shell",
      `$l = $s.CreateShortcut(${psq(lnk)})`,
      `$l.TargetPath = ${psq(wscript)}`,
      `$l.Arguments = ${psq('"' + vbs + '"')}`,
      `$l.WorkingDirectory = ${psq(__dirname)}`,
      "$l.Description = 'ADO Command Center (tray app)'",
      `if (Test-Path ${psq(ico)}) { $l.IconLocation = ${psq(ico + ",0")} }`,
      "$l.Save()",
    ].join("\r\n");
    const os = require("os");
    const tmp = path.join(os.tmpdir(), `acc-autostart-${crypto.randomBytes(6).toString("hex")}.ps1`);
    const { execFile } = require("child_process");
    try { fs.writeFileSync(tmp, script, "utf8"); }
    catch (e) { return reject(e); }
    execFile("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tmp], (err) => {
      try { fs.unlinkSync(tmp); } catch {}
      if (err) return reject(err);
      resolve(true);
    });
  });
}

// ---- mutable runtime state -------------------------------------------------
let CONFIG = cfgMod.load();           // null until setup completes
let auth = new Auth(CONFIG ? { tenant: CONFIG.tenant } : {});

function rebuildAuth() {
  auth = new Auth(CONFIG ? { tenant: CONFIG.tenant } : {});
}

// ---- ADO REST --------------------------------------------------------------
function looksLikeAuthFailure(status, text) {
  if (status === 401 || status === 203) return true;
  const t = (text || "").trimStart().slice(0, 40).toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html");
}

async function adoFetch(url, opts = {}) {
  const { method = "GET", body = null, contentType = "application/json" } = opts;
  const token = await auth.getToken(); // throws {needsLogin} if not signed in
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": contentType,
      Accept: "application/json",
    },
    body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).message || text; } catch {}
    if (looksLikeAuthFailure(res.status, text)) msg = "Azure DevOps rejected the request (auth). Sign in again to refresh your token.";
    const e = new Error(typeof msg === "string" ? msg.slice(0, 300) : "ADO error");
    e.status = res.status;
    throw e;
  }
  return text ? JSON.parse(text) : {};
}

const ORG = () => cfgMod.normalizeOrg(CONFIG.org);
const PROJECT = () => CONFIG.project;
const FIELDS = [
  "System.Id", "System.WorkItemType", "System.Title", "System.State",
  "System.AssignedTo", "System.Tags", "System.IterationPath", "System.AreaPath",
  "Microsoft.VSTS.Common.Priority", "System.ChangedDate",
  "Microsoft.VSTS.Scheduling.StoryPoints", "System.Parent",
];

function webUrl(id) {
  // Build a friendly edit URL from the org base.
  return `${ORG()}/${encodeURIComponent(PROJECT())}/_workitems/edit/${id}`;
}

// ---- queries (config scope driven) -----------------------------------------
async function scopeIds() {
  const scope = cfgMod.activeScope(CONFIG);
  if (!scope) throw new Error("No scope configured.");
  if (scope.type === "query") {
    const r = await adoFetch(`${ORG()}/${encodeURIComponent(PROJECT())}/_apis/wit/wiql/${scope.queryId}?api-version=7.0`);
    const flat = (r.workItems || []).map((w) => w.id);
    const tree = (r.workItemRelations || []).map((rel) => rel.target && rel.target.id).filter(Boolean);
    return [...new Set([...flat, ...tree])];
  }
  const wiql = cfgMod.buildWiql(CONFIG, scope);
  const r = await adoFetch(`${ORG()}/${encodeURIComponent(PROJECT())}/_apis/wit/wiql?api-version=7.0`, { method: "POST", body: { query: wiql } });
  return (r.workItems || []).map((w) => w.id);
}

async function fetchByIds(ids, { fields = FIELDS, expand = null } = {}) {
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    const body = expand ? { ids: batch, $expand: expand } : { ids: batch, fields };
    const r = await adoFetch(`${ORG()}/_apis/wit/workitemsbatch?api-version=7.0`, { method: "POST", body });
    out.push(...r.value);
  }
  return out;
}

async function getItems() {
  const ids = await scopeIds();
  const raw = await fetchByIds(ids);
  return raw.map((w) => {
    const f = w.fields;
    const a = f["System.AssignedTo"];
    return {
      id: w.id,
      type: f["System.WorkItemType"],
      title: f["System.Title"],
      state: f["System.State"],
      assignee: a ? a.displayName : "Unassigned",
      email: a ? a.uniqueName : "",
      tags: f["System.Tags"] || null,
      priority: f["Microsoft.VSTS.Common.Priority"] ?? null,
      changed: f["System.ChangedDate"],
      rev: w.rev,
      url: webUrl(w.id),
    };
  });
}

let stateCache = null;
async function getTypeStates() {
  if (stateCache) return stateCache;
  const types = ["Task", "Bug", "Feature", "Epic", "Product Backlog Item", "Test Case", "User Story", "Issue"];
  const map = {};
  for (const t of types) {
    try {
      const r = await adoFetch(`${ORG()}/${encodeURIComponent(PROJECT())}/_apis/wit/workItemTypes/${encodeURIComponent(t)}/states?api-version=7.0`);
      map[t] = r.value.map((s) => ({ name: s.name, color: s.color, category: s.category }));
    } catch { /* type may not exist in this project */ }
  }
  stateCache = map;
  return map;
}

async function updateState(id, newState) {
  const patch = [{ op: "add", path: "/fields/System.State", value: newState }];
  const r = await adoFetch(`${ORG()}/_apis/wit/workitems/${id}?api-version=7.0`, {
    method: "PATCH", body: JSON.stringify(patch), contentType: "application/json-patch+json",
  });
  return { id: r.id, state: r.fields["System.State"], rev: r.rev };
}

// Set (or move) a work item's parent via the hierarchy link. ADO allows a
// single parent, so any existing parent relation is removed first. ADO itself
// enforces process/cycle rules and returns an error we surface verbatim.
async function setParent(childId, parentId) {
  childId = Number(childId); parentId = Number(parentId);
  if (!childId || !parentId) throw new Error("childId and parentId are required.");
  if (childId === parentId) throw new Error("A work item can't be its own parent.");

  const child = await adoFetch(`${ORG()}/_apis/wit/workitems/${childId}?$expand=relations&api-version=7.0`);
  const rels = child.relations || [];
  let existingIdx = -1, alreadyParent = false;
  rels.forEach((rel, i) => {
    if (rel.rel === "System.LinkTypes.Hierarchy-Reverse") {
      existingIdx = i;
      if (PARENT_ID(rel) === parentId) alreadyParent = true;
    }
  });
  if (alreadyParent) return { id: childId, parentId, unchanged: true };

  const parentUrl = `${ORG()}/_apis/wit/workItems/${parentId}`;
  const patch = [{ op: "test", path: "/rev", value: child.rev }];
  if (existingIdx >= 0) patch.push({ op: "remove", path: `/relations/${existingIdx}` });
  patch.push({ op: "add", path: "/relations/-", value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: parentUrl } });

  const updated = await adoFetch(`${ORG()}/_apis/wit/workitems/${childId}?api-version=7.0`, {
    method: "PATCH", body: JSON.stringify(patch), contentType: "application/json-patch+json",
  });
  return { id: updated.id, parentId, parent: (updated.fields && updated.fields["System.Parent"]) || parentId, rev: updated.rev };
}

// ---- analytics helpers -----------------------------------------------------

// Pull the (non-negated) area paths out of a stored query's WIQL so the area-path
// editor can pre-fill a query scope's existing paths. Prefers Target.* clauses
// (the child filter in a tree query); falls back to non-Source clauses.
function extractAreaPaths(wiql) {
  const matches = [];
  const re = /(not\s+)?(source\.|target\.)?\[system\.areapath\]\s+under\s+'((?:[^']|'')+)'/gi;
  let m;
  while ((m = re.exec(String(wiql || "")))) {
    if (m[1]) continue; // skip "not ... under"
    matches.push({ side: (m[2] || "").toLowerCase(), path: m[3].replace(/''/g, "'") });
  }
  const target = matches.filter((x) => x.side === "target.").map((x) => x.path);
  if (target.length) return [...new Set(target)];
  const nonSource = matches.filter((x) => x.side !== "source.").map((x) => x.path);
  if (nonSource.length) return [...new Set(nonSource)];
  return [...new Set(matches.map((x) => x.path))];
}
async function queryAreaPaths(queryId) {
  const q = await adoFetch(`${ORG()}/${encodeURIComponent(PROJECT())}/_apis/wit/queries/${queryId}?$expand=wiql&api-version=7.0`);
  return extractAreaPaths(q.wiql);
}

function categoryOf(states, type, state) {
  const hit = (states[type] || []).find((s) => s.name === state);
  return hit ? hit.category : null;
}
function ageDays(changed) { return Math.floor((Date.now() - new Date(changed).getTime()) / 86400000); }
const PARENT_ID = (rel) => { const m = String(rel.url || "").match(/workItems\/(\d+)/i); return m ? Number(m[1]) : null; };

async function getHierarchy() {
  const [group, states] = await Promise.all([getItems(), getTypeStates()]);
  const groupIds = new Set(group.map((g) => g.id));
  const groupEpicFeat = new Set(group.filter((g) => g.type === "Epic" || g.type === "Feature").map((g) => g.id));
  const nodes = new Map();
  const fetched = new Set();

  async function ensure(ids) {
    const need = [...new Set(ids.filter((id) => id && !fetched.has(id)))];
    const raw = await fetchByIds(need, { expand: "Relations" });
    for (const w of raw) {
      fetched.add(w.id);
      const f = w.fields;
      const a = f["System.AssignedTo"];
      const type = f["System.WorkItemType"];
      const childIds = [];
      for (const rel of w.relations || []) {
        if (rel.rel === "System.LinkTypes.Hierarchy-Forward") { const cid = PARENT_ID(rel); if (cid) childIds.push(cid); }
      }
      nodes.set(w.id, {
        id: w.id, type, title: f["System.Title"], state: f["System.State"],
        category: categoryOf(states, type, f["System.State"]),
        assignee: a ? a.displayName : "Unassigned",
        parent: f["System.Parent"] || null,
        priority: f["Microsoft.VSTS.Common.Priority"] ?? null,
        changed: f["System.ChangedDate"], childIds, inGroup: groupIds.has(w.id),
        url: webUrl(w.id),
      });
    }
  }

  const rootIds = group
    .filter((g) => (g.type === "Epic" || g.type === "Feature") && !groupEpicFeat.has(g.parent))
    .map((g) => g.id);

  let frontier = [...rootIds];
  while (frontier.length && fetched.size < HIERARCHY_CAP) {
    await ensure(frontier);
    const next = [];
    for (const id of frontier) {
      const n = nodes.get(id);
      if (!n) continue;
      for (const c of n.childIds) if (!fetched.has(c)) next.push(c);
    }
    frontier = [...new Set(next)];
  }

  function rollup(id, seen = new Set()) {
    const n = nodes.get(id);
    if (!n || seen.has(id)) return { total: 0, done: 0 };
    seen.add(id);
    let total = 0, done = 0;
    for (const cid of n.childIds) {
      const c = nodes.get(cid);
      if (!c || c.category === "Removed") continue;
      total++; if (c.category === "Completed") done++;
      const sub = rollup(cid, seen); total += sub.total; done += sub.done;
    }
    n.total = total; n.done = done; n.pct = total ? Math.round((done / total) * 100) : 0;
    return { total, done };
  }
  function build(id, seen = new Set()) {
    if (seen.has(id)) return null;
    seen.add(id);
    const n = nodes.get(id);
    if (!n) return null;
    return {
      id: n.id, type: n.type, title: n.title, state: n.state, category: n.category,
      assignee: n.assignee, priority: n.priority, ageDays: ageDays(n.changed), url: n.url,
      pct: n.pct || 0, done: n.done || 0, total: n.total || 0, inGroup: n.inGroup,
      children: n.childIds.map((c) => build(c, seen)).filter(Boolean),
    };
  }

  rootIds.forEach((id) => rollup(id));
  const typeRank = { Epic: 0, Feature: 1 };
  const tree = rootIds.map((id) => build(id)).filter(Boolean)
    .sort((a, b) => (typeRank[a.type] ?? 9) - (typeRank[b.type] ?? 9) || b.total - a.total);

  const inTree = new Set();
  (function collect(ns) { for (const n of ns) { inTree.add(n.id); collect(n.children); } })(tree);
  const other = group.filter((g) => !inTree.has(g.id)).map((g) => ({
    id: g.id, type: g.type, title: g.title, state: g.state,
    category: categoryOf(states, g.type, g.state), assignee: g.assignee,
    priority: g.priority, ageDays: ageDays(g.changed), url: g.url,
  }));

  return { tree, other, nodeCount: nodes.size, capped: fetched.size >= HIERARCHY_CAP };
}

async function getRadar() {
  const [group, states, hier] = await Promise.all([getItems(), getTypeStates(), getHierarchy()]);
  const stale = CONFIG.staleDays;
  const enrich = (i) => ({
    id: i.id, type: i.type, title: i.title, state: i.state, assignee: i.assignee,
    priority: i.priority, ageDays: ageDays(i.changed), url: i.url,
    category: categoryOf(states, i.type, i.state),
  });
  const items = group.map(enrich);
  const staleItems = items.filter((i) => i.ageDays >= stale).sort((a, b) => b.ageDays - a.ageDays);
  const highPriNotStarted = items.filter((i) => i.priority === 1 && i.category === "Proposed").sort((a, b) => b.ageDays - a.ageDays);

  const groupIds = new Set(group.map((g) => g.id));
  const emptyFeatures = [];
  (function scan(ns) {
    for (const n of ns) {
      if (n.type === "Feature" && groupIds.has(n.id) && n.children.length === 0) {
        emptyFeatures.push({ id: n.id, type: n.type, title: n.title, state: n.state, category: n.category, assignee: n.assignee, priority: n.priority, ageDays: n.ageDays, url: n.url });
      }
      scan(n.children);
    }
  })(hier.tree);

  const wip = {};
  for (const i of items) if (i.category === "InProgress") wip[i.assignee] = (wip[i.assignee] || 0) + 1;
  const wipOverload = Object.entries(wip).filter(([, c]) => c > CONFIG.wipLimit)
    .map(([assignee, count]) => ({ assignee, count, limit: CONFIG.wipLimit })).sort((a, b) => b.count - a.count);

  return {
    config: { staleDays: stale, wipLimit: CONFIG.wipLimit },
    counts: { stale: staleItems.length, highPriNotStarted: highPriNotStarted.length, emptyFeatures: emptyFeatures.length, wipOverload: wipOverload.length },
    stale: staleItems, highPriNotStarted, emptyFeatures, wipOverload,
  };
}

async function getWorkload() {
  const [group, states] = await Promise.all([getItems(), getTypeStates()]);
  const people = {};
  for (const i of group) {
    const p = (people[i.assignee] ||= { assignee: i.assignee, total: 0, wip: 0, notStarted: 0, stale: 0, byType: {}, byState: {} });
    const cat = categoryOf(states, i.type, i.state);
    p.total++;
    if (cat === "InProgress") p.wip++;
    if (cat === "Proposed") p.notStarted++;
    if (ageDays(i.changed) >= CONFIG.staleDays) p.stale++;
    p.byType[i.type] = (p.byType[i.type] || 0) + 1;
    p.byState[i.state] = (p.byState[i.state] || 0) + 1;
  }
  const list = Object.values(people).map((p) => ({ ...p, overloaded: p.wip > CONFIG.wipLimit }))
    .sort((a, b) => b.wip - a.wip || b.total - a.total);
  return { people: list, config: { wipLimit: CONFIG.wipLimit, staleDays: CONFIG.staleDays } };
}

// ---- wizard discovery (config-less, but still auth-gated) ------------------
async function listProjects(orgUrl) {
  const base = cfgMod.normalizeOrg(orgUrl);
  const r = await adoFetch(`${base}/_apis/projects?api-version=7.0&$top=200`);
  return (r.value || []).map((p) => ({ id: p.id, name: p.name }));
}
async function listQueries(orgUrl, project) {
  const base = cfgMod.normalizeOrg(orgUrl);
  const r = await adoFetch(`${base}/${encodeURIComponent(project)}/_apis/wit/queries?$depth=2&$expand=none&api-version=7.0`);
  const out = [];
  (function walk(items, prefix) {
    for (const q of items || []) {
      if (q.isFolder) walk(q.children, prefix + q.name + "/");
      else out.push({ id: q.id, name: q.name, path: prefix + q.name });
    }
  })(r.value, "");
  return out;
}
async function listAreaPaths(orgUrl, project) {
  const base = cfgMod.normalizeOrg(orgUrl);
  const r = await adoFetch(`${base}/${encodeURIComponent(project)}/_apis/wit/classificationnodes/areas?$depth=6&api-version=7.0`);
  const out = [];
  (function walk(node, prefix) {
    const p = prefix ? prefix + "\\" + node.name : node.name;
    out.push(p);
    for (const c of node.children || []) walk(c, p);
  })(r, "");
  return out;
}
async function testScope(probeCfg) {
  const saved = CONFIG;
  CONFIG = { ...cfgMod.DEFAULTS, ...probeCfg };
  try {
    const ids = await scopeIds();
    return { count: ids.length };
  } finally { CONFIG = saved; }
}

// ---- HTTP plumbing ---------------------------------------------------------
function send(res, code, body, type = "application/json", headers = {}) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); });
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach((c) => { const [k, v] = c.split("="); if (k) out[k.trim()] = (v || "").trim(); });
  return out;
}
function isAuthed(req) {
  const c = parseCookies(req);
  return c[SESSION_COOKIE] && sessions.has(c[SESSION_COOKIE]);
}
function serveFile(res, file, type) {
  try { send(res, 200, fs.readFileSync(path.join(PUBLIC, file), "utf8"), type); }
  catch { send(res, 404, "Not found", "text/plain"); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;

    // --- launch-token exchange -> session cookie ---
    if (p === "/auth") {
      const token = url.searchParams.get("token");
      if (token && crypto.timingSafeEqual(Buffer.from(token.padEnd(64).slice(0,64)), Buffer.from(LAUNCH_TOKEN))) {
        const sid = crypto.randomBytes(24).toString("hex");
        sessions.add(sid);
        // Honor an optional local ?next= path (e.g. the tray "Open Dashboard"
        // menu) once configured; reject absolute/protocol-relative URLs.
        const next = url.searchParams.get("next");
        const safeNext = next && /^\/(?!\/)/.test(next) ? next : null;
        const dest = CONFIG ? (safeNext || "/") : "/setup";
        return send(res, 302, "", "text/plain", {
          "Set-Cookie": `${SESSION_COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/`,
          "Location": dest,
        });
      }
      return send(res, 401, "<h3>Invalid or missing launch token.</h3>Use the link printed in the terminal.", "text/html");
    }

    // --- unauthenticated health probe (used by the tray single-instance guard) ---
    if (p === "/api/health") return send(res, 200, { ok: true });

    // --- everything below requires a session ---
    if (!isAuthed(req)) {
      if (p === "/" || p === "/setup" || p === "/dashboard") {
        return send(res, 401,
          "<h3>Locked</h3><p>Open the link printed in the terminal (it contains your one-time launch token).</p>",
          "text/html");
      }
      return send(res, 401, { error: "unauthorized", hint: "open the launch link from the terminal" });
    }

    // --- pages ---
    if (p === "/setup") return serveFile(res, "setup.html", "text/html; charset=utf-8");
    if (!CONFIG && (p === "/" || p === "/dashboard")) {
      return send(res, 302, "", "text/plain", { "Location": "/setup" });
    }
    if (p === "/" || p === "/index.html") return serveFile(res, "kanban-live.html", "text/html; charset=utf-8");
    if (p === "/dashboard") return serveFile(res, "dashboard.html", "text/html; charset=utf-8");
    if (p === "/settings.js") return serveFile(res, "settings.js", "application/javascript; charset=utf-8");

    // --- auth/account status + interactive sign-in (AzureAuth broker) ---
    if (p === "/api/me") {
      const signedIn = await auth.hasAccount();
      let username = null;
      if (signedIn) { const a = await auth.account(); username = a && a.username; }
      return send(res, 200, { signedIn, username, hasConfig: !!CONFIG });
    }
    if (p === "/api/login/start" && req.method === "POST") {
      // Kick off interactive sign-in via AzureAuth (broker, then browser). The
      // client polls /api/login/status until a token can be obtained.
      auth.startLogin().catch(() => {});
      return send(res, 200, { started: true, message: "Complete the sign-in prompt (a window may open), then return here." });
    }
    if (p === "/api/login/status") {
      const signedIn = await auth.hasAccount();
      return send(res, 200, { signedIn, loginInProgress: auth.loginInProgress() });
    }
    if (p === "/api/logout" && req.method === "POST") {
      await auth.signOut();
      return send(res, 200, { ok: true });
    }

    // --- wizard discovery ---
    if (p === "/api/discover/projects") {
      const org = url.searchParams.get("org");
      if (!org) return send(res, 400, { error: "org required" });
      return send(res, 200, { projects: await listProjects(org) });
    }
    if (p === "/api/discover/queries") {
      const org = url.searchParams.get("org"); const project = url.searchParams.get("project");
      if (!org || !project) return send(res, 400, { error: "org and project required" });
      return send(res, 200, { queries: await listQueries(org, project) });
    }
    if (p === "/api/discover/areas") {
      const org = url.searchParams.get("org"); const project = url.searchParams.get("project");
      if (!org || !project) return send(res, 400, { error: "org and project required" });
      return send(res, 200, { areaPaths: await listAreaPaths(org, project) });
    }
    if (p === "/api/setup/test" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      try { return send(res, 200, await testScope(body)); }
      catch (e) { return send(res, 400, { error: e.message }); }
    }
    if (p === "/api/setup/save" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      CONFIG = cfgMod.save(body);
      rebuildAuth();
      stateCache = null;
      return send(res, 200, { ok: true });
    }

    // --- scope: read + edit the locally-managed area-path list ---
    if (p === "/api/scope") {
      const active = cfgMod.activeScope(CONFIG) || {};
      const areaScope = (CONFIG.scopes || []).find((s) => s.type === "areaPath");
      let areaPaths = (areaScope && areaScope.areaPaths) || [];
      let derivedFrom = null;
      // No saved area-path scope yet but the active scope is a saved query —
      // seed the editor with the area paths already baked into that query so the
      // user keeps their existing paths and can add more.
      if (!areaPaths.length && active.type === "query" && active.queryId) {
        try {
          const derived = await queryAreaPaths(active.queryId);
          if (derived.length) { areaPaths = derived; derivedFrom = "query"; }
        } catch { /* not signed in / query gone — leave empty */ }
      }
      return send(res, 200, {
        org: CONFIG.org, project: CONFIG.project,
        activeType: active.type || null, activeName: active.name || null,
        areaPaths, derivedFrom,
        people: (areaScope && areaScope.people) || [],
      });
    }
    if (p === "/api/scope/areapaths" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      const paths = Array.isArray(body.areaPaths)
        ? [...new Set(body.areaPaths.map((s) => String(s).trim()).filter(Boolean))] : [];
      if (!paths.length) return send(res, 400, { error: "Provide at least one area path." });
      const people = Array.isArray(body.people)
        ? [...new Set(body.people.map((s) => String(s).trim()).filter(Boolean))] : [];
      const scopes = Array.isArray(CONFIG.scopes) ? [...CONFIG.scopes] : [];
      let idx = scopes.findIndex((s) => s.type === "areaPath");
      if (idx === -1) { scopes.push({ name: "Area Paths", type: "areaPath", areaPaths: paths, people }); idx = scopes.length - 1; }
      else { scopes[idx] = { ...scopes[idx], name: scopes[idx].name || "Area Paths", areaPaths: paths, people }; }
      CONFIG = cfgMod.save({ ...CONFIG, scopes, activeScope: idx });
      stateCache = null;
      return send(res, 200, { ok: true, areaPaths: paths, people, activeScope: idx });
    }
    if (p === "/api/discover/people") {
      // Distinct assignees from the current scope, for the people-filter picker.
      try {
        const items = await getItems();
        const seen = new Map();
        for (const i of items) {
          if (!i.email) continue;
          if (!seen.has(i.email)) seen.set(i.email, i.assignee || i.email);
        }
        const people = [...seen.entries()]
          .map(([email, name]) => ({ email, name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return send(res, 200, { people });
      } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    }

    // --- "start at login" toggle (Windows tray app) ---
    if (p === "/api/autostart" && req.method === "GET") {
      return send(res, 200, { supported: autostartSupported(), enabled: autostartEnabled() });
    }
    if (p === "/api/autostart" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      try {
        const enabled = await setAutostart(!!body.enabled);
        return send(res, 200, { supported: autostartSupported(), enabled });
      } catch (e) { return send(res, 400, { error: e.message }); }
    }

    if (p.startsWith("/api/") && !CONFIG) return send(res, 409, { error: "not configured", hint: "complete setup at /setup" });

    if (p === "/api/config") return send(res, 200, { staleDays: CONFIG.staleDays, wipLimit: CONFIG.wipLimit, org: CONFIG.org, project: CONFIG.project, scopes: (CONFIG.scopes || []).map((s) => s.name), activeScope: CONFIG.activeScope, closedStates: CONFIG.closedStates || [] });
    if (p === "/api/bootstrap") { const [items, states] = await Promise.all([getItems(), getTypeStates()]); return send(res, 200, { items, states, pulled: new Date().toISOString() }); }
    if (p === "/api/items") return send(res, 200, { items: await getItems(), pulled: new Date().toISOString() });
    if (p === "/api/hierarchy") return send(res, 200, { ...(await getHierarchy()), pulled: new Date().toISOString() });
    if (p === "/api/radar") return send(res, 200, { ...(await getRadar()), pulled: new Date().toISOString() });
    if (p === "/api/workload") return send(res, 200, { ...(await getWorkload()), pulled: new Date().toISOString() });
    if (p === "/api/state" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.id || !body.state) return send(res, 400, { error: "id and state required" });
      return send(res, 200, await updateState(body.id, body.state));
    }
    if (p === "/api/parent" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)) || "{}");
      if (!body.childId || !body.parentId) return send(res, 400, { error: "childId and parentId required" });
      try { return send(res, 200, await setParent(body.childId, body.parentId)); }
      catch (e) { return send(res, e.status || 400, { error: e.message }); }
    }

    return send(res, 404, { error: "not found" });
  } catch (e) {
    if (e.needsLogin) return send(res, 401, { error: "sign-in required", needsLogin: true });
    return send(res, e.status || 500, { error: e.message });
  }
});

const PORT = (CONFIG && CONFIG.port) || 7421;

// Defensive: never let a single bad request or a stray async error from a
// child process (e.g. the auth broker) crash the whole server — that would
// surface in the browser as an opaque "Failed to fetch".
process.on("unhandledRejection", (err) => {
  console.error("  [warn] unhandled rejection:", (err && err.message) || err);
});
process.on("uncaughtException", (err) => {
  console.error("  [warn] uncaught exception:", (err && err.message) || err);
});
server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`\n  Port ${PORT} is already in use. Another server may be running.`);
    console.error(`  Restart with a fresh link:  .\\Start-Kanban.ps1 -Restart\n`);
    process.exit(1);
  }
  console.error("  [server error]", (err && err.message) || err);
});

function start(port = PORT) {
  server.listen(port, "127.0.0.1", () => {
    const link = `http://localhost:${port}/auth?token=${LAUNCH_TOKEN}`;
    console.log("\n  ADO Command Center");
    console.log("  ------------------");
    if (!CONFIG) console.log("  First run — you'll be guided through setup.");
    console.log("  Open this link (contains your one-time launch token):\n");
    console.log("  " + link + "\n");
    console.log("  Keep this terminal open. Press Ctrl+C to stop.\n");
    if (process.env.ACC_OPEN_BROWSER === "1") {
      const { exec } = require("child_process");
      const cmd = process.platform === "win32" ? `start "" "${link}"`
        : process.platform === "darwin" ? `open "${link}"` : `xdg-open "${link}"`;
      exec(cmd, { shell: true }, () => {});
    }
  });
  return server;
}

// Embeddable: the tray host (command-center-tray.js) requires this module and
// calls start() in-process so it can read LAUNCH_TOKEN. Running the file
// directly (node kanban-server.js / Start-Kanban.ps1) still starts the server.
module.exports = { start, server, PORT, LAUNCH_TOKEN };

if (require.main === module) {
  start(PORT);
}
