# Codex Usage SwiftBar Plugin

SwiftBar plugin that shows Codex usage and rate-limit remaining percentages in
the macOS menu bar.

Shows both 5-hour window and weekly rate limits with color-coded status.

## Files

- `CodexUsage/codex-usage.1m.sh` - SwiftBar executable plugin wrapper.
- `CodexUsage/.codex-usage/codex-usage.js` - dependency-free Node.js fetcher, normalizer, cache, and menu renderer.

## Requirements

- [Codex CLI](https://platform.openai.com/docs/guides/codex) installed and authenticated.
- Node.js installed. The plugin uses only Node built-ins; no npm packages are required.

## Install

Use `CodexUsage` as your SwiftBar plugin folder, or copy both files into:

```sh
~/Library/Application\ Support/SwiftBar/Plugins/
```

Only the wrapper should be executable:

```sh
chmod +x codex-usage.1m.sh
chmod -x .codex-usage/codex-usage.js .codex-usage/README.md
```

SwiftBar refreshes this plugin every minute because the filename contains `.1m.`.

## Authentication

The plugin reads the Codex authentication token that the Codex CLI saves. Make
sure the Codex CLI is properly authenticated:

```sh
codex login
```

Auth discovery order:

1. `CODEX_AUTH_FILE`
2. `$CODEX_HOME/auth.json`
3. `~/.codex/auth.json`

Once the Codex CLI is authenticated, this plugin will automatically find and use
the stored credentials.

## Configuration

The plugin reads Codex OAuth credentials without changing Codex config.

Optional environment variables:

- `CODEX_AUTH_FILE=/custom/path/auth.json`
- `CODEX_HOME=/custom/codex/home`
- `CODEX_USAGE_SOURCE=auth-json` (default)
- `CODEX_USAGE_SOURCE=codex-cli` for a future official `codex usage --json` command
- `CODEX_USAGE_ENDPOINT=https://chatgpt.com/backend-api/codex/usage`
- `CODEX_USAGE_CACHE_TTL_SECONDS=90`
- `CODEX_USAGE_CACHE_FILE=~/.cache/codex-usage-bar/usage.json`
- `CODEX_USAGE_TIMEOUT_MS=12000`
- `CODEX_USAGE_TITLE_LABEL=CODEX` for the vertical SVG label

## Notes

The default `auth-json` source uses the currently known internal ChatGPT backend
endpoint. That endpoint is not a public stable API, so the endpoint and the
entire source mode are configurable.

The plugin never prints tokens or raw API responses in the menu. It caches
normalized usage data in `~/.cache/codex-usage-bar/usage.json`.
