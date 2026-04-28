# Codex Usage SwiftBar Plugin

SwiftBar plugin that shows Codex usage/rate-limit remaining percentages in the macOS menu bar.

## Files

- `codex-usage.1m.sh` - SwiftBar executable plugin wrapper.
- `.codex-usage/codex-usage.js` - dependency-free Node.js fetcher, normalizer, cache, and menu renderer.

## Install

Use this directory as your SwiftBar plugin folder, or copy both files into:

```sh
~/Library/Application\ Support/SwiftBar/Plugins/
```

Only the wrapper should be executable:

```sh
chmod +x codex-usage.1m.sh
chmod -x .codex-usage/codex-usage.js README.md
```

SwiftBar refreshes this plugin every minute because the filename contains `.1m.`.

## Configuration

The plugin reads Codex OAuth credentials without changing Codex config.

Environment variables:

- `CODEX_AUTH_FILE=/custom/path/auth.json`
- `CODEX_HOME=/custom/codex/home`
- `CODEX_USAGE_SOURCE=auth-json` (default)
- `CODEX_USAGE_SOURCE=codex-cli` for a future official `codex usage --json` command
- `CODEX_USAGE_ENDPOINT=https://chatgpt.com/backend-api/codex/usage`
- `CODEX_USAGE_CACHE_TTL_SECONDS=90`
- `CODEX_USAGE_CACHE_FILE=~/.cache/codex-usage-bar/usage.json`
- `CODEX_USAGE_TITLE_MODE=svg` for a two-line SVG title (default)
- `CODEX_USAGE_TITLE_MODE=text` for the plain one-line title fallback
- `CODEX_USAGE_TITLE_LABEL=CODEX` for the vertical SVG label

Auth discovery order:

1. `CODEX_AUTH_FILE`
2. `$CODEX_HOME/auth.json`
3. `~/.codex/auth.json`

## Notes

The default `auth-json` source uses the currently known internal ChatGPT backend endpoint. That endpoint is not a public stable API, so the endpoint and the entire source mode are configurable.

The plugin never prints tokens or raw API responses in the menu. It caches normalized usage data in `~/.cache/codex-usage-bar/usage.json`.
