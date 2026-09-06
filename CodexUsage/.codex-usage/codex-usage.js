#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { AppServer } = require("./app-server");
const { number, normalizeUsage, normalizeActivity, selectBucket } = require("./usage");

const VERSION = "0.2.0";
const CACHE_VERSION = 2;
const USAGE_URL = "https://chatgpt.com/codex/settings/usage";
const DEFAULT_ENDPOINT = "https://chatgpt.com/backend-api/codex/usage";
const COLORS = { critical: "#F56527", low: "#F5B427", watch: "#F5DA27", healthy: "#98F527", stale: "#9CA3AF", unknown: "gray" };
const LIGHT_NEUTRAL = "#111111";
const LIGHT_COLORS = { "#F56527": "#B84314", "#F5B427": "#925F00", "#F5DA27": "#836900", "#98F527": "#367C0A" };

function expandHome(value) {
  return value === "~" ? os.homedir() : value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

function configFromEnv(env = process.env) {
  const cacheDir = path.join(expandHome(env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache")), "codex-usage-bar");
  const integer = (key, fallback, minimum = 0) => {
    const parsed = number(env[key]);
    return parsed !== null && Number.isInteger(parsed) && parsed >= minimum ? parsed : fallback;
  };
  const codexHome = expandHome(env.CODEX_HOME || path.join(os.homedir(), ".codex"));
  return {
    source: env.CODEX_USAGE_SOURCE || (env.CODEX_AUTH_FILE || env.CODEX_USAGE_ENDPOINT ? "auth-json" : "auto"),
    endpoint: env.CODEX_USAGE_ENDPOINT || DEFAULT_ENDPOINT,
    codexCommand: expandHome(env.CODEX_USAGE_CODEX || env.CODEX_CLI_COMMAND || "codex"),
    codexHome,
    authFile: expandHome(env.CODEX_AUTH_FILE || path.join(codexHome, "auth.json")),
    cacheFile: expandHome(env.CODEX_USAGE_CACHE_FILE || path.join(cacheDir, "usage.json")),
    titleModeFile: expandHome(env.CODEX_USAGE_TITLE_MODE_FILE || path.join(cacheDir, "title-mode.json")),
    cacheTtlSeconds: integer("CODEX_USAGE_CACHE_TTL_SECONDS", 90),
    timeoutMs: integer("CODEX_USAGE_TIMEOUT_MS", 12000, 1),
    titleLabel: env.CODEX_USAGE_TITLE_LABEL || "CODEX",
    bucketId: env.CODEX_USAGE_LIMIT_ID || "codex",
    showActivity: env.CODEX_USAGE_SHOW_ACTIVITY === "1",
    light: env.OS_APPEARANCE === "Light",
    wrapper: env.CODEX_USAGE_PLUGIN_WRAPPER || path.join(__dirname, "..", "codex-usage.1m.sh"),
  };
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, file);
  } finally { try { fs.unlinkSync(temporary); } catch {} }
}

function cacheKey(config) {
  const stamp = file => {
    try { const stat = fs.statSync(file); return [stat.mtimeMs, stat.size]; } catch { return null; }
  };
  // Credentials never enter the cache; invalidate after login/config changes.
  return createHash("sha256").update(JSON.stringify([
    config.source, config.endpoint, config.codexCommand, config.codexHome,
    config.authFile, stamp(config.authFile), stamp(path.join(config.codexHome, "config.toml")), config.showActivity,
  ])).digest("hex");
}

function readCache(config, key) {
  try {
    const cached = readJson(config.cacheFile);
    if (cached.version !== CACHE_VERSION || cached.key !== key) return null;
    const usage = cached.usage;
    if (!usage || !Number.isFinite(Date.parse(usage.fetchedAt)) || !Array.isArray(usage.buckets) || !usage.buckets.length) return null;
    if (!usage.buckets.every(bucket => typeof bucket?.id === "string" && Array.isArray(bucket.windows)
      && bucket.windows.every(window => window && typeof window.label === "string"
        && (window.remainingPct === null || (Number.isFinite(window.remainingPct) && window.remainingPct >= 0 && window.remainingPct <= 100))))) return null;
    return usage;
  } catch { return null; }
}

function isFresh(usage, config, force = false, now = Date.now()) {
  if (!usage || force) return false;
  const age = now - Date.parse(usage.fetchedAt);
  if (age < 0 || age >= config.cacheTtlSeconds * 1000) return false;
  // A passed reset needs a new reading, never a synthesized 100% window.
  return !usage.buckets.some(bucket => bucket.windows.some(window => window.resetsAt && window.resetsAt * 1000 <= now));
}

function titleMode(config) {
  try {
    const mode = readJson(config.titleModeFile).mode;
    return mode === "tokens" || mode === "credits" ? "credits" : "reset";
  } catch { return "reset"; }
}

function extractTokens(auth) {
  const containers = [auth?.tokens, auth, auth?.oauth, auth?.chatgpt];
  const pick = keys => {
    for (const container of containers) {
      for (const key of keys) if (typeof container?.[key] === "string" && container[key].trim()) return container[key].trim();
    }
    return "";
  };
  return { accessToken: pick(["access_token", "accessToken"]), accountId: pick(["account_id", "accountId"]) || auth?.account?.id || "" };
}

async function fetchViaAuthJson(config, fetchImpl = fetch) {
  const endpoint = new URL(config.endpoint);
  if (endpoint.origin !== "https://chatgpt.com" || endpoint.username || endpoint.password) throw new Error("CODEX_USAGE_ENDPOINT must use https://chatgpt.com to protect Codex credentials");
  let auth;
  try { auth = readJson(config.authFile); } catch { throw new Error("Codex auth.json unavailable; run codex login or use the app-server source"); }
  const { accessToken, accountId } = extractTokens(auth);
  if (!accessToken) throw new Error("No ChatGPT access token; sign in with codex login");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const headers = { authorization: `Bearer ${accessToken}`, accept: "application/json" };
    if (accountId) headers["chatgpt-account-id"] = accountId;
    const response = await fetchImpl(endpoint.href, { method: "GET", headers, redirect: "error", signal: controller.signal });
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw new Error(`HTTP ${response.status}: sign in with codex login or use app-server to refresh authentication`);
      throw new Error(`Usage request failed (HTTP ${response.status}); try Refresh later`);
    }
    return { ...normalizeUsage(await response.json()), source: "auth-json" };
  } catch (error) {
    if (/^(HTTP |Usage request failed|Unrecognized usage|Usage response)/.test(error.message)) throw error;
    throw new Error(controller.signal.aborted ? "Usage request timed out; try Refresh" : "Could not read usage from ChatGPT");
  } finally { clearTimeout(timer); }
}

async function fetchViaAppServer(config) {
  const client = new AppServer(config.codexCommand, { timeoutMs: config.timeoutMs });
  try {
    await client.initialize();
    const usage = { ...normalizeUsage(await client.request("account/rateLimits/read")), source: "app-server" };
    if (config.showActivity) {
      try { usage.activity = normalizeActivity(await client.request("account/usage/read", undefined, Math.min(4000, config.timeoutMs))); }
      catch { usage.activityUnavailable = true; }
    }
    return usage;
  } finally { client.close(); }
}

async function fetchFresh(config) {
  if (config.source === "auth-json") return fetchViaAuthJson(config);
  if (!["auto", "app-server", "codex-cli"].includes(config.source)) throw new Error("Unsupported CODEX_USAGE_SOURCE; use auto, app-server, or auth-json");
  try { return await fetchViaAppServer(config); }
  catch (error) {
    // Only an absent CLI permits fallback. Auth/server errors must not switch accounts.
    if (config.source === "auto" && error.code === "ENOENT") return fetchViaAuthJson(config);
    throw error;
  }
}

function escape(value) { return String(value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 240); }
function attr(value) { return `"${escape(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`; }
function xml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function pct(value) {
  if (!Number.isFinite(value)) return "?";
  if (value > 0 && value < 1) return "<1%";
  if (value < 100 && value > 99) return ">99%";
  return `${Math.round(value)}%`;
}
function numberText(value) { return number(value) === null ? "?" : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(value)); }
function color(value) {
  if (!Number.isFinite(value)) return COLORS.unknown;
  return value <= 10 ? COLORS.critical : value <= 25 ? COLORS.low : value <= 40 ? COLORS.watch : COLORS.healthy;
}
function clock(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "?";
}
function exactReset(seconds, now = Date.now()) {
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(new Date(seconds * 1000).getTime())) return "reset ?";
  if (seconds * 1000 <= now) return "reset due";
  const date = new Date(seconds * 1000);
  const today = new Date(now);
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return clock(date);
  if (date.toDateString() === tomorrow.toDateString()) return `Tom ${clock(date)}`;
  return `${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date).replace(/\.$/, "")} ${clock(date)}`;
}
function resetSummary(seconds, now = Date.now()) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "reset time unavailable";
  if (seconds * 1000 <= now) return "reset due; awaiting updated usage";
  const total = Math.ceil((seconds * 1000 - now) / 60000);
  const hours = Math.floor(total / 60);
  const relative = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : hours ? `${hours}h ${total % 60}m` : `${total}m`;
  return `resets in ${relative}, ${exactReset(seconds, now)}`;
}
function creditsText(credits) { return credits?.unlimited ? "Unlimited" : numberText(credits?.balance); }

function titleLines(usage, config, mode = "reset") {
  const bucket = selectBucket(usage, config.bucketId);
  if (!bucket) return [{ text: "Limit ?", color: COLORS.unknown }, { text: "see menu", color: COLORS.unknown }];
  const zero = bucket.windows.filter(window => window.remainingPct === 0);
  if (zero.length) {
    // All exhausted windows must reset before the allowance is usable again.
    const latest = zero.reduce((a, b) => (a.resetsAt || Infinity) > (b.resetsAt || Infinity) ? a : b);
    return [{ text: `${latest.label}  0%`, color: color(0) }, {
      text: mode === "credits" ? `${creditsText(bucket.credits)} cr` : exactReset(latest.resetsAt), color: config.light ? LIGHT_NEUTRAL : "#E8E8E8",
    }];
  }
  if (bucket.blocked || bucket.reached) return [{ text: "Limited", color: color(0) }, { text: "see menu", color: COLORS.unknown }];
  const lines = bucket.windows.slice(0, 2).map(window => ({ text: `${window.label}  ${pct(window.remainingPct)}`, color: color(window.remainingPct) }));
  if (lines.length === 1) lines.push({ text: exactReset(bucket.windows[0].resetsAt), color: config.light ? LIGHT_NEUTRAL : "#E8E8E8" });
  if (!lines.length) lines.push({ text: "Usage ?", color: COLORS.unknown }, { text: "see menu", color: COLORS.unknown });
  return lines;
}
function titleSvg(usage, config, { stale = false, mode = "reset" } = {}) {
  const lines = titleLines(usage, config, mode);
  const width = Math.max(70, Math.min(175, 18 + Math.max(...lines.map(line => line.text.length)) * 6));
  const accent = stale ? COLORS.stale : config.light ? LIGHT_NEUTRAL : "#E8E8E8";
  const label = escape(config.titleLabel).slice(0, 5).toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24" viewBox="0 0 ${width} 24">
<style>text { font-family: -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; font-weight: 600; }</style>
<text x="-22" y="8" transform="rotate(-90)" font-size="6" letter-spacing="0.4" fill="${accent}">${xml(label)}</text>
<line x1="10" y1="2" x2="10" y2="22" stroke="${accent}" stroke-opacity="0.35"/>
${lines.map((line, index) => `<text x="14" y="${index ? 21 : 9}" font-size="10" fill="${stale ? COLORS.stale : config.light ? (LIGHT_COLORS[line.color] || line.color) : line.color}">${xml(line.text)}</text>`).join("\n")}
</svg>`;
}
function action(config, label, command) { return `${label} | bash=${attr(config.wrapper)} param1=${command} terminal=false refresh=true`; }

function renderMenu(usage, config, options = {}) {
  const mode = options.mode || titleMode(config);
  const lines = [];
  if (usage) {
    const image = Buffer.from(titleSvg(usage, config, { ...options, mode })).toString("base64");
    lines.push(`| image=${image} tooltip=${attr(`Codex usage${options.stale ? " — STALE" : ""}`)}`, "---", "Codex usage — remaining allowance | size=13", "---");
    if (options.stale) lines.push("STALE — showing the last successful reading | color=orange");
    const selected = selectBucket(usage, config.bucketId);
    if (!selected) lines.push(`Selected limit unavailable: ${escape(config.bucketId)} | color=orange`);
    const buckets = [...usage.buckets].sort((a, b) => Number(b === selected) - Number(a === selected));
    for (const bucket of buckets) {
      lines.push(`${escape(bucket.name)}${bucket === selected ? " (menu bar)" : ""} | size=13`);
      if (!bucket.windows.length) lines.push("No quota windows reported");
      for (const window of bucket.windows) lines.push(`${escape(window.label)}: ${pct(window.remainingPct)} left, ${resetSummary(window.resetsAt)}`);
      if (bucket.credits) lines.push(`Credits: ${creditsText(bucket.credits)}`);
      if (bucket.individualLimit) lines.push(`Individual spending allowance: ${pct(bucket.individualLimit.remainingPct)} left, ${resetSummary(bucket.individualLimit.resetsAt)}`);
      if (bucket.reached || bucket.blocked) lines.push(`Limit state: ${escape(bucket.reached || "limit reached")} | color=orange`);
      if (bucket.plan) lines.push(`Plan: ${escape(bucket.plan)}`);
      lines.push("---");
    }
    if (usage.availableResets !== null) lines.push(`Available limit resets: ${numberText(usage.availableResets)}`);
    if (usage.activity) lines.push(`Lifetime tokens: ${numberText(usage.activity.lifetimeTokens)}`, `Peak daily tokens: ${numberText(usage.activity.peakDailyTokens)}`, `Current streak: ${numberText(usage.activity.currentStreakDays)} days`);
    if (usage.activityUnavailable) lines.push("Token activity unavailable in this CLI/account | color=gray");
    lines.push(`Last updated: ${clock(usage.fetchedAt)}${options.stale ? ` (${new Date(usage.fetchedAt).toLocaleDateString()})` : ""}`);
  } else lines.push("○ Codex ? | color=gray", "---", "Codex usage unavailable | color=red");
  if (options.error) lines.push(`Last error: ${escape(options.error)} | color=red`);
  if (options.warning) lines.push(`${escape(options.warning)} | color=orange`);
  lines.push("---", `Zero-limit title shows: ${mode === "credits" ? "credits left" : "reset time"} | color=gray`,
    action(config, `Switch zero-limit title to: ${mode === "credits" ? "reset time" : "credits left"}`, "toggle-zero-title-mode"),
    "---", `Open usage page | href=${USAGE_URL}`, action(config, "Refresh now", "refresh"), "---",
    `Source: ${escape(usage?.source || config.source)} | color=gray`, `Cache TTL: ${config.cacheTtlSeconds}s | color=gray`,
    `Plugin: ${VERSION} | color=gray`, `Node: ${process.version} | color=gray`);
  return lines.join("\n") + "\n";
}

async function main(args = process.argv.slice(2), env = process.env) {
  const config = configFromEnv(env);
  const cached = readCache(config, cacheKey(config));
  if (args[0] === "toggle-zero-title-mode") {
    try { writeJson(config.titleModeFile, { mode: titleMode(config) === "reset" ? "credits" : "reset" }); }
    catch { console.log(renderMenu(cached, config, { warning: "Could not save title preference" })); }
    return;
  }
  const force = args[0] === "refresh" || [env.SWIFTBAR_REFRESH, env.BITBAR_REFRESH].some(value => value === "1" || value === "true");
  if (isFresh(cached, config, force)) return process.stdout.write(renderMenu(cached, config));
  let usage;
  try { usage = await fetchFresh(config); }
  catch (error) { return process.stdout.write(renderMenu(cached, config, { stale: Boolean(cached), error: error.message })); }
  let warning;
  try { writeJson(config.cacheFile, { version: CACHE_VERSION, key: cacheKey(config), usage }); }
  catch { warning = "Live usage loaded; could not save cache"; }
  process.stdout.write(renderMenu(usage, config, { warning }));
}

if (require.main === module) main().catch(() => {
  process.stdout.write("○ Codex ? | color=gray\n---\nCould not load usage; check plugin configuration | color=red\n");
  process.exitCode = 1;
});

module.exports = { configFromEnv, cacheKey, readCache, writeJson, isFresh, titleMode, extractTokens, fetchViaAuthJson, fetchViaAppServer, fetchFresh, titleLines, titleSvg, renderMenu, pct, main, CACHE_VERSION };
