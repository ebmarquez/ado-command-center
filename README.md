# ADO Command Center

A local, self-hosted **Kanban board + analytics dashboard** for your Azure
DevOps work items. Drag cards to update work-item state live, see honest
Epic→Feature progress rollups, and get an "attention radar" of stale items,
unstarted priorities, empty features, and WIP overload.

Everything runs on your machine. It reads (and optionally updates) work items
through **AzureAuth** (your device's authentication broker) — no data leaves your
computer, no server to host, no secrets to store.

## Features

- **Live Kanban board** — columns by state, drag-and-drop to change a work
  item's state (writes back to Azure DevOps). Drops are validated per work-item
  type so you can't move an item to an invalid state.
- **Command Center dashboard**
  - **State filter** — a header switch (**Active only · Hide done · Show all**,
    default *Active only*) governs the Epic→Feature→child trees so you can focus
    on new/in-progress work or expand to see completed items. Filtering is by ADO
    state *category* (robust to custom state names); %-complete rollup bars still
    reflect true totals. Triage lists (**Other items**, **stale**, and the radar)
    always exclude completed/resolved/removed items regardless of the switch.
  - **Attention radar** — stale items (configurable threshold), P1s not started,
    features with no child breakdown, and per-person WIP overload.
  - **Hierarchy rollup** — Epic → Feature → child tree with count-based
    %-complete bars computed over *all* descendants (honest progress). Pick a
    single Epic or Feature from the focus picker to drill into just its
    downstream features/tasks/bugs with a segmented status summary.
  - **Drag-to-parent** — drag any task, bug or feature onto an Epic or Feature
    in the Hierarchy tab to set or move its parent in Azure DevOps (great for
    attaching orphaned items or re-parenting a feature to a new epic). ADO's own
    process and cycle rules are enforced; invalid drops are reported.
  - **Workload** — per-person WIP, not-started, stale counts, and type mix.
- **First-run setup wizard** — sign in via AzureAuth, pick your org/project,
  and define your scope with live auto-discovery of projects, saved queries, and
  area paths. Test your scope before saving.
- **Flexible scopes** — define "what the board shows" as a people list, an ADO
  saved query, or an area path. Switch or add scopes anytime.
- **Daily snapshots** — optional history capture for future trend charts.
- **Tray app** — runs from the Windows system tray (no console window). Tray
  menu opens the board/dashboard in a chromeless Edge app-window, restarts the
  server, or quits. Optional auto-start at login. See *Run as a tray app*.
- **Settings menu** — a ⚙ gear on both the board and the dashboard for
  **theme** (Light / Dark / System), **text size** (Small / Default / Large / XL /
  XXL — defaults to **XL**), a **Start at login** toggle (Windows tray app), an
  **account** sign-in/out trigger, an **Area paths** editor that switches the
  board to a locally-managed area-path scope (add/remove paths, save, reload — no
  ADO query editing), and a **Configuration** section that edits every
  `config.json` field — organization URL, project, active scope, saved query
  (pick from a list or paste a GUID), stale-after days, WIP limit, closed
  states, and port (a port change takes effect after a tray ▸ Restart). The
  area-path editor also takes an optional **people** filter
  (by assignee email) so the scope is *items in those area paths **and** assigned to
  those people*. Theme/text preferences are saved in the browser; everything in
  the Configuration section is saved to `config.json`.

## Prerequisites

- **Node.js 18+** — <https://nodejs.org>
- **AzureAuth** — <https://aka.ms/AzureAuth>. Mints the Azure DevOps token via
  your device's authentication broker. Works in tenants where device-code sign-in
  and Personal Access Tokens are blocked by policy.
- An **Azure DevOps** account with access to the org/project you want to view.
- A web browser.

That's it. No app registration or PAT required.

## Quick start

```powershell
git clone https://github.com/ebmarquez/ado-command-center.git
cd ado-command-center
./Start-Kanban.ps1
```

On first run the launcher installs dependencies, starts the server, and opens a
one-time launch link in your browser. From there:

1. **Sign in** — click Sign in to launch AzureAuth. The first time, a sign-in
   prompt may appear (handled by your device's authentication broker); after
   that it refreshes silently.
2. **Choose your organization and project** (projects are auto-discovered).
3. **Define your scope** — People, Saved query, or Area path. Click **Test** to
   see how many items match.
4. **Save** — the dashboard opens. You're done.

Your settings are written to `config.json` (gitignored). Next launch skips
setup and goes straight to the board.

> Not on Windows? Run it directly: `npm install && npm start`, then open the
> launch link the server prints in the terminal.

## Run as a tray app (recommended)

Tired of keeping a PowerShell window open? Install the tray app so the Command
Center runs from the **Windows system tray** — no console window to close by
accident.

```powershell
cd ado-command-center
./Install.ps1
```

This installs dependencies and creates Desktop, Start-Menu, and Startup
shortcuts that launch the tray with **no console window** (via
`Launch-CommandCenter.vbs`). The tray icon's menu gives you:

- **Open Board** / **Open Dashboard** — open in a chromeless Edge app-window
  (falls back to your default browser), already authenticated.
- **Restart server** — restart the local server in place.
- **Quit** — stop the server and exit.

**Auto-start at login** is on by default. Toggle it anytime from the Settings
(⚙) panel ("Start at login"), or install without it via `./Install.ps1
-NoStartup`. Remove the shortcuts with `./Uninstall.ps1`.

`./Start-Kanban.ps1` still works for a console/dev run.

## How it works

- A small Node HTTP server (`kanban-server.js`) serves the UI and proxies reads
  and the single write (`PATCH System.State`) to Azure DevOps.
- **Auth** uses **AzureAuth** (<https://aka.ms/AzureAuth>) via `auth.js`. The
  server shells out to `azureauth ado token` to mint Azure DevOps tokens through
  the OS authentication broker (WAM) using the Visual Studio first-party client.
  This works where device-code sign-in, Personal Access Tokens, and Azure CLI
  tokens are blocked by tenant policy — **no app registration is needed** and this
  tool never stores a token of its own. The broker caches and refreshes silently
  after the first sign-in. Set `AZUREAUTH_PATH` to override the executable
  location if it isn't on `PATH`.
- The server binds to `127.0.0.1` only and gates every route behind a one-time
  **launch token** (printed to your terminal each run), which is exchanged for a
  session cookie. Only someone who can see your terminal can use it.
- **Scope** is defined in `config.json` and compiled to a WIQL query at request
  time (`config.js`). Nothing about your team or org is hard-coded.

## Configuration

The setup wizard writes `config.json` for you. To edit by hand, see
[`config.example.json`](./config.example.json). Key fields:

| Field | Meaning |
|-------|---------|
| `org` / `project` | Azure DevOps org URL and project name |
| `port` | Local port (default `7421`) |
| `staleDays` | "Needs attention" age threshold (default `30`) |
| `wipLimit` | Per-person in-progress overload threshold (default `10`) |
| `scopes[]` | Named scopes: `people`, `query`, or `areaPath` |
| `activeScope` | Index of the scope to show |
| `tenant` | *(optional)* Entra tenant id/domain passed to `azureauth` for non-Microsoft tenants |

## Daily snapshots (optional)

To accrue history for trend analysis, run the snapshot on a schedule:

```powershell
node snapshot.js
```

It writes `snapshots/YYYY-MM-DD.json`. Schedule it with Task Scheduler (Windows)
or cron. It reuses your cached sign-in, so sign in via the app at least once
first.

## Commands

| Command | What it does |
|---------|--------------|
| `./Install.ps1` | Install deps + create tray-app shortcuts (Desktop / Start Menu / Startup) |
| `./Install.ps1 -NoStartup` | Install without launching at sign-in |
| `./Uninstall.ps1` | Remove the tray-app shortcuts |
| `./Start-Kanban.ps1` | Install deps (first run), start server, open the launch link |
| `./Start-Kanban.ps1 -Restart` | Stop a running instance and start fresh |
| `./Start-Kanban.ps1 -NoBrowser` | Start without opening a browser |
| `npm start` | Start the server directly |
| `node command-center-tray.js` | Start the tray app directly (no console window when launched via the `.vbs`) |
| `node snapshot.js` | Capture a daily snapshot |

## Security & privacy

- Runs entirely locally; binds to `127.0.0.1`.
- No secrets in the repo. `config.json` and `.token-cache.json` are gitignored.
- Auth tokens are obtained via your own Microsoft sign-in and stored only on
  your machine.
- The only write the tool performs is changing a work item's **State** when you
  drag a card.

## License

[MIT](./LICENSE)
