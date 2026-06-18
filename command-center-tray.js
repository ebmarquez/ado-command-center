// All-Node system-tray host for the ADO Command Center.
//
// Runs the Command Center HTTP server in-process (a single Node process) and
// shows a tray icon. Click the icon for a menu:
//   - Open Board        (opens an Edge "app" window, no address bar)
//   - Open Dashboard
//   - Restart server
//   - Quit
//
// No URL/token to remember, no PowerShell window, no console window. Launch
// hidden via Launch-CommandCenter.vbs (a shortcut to it is created by
// Install.ps1).
//
// Unlike a plain browser launch, the Command Center gates the session behind a
// one-time launch token. Because the server runs IN THIS PROCESS, we can read
// its LAUNCH_TOKEN directly and open the authenticated link
// (/auth?token=...&next=...), which sets the session cookie and lands on the
// requested page.

const path = require("path");
const fs = require("fs");
const http = require("http");
const { spawn } = require("child_process");
const SysTray = require("systray2").default;
const serverModule = require("./kanban-server");

const HERE = __dirname;
const PORT = serverModule.PORT || 7421;
const TOKEN = serverModule.LAUNCH_TOKEN;
const BASE_URL = `http://localhost:${PORT}`;
const ICON = path.join(HERE, "command-center.ico");

const EDGE = [
  path.join(process.env["ProgramFiles"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
  path.join(process.env["ProgramFiles(x86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
].find((p) => {
  try { return p && fs.existsSync(p); } catch { return false; }
});

let httpServer = null;

function pingServer() {
  return new Promise((resolve) => {
    const req = http.get(`${BASE_URL}/api/health`, { timeout: 2500 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

function startServer() {
  if (!httpServer) httpServer = serverModule.start(PORT);
  return httpServer;
}

function restartServer() {
  return new Promise((resolve) => {
    if (httpServer) {
      httpServer.close(() => { httpServer = serverModule.start(PORT); resolve(true); });
      httpServer = null;
    } else {
      httpServer = serverModule.start(PORT);
      resolve(true);
    }
  });
}

function authUrl(subPath = "") {
  // /auth sets the session cookie, then redirects to ?next= (a local path).
  const next = subPath && subPath.startsWith("/") ? subPath : "/";
  return `${BASE_URL}/auth?token=${TOKEN}&next=${encodeURIComponent(next)}`;
}

function openApp(subPath = "") {
  if (process.env.ACC_NO_OPEN === "1") return; // test hook: suppress window
  const target = authUrl(subPath);
  try {
    if (EDGE) {
      spawn(EDGE, [`--app=${target}`], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
  }
}

// ---- single-instance guard -------------------------------------------------
// If a server is already listening (another tray instance), just open the
// board and exit without creating a duplicate tray icon. Note: a server
// started by an OLDER process uses a DIFFERENT launch token, so we can't build
// an authenticated link for it here — open the bare board URL and let the
// existing instance's own session/login handle auth.
(async function main() {
  if (await pingServer()) {
    const bare = process.env.ACC_NO_OPEN === "1" ? null : `${BASE_URL}/`;
    if (bare) {
      try {
        if (EDGE) spawn(EDGE, [`--app=${bare}`], { detached: true, stdio: "ignore" }).unref();
        else spawn("cmd", ["/c", "start", "", bare], { detached: true, stdio: "ignore" }).unref();
      } catch { spawn("cmd", ["/c", "start", "", bare], { detached: true, stdio: "ignore" }).unref(); }
    }
    process.exit(0);
  }

  startServer();

  const itemBoard = {
    title: "Open Board",
    tooltip: "Open the Kanban board",
    enabled: true,
    click: () => openApp("/"),
  };
  const itemDash = {
    title: "Open Dashboard",
    tooltip: "Open the analytics dashboard",
    enabled: true,
    click: () => openApp("/dashboard"),
  };
  const itemRestart = {
    title: "Restart server",
    tooltip: "Restart the local Command Center server",
    enabled: true,
    click: async () => { await restartServer(); },
  };
  const itemQuit = {
    title: "Quit",
    tooltip: "Stop the server and exit",
    enabled: true,
    click: () => {
      try { if (httpServer) httpServer.close(); } catch {}
      systray.kill(true); // also exits this Node process
    },
  };

  const systray = new SysTray({
    menu: {
      icon: ICON,
      title: "ADO Command Center",
      tooltip: "ADO Command Center",
      items: [
        itemBoard,
        itemDash,
        SysTray.separator,
        itemRestart,
        SysTray.separator,
        itemQuit,
      ],
    },
    debug: false,
    copyDir: false,
  });

  // onClick/onError/onExit must be registered only after the tray child
  // process exists (the constructor's init is async), so wire them in ready().
  systray.ready()
    .then(() => {
      systray.onClick((action) => {
        if (action.item && typeof action.item.click === "function") action.item.click();
      });
      systray.onError((err) => {
        console.error("systray error:", err && err.message);
        openApp("/");
      });
      openApp("/");
    })
    .catch((err) => {
      // Tray helper failed to start. Fall back to opening the board so the
      // user still gets it even without a tray icon.
      console.error("systray failed:", err && err.message);
      openApp("/");
    });

  process.on("SIGINT", () => { try { systray.kill(true); } catch { process.exit(0); } });
  process.on("SIGTERM", () => { try { systray.kill(true); } catch { process.exit(0); } });
})();
