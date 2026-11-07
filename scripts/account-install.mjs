#!/usr/bin/env node
// account-install.mjs: put Supersuit into Claude Code from app.supersuit.co with the member's
// Supersuit sign-in. No GitHub account, no repo grant, no git credential.
//
//   node account-install.mjs            sign in if needed, then install Supersuit
//   node account-install.mjs --check    say what would happen, change nothing
//   node account-install.mjs --switch   also move a Mac that gets Supersuit from GitHub today
//   node account-install.mjs --no-sign-in   stop instead of signing in (the unattended move in an update)
//   node account-install.mjs headers    the marketplace's headersHelper (Claude Code runs this)
//
// Design: "Installing Freedom without GitHub" (2026-10-14) and superproject install-without-github,
// step s08. Server half: continental-works-web src/lib/plugin-releases.ts.
//
// ONE FILE, NODE'S OWN MODULES ONLY. A fresh Mac downloads this alone, before any plugin exists,
// so it cannot import the plugin's libraries. It copies itself to ~/.supersuit/bin, and that copy
// is the headersHelper Claude Code runs before every catalog refresh and zip download.
//
// Measured 2026-11-01 (Claude Code 2.1.316, an empty HOME, github.com cut off, no Anthropic login):
//   - `claude plugin marketplace add <url>` refuses when settings declare the name with a
//     headersHelper ("its source doesn't match its extraKnownMarketplaces entry"), and no CLI flag
//     carries one. So this never runs `marketplace add`: it DECLARES the marketplace in user
//     settings, and a session start registers it (a `claude -p` that then says "Not logged in"
//     still registered it). Then `claude plugin install supersuit@supersuit` downloaded 7.4.0.
//   - A changed declared source is Claude Code's documented replacement path: "Plugins already
//     installed from it now update from the new source." That is what --switch relies on.
//
// The token code below repeats supersuit-auth.mjs's idToken on purpose (a third copy, the analytics
// sender holds the second): this file must run with nothing else on disk. Change the token shape in
// all three, and run tests/account-install.test.mjs, tests/plugin-headers.test.mjs.
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, chmodSync, realpathSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, hostname } from "node:os";
import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const MARKETPLACE_URL = "https://app.supersuit.co/api/plugin/marketplace.json";
export const MIN_CLAUDE = "2.1.238";
export const PORTAL_DEFAULT = "https://app.supersuit.co";
const PORTAL = process.env.FREEDOM_PORTAL || PORTAL_DEFAULT;
const API_KEY = process.env.FREEDOM_FIREBASE_API_KEY || "AIzaSyCjDs2AeeYo4s4Osudq6YDwNbjWCqexU_g";
const PROJECT = process.env.FREEDOM_FIREBASE_PROJECT || "cci-paos-analytics";

const home = () => process.env.FREEDOM_HOME || homedir();
const stateDir = () => join(home(), ".supersuit");
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(home(), ".claude");
const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };

// ── pure decisions, tested ─────────────────────────────────────────────────────────────────────

export function versionAtLeast(text, min) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text || ""));
  if (!m) return false;
  const a = m.slice(1).map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/**
 * Claude Code runs this through a shell: sh on a Mac; on Windows cmd.exe or Git Bash. Absolute paths,
 * double-quoted, printable ASCII, at most 500 chars. On Windows the paths are written with forward
 * slashes, which both cmd.exe and Git Bash run, and node reads; a backslash there is a path
 * separator to cmd and an escape to bash, so no one quoting is right for both. % (cmd) and $ and `
 * (bash) expand inside double quotes, so a path holding any of them is refused rather than quoted.
 */
export function helperCommand(node, script, platform = process.platform) {
  if (platform === "win32") {
    [node, script] = [node, script].map((p) => p.replace(/\\/g, "/"));
    if (/["%$`!]/.test(node + script)) throw new Error("a path with a quote, %, $, ! or backtick cannot be quoted safely");
  } else if (/["\\$`]/.test(node + script)) throw new Error("a path with a quote, backslash, $ or backtick cannot be quoted safely");
  const c = `"${node}" "${script}" headers`;
  if (c.length > 500 || !/^[\x20-\x7e]+$/.test(c) || / {4}/.test(c)) throw new Error("the helper command breaks Claude Code's rules");
  return c;
}

/**
 * The command that opens a page in the default browser. On Windows `explorer <url>` opened nothing
 * on the Dell (2026-11-02), and `cmd /c start` splits a URL at its &; rundll32's protocol handler
 * takes the URL whole.
 */
export function openCommand(url, platform = process.platform) {
  if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
  return [platform === "darwin" ? "open" : "xdg-open", [url]];
}

/** The user settings with Supersuit's account marketplace declared and its plugin switched on. */
export function withAccountMarketplace(settings, helper) {
  const s = structuredClone(settings || {});
  s.extraKnownMarketplaces = { ...(s.extraKnownMarketplaces || {}),
    supersuit: { source: { source: "url", url: MARKETPLACE_URL, headersHelper: helper }, autoUpdate: true } };
  s.enabledPlugins = { ...(s.enabledPlugins || {}), "supersuit@supersuit": true };
  return s;
}

/** Where Claude Code gets Supersuit from today: null, or { kind, account }. */
export function knownSupersuit(dir = claudeDir()) {
  const k = readJson(join(dir, "plugins", "known_marketplaces.json"));
  const src = k?.supersuit?.source;
  if (!src) return null;
  return { kind: src.source, account: src.source === "url" && src.url === MARKETPLACE_URL };
}

/** The folder Claude Code installed Supersuit into, from its install record, or null. */
export function supersuitInstallPath(dir = claudeDir()) {
  const rows = readJson(join(dir, "plugins", "installed_plugins.json"))?.plugins?.["supersuit@supersuit"];
  const row = Array.isArray(rows) ? (rows.find((r) => r?.scope === "user") || rows[0]) : null;
  return row?.installPath && existsSync(row.installPath) ? row.installPath : null;
}

/**
 * Put ~/.supersuit/bin/supersuit-lib (and the ~/.supersuit/plugin link) in place NOW, not at the next
 * session event (supersuit-dev#1655, reported by Tres Davis). Only the plugin's session-alive hook
 * ever wrote the resolver, and a plugin installed mid-session has no hooks running until
 * /reload-plugins, so every skill step that calls supersuit-lib failed in the very session that
 * installed it. This runs that same hook from the copy just installed, once, with liveness off
 * (FREEDOM_SESSION_ALIVE=off) and CLAUDE_PLUGIN_ROOT emptied, so there is one writer of the resolver
 * and this file still imports nothing. -> true when supersuit-lib is there afterwards.
 */
export function primeResolver(installPath, { home: h = home(), env = process.env } = {}) {
  const hook = installPath ? join(installPath, "hooks", "session-alive.sh") : null;
  if (hook && existsSync(hook)) {
    spawnSync("bash", [hook], { input: "", stdio: ["pipe", "ignore", "ignore"], timeout: 30_000,
      env: { ...env, HOME: h, FREEDOM_HOME: h, CLAUDE_PLUGIN_ROOT: "", FREEDOM_SESSION_ALIVE: "off" } });
  }
  return existsSync(join(h, ".supersuit", "bin", "supersuit-lib"));
}

const TOKEN = /^[A-Za-z0-9._-]+$/;
export const headerJson = (t) => (typeof t === "string" && TOKEN.test(t) ? JSON.stringify({ Authorization: `Bearer ${t}` }) + "\n" : "");

// ── the token, as supersuit-auth.mjs mints it ──────────────────────────────────────────────────

async function idToken() {
  const auth = readJson(join(stateDir(), "auth.json"));
  if (!auth?.refreshToken || !auth?.apiKey) return null;
  const cacheFile = join(stateDir(), "token-cache.json");
  const c = readJson(cacheFile);
  if (c?.token && c.exp > Date.now() + 60_000 && c.account === auth.account) return c.token;
  const r = await fetch(`https://securetoken.googleapis.com/v1/token?key=${auth.apiKey}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(auth.refreshToken)}`,
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) return null;
  const d = await r.json();
  if (!d.id_token) return null;
  try {
    writeFileSync(cacheFile, JSON.stringify({ token: d.id_token, account: auth.account,
      exp: Date.now() + Number(d.expires_in || 3600) * 1000 }), { mode: 0o600 });
  } catch { /* the cache is an optimisation */ }
  return d.id_token;
}

// ── the install ────────────────────────────────────────────────────────────────────────────────

const say = (s = "") => process.stderr.write(`  ${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The daily update runs from launchd with a short PATH, so it names the binary it found.
const claudeBin = () => process.env.FREEDOM_CLAUDE_BIN || "claude";

function claude(args, opts = {}) {
  const r = spawnSync(claudeBin(), args, { encoding: "utf8", timeout: 300_000, ...opts });
  return { code: r.error ? 127 : r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

/** Device sign-in, the same flow as login.mjs: a code approved in the browser, the credential minted here. */
async function signIn() {
  const start = await (await fetch(`${PORTAL}/api/device/start`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hostname: hostname() }),
    signal: AbortSignal.timeout(10000) })).json();
  say(`Your code: ${start.userCode}`);
  say(`Approve it in the browser page that names that code: ${start.verifyUrlComplete}`);
  const [opener, openArgs] = openCommand(start.verifyUrlComplete);
  spawnSync(opener, openArgs, { stdio: "ignore" });
  const deadline = start.expiresAt ?? Date.now() + 10 * 60_000;
  const every = Math.max(1, Number(start.interval) || 2) * 1000;
  while (Date.now() < deadline) {
    await sleep(every);
    let d;
    try {
      d = await (await fetch(`${PORTAL}/api/device/poll`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceCode: start.deviceCode }), signal: AbortSignal.timeout(10000) })).json();
    } catch { continue; }
    if (d.status === "pending") continue;
    if (d.status !== "approved") throw new Error(`the sign-in was ${d.status}; run this again for a fresh code`);
    const x = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: d.customToken, returnSecureToken: true }), signal: AbortSignal.timeout(10000) });
    const t = await x.json().catch(() => ({}));
    if (!x.ok || !t.refreshToken) throw new Error("approved, but the credential exchange failed; run this again");
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(join(stateDir(), "auth.json"), JSON.stringify({ account: d.account, email: d.email ?? null,
      refreshToken: t.refreshToken, project: PROJECT, apiKey: API_KEY, linkedAt: new Date().toISOString() }, null, 2) + "\n",
      { mode: 0o600 });
    return d.email || d.account;
  }
  throw new Error("the code expired unapproved; run this again for a fresh one");
}

/** A node that survives a Homebrew upgrade (the Cellar path does not). */
function stableNode() {
  for (const p of ["/opt/homebrew/bin/node", "/usr/local/bin/node"]) if (existsSync(p)) return p;
  return process.execPath;
}

/** Start one session so Claude Code registers the declared marketplace. It may say "Not logged in"; that is fine. */
async function registerDeclared() {
  const child = spawn(claudeBin(), ["-p", "reply ok"], { stdio: "ignore",
    // FREEDOM_AUTO_UPDATE=off: this session loads the Supersuit hooks, and an update it started would
    // run this move again from inside the move.
    env: { ...process.env, CLAUDE_CODE_SYNC_PLUGIN_INSTALL: "1", FREEDOM_AUTO_UPDATE: "off" } });
  let exitedAt = null;
  child.on("exit", () => { exitedAt = Date.now(); });
  const until = Date.now() + 120_000;
  while (Date.now() < until && !knownSupersuit()?.account) {
    await sleep(2000);
    if (exitedAt && Date.now() - exitedAt > 15_000) break;   // gone, and nothing registered since
  }
  try { child.kill(); } catch { /* already gone */ }
  return knownSupersuit()?.account === true;
}

async function install({ check, switchFromGithub, noSignIn }) {
  const v = claude(["--version"]);
  if (v.code !== 0) throw new Error("Claude Code is not installed (`claude --version` did not run)");
  if (!versionAtLeast(v.out, MIN_CLAUDE)) throw new Error(`Claude Code ${v.out.trim()} is too old; update it to ${MIN_CLAUDE} or later (\`claude update\`)`);
  say(`Claude Code ${v.out.trim().split(" ")[0]} found`);

  const known = knownSupersuit();
  if (known && !known.account && !switchFromGithub) {
    say(`This computer already gets Supersuit from ${known.kind === "github" ? "GitHub" : known.kind}; nothing was changed.`);
    say("Run again with --switch to get it from your Supersuit account instead.");
    return 0;
  }
  if (check) { say(known?.account ? "Supersuit already comes from your Supersuit account" : "would sign in, declare the account marketplace and install Supersuit"); return 0; }

  if (!readJson(join(stateDir(), "auth.json"))?.refreshToken) {
    if (noSignIn) throw new Error("not signed in to Supersuit; nothing was changed");
    say(`Signed in as ${await signIn()}`);
  } else say("Already signed in to Supersuit");
  if (!(await idToken())) throw new Error("this computer's Supersuit sign-in did not give a token; sign in again (delete ~/.supersuit/auth.json, then run this again)");

  const bin = join(stateDir(), "bin");
  mkdirSync(bin, { recursive: true });
  const helperFile = join(bin, "supersuit-account.mjs");
  copyFileSync(realpathSync(fileURLToPath(import.meta.url)), helperFile);
  chmodSync(helperFile, 0o755);
  const helper = helperCommand(stableNode(), helperFile);
  // Run it the way Claude Code will: sh on a Mac, the system shell (cmd.exe) on Windows.
  const probe = process.platform === "win32"
    ? spawnSync(helper, { shell: true, encoding: "utf8", timeout: 10_000 })
    : spawnSync("sh", ["-c", helper], { encoding: "utf8", timeout: 10_000 });
  if (probe.status !== 0 || !headerJson(JSON.parse(probe.stdout || "{}").Authorization?.slice(7))) throw new Error("the sign-in helper did not print a header; nothing was changed in Claude Code");

  const settingsFile = join(claudeDir(), "settings.json");
  mkdirSync(claudeDir(), { recursive: true });
  const before = existsSync(settingsFile) ? readJson(settingsFile) : {};
  if (before === null) throw new Error(`${settingsFile} is not valid JSON; fix it, then run this again`);
  // Claude Code's two records of the source, as they stand. A failure below puts both back, byte for
  // byte: a Mac declaring one source and registered to another is worse than a Mac that did not move.
  const knownFile = join(claudeDir(), "plugins", "known_marketplaces.json");
  const undo = [settingsFile, knownFile].map((f) => [f, existsSync(f) ? readFileSync(f) : null]);
  writeFileSync(settingsFile, JSON.stringify(withAccountMarketplace(before, helper), null, 2) + "\n");
  let ver;
  try {
    say(`Supersuit's marketplace declared in ${settingsFile}`);

    if (!knownSupersuit()?.account && !(await registerDeclared())) {
      throw new Error("Claude Code did not register the marketplace; open Claude Code once (it registers it at start), then run this again");
    }
    say("Claude Code registered the marketplace at app.supersuit.co");
    const up = claude(["plugin", "marketplace", "update", "supersuit"]);
    if (up.code !== 0) throw new Error(`refreshing the marketplace failed: ${up.out.trim().split("\n").pop()}`);
    const inst = claude(["plugin", "install", "supersuit@supersuit", "--scope", "user"]);
    if (inst.code !== 0 && !/already/i.test(inst.out)) throw new Error(`installing Supersuit failed: ${inst.out.trim().split("\n").pop()}`);
    const list = claude(["plugin", "list"]).out;
    ver = /supersuit@supersuit[\s\S]*?Version:\s*(\S+)/.exec(list)?.[1];
    if (!ver) throw new Error("Claude Code reported the install, but `claude plugin list` does not show supersuit@supersuit");
  } catch (e) {
    for (const [f, bytes] of undo) { if (bytes === null) rmSync(f, { force: true }); else writeFileSync(f, bytes); }
    throw e;
  }
  say(`Supersuit ${ver} installed from your Supersuit account. Updates come the same way.`);
  if (primeResolver(supersuitInstallPath())) say("Its skills can run in this session: ~/.supersuit/bin/supersuit-lib is in place");
  else say("Run /reload-plugins (or open a new Claude Code session) before using a skill: ~/.supersuit/bin/supersuit-lib is not in place yet");
  return 0;
}

// Inline, not supersuit-is-main.mjs: a fresh Mac downloads this file alone (see the header), so it
// cannot import the helper. Same rule restated, the eval check included (#1033): under `node -e`
// argv[1] is the first extra argument, which can be this file's own path, and nothing is main.
const isMain = (() => {
  if (process.execArgv.some((a) => /^(?:-e|-p|-pe|--eval|--print)(?:=|$)/.test(a))) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === "headers") {
    // stdout is Claude Code's: the JSON object and not one byte more.
    let line = "";
    try { line = headerJson(await idToken()); } catch { line = ""; }
    process.stdout.write(line);
    process.exitCode = line ? 0 : 1;
  } else {
    try {
      process.exitCode = await install({ check: args.includes("--check"), switchFromGithub: args.includes("--switch"), noSignIn: args.includes("--no-sign-in") });
    } catch (e) {
      say(`Stopped: ${e.message}`);
      process.exitCode = 1;
    }
  }
}
