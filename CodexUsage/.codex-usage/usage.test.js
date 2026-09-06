"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { AppServer } = require("./app-server");
const { number, normalizeUsage, selectBucket, normalizeActivity } = require("./usage");
const plugin = require("./codex-usage");

const now = Date.now();
const reset = Math.floor(now / 1000) + 7200;
const weekly = (usedPercent = 9) => ({ rateLimits: { primary: { usedPercent, windowDurationMins: 10080, resetsAt: reset }, secondary: null } });
const config = plugin.configFromEnv({ CODEX_USAGE_TITLE_MODE_FILE: "/nonexistent/codex-title-mode", OS_APPEARANCE: "Light" });
const temp = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-usage-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test("regression: weekly primary and null secondary produce one weekly 91% window", () => {
  const usage = normalizeUsage(weekly());
  assert.deepEqual(usage.buckets[0].windows, [{ slot: "primary", minutes: 10080, label: "1w", remainingPct: 91, resetsAt: reset }]);
  const lines = plugin.titleLines(usage, config);
  assert.equal(lines[0].text, "1w  91%");
  assert.doesNotMatch(lines[1].text, /100%|5h/);
  assert.doesNotMatch(plugin.renderMenu(usage, config), /5h:|Additional tokens/);
});

test("legacy HTTP seconds have the same semantics, including absent secondary", () => {
  const raw = { rate_limit: { primary_window: { used_percent: 9, limit_window_seconds: 604800, reset_at: reset }, secondary_window: null } };
  assert.deepEqual(normalizeUsage(raw, now), normalizeUsage(weekly(), now));
});

test("null, missing, empty, boolean and nonnumeric values never become 100%", () => {
  for (const invalid of [null, undefined, "", " ", false, true, [], {}, "oops", Infinity, NaN]) {
    assert.equal(number(invalid), null);
    const raw = weekly();
    raw.rateLimits.primary.usedPercent = invalid;
    assert.equal(normalizeUsage(raw).buckets[0].windows[0].remainingPct, null);
  }
  assert.equal(normalizeUsage(weekly(0)).buckets[0].windows[0].remainingPct, 100);
  assert.equal(normalizeUsage(weekly("100")).buckets[0].windows[0].remainingPct, 0);
});

test("swapped slots retain their own percentage and reset after sorting by duration", () => {
  const raw = weekly();
  raw.rateLimits.secondary = { usedPercent: 40, windowDurationMins: 300, resetsAt: reset - 500 };
  const windows = normalizeUsage(raw).buckets[0].windows;
  assert.deepEqual(windows.map(w => [w.label, w.remainingPct, w.resetsAt]), [["5h", 60, reset - 500], ["1w", 91, reset]]);
});

test("arbitrary duration and unknown duration are not relabeled as five hours", () => {
  for (const [minutes, label] of [[15, "15m"], [1440, "1d"], [120, "2h"], [null, "Primary window"]]) {
    const raw = weekly(); raw.rateLimits.primary.windowDurationMins = minutes;
    assert.equal(normalizeUsage(raw).buckets[0].windows[0].label, label);
  }
});

test("multi-bucket view overrides the legacy view and never mixes Spark with Codex", () => {
  const raw = weekly(90);
  raw.rateLimitsByLimitId = {
    codex_bengalfox: { limitName: "GPT-5.3-Codex-Spark", primary: { usedPercent: 0, windowDurationMins: 300 } },
    codex: weekly().rateLimits,
  };
  const usage = normalizeUsage(raw);
  assert.equal(selectBucket(usage).windows[0].remainingPct, 91);
  assert.equal(selectBucket(usage, "codex_bengalfox").windows[0].label, "5h");
  assert.equal(selectBucket(usage, "missing"), null);
  assert.equal(plugin.titleLines(usage, { ...config, bucketId: "missing" })[0].text, "Limit ?");
  assert.match(plugin.renderMenu(usage, config), /GPT-5.3-Codex-Spark/);
});

test("HTTP additional and review limits remain separate buckets", () => {
  const raw = { rate_limit: weekly().rateLimits, additional_rate_limits: [{ limit_id: "spark", limit_name: "Spark", rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: 18000 } } }], code_review_rate_limit: { primary_window: { used_percent: 12, limit_window_seconds: 604800 } } };
  assert.deepEqual(normalizeUsage(raw).buckets.map(b => b.id), ["codex", "spark", "code_review"]);
});

test("unknown or empty payload is an error; explicit null windows are unavailable", () => {
  for (const raw of [null, {}, [], { error: "fail" }]) assert.throws(() => normalizeUsage(raw));
  assert.match(plugin.renderMenu(normalizeUsage({ rateLimits: { primary: null, secondary: null } }), config), /No quota windows reported/);
});

test("credits and earned resets preserve zero, decimals, unlimited and unknown", () => {
  const raw = weekly();
  raw.rateLimits.credits = { balance: "12.75", hasCredits: true, unlimited: false };
  raw.rateLimitResetCredits = { availableCount: 3, credits: [] };
  let usage = normalizeUsage(raw);
  assert.match(plugin.renderMenu(usage, config), /Credits: 12[.,]75/);
  assert.equal(usage.availableResets, 3);
  raw.rateLimits.credits = { balance: null, unlimited: true };
  raw.rateLimitResetCredits.availableCount = 0;
  usage = normalizeUsage(raw);
  assert.match(plugin.renderMenu(usage, config), /Credits: Unlimited/);
  assert.equal(usage.availableResets, 0);
  assert.equal(normalizeUsage(weekly()).availableResets, null);
});

test("normalized data excludes raw payloads, account identifiers, and reset credit IDs", () => {
  const raw = weekly();
  raw.secret = "sensitive"; raw.accountId = "sensitive";
  raw.rateLimitResetCredits = { availableCount: 3, credits: [{ id: "sensitive" }] };
  assert.doesNotMatch(JSON.stringify(normalizeUsage(raw)), /sensitive|accountId|raw/);
});

test("all exhausted windows require the latest reset, unknown resets stay unknown", () => {
  const raw = weekly(100);
  raw.rateLimits.secondary = { usedPercent: 100, windowDurationMins: 300, resetsAt: reset - 1000 };
  assert.equal(plugin.titleLines(normalizeUsage(raw), config)[0].text, "1w  0%");
  raw.rateLimits.primary.resetsAt = null;
  assert.equal(plugin.titleLines(normalizeUsage(raw), config)[1].text, "reset ?");
});

test("fractional remaining allowance never displays a false zero or full limit", () => {
  assert.equal(plugin.pct(0.1), "<1%");
  assert.equal(plugin.pct(99.9), ">99%");
  assert.equal(plugin.pct(null), "?");
  assert.notEqual(plugin.titleLines(normalizeUsage(weekly(99.9)), config)[0].text, "1w  0%");
});

test("server limit state is visible even with positive quota percentages", () => {
  const raw = weekly(); raw.rateLimits.spendControlReached = true;
  assert.equal(plugin.titleLines(normalizeUsage(raw), config)[0].text, "Limited");
});

test("cache schema/key validation discards old mislabeled and corrupt caches", t => {
  const dir = temp(t), cfg = { ...config, cacheFile: path.join(dir, "cache.json") };
  plugin.writeJson(cfg.cacheFile, { fetchedAt: new Date().toISOString(), fiveHourRemainingPct: 91, weeklyRemainingPct: 100 });
  assert.equal(plugin.readCache(cfg, "key"), null);
  plugin.writeJson(cfg.cacheFile, { version: plugin.CACHE_VERSION, key: "key", usage: normalizeUsage(weekly()) });
  assert.ok(plugin.readCache(cfg, "key"));
  assert.equal(plugin.readCache(cfg, "other-account"), null);
  assert.equal(fs.statSync(cfg.cacheFile).mode & 0o777, 0o600);
  fs.writeFileSync(cfg.cacheFile, "{broken");
  assert.equal(plugin.readCache(cfg, "key"), null);
});

test("cache expires on TTL, forced refresh, future timestamp and elapsed reset", () => {
  const usage = normalizeUsage(weekly(), now);
  assert.equal(plugin.isFresh(usage, config, false, now + 1000), true);
  assert.equal(plugin.isFresh(usage, config, true, now + 1000), false);
  assert.equal(plugin.isFresh(usage, config, false, now + 91000), false);
  assert.equal(plugin.isFresh(usage, config, false, now - 1000), false);
  usage.buckets[0].windows[0].resetsAt = Math.floor(now / 1000);
  assert.equal(plugin.isFresh(usage, config, false, now + 1000), false);
});

test("legacy title preference migrates from tokens to credits", t => {
  const cfg = { ...config, titleModeFile: path.join(temp(t), "title-mode.json") };
  plugin.writeJson(cfg.titleModeFile, { mode: "tokens" });
  assert.equal(plugin.titleMode(cfg), "credits");
});

test("manual refresh runs the wrapper with an explicit cache-bypass argument", () => {
  const menu = plugin.renderMenu(normalizeUsage(weekly()), { ...config, wrapper: "/tmp/Folder with spaces/plugin.sh" });
  assert.match(menu, /Refresh now \| bash="\/tmp\/Folder with spaces\/plugin.sh" param1=refresh terminal=false refresh=true/);
});

test("stale output is visibly marked and untrusted labels cannot add SwiftBar actions", () => {
  const raw = weekly(); raw.rateLimits.limitName = "label\nInjected | bash=/bad";
  const usage = normalizeUsage(raw);
  const menu = plugin.renderMenu(usage, config, { stale: true });
  assert.match(menu, /STALE — showing/);
  assert.doesNotMatch(menu, /\nInjected|\| bash=\/bad/);
  assert.match(plugin.titleSvg(usage, config, { stale: true }), /#9CA3AF/);
});

test("HTTP auth includes tokens.account_id and never refreshes/prints OAuth secrets", async t => {
  const authFile = path.join(temp(t), "auth.json");
  plugin.writeJson(authFile, { tokens: { access_token: "test-token", account_id: "test-account", refresh_token: "test-refresh" } });
  const cfg = { ...config, authFile };
  const usage = await plugin.fetchViaAuthJson(cfg, async (url, options) => {
    assert.equal(options.headers["chatgpt-account-id"], "test-account");
    assert.equal(options.headers.authorization, "Bearer test-token");
    assert.equal(options.method, "GET"); assert.equal(options.redirect, "error");
    return { ok: true, json: async () => weekly() };
  });
  assert.equal(usage.source, "auth-json");
  await assert.rejects(plugin.fetchViaAuthJson(cfg, async () => ({ ok: false, status: 401, json: async () => ({ message: "test-token" }) })), /HTTP 401: sign in/);
  await assert.rejects(plugin.fetchViaAuthJson({ ...cfg, endpoint: "https://untrusted.example/usage" }, () => assert.fail("must not fetch")), /protect Codex credentials/);
});

test("activity keeps unknown metrics unknown", () => {
  assert.equal(normalizeActivity({}), null);
  assert.deepEqual(normalizeActivity({ summary: { lifetimeTokens: "123", peakDailyTokens: null } }), { lifetimeTokens: 123, peakDailyTokens: null, currentStreakDays: null, longestStreakDays: null });
});

test("SwiftBar light appearance uses legible darker colors", () => {
  assert.equal(config.light, true);
  const svg = plugin.titleSvg(normalizeUsage(weekly()), config);
  assert.match(svg, /#367C0A/);
  assert.doesNotMatch(svg, /#98F527/);
  assert.match(svg, /#111111/);
  assert.doesNotMatch(svg, /#333333/);
});

const fake = path.join(__dirname, "test", "fake-codex.js");
function client(t, mode) {
  const server = new AppServer(process.execPath, { args: [fake], env: { ...process.env, FAKE_MODE: mode }, timeoutMs: mode === "timeout" ? 100 : 3000 });
  t.after(() => server.close());
  return server;
}
test("App Server performs handshake, ignores notifications, correlates responses", async t => {
  const server = client(t, "ok");
  await server.initialize();
  const result = await server.request("account/rateLimits/read");
  assert.equal(normalizeUsage(result).buckets[0].windows[0].remainingPct, 91);
});
test("App Server errors do not reveal raw response messages", async t => {
  const server = client(t, "error"); await server.initialize();
  await assert.rejects(server.request("account/rateLimits/read"), error => !error.message.includes("secret-token") && error.code === 401);
});
test("App Server bounds unresponsive requests", async t => {
  await assert.rejects(client(t, "timeout").initialize(), /timed out/);
});
test("App Server handles a missing executable without hanging", async t => {
  const server = new AppServer("/nonexistent/codex-usage-test"); t.after(() => server.close());
  await assert.rejects(server.initialize(), error => error.code === "ENOENT");
});

test("CLI caches, force-refreshes, shows stale on failure and tolerates unavailable activity", t => {
  const dir = temp(t), log = path.join(dir, "requests.log");
  const env = { ...process.env, CODEX_USAGE_SOURCE: "app-server", CODEX_USAGE_CODEX: fake, CODEX_USAGE_CACHE_FILE: path.join(dir, "usage.json"), CODEX_USAGE_TITLE_MODE_FILE: path.join(dir, "mode.json"), CODEX_USAGE_SHOW_ACTIVITY: "1", FAKE_LOG: log, FAKE_MODE: "ok", SWIFTBAR_REFRESH: "0", BITBAR_REFRESH: "0" };
  const run = (args = [], overrides = {}) => {
    const result = spawnSync(process.execPath, [path.join(__dirname, "codex-usage.js"), ...args], { env: { ...env, ...overrides }, encoding: "utf8", timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  assert.match(run(), /1w: 91% left/);
  const requests = fs.readFileSync(log, "utf8");
  assert.match(run(), /Token activity unavailable/);
  assert.equal(fs.readFileSync(log, "utf8"), requests);
  assert.match(run(["refresh"]), /Available limit resets: 3/);
  assert.equal(fs.readFileSync(log, "utf8").split("account/rateLimits/read").length - 1, 2);
  const failed = run(["refresh"], { FAKE_MODE: "error" });
  assert.match(failed, /STALE/); assert.match(failed, /1w: 91% left/); assert.doesNotMatch(failed, /secret-token/);
  assert.doesNotMatch(fs.readFileSync(env.CODEX_USAGE_CACHE_FILE, "utf8"), /secret-token|access_token/);
});

test("a cache write failure still displays fresh usage", t => {
  const dir = temp(t), blocker = path.join(dir, "file"); fs.writeFileSync(blocker, "not a directory");
  const result = spawnSync(process.execPath, [path.join(__dirname, "codex-usage.js"), "refresh"], {
    env: { ...process.env, CODEX_USAGE_SOURCE: "app-server", CODEX_USAGE_CODEX: fake, CODEX_USAGE_CACHE_FILE: path.join(blocker, "usage.json"), FAKE_MODE: "ok" }, encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0); assert.match(result.stdout, /1w: 91% left/); assert.match(result.stdout, /could not save cache/); assert.doesNotMatch(result.stdout, /STALE/);
});

test("wrapper works with GUI PATH, forwards refresh and supplies Node to npm-style launchers", t => {
  const dir = temp(t);
  const result = spawnSync("/bin/zsh", [path.join(__dirname, "..", "codex-usage.1m.sh"), "refresh"], {
    env: { PATH: "/usr/bin:/bin", CODEX_USAGE_NODE: process.execPath, CODEX_USAGE_SOURCE: "app-server", CODEX_USAGE_CODEX: fake,
      CODEX_USAGE_CACHE_FILE: path.join(dir, "usage.json"), CODEX_USAGE_TITLE_MODE_FILE: path.join(dir, "title.json"), FAKE_MODE: "ok" },
    encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /1w: 91% left/); assert.match(result.stdout, /Source: app-server/);
});
