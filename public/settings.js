// Shared settings menu for the ADO Command Center pages (dashboard + Kanban
// board). Provides theme (light/dark/system), text size, and an account
// sign-in/out trigger. Preferences persist in localStorage and apply on every
// page; the early theme/zoom bootstrap lives inline in each page's <head> to
// avoid a flash. This script builds the gear menu and handles live changes.
(() => {
  const LS = window.localStorage;
  const KEY_THEME = "acc.theme";     // 'light' | 'dark' | 'system'
  const KEY_FONT = "acc.fontScale";  // numeric string, 1 = browser baseline
  const DEFAULT_FONT = 1.3;          // XL — comfortable default; smaller sizes are opt-in

  const getTheme = () => LS.getItem(KEY_THEME) || "system";
  const getFont = () => parseFloat(LS.getItem(KEY_FONT)) || DEFAULT_FONT;

  function effectiveTheme(t) {
    if (t === "light" || t === "dark") return t;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", effectiveTheme(t));
  }
  function applyFont(scale) {
    document.documentElement.style.zoom = (scale && scale !== 1) ? String(scale) : "";
  }

  // Keep "System" themed pages in sync with OS changes.
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (getTheme() === "system") applyTheme("system");
  });
  // Sync across tabs.
  window.addEventListener("storage", (e) => {
    if (e.key === KEY_THEME) applyTheme(getTheme());
    if (e.key === KEY_FONT) applyFont(getFont());
  });

  // ---- styles ----
  const style = document.createElement("style");
  style.textContent = `
    #accGear { line-height: 1; }
    .acc-panel { position: fixed; top: 58px; right: 16px; z-index: 200; width: 280px;
      background: var(--cp-surface); color: var(--cp-text); border: 1px solid var(--cp-border);
      border-radius: 14px; box-shadow: var(--cp-shadow, 0 18px 48px rgba(0,0,0,0.2));
      padding: 14px 16px; font-size: 13px; }
    .acc-panel[hidden] { display: none; }
    .acc-panel h3 { margin: 0 0 10px; font-size: 14px; }
    .acc-row { margin-bottom: 14px; }
    .acc-row > label { display: block; font-size: 12px; font-weight: 600; color: var(--cp-text-muted); margin-bottom: 6px; }
    .acc-seg { display: inline-flex; border: 1px solid var(--cp-border); border-radius: 0.625rem; overflow: hidden; width: 100%; }
    .acc-seg button { flex: 1; font-size: 12px; font-weight: 600; padding: 6px 4px; border: none;
      background: var(--cp-surface); color: var(--cp-text-muted); cursor: pointer; font-family: inherit; }
    .acc-seg button:not(:last-child) { border-right: 1px solid var(--cp-border); }
    .acc-seg button.active { background: var(--cp-accent); color: var(--cp-accent-fg); }
    .acc-acct { font-size: 12px; color: var(--cp-text-muted); }
    .acc-acct b { color: var(--cp-text); }
    .acc-btn { margin-top: 8px; width: 100%; background: var(--cp-surface); color: var(--cp-text);
      border: 1px solid var(--cp-border); border-radius: 0.625rem; padding: 7px 12px; font-size: 13px;
      font-weight: 600; cursor: pointer; font-family: inherit; }
    .acc-btn:hover { border-color: var(--cp-border-strong); }
    .acc-btn.primary { background: var(--cp-accent); color: var(--cp-accent-fg); border-color: var(--cp-accent); }
    .acc-btn:disabled { opacity: 0.6; cursor: default; }
    .acc-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .acc-chip { display: inline-flex; align-items: center; gap: 6px; max-width: 100%;
      background: var(--cp-surface-soft, var(--cp-surface)); border: 1px solid var(--cp-border);
      border-radius: 999px; padding: 3px 6px 3px 10px; font-size: 11px; }
    .acc-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
    .acc-chip button { border: none; background: transparent; color: var(--cp-text-muted); cursor: pointer;
      font-size: 13px; line-height: 1; padding: 0 2px; font-family: inherit; }
    .acc-chip button:hover { color: var(--cp-danger, #d33); }
    .acc-add { display: flex; gap: 6px; }
    .acc-add input { flex: 1; min-width: 0; font-size: 12px; padding: 6px 8px; border-radius: 8px;
      border: 1px solid var(--cp-border); background: var(--cp-surface); color: var(--cp-text); font-family: inherit; }
    .acc-add button { flex: 0 0 auto; width: auto; padding: 6px 12px; margin-top: 0; }
    .acc-hint { font-size: 11px; color: var(--cp-text-muted); margin-top: 6px; }
    .acc-hint.err { color: var(--cp-danger, #d33); }
    .acc-toggle { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--cp-text); font-weight: 400; cursor: pointer; }
    .acc-toggle input { width: auto; margin: 0; cursor: pointer; }
    .acc-spin { display: inline-block; width: 12px; height: 12px; border: 2px solid var(--cp-border-strong);
      border-top-color: var(--cp-accent); border-radius: 50%; animation: accspin 0.7s linear infinite; vertical-align: -2px; margin-right: 6px; }
    @keyframes accspin { to { transform: rotate(360deg); } }
    .acc-panel { max-height: calc(100vh - 80px); overflow-y: auto; }
    .acc-sec { border-top: 1px solid var(--cp-border); margin-top: 4px; padding-top: 12px; }
    .acc-field { margin-bottom: 10px; }
    .acc-field > label { display: block; font-size: 12px; font-weight: 600; color: var(--cp-text-muted); margin-bottom: 4px; }
    .acc-field input, .acc-field select { width: 100%; box-sizing: border-box; font-size: 12px; padding: 6px 8px;
      border-radius: 8px; border: 1px solid var(--cp-border); background: var(--cp-surface); color: var(--cp-text); font-family: inherit; }
    .acc-grid2 { display: flex; gap: 8px; }
    .acc-grid2 > .acc-field { flex: 1; }
  `;
  document.head.appendChild(style);

  // ---- gear button ----
  const slot = document.getElementById("settingsSlot");
  const gear = document.createElement("button");
  gear.id = "accGear";
  gear.className = "btn";
  gear.title = "Settings";
  gear.setAttribute("aria-label", "Settings");
  gear.textContent = "⚙";
  if (slot) slot.appendChild(gear); else document.body.appendChild(gear);

  // ---- panel ----
  const panel = document.createElement("div");
  panel.className = "acc-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <h3>Settings</h3>
    <div class="acc-row">
      <label>Theme</label>
      <div class="acc-seg" data-group="theme">
        <button data-v="light">Light</button>
        <button data-v="dark">Dark</button>
        <button data-v="system">System</button>
      </div>
    </div>
    <div class="acc-row">
      <label>Text size</label>
      <div class="acc-seg" data-group="font">
        <button data-v="0.9">Small</button>
        <button data-v="1">Default</button>
        <button data-v="1.15">Large</button>
        <button data-v="1.3">XL</button>
        <button data-v="1.5">XXL</button>
      </div>
    </div>
    <div class="acc-row" id="accAutostartRow" style="display:none">
      <label>Start at login</label>
      <label class="acc-toggle"><input type="checkbox" id="accAutostart" /> <span>Launch the tray app when I sign in to Windows</span></label>
      <div class="acc-hint" id="accAutostartHint"></div>
    </div>
    <div class="acc-row">
      <label>Area paths (work-item scope)</label>
      <div class="acc-chips" id="accAreaChips"></div>
      <div class="acc-add">
        <input id="accAreaInput" list="accAreaList" placeholder="Add an area path…" autocomplete="off" />
        <datalist id="accAreaList"></datalist>
        <button class="acc-btn" id="accAreaAdd">Add</button>
      </div>
      <div class="acc-hint" id="accAreaHint"></div>
    </div>
    <div class="acc-row">
      <label>People (filter to assignees — optional)</label>
      <div class="acc-chips" id="accPeopleChips"></div>
      <div class="acc-add">
        <input id="accPeopleInput" list="accPeopleList" placeholder="Add a person (name or email)…" autocomplete="off" />
        <datalist id="accPeopleList"></datalist>
        <button class="acc-btn" id="accPeopleAdd">Add</button>
      </div>
      <div class="acc-hint" id="accPeopleHint"></div>
      <button class="acc-btn primary" id="accAreaSave" style="margin-top:8px">Save &amp; reload</button>
    </div>
    <div class="acc-sec" id="accCfgSection">
      <label style="display:block;font-size:12px;font-weight:600;color:var(--cp-text-muted);margin-bottom:8px">Configuration</label>
      <div class="acc-field">
        <label>Organization URL</label>
        <input id="accCfgOrg" placeholder="https://dev.azure.com/org" autocomplete="off" />
      </div>
      <div class="acc-field">
        <label>Project</label>
        <input id="accCfgProject" placeholder="Project name" autocomplete="off" />
      </div>
      <div class="acc-field">
        <label>Active scope (drives the board)</label>
        <select id="accCfgActive"></select>
      </div>
      <div class="acc-field">
        <label>Saved query</label>
        <select id="accCfgQuerySelect"><option value="">Loading queries…</option></select>
        <input id="accCfgQueryId" placeholder="Query GUID" autocomplete="off" style="margin-top:6px" />
        <div class="acc-hint" id="accCfgQueryHint"></div>
      </div>
      <div class="acc-grid2">
        <div class="acc-field">
          <label>Stale after (days)</label>
          <input id="accCfgStale" type="number" min="1" step="1" />
        </div>
        <div class="acc-field">
          <label>WIP limit</label>
          <input id="accCfgWip" type="number" min="1" step="1" />
        </div>
      </div>
      <div class="acc-field">
        <label>Closed states (excluded from the board)</label>
        <div class="acc-chips" id="accClosedChips"></div>
        <div class="acc-add">
          <input id="accClosedInput" placeholder="Add a state…" autocomplete="off" />
          <button class="acc-btn" id="accClosedAdd">Add</button>
        </div>
      </div>
      <div class="acc-field">
        <label>Port (restart required)</label>
        <input id="accCfgPort" type="number" min="1" max="65535" step="1" />
      </div>
      <button class="acc-btn primary" id="accCfgSave">Save configuration</button>
      <div class="acc-hint" id="accCfgHint"></div>
    </div>
    <div class="acc-row" style="margin-bottom:0">
      <label>Account</label>
      <div class="acc-acct" id="accAcctBody">Checking…</div>
    </div>
  `;
  document.body.appendChild(panel);

  function markSeg(group, value) {
    panel.querySelectorAll(`.acc-seg[data-group="${group}"] button`).forEach((b) => {
      b.classList.toggle("active", b.dataset.v === String(value));
    });
  }

  // theme buttons
  panel.querySelector('.acc-seg[data-group="theme"]').addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    LS.setItem(KEY_THEME, b.dataset.v);
    applyTheme(b.dataset.v);
    markSeg("theme", b.dataset.v);
  });
  // font buttons
  panel.querySelector('.acc-seg[data-group="font"]').addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const v = parseFloat(b.dataset.v);
    LS.setItem(KEY_FONT, String(v));
    applyFont(v);
    markSeg("font", b.dataset.v);
  });

  // ---- account ----
  const acctBody = panel.querySelector("#accAcctBody");
  let pollTimer = null;

  async function refreshAccount() {
    try {
      const me = await fetch("/api/me").then((r) => r.json());
      if (me.signedIn) {
        acctBody.innerHTML = `Signed in as <b>${escapeHtml(me.username || "your account")}</b>
          <button class="acc-btn" id="accSignOut">Sign out</button>`;
        acctBody.querySelector("#accSignOut").onclick = signOut;
      } else {
        acctBody.innerHTML = `Not signed in.
          <button class="acc-btn primary" id="accSignIn">Sign in</button>`;
        acctBody.querySelector("#accSignIn").onclick = signIn;
      }
    } catch {
      acctBody.innerHTML = `Couldn't reach the server.
        <button class="acc-btn" id="accRetry">Retry</button>`;
      acctBody.querySelector("#accRetry").onclick = refreshAccount;
    }
  }

  async function signIn() {
    acctBody.innerHTML = `<span class="acc-spin"></span> Starting sign-in…`;
    try {
      const r = await fetch("/api/login/start", { method: "POST" }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      acctBody.innerHTML = `<span class="acc-spin"></span> ${escapeHtml(r.message || "Complete the sign-in prompt, then return here.")}`;
      let waited = 0;
      clearInterval(pollTimer);
      pollTimer = setInterval(async () => {
        waited += 2500;
        const s = await fetch("/api/login/status").then((x) => x.json()).catch(() => ({}));
        if (s.signedIn) { clearInterval(pollTimer); refreshAccount(); }
        else if (waited >= 150000) { clearInterval(pollTimer); refreshAccount(); }
      }, 2500);
    } catch (e) {
      acctBody.innerHTML = `${escapeHtml(e.message)}
        <button class="acc-btn primary" id="accSignIn">Try again</button>`;
      acctBody.querySelector("#accSignIn").onclick = signIn;
    }
  }

  async function signOut() {
    acctBody.innerHTML = `<span class="acc-spin"></span> Signing out…`;
    try { await fetch("/api/logout", { method: "POST" }); } catch {}
    refreshAccount();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- area paths ----
  const areaChips = panel.querySelector("#accAreaChips");
  const areaInput = panel.querySelector("#accAreaInput");
  const areaList = panel.querySelector("#accAreaList");
  const areaAdd = panel.querySelector("#accAreaAdd");
  const areaSave = panel.querySelector("#accAreaSave");
  const areaHint = panel.querySelector("#accAreaHint");
  let areaPaths = [];      // current selection
  let areaAvail = [];      // valid paths from ADO
  let areaLoaded = false;

  const peopleChips = panel.querySelector("#accPeopleChips");
  const peopleInput = panel.querySelector("#accPeopleInput");
  const peopleList = panel.querySelector("#accPeopleList");
  const peopleAdd = panel.querySelector("#accPeopleAdd");
  const peopleHint = panel.querySelector("#accPeopleHint");
  let people = [];         // selected emails
  let peopleAvail = [];    // [{email,name}] discovered assignees

  const autostartRow = panel.querySelector("#accAutostartRow");
  const autostart = panel.querySelector("#accAutostart");
  const autostartHint = panel.querySelector("#accAutostartHint");
  function setAutostartHint(msg, isErr) { autostartHint.textContent = msg || ""; autostartHint.classList.toggle("err", !!isErr); }

  async function loadAutostart() {
    try {
      const r = await fetch("/api/autostart").then((x) => x.json());
      if (!r.supported) { autostartRow.style.display = "none"; return; }
      autostartRow.style.display = "";
      autostart.checked = !!r.enabled;
      setAutostartHint("");
    } catch { autostartRow.style.display = "none"; }
  }
  autostart.addEventListener("change", async () => {
    const want = autostart.checked;
    autostart.disabled = true;
    setAutostartHint("Saving…");
    try {
      const r = await fetch("/api/autostart", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: want }),
      }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      autostart.checked = !!r.enabled;
      setAutostartHint(r.enabled ? "Will launch at sign-in." : "Auto-start disabled.");
    } catch (e) {
      autostart.checked = !want;
      setAutostartHint(e.message || "Couldn't update.", true);
    } finally { autostart.disabled = false; }
  });

  function leaf(p) { const s = String(p).split("\\"); return s[s.length - 1] || p; }
  function setHint(msg, isErr) { areaHint.textContent = msg || ""; areaHint.classList.toggle("err", !!isErr); }
  function setPeopleHint(msg, isErr) { peopleHint.textContent = msg || ""; peopleHint.classList.toggle("err", !!isErr); }

  function nameFor(email) {
    const hit = peopleAvail.find((x) => x.email.toLowerCase() === String(email).toLowerCase());
    return hit ? hit.name : email;
  }
  function renderPeopleChips() {
    peopleChips.innerHTML = people.length
      ? people.map((em, i) =>
          `<span class="acc-chip" title="${escapeHtml(em)}"><span>${escapeHtml(nameFor(em))}</span>` +
          `<button data-i="${i}" aria-label="Remove">×</button></span>`).join("")
      : `<span class="acc-hint">All assignees (no people filter).</span>`;
    peopleChips.querySelectorAll("button[data-i]").forEach((b) => {
      b.onclick = () => { people.splice(Number(b.dataset.i), 1); renderPeopleChips(); };
    });
  }

  function renderChips() {
    areaChips.innerHTML = areaPaths.length
      ? areaPaths.map((p, i) =>
          `<span class="acc-chip" title="${escapeHtml(p)}"><span>${escapeHtml(leaf(p))}</span>` +
          `<button data-i="${i}" aria-label="Remove">×</button></span>`).join("")
      : `<span class="acc-hint">No area paths set yet.</span>`;
    areaChips.querySelectorAll("button[data-i]").forEach((b) => {
      b.onclick = () => { areaPaths.splice(Number(b.dataset.i), 1); renderChips(); };
    });
  }

  async function loadAreas() {
    if (areaLoaded) return;
    setHint("Loading…");
    try {
      const scope = await fetch("/api/scope").then((r) => r.json());
      areaPaths = Array.isArray(scope.areaPaths) ? scope.areaPaths.slice() : [];
      people = Array.isArray(scope.people) ? scope.people.slice() : [];
      renderChips();
      renderPeopleChips();
      if (scope.activeType && scope.activeType !== "areaPath") {
        const seeded = scope.derivedFrom === "query" && areaPaths.length
          ? ` Prefilled ${areaPaths.length} path(s) from that query — add more below.` : "";
        setHint(`Active scope is "${escapeHtml(scope.activeName || scope.activeType)}". Saving switches the board to these area paths.${seeded}`);
      } else { setHint(""); }
      if (scope.org && scope.project) {
        const q = `?org=${encodeURIComponent(scope.org)}&project=${encodeURIComponent(scope.project)}`;
        const r = await fetch("/api/discover/areas" + q).then((x) => x.json());
        areaAvail = Array.isArray(r.areaPaths) ? r.areaPaths : [];
      }
      // Discover assignees from the current scope for the people picker.
      try {
        const rp = await fetch("/api/discover/people").then((x) => x.json());
        peopleAvail = Array.isArray(rp.people) ? rp.people : [];
        peopleList.innerHTML = peopleAvail
          .map((x) => `<option value="${escapeHtml(x.email)}">${escapeHtml(x.name)}</option>`).join("");
        renderPeopleChips();
      } catch { /* leave free-text entry available */ }
      areaLoaded = true;
    } catch {
      setHint("Couldn't load area paths (are you signed in?).", true);
    }
  }

  function addArea() {
    const v = areaInput.value.trim();
    if (!v) return;
    const match = areaAvail.find((p) => p.toLowerCase() === v.toLowerCase());
    if (areaAvail.length && !match) { setHint("Pick a valid area path from the list.", true); return; }
    const val = match || v;
    if (areaPaths.some((p) => p.toLowerCase() === val.toLowerCase())) { setHint("Already added.", true); return; }
    areaPaths.push(val); areaInput.value = ""; setHint(""); renderChips();
  }
  areaAdd.onclick = addArea;
  areaInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addArea(); } });
  // Type-ahead: only render the top matches (the project can have ~19k areas).
  areaInput.addEventListener("input", () => {
    const v = areaInput.value.trim().toLowerCase();
    if (v.length < 2) { areaList.innerHTML = ""; return; }
    const hits = [];
    for (const p of areaAvail) {
      if (p.toLowerCase().includes(v)) { hits.push(p); if (hits.length >= 50) break; }
    }
    areaList.innerHTML = hits.map((p) => `<option value="${escapeHtml(p)}">`).join("");
  });

  function addPerson() {
    let v = peopleInput.value.trim();
    if (!v) return;
    // Accept "Name <email>" or a bare email/name; resolve to an email when possible.
    const angle = v.match(/<([^>]+)>/);
    if (angle) v = angle[1].trim();
    let email = v;
    const byEmail = peopleAvail.find((x) => x.email.toLowerCase() === v.toLowerCase());
    const byName = peopleAvail.find((x) => x.name.toLowerCase() === v.toLowerCase());
    if (byEmail) email = byEmail.email;
    else if (byName) email = byName.email;
    if (!/@/.test(email)) { setPeopleHint("Enter an email, or pick a name from the list.", true); return; }
    if (people.some((p) => p.toLowerCase() === email.toLowerCase())) { setPeopleHint("Already added.", true); return; }
    people.push(email); peopleInput.value = ""; setPeopleHint(""); renderPeopleChips();
  }
  peopleAdd.onclick = addPerson;
  peopleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addPerson(); } });

  areaSave.onclick = async () => {
    if (!areaPaths.length) { setHint("Add at least one area path first.", true); return; }
    areaSave.disabled = true; setHint("Saving…");
    try {
      const r = await fetch("/api/scope/areapaths", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ areaPaths, people }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setHint("Saved. Reloading…");
      location.reload();
    } catch (e) {
      areaSave.disabled = false; setHint(e.message, true);
    }
  };

  // ---- configuration (full config.json editor) ----
  const cfgOrg = panel.querySelector("#accCfgOrg");
  const cfgProject = panel.querySelector("#accCfgProject");
  const cfgActive = panel.querySelector("#accCfgActive");
  const cfgQuerySelect = panel.querySelector("#accCfgQuerySelect");
  const cfgQueryId = panel.querySelector("#accCfgQueryId");
  const cfgQueryHint = panel.querySelector("#accCfgQueryHint");
  const cfgStale = panel.querySelector("#accCfgStale");
  const cfgWip = panel.querySelector("#accCfgWip");
  const cfgPort = panel.querySelector("#accCfgPort");
  const closedChips = panel.querySelector("#accClosedChips");
  const closedInput = panel.querySelector("#accClosedInput");
  const closedAdd = panel.querySelector("#accClosedAdd");
  const cfgSave = panel.querySelector("#accCfgSave");
  const cfgHint = panel.querySelector("#accCfgHint");
  let closedStates = [];
  let cfgLoaded = false;
  let cfgQueriesLoaded = false;

  function setCfgHint(msg, isErr) { cfgHint.textContent = msg || ""; cfgHint.classList.toggle("err", !!isErr); }

  function renderClosedChips() {
    closedChips.innerHTML = closedStates.length
      ? closedStates.map((s, i) =>
          `<span class="acc-chip" title="${escapeHtml(s)}"><span>${escapeHtml(s)}</span>` +
          `<button data-i="${i}" aria-label="Remove">×</button></span>`).join("")
      : `<span class="acc-hint">No closed states set.</span>`;
    closedChips.querySelectorAll("button[data-i]").forEach((b) => {
      b.onclick = () => { closedStates.splice(Number(b.dataset.i), 1); renderClosedChips(); };
    });
  }
  function addClosed() {
    const v = closedInput.value.trim();
    if (!v) return;
    if (closedStates.some((s) => s.toLowerCase() === v.toLowerCase())) { closedInput.value = ""; return; }
    closedStates.push(v); closedInput.value = ""; renderClosedChips();
  }
  closedAdd.onclick = addClosed;
  closedInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addClosed(); } });

  cfgQuerySelect.addEventListener("change", () => {
    if (cfgQuerySelect.value) cfgQueryId.value = cfgQuerySelect.value;
  });

  async function loadQueriesInto(org, project, currentId) {
    if (cfgQueriesLoaded || !org || !project) return;
    try {
      const q = `?org=${encodeURIComponent(org)}&project=${encodeURIComponent(project)}`;
      const r = await fetch("/api/discover/queries" + q).then((x) => x.json());
      const queries = Array.isArray(r.queries) ? r.queries : [];
      cfgQuerySelect.innerHTML = [`<option value="">— pick a saved query —</option>`]
        .concat(queries.map((qq) => `<option value="${escapeHtml(qq.id)}">${escapeHtml(qq.path || qq.name)}</option>`))
        .join("");
      if (currentId) {
        cfgQuerySelect.value = currentId;
        const hit = queries.find((qq) => qq.id === currentId);
        cfgQueryHint.textContent = hit ? `Current: ${hit.path || hit.name}` : "Current query is not in this project's list.";
      }
      cfgQueriesLoaded = true;
    } catch {
      cfgQuerySelect.innerHTML = `<option value="">(couldn't load queries — enter the ID below)</option>`;
    }
  }

  async function loadSettings() {
    if (cfgLoaded) return;
    setCfgHint("Loading…");
    try {
      const s = await fetch("/api/settings").then((r) => r.json());
      cfgOrg.value = s.org || "";
      cfgProject.value = s.project || "";
      cfgStale.value = s.staleDays != null ? s.staleDays : "";
      cfgWip.value = s.wipLimit != null ? s.wipLimit : "";
      cfgPort.value = s.port != null ? s.port : "";
      closedStates = Array.isArray(s.closedStates) ? s.closedStates.slice() : [];
      renderClosedChips();
      cfgActive.innerHTML = (s.scopes || [])
        .map((sc) => `<option value="${sc.index}">${escapeHtml(sc.name)} (${escapeHtml(sc.type)})</option>`).join("");
      cfgActive.value = String(s.activeScope || 0);
      const qid = s.queryScope ? s.queryScope.queryId : "";
      cfgQueryId.value = qid || "";
      cfgQueryHint.textContent = "";
      cfgLoaded = true;
      setCfgHint("");
      loadQueriesInto(s.org, s.project, qid); // best-effort picker; needs sign-in
    } catch {
      setCfgHint("Couldn't load configuration.", true);
    }
  }

  cfgSave.onclick = async () => {
    cfgSave.disabled = true; setCfgHint("Saving…");
    const payload = {
      org: cfgOrg.value.trim(),
      project: cfgProject.value.trim(),
      staleDays: cfgStale.value,
      wipLimit: cfgWip.value,
      port: cfgPort.value,
      closedStates,
      activeScope: cfgActive.value,
      query: { queryId: cfgQueryId.value.trim() },
    };
    try {
      const r = await fetch("/api/settings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      if (j.portChanged) {
        setCfgHint(`Saved. Restart the app (tray ▸ Restart) to use port ${j.port}.`);
        cfgSave.disabled = false;
      } else {
        setCfgHint("Saved. Reloading…");
        location.reload();
      }
    } catch (e) {
      cfgSave.disabled = false; setCfgHint(e.message, true);
    }
  };

  // ---- open/close ----
  function open() {
    markSeg("theme", getTheme());
    markSeg("font", getFont());
    refreshAccount();
    loadAreas();
    loadAutostart();
    loadSettings();
    panel.hidden = false;
  }
  function close() {
    panel.hidden = true;
    clearInterval(pollTimer);
  }
  gear.addEventListener("click", (e) => {
    e.stopPropagation();
    panel.hidden ? open() : close();
  });
  document.addEventListener("click", (e) => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== gear) close();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
})();
