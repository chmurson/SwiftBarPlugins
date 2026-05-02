#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const VERSION = "0.1.0";
const DEFAULT_ENDPOINT = "https://claude.ai/api/organizations/5c786126-2c64-453c-bfdc-3eea0b5195ef/overage_spend_limit";
const DEFAULT_ACCOUNT_UUID = "726a15ee-c3c3-4817-ba63-66895bc0d857";
const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_TIMEOUT_MS = 12000;

function envInt(name, fallback) {
	const raw = process.env[name];
	if (!raw) return fallback;
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const config = {
	endpoint: process.env.CLAUDE_USAGE_ENDPOINT || DEFAULT_ENDPOINT,
	accountUuid: process.env.CLAUDE_ACCOUNT_UUID || DEFAULT_ACCOUNT_UUID,
	cookieFile: process.env.CLAUDE_USAGE_COOKIE_FILE || path.join(os.homedir(), ".claude", "claude-usage.cookie.txt"),
	cacheFile:
		process.env.CLAUDE_USAGE_CACHE_FILE ||
		path.join(
			process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"),
			"claude-usage-bar",
			"usage.json",
		),
	cacheTtlSeconds: envInt(
		"CLAUDE_USAGE_CACHE_TTL_SECONDS",
		DEFAULT_CACHE_TTL_SECONDS,
	),
	timeoutMs: envInt("CLAUDE_USAGE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
};

function nowIso() {
	return new Date().toISOString();
}

function centsToUsd(cents) {
	if (!Number.isFinite(cents)) return null;
	return (cents / 100).toFixed(2);
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

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, {
		mode: 0o600,
	});
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

function readCookie() {
	try {
		const cookie = fs.readFileSync(config.cookieFile, "utf8").trim();
		if (!cookie) throw new Error("Cookie file is empty");
		return cookie;
	} catch (error) {
		throw new Error(`Failed to read cookie from ${config.cookieFile}: ${error.message}`);
	}
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

async function fetchFresh() {
	const cookie = readCookie();
	const url = `${config.endpoint}?account_uuid=${config.accountUuid}`;

	const response = await requestJson(url, {
		method: "GET",
		headers: {
			cookie,
			accept: "application/json",
			"user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:128.0) Gecko/20100101 Firefox/128.0",
		},
	});

	const usedCredits = response && response.used_credits;
	if (!Number.isFinite(usedCredits)) {
		throw new Error("Invalid response: used_credits not found or not a number");
	}

	return {
		fetchedAt: nowIso(),
		usedCredits,
		usedUsd: centsToUsd(usedCredits),
		currency: response.currency || "USD",
		seatTier: response.seat_tier || null,
		accountEmail: response.account_email || null,
	};
}

function swiftbarEscape(value) {
	return String(value).replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 240);
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

function usageTitleSvg(usd) {
	const label = "Claude";
	const amount = `$${usd || "?"}`;
	const amountColor = usd && Number(usd) > 50 ? "#f97316" : "#22c55e";
	const labelColor = "#e8e8e8";

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="35" height="24" viewBox="0 0 35 24">
		<style>
		text { font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", Helvetica, Arial, sans-serif; font-weight: 600; text-anchor: middle; }
		</style>
		<text x="17.5" y="9" font-size="8" fill="${xmlEscape(labelColor)}">${xmlEscape(label)}</text>
		<text x="16" y="21" font-size="10" font-weight="700" fill="${xmlEscape(amountColor)}">${xmlEscape(amount)}</text>
	</svg>`;

	return svgData(svg);
}

function printTitle(usd) {
	const titleColor = usd && Number(usd) > 50 ? "#f97316" : "#22c55e";
	console.log(`| image=${usageTitleSvg(usd)} color=${titleColor}`);
}

function printMenu(usage, options = {}) {
	printTitle(usage.usedUsd);
	console.log("---");
	console.log("Claude usage | size=13");
	console.log("---");
	console.log(`Used: $${usage.usedUsd} (${usage.usedCredits} cents)`);
	if (usage.seatTier) console.log(`Tier: ${swiftbarEscape(usage.seatTier)}`);
	if (usage.accountEmail) console.log(`Account: ${swiftbarEscape(usage.accountEmail)}`);
	console.log(`Last updated: ${formatClock(usage.fetchedAt)}`);
	if (options.error)
		console.log(`Last error: ${swiftbarEscape(options.error)} | color=red`);
	console.log("---");
	console.log(
		"Open usage page | href=https://claude.ai/settings/usage",
	);
	console.log("Refresh | refresh=true");
	console.log("---");
	console.log(`Cache TTL: ${config.cacheTtlSeconds}s | color=gray`);
	if (process.env.CLAUDE_USAGE_NODE_VERSION) {
		console.log(
			`Node: ${swiftbarEscape(process.env.CLAUDE_USAGE_NODE_VERSION)} | color=gray`,
		);
	}
}

function printError(message, cached) {
	if (cached) return printMenu(cached, { stale: true, error: message });
	console.log(`| image=${usageTitleSvg(null)} color=gray`);
	console.log("---");
	console.log("Claude usage unavailable | color=red");
	console.log(`Error: ${swiftbarEscape(message)} | color=red`);
	console.log("---");
	console.log(
		"Open usage page | href=https://claude.ai/settings/usage",
	);
	console.log("Refresh | refresh=true");
	console.log("---");
	console.log(
		`Cookie file: ${swiftbarEscape(config.cookieFile)} | color=gray`,
	);
}

async function main() {
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
