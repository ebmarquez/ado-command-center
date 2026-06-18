// Authentication for the ADO Command Center via AzureAuth (the Microsoft
// `azureauth` CLI — https://aka.ms/AzureAuth).
//
// Why not device-code or PAT or the Azure CLI? In some corporate tenants,
// administration blocks the device-code flow and Personal Access Tokens, and
// Azure DevOps rejects tokens minted by the Azure CLI public client
// (04b07795…) with a 302 -> sign-in. AzureAuth mints Azure DevOps tokens
// through the OS authentication broker (WAM) using the Visual Studio first-party
// client (872cd9fa…), which IS allowlisted for ADO and satisfies Conditional
// Access on a compliant device. The broker caches and silently refreshes, so
// after one interactive sign-in, `azureauth ado token` returns silently.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

// Azure DevOps resource app ID — the resource AzureAuth requests a token for.
const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";

// Locate the azureauth executable: explicit override, then PATH, then the
// default per-user install (highest installed version).
function resolveAzureAuth() {
  if (process.env.AZUREAUTH_PATH && fs.existsSync(process.env.AZUREAUTH_PATH)) return process.env.AZUREAUTH_PATH;
  const isWin = process.platform === "win32";
  if (isWin) {
    const root = path.join(process.env.LOCALAPPDATA || "", "Programs", "AzureAuth");
    try {
      const versions = fs.readdirSync(root)
        .map((v) => path.join(root, v, "azureauth.exe"))
        .filter((p) => fs.existsSync(p))
        .sort();
      if (versions.length) return versions[versions.length - 1];
    } catch { /* not installed there */ }
    return "azureauth.exe"; // fall back to PATH
  }
  return "azureauth";
}

const AZUREAUTH = resolveAzureAuth();

// Run azureauth and resolve trimmed stdout. Rejects on non-zero exit.
function runAzureAuth(args) {
  return new Promise((resolve, reject) => {
    execFile(AZUREAUTH, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = (stderr || "").toString();
        return reject(err);
      }
      resolve((stdout || "").toString().trim());
    });
  });
}

// Decode a JWT payload without verifying (we only need exp/upn for caching).
function decodeJwt(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(part, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

// A tenant override is only meaningful when it is a real tenant id (GUID) or a
// domain. AzureAuth defaults to the Microsoft tenant when omitted.
function azTenant(tenant) {
  if (!tenant) return null;
  const t = String(tenant).trim();
  if (!t || t.toLowerCase() === "organizations" || t.toLowerCase() === "common") return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) || t.includes(".")) return t;
  return null;
}

class Auth {
  constructor(opts = {}) {
    this.tenant = azTenant(opts.tenant);
    this._account = null;       // { username }
    this._token = null;         // cached access token
    this._tokenExp = 0;         // epoch ms when the cached token expires
    this._loginInFlight = null; // promise while interactive login runs
  }

  // Common azureauth args for an ADO token. `modes` controls how the token is
  // acquired (e.g. silent broker, or broker-then-web for interactive sign-in).
  _adoArgs(modes) {
    const args = ["ado", "token", "--output", "token", "--domain", "microsoft.com"];
    for (const m of modes) args.push("--mode", m);
    if (this.tenant) args.push("--tenant", this.tenant);
    return args;
  }

  _cacheFromToken(token) {
    this._token = token;
    const claims = decodeJwt(token);
    this._tokenExp = claims.exp ? claims.exp * 1000 : Date.now() + 50 * 60 * 1000;
    const upn = claims.upn || claims.unique_name || claims.email || claims.preferred_username;
    if (upn) this._account = { username: upn };
    return token;
  }

  // Returns a valid ADO access token, reusing the in-memory cache until it is
  // within 60s of expiry. Acquires silently via the broker (no UI). Throws
  // { needsLogin: true } when an interactive sign-in is required.
  async getToken() {
    if (this._token && Date.now() < this._tokenExp - 60000) return this._token;

    let token;
    try {
      // Silent modes only — broker (WAM) and integrated Windows auth. A short
      // timeout keeps data requests snappy and fails fast to a login prompt.
      token = await runAzureAuth([...this._adoArgs(["broker", "iwa"]), "--timeout", "1"]);
    } catch (err) {
      const e = new Error("Azure DevOps sign-in required. Click sign in (or run 'azureauth ado token').");
      e.needsLogin = true;
      e.cause = err && (err.stderr || err.message);
      throw e;
    }
    if (!token) {
      const e = new Error("Azure DevOps sign-in required.");
      e.needsLogin = true;
      throw e;
    }
    return this._cacheFromToken(token);
  }

  // True if we can silently obtain a token (i.e. the broker has a usable account).
  async hasAccount() {
    try {
      await this.getToken();
      return true;
    } catch {
      return false;
    }
  }

  async account() {
    if (this._account) return this._account;
    await this.hasAccount();
    return this._account;
  }

  // Interactive sign-in: broker first, then a browser window if needed. Primes
  // the broker cache so later getToken() calls succeed silently. Resolves once
  // azureauth returns a token (or rejects on failure/timeout).
  startLogin() {
    if (this._loginInFlight) return this._loginInFlight;
    this._loginInFlight = runAzureAuth(this._adoArgs(["broker", "web"]))
      .then((token) => {
        this._loginInFlight = null;
        if (token) this._cacheFromToken(token);
        return token;
      })
      .catch((err) => {
        this._loginInFlight = null;
        throw err;
      });
    return this._loginInFlight;
  }

  loginInProgress() {
    return !!this._loginInFlight;
  }

  // Clear our in-memory token cache. We do NOT clear the broker/AzureAuth cache,
  // which is shared with other Microsoft tooling on the machine.
  async signOut() {
    this._token = null;
    this._tokenExp = 0;
    this._account = null;
  }
}

module.exports = { Auth, ADO_RESOURCE, AZUREAUTH };
