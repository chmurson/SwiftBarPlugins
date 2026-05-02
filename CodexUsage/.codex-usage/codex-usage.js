#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const VERSION = "0.1.0";
const DEFAULT_ENDPOINT = "https://chatgpt.com/backend-api/codex/usage";
const DEFAULT_CACHE_TTL_SECONDS = 90;
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_ZERO_LIMIT_TITLE_MODE = "reset";
const ZERO_LIMIT_TITLE_MODES = new Set(["reset", "tokens"]);

function envInt(name, fallback) {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const defaultCacheDir = path.join(
	process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
	"codex-usage-bar",
);
const defaultCacheFile = path.join(defaultCacheDir, "usage.json");

const config = {
	source: process.env.CODEX_USAGE_SOURCE || "auth-json",
	endpoint: process.env.CODEX_USAGE_ENDPOINT || DEFAULT_ENDPOINT,
	authFile: process.env.CODEX_AUTH_FILE || "",
	titleLabel: process.env.CODEX_USAGE_TITLE_LABEL || "CODEX",
	cacheFile: process.env.CODEX_USAGE_CACHE_FILE || defaultCacheFile,
	titleModeFile:
		process.env.CODEX_USAGE_TITLE_MODE_FILE ||
		path.join(defaultCacheDir, "title-mode.json"),
	cacheTtlSeconds: envInt(
		"CODEX_USAGE_CACHE_TTL_SECONDS",
		DEFAULT_CACHE_TTL_SECONDS,
	),
	timeoutMs: envInt("CODEX_USAGE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
};

function nowIso() {
	return new Date().toISOString();
}

function expandHome(filePath) {
	if (!filePath) return filePath;
	if (filePath === "~") return os.homedir();
	if (filePath.startsWith("~/"))
		return path.join(os.homedir(), filePath.slice(2));
	return filePath;
}

function formatClock(iso) {
	if (!iso) return "?";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "?";
	return new Intl.DateTimeFormat(undefined, {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(date);
}

function clampPercent(value) {
	if (!Number.isFinite(value)) return null;
	return Math.max(0, Math.min(100, Math.round(value)));
}

function usedToRemaining(value) {
	const used = clampPercent(Number(value));
	return used === null ? null : 100 - used;
}

function pctText(value) {
	return value === null || value === undefined ? "?" : `${value}%`;
}

function numberText(value) {
	if (value === null || value === undefined) return "?";
	const number = Number(value);
	if (!Number.isFinite(number)) return "?";
	return new Intl.NumberFormat(undefined, {
		maximumFractionDigits: 0,
	}).format(number);
}

function resetText(epochSeconds) {
	if (!epochSeconds) return "";
	const resetMs = Number(epochSeconds) * 1000;
	if (!Number.isFinite(resetMs)) return "";
	const deltaMs = resetMs - Date.now();
	if (deltaMs <= 0) return "resets now";
	const totalMinutes = Math.ceil(deltaMs / 60000);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours >= 24) {
		const days = Math.floor(hours / 24);
		const remHours = hours % 24;
		return `resets in ${days}d ${remHours}h`;
	}
	if (hours > 0) return `resets in ${hours}h ${minutes}m`;
	return `resets in ${minutes}m`;
}

function startOfDay(date) {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayDelta(fromDate, toDate) {
	const from = startOfDay(fromDate).getTime();
	const to = startOfDay(toDate).getTime();
	return Math.round((to - from) / 86400000);
}

function weekdayText(date) {
	return new Intl.DateTimeFormat(undefined, { weekday: "short" })
		.format(date)
		.replace(/\.$/, "");
}

function resetExactText(epochSeconds, { compact = false } = {}) {
	if (!epochSeconds) return "";
	const resetMs = Number(epochSeconds) * 1000;
	if (!Number.isFinite(resetMs)) return "";
	const date = new Date(resetMs);
	const time = formatClock(date.toISOString());
	const delta = dayDelta(new Date(), date);
	if (delta === 0) return compact ? time : `Today ${time}`;
	if (delta === 1) return `${compact ? "Tom" : "Tomorrow"} ${time}`;
	return `${weekdayText(date)} ${time}`;
}

function resetSummaryText(epochSeconds) {
	const relative = resetText(epochSeconds);
	const exact = resetExactText(epochSeconds);
	if (!relative) return exact;
	if (!exact) return relative;
	return `${relative}, ${exact}`;
}

const USAGE_COLOR = {
	burntOrange: "#F56527",
	amber: "#F5B427",
	warmYellow: "#F5DA27",
	limeGreen: "#98F527",
	softWhite: "#E8E8E8",
	staleGray: "#9CA3AF",
	unknownGray: "gray",
};

const USAGE_REMAINING_BANDS = [
	{ label: "critical", maxPct: 10, color: USAGE_COLOR.burntOrange },
	{ label: "low", maxPct: 25, color: USAGE_COLOR.amber },
	{ label: "watch", maxPct: 40, color: USAGE_COLOR.warmYellow },
	{ label: "healthy", maxPct: 100, color: USAGE_COLOR.limeGreen },
];

const UNKNOWN_USAGE_COLOR = USAGE_COLOR.unknownGray;

function colorForPct(value) {
	if (!Number.isFinite(value)) return UNKNOWN_USAGE_COLOR;
	const band = USAGE_REMAINING_BANDS.find((entry) => value <= entry.maxPct);
	return band ? band.color : UNKNOWN_USAGE_COLOR;
}

function titleColorFor(five, week, stale) {
	if (stale) return USAGE_COLOR.staleGray;
	const values = [five, week].filter((value) => Number.isFinite(value));
	if (values.length === 0) return UNKNOWN_USAGE_COLOR;
	return colorForPct(Math.min(...values));
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, {
		mode: 0o600,
	});
}

function normalizeZeroLimitTitleMode(mode) {
	return ZERO_LIMIT_TITLE_MODES.has(mode) ? mode : DEFAULT_ZERO_LIMIT_TITLE_MODE;
}

function readZeroLimitTitleMode() {
	try {
		return normalizeZeroLimitTitleMode(readJson(config.titleModeFile).mode);
	} catch {
		return DEFAULT_ZERO_LIMIT_TITLE_MODE;
	}
}

function writeZeroLimitTitleMode(mode) {
	writeJson(config.titleModeFile, {
		mode: normalizeZeroLimitTitleMode(mode),
		updatedAt: nowIso(),
	});
}

function toggleZeroLimitTitleMode() {
	const current = readZeroLimitTitleMode();
	const next = current === "reset" ? "tokens" : "reset";
	writeZeroLimitTitleMode(next);
	return next;
}

function readCache() {
	try {
		const cache = readJson(config.cacheFile);
		const fetchedAtMs = new Date(cache.fetchedAt).getTime();
		if (!Number.isFinite(fetchedAtMs)) return null;
		return cache;
	} catch {
		return null;
	}
}

function isFresh(cache) {
	if (!cache || process.env.SWIFTBAR_REFRESH || process.env.BITBAR_REFRESH)
		return false;
	const fetchedAtMs = new Date(cache.fetchedAt).getTime();
	return Date.now() - fetchedAtMs < config.cacheTtlSeconds * 1000;
}

function authCandidates() {
	if (config.authFile) return [expandHome(config.authFile)];
	const candidates = [];
	if (process.env.CODEX_HOME)
		candidates.push(path.join(expandHome(process.env.CODEX_HOME), "auth.json"));
	candidates.push(path.join(os.homedir(), ".codex", "auth.json"));
	return [...new Set(candidates)];
}

function findAuthFile() {
	return authCandidates().find((candidate) => fs.existsSync(candidate));
}

function pickString(obj, paths) {
	for (const parts of paths) {
		let cursor = obj;
		for (const part of parts) {
			if (cursor === null || typeof cursor !== "object" || !(part in cursor)) {
				cursor = undefined;
				break;
			}
			cursor = cursor[part];
		}
		if (typeof cursor === "string" && cursor.trim()) return cursor.trim();
	}
	return "";
}

function pickNumber(obj, paths) {
	for (const parts of paths) {
		let cursor = obj;
		for (const part of parts) {
			if (cursor === null || typeof cursor !== "object" || !(part in cursor)) {
				cursor = undefined;
				break;
			}
			cursor = cursor[part];
		}
		if (cursor !== null && cursor !== undefined && cursor !== "") {
			const number = Number(cursor);
			if (Number.isFinite(number)) return number;
		}
	}
	return null;
}

function extractTokens(auth) {
	return {
		accessToken: pickString(auth, [
			["access_token"],
			["accessToken"],
			["tokens", "access_token"],
			["tokens", "accessToken"],
			["oauth", "access_token"],
			["oauth", "accessToken"],
			["chatgpt", "access_token"],
			["chatgpt", "accessToken"],
		]),
		refreshToken: pickString(auth, [
			["refresh_token"],
			["refreshToken"],
			["tokens", "refresh_token"],
			["tokens", "refreshToken"],
			["oauth", "refresh_token"],
			["oauth", "refreshToken"],
			["chatgpt", "refresh_token"],
			["chatgpt", "refreshToken"],
		]),
		accountId: pickString(auth, [
			["account_id"],
			["accountId"],
			["account", "id"],
			["chatgpt", "account_id"],
			["chatgpt", "accountId"],
		]),
	};
}

function decodeJwtPayload(token) {
	const part = token.split(".")[1];
	if (!part) return null;
	try {
		const padded = part.padEnd(
			part.length + ((4 - (part.length % 4)) % 4),
			"=",
		);
		return JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
	} catch {
		return null;
	}
}

function tokenExpiresSoon(accessToken) {
	const payload = decodeJwtPayload(accessToken);
	if (!payload || !payload.exp) return false;
	return payload.exp * 1000 - Date.now() < 5 * 60 * 1000;
}

async function requestJson(url, options) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		});
		const text = await response.text();
		let body = null;
		if (text) {
			try {
				body = JSON.parse(text);
			} catch {
				body = { message: text.slice(0, 300) };
			}
		}
		if (!response.ok) {
			const message = body && (body.detail || body.message || body.error);
			throw new Error(
				`HTTP ${response.status}${message ? `: ${message}` : ""}`,
			);
		}
		return body;
	} finally {
		clearTimeout(timeout);
	}
}

async function refreshAccessToken(refreshToken) {
	if (!refreshToken) return "";
	const refreshEndpoint =
		process.env.CODEX_REFRESH_ENDPOINT || "https://auth.openai.com/oauth/token";
	const clientId =
		process.env.CODEX_OAUTH_CLIENT_ID || "app_EMoamEEZ73f0CkXaXp7hrann";

	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: clientId,
	});

	const refreshed = await requestJson(refreshEndpoint, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body,
	});

	return refreshed && (refreshed.access_token || refreshed.accessToken || "");
}

function normalizeUsage(raw) {
	const limits =
		raw &&
		(raw.rateLimits || raw.rate_limits || raw.rate_limit || raw.limits || raw);
	const primary =
		limits.primary ||
		limits.primary_window ||
		limits.primaryWindow ||
		limits.session ||
		limits.five_hour ||
		limits.fiveHour ||
		null;
	const secondary =
		limits.secondary ||
		limits.secondary_window ||
		limits.secondaryWindow ||
		limits.weekly ||
		limits.week ||
		limits.seven_day ||
		limits.sevenDay ||
		null;

	const primaryUsed =
		primary &&
		(primary.usedPercent ?? primary.used_percent ?? primary.percent_used);
	const secondaryUsed =
		secondary &&
		(secondary.usedPercent ?? secondary.used_percent ?? secondary.percent_used);
	const additionalTokens = pickNumber(raw, [
		["credits", "balance"],
		["additional_tokens"],
		["additionalTokens"],
		["additional_rate_limits", "tokens"],
		["additional_rate_limits", "token_balance"],
		["additional_rate_limits", "remaining_tokens"],
		["additional_rate_limits", "remainingTokens"],
	]);

	const fiveHourRemainingPct =
		primary &&
		(primary.remainingPercent ?? primary.remaining_percent) !== undefined
			? clampPercent(
					Number(primary.remainingPercent ?? primary.remaining_percent),
				)
			: usedToRemaining(primaryUsed);

	const weeklyRemainingPct =
		secondary &&
		(secondary.remainingPercent ?? secondary.remaining_percent) !== undefined
			? clampPercent(
					Number(secondary.remainingPercent ?? secondary.remaining_percent),
				)
			: usedToRemaining(secondaryUsed);

	const safeRaw = raw
		? {
				plan_type: raw.plan_type,
				rate_limit: raw.rate_limit,
				rateLimits: raw.rateLimits,
				rate_limits: raw.rate_limits,
				additional_rate_limits: raw.additional_rate_limits,
				code_review_rate_limit: raw.code_review_rate_limit,
				credits: raw.credits,
				rate_limit_reached_type: raw.rate_limit_reached_type,
			}
		: {};

	return {
		fetchedAt: nowIso(),
		plan:
			raw.plan ||
			raw.planType ||
			raw.plan_type ||
			raw.account?.planType ||
			null,
		model: raw.model || raw.current_model || raw.defaultModel || null,
		fiveHourRemainingPct,
		weeklyRemainingPct,
		additionalTokens,
		primaryWindowMins:
			primary &&
			(primary.windowDurationMins ??
				primary.window_duration_mins ??
				primary.window_minutes ??
				(primary.limit_window_seconds
					? Math.round(primary.limit_window_seconds / 60)
					: undefined)),
		secondaryWindowMins:
			secondary &&
			(secondary.windowDurationMins ??
				secondary.window_duration_mins ??
				secondary.window_minutes ??
				(secondary.limit_window_seconds
					? Math.round(secondary.limit_window_seconds / 60)
					: undefined)),
		primaryResetsAt:
			primary && (primary.resetsAt ?? primary.resets_at ?? primary.reset_at),
		secondaryResetsAt:
			secondary &&
			(secondary.resetsAt ?? secondary.resets_at ?? secondary.reset_at),
		reached:
			limits.rateLimitReachedType || limits.rate_limit_reached_type || null,
		raw: safeRaw,
	};
}

async function fetchViaAuthJson() {
	const authFile = findAuthFile();
	if (!authFile) {
		throw new Error(
			`No auth file found. Checked: ${authCandidates().join(", ")}`,
		);
	}

	const auth = readJson(authFile);
	let { accessToken, refreshToken, accountId } = extractTokens(auth);
	if (!accessToken) throw new Error(`No access token found in ${authFile}`);

	if (tokenExpiresSoon(accessToken) && refreshToken) {
		const refreshed = await refreshAccessToken(refreshToken);
		if (refreshed) {
			accessToken = refreshed;
		}
	}

	for (let attempt = 0; attempt < 2; attempt += 1) {
		const headers = {
			authorization: `Bearer ${accessToken}`,
			accept: "application/json",
			"user-agent":
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:128.0) Gecko/20100101 Firefox/128.0",
		};
		if (accountId) headers["chatgpt-account-id"] = accountId;

		try {
			return normalizeUsage(
				await requestJson(config.endpoint, { method: "GET", headers }),
			);
		} catch (error) {
			if (
				!refreshToken ||
				attempt > 0 ||
				!/^HTTP (401|403)\b/.test(error.message || "")
			) {
				throw error;
			}
			const refreshed = await refreshAccessToken(refreshToken);
			if (!refreshed) throw error;
			accessToken = refreshed;
		}
	}

	throw new Error("Failed to fetch usage");
}

function fetchViaCodexCli() {
	const command = process.env.CODEX_CLI_COMMAND || "codex";
	const args = (process.env.CODEX_CLI_USAGE_ARGS || "usage --json")
		.split(/\s+/)
		.filter(Boolean);
	const result = spawnSync(command, args, {
		encoding: "utf8",
		timeout: config.timeoutMs,
		env: process.env,
	});

	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			(
				result.stderr ||
				result.stdout ||
				`codex exited ${result.status}`
			).trim(),
		);
	}

	return normalizeUsage(JSON.parse(result.stdout));
}

async function fetchFresh() {
	if (config.source === "codex-cli") return fetchViaCodexCli();
	if (config.source !== "auth-json") {
		throw new Error(`Unsupported CODEX_USAGE_SOURCE=${config.source}`);
	}
	return fetchViaAuthJson();
}

function swiftbarEscape(value) {
	return String(value).replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 240);
}

function swiftbarAttr(value) {
	return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\|/g, "/")}"`;
}

function xmlEscape(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function svgData(svg) {
	return Buffer.from(svg, "utf8").toString("base64");
}

function zeroLimitTitleLines(usage, titleMode) {
	const candidates = [
		{
			label: "5h",
			value: usage.fiveHourRemainingPct,
			resetsAt: usage.primaryResetsAt,
		},
		{
			label: "1w",
			value: usage.weeklyRemainingPct,
			resetsAt: usage.secondaryResetsAt,
		},
	].filter((entry) => entry.value === 0);

	if (candidates.length === 0) return null;
	candidates.sort((a, b) => {
		const aReset = Number(a.resetsAt) || Number.POSITIVE_INFINITY;
		const bReset = Number(b.resetsAt) || Number.POSITIVE_INFINITY;
		return aReset - bReset;
	});

	const zero = candidates[0];
	return {
		line1: `${zero.label}  0%`,
		line2:
			titleMode === "tokens"
				? `${numberText(usage.additionalTokens)} tok`
				: resetExactText(zero.resetsAt, { compact: true }) || "reset ?",
		lineColor1: colorForPct(0),
		lineColor2: USAGE_COLOR.softWhite,
	};
}

function usageTitleSvg(usage, stale, titleMode) {
	const five = usage.fiveHourRemainingPct;
	const week = usage.weeklyRemainingPct;
	const label = config.titleLabel.slice(0, 5).toUpperCase();
	const titleLines = zeroLimitTitleLines(usage, titleMode) || {
		line1: `5h  ${pctText(five)}`,
		line2: `1w  ${pctText(week)}`,
		lineColor1: colorForPct(five),
		lineColor2: colorForPct(week),
	};
	const accentColor = stale ? USAGE_COLOR.staleGray : USAGE_COLOR.softWhite;
	const lineColor1 = stale ? USAGE_COLOR.staleGray : titleLines.lineColor1;
	const lineColor2 = stale ? USAGE_COLOR.staleGray : titleLines.lineColor2;
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="62" height="24" viewBox="0 0 62 24">
		<style>
		text { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Helvetica, Arial, sans-serif; font-weight: 600; }
		</style>
		<text x="-22" y="8" transform="rotate(-90)" font-size="6" letter-spacing="0.4" fill="${xmlEscape(accentColor)}">${xmlEscape(label)}</text>
		<line x1="10" y1="2" x2="10" y2="22" stroke="${xmlEscape(accentColor)}" stroke-opacity="0.35" stroke-width="1"/>
		<text x="14" y="9" font-size="10" fill="${xmlEscape(lineColor1)}">${xmlEscape(titleLines.line1)}</text>
		<text x="14" y="21" font-size="10" fill="${xmlEscape(lineColor2)}">${xmlEscape(titleLines.line2)}</text>
		</svg>`;
	return svgData(svg);
}

function printTitle(usage, stale, titleMode) {
	const five = usage.fiveHourRemainingPct;
	const week = usage.weeklyRemainingPct;
	const titleColor = titleColorFor(five, week, stale);
	console.log(
		`| image=${usageTitleSvg(usage, stale, titleMode)} color=${titleColor}`,
	);
}

function titleModeLabel(mode) {
	return mode === "tokens" ? "additional tokens left" : "reset time";
}

function titleModeToggleLabel(mode) {
	const next = mode === "tokens" ? "reset time" : "additional tokens left";
	return `Switch zero-limit title to: ${next}`;
}

function commandScriptPath() {
	if (process.env.CODEX_USAGE_PLUGIN_WRAPPER)
		return process.env.CODEX_USAGE_PLUGIN_WRAPPER;
	return path.join(
		path.dirname(path.dirname(process.argv[1] || "")),
		"codex-usage.1m.sh",
	);
}

function printMenu(usage, options = {}) {
	const titleMode = readZeroLimitTitleMode();
	const five = usage.fiveHourRemainingPct;
	const week = usage.weeklyRemainingPct;
	printTitle(usage, options.stale, titleMode);
	console.log("---");
	console.log("Codex usage | size=13");
	console.log("---");
	console.log(
		`5h window: ${pctText(five)} left${usage.primaryResetsAt ? `, ${resetSummaryText(usage.primaryResetsAt)}` : ""}`,
	);
	console.log(
		`Weekly: ${pctText(week)} left${usage.secondaryResetsAt ? `, ${resetSummaryText(usage.secondaryResetsAt)}` : ""}`,
	);
	console.log(`Additional tokens: ${numberText(usage.additionalTokens)}`);
	if (usage.plan) console.log(`Plan: ${swiftbarEscape(usage.plan)}`);
	if (usage.model) console.log(`Model: ${swiftbarEscape(usage.model)}`);
	if (usage.reached)
		console.log(`Limit state: ${swiftbarEscape(usage.reached)}`);
	console.log(`Last updated: ${formatClock(usage.fetchedAt)}`);
	if (options.error)
		console.log(`Last error: ${swiftbarEscape(options.error)} | color=red`);
	console.log("---");
	console.log(
		`Zero-limit title shows: ${titleModeLabel(titleMode)} | color=gray`,
	);
	console.log(
		`${titleModeToggleLabel(titleMode)} | bash=${swiftbarAttr(commandScriptPath())} param1=toggle-zero-title-mode terminal=false refresh=true`,
	);
	console.log("---");
	console.log(
		"Open usage page | href=https://chatgpt.com/codex/settings/usage",
	);
	console.log("Refresh | refresh=true");
	console.log("---");
	console.log(`Source: ${swiftbarEscape(config.source)} | color=gray`);
	console.log(`Cache TTL: ${config.cacheTtlSeconds}s | color=gray`);
	if (process.env.CODEX_USAGE_NODE_VERSION) {
		console.log(
			`Node: ${swiftbarEscape(process.env.CODEX_USAGE_NODE_VERSION)} | color=gray`,
		);
	}
	if (process.env.CODEX_USAGE_NODE) {
		console.log(
			`Node path: ${swiftbarEscape(process.env.CODEX_USAGE_NODE)} | color=gray`,
		);
	}
}

function printError(message, cached) {
	if (cached) return printMenu(cached, { stale: true, error: message });
	console.log("○ Codex ? | color=gray");
	console.log("---");
	console.log("Codex usage unavailable | color=red");
	console.log(`Error: ${swiftbarEscape(message)} | color=red`);
	console.log("---");
	console.log(
		"Open usage page | href=https://chatgpt.com/codex/settings/usage",
	);
	console.log("Refresh | refresh=true");
	console.log("---");
	console.log(
		`Auth files checked: ${swiftbarEscape(authCandidates().join(", "))} | color=gray`,
	);
}

async function main() {
	if (process.argv[2] === "toggle-zero-title-mode") {
		toggleZeroLimitTitleMode();
		return;
	}

	const cached = readCache();
	if (isFresh(cached)) {
		printMenu(cached);
		return;
	}

	try {
		const usage = await fetchFresh();
		writeJson(config.cacheFile, usage);
		printMenu(usage);
	} catch (error) {
		printError(error.message || String(error), cached);
	}
}

main();
