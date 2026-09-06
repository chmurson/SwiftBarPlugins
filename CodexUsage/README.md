# Codex Usage for SwiftBar

A compact macOS menu bar monitor for the remaining allowance on your signed-in
Codex/ChatGPT account. Version 0.2.0 labels windows by their actual duration, so a
weekly-only account shows `1w 90%` and its next reset time, without an invented
five-hour quota. Accounts with two windows retain the two-line percentage display.

The menu shows every reported limit pool (including separately metered models),
reset times, credit balances, available earned resets and spending-limit state.
This is an account allowance monitor, not a token-cost estimate for a single task
or the separately billed OpenAI Platform API.

## Installation

Requirements: macOS, SwiftBar, Node.js 18+ (a current LTS release recommended), and
an authenticated Codex CLI. No npm dependencies are needed.

Keep the wrapper and the entire hidden `.codex-usage` directory together. Point
SwiftBar at `CodexUsage`, or symlink its wrapper into your existing plugin folder:

```sh
ln -s /absolute/path/to/CodexUsage/codex-usage.1m.sh /your/swiftbar/plugins/codex-usage.1m.sh
chmod +x /absolute/path/to/CodexUsage/codex-usage.1m.sh
```

SwiftBar runs it once per minute. The wrapper resolves symlinks, forwards menu
actions and locates Node/Codex even with a minimal GUI PATH. An explicit Node
override takes precedence, followed by PATH, Homebrew, and descending nvm versions.

## Authentication and sources

The default `auto` source uses the documented
[`account/rateLimits/read` App Server API](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt).
It starts a short-lived `codex app-server` over stdio and closes it after reading
usage. Codex manages authentication, including its configured credential store.
Sign in with `codex login` if necessary. No conversations or model turns are created.

`auto` falls back to the legacy HTTP source only if the Codex executable cannot
be found. Other App Server errors remain visible rather than switching account
sources. Explicit `CODEX_AUTH_FILE` or `CODEX_USAGE_ENDPOINT` configuration selects
`auth-json` unless a source is also specified. The old `codex-cli` source is now
an alias for App Server; the previous speculative `codex usage --json` command
and `CODEX_CLI_USAGE_ARGS` are no longer used.

`auth-json` reads `CODEX_AUTH_FILE`, otherwise `$CODEX_HOME/auth.json`, otherwise
`~/.codex/auth.json`. It does not rotate OAuth refresh tokens. Its internal HTTP
endpoint is not a stable public API; requests are restricted to HTTPS on
`chatgpt.com`, and redirects are rejected. App Server is the preferred source.

## Configuration

Set these in the environment SwiftBar passes to the plugin (for example via
SwiftBar's `<swiftbar.environment>` metadata in the wrapper):

| Variable | Default / purpose |
| --- | --- |
| `CODEX_USAGE_SOURCE` | `auto`, `app-server`, or `auth-json` |
| `CODEX_USAGE_CODEX` | Codex executable path; wrapper detects PATH/Homebrew |
| `CODEX_USAGE_NODE` | Optional absolute Node executable path |
| `CODEX_HOME` | `~/.codex`; respected by Codex and direct auth discovery |
| `CODEX_AUTH_FILE` | Optional auth.json path for `auth-json` |
| `CODEX_USAGE_ENDPOINT` | `https://chatgpt.com/backend-api/codex/usage` |
| `CODEX_USAGE_LIMIT_ID` | `codex`; pool displayed in the menu bar |
| `CODEX_USAGE_TITLE_LABEL` | `CODEX`; vertical label, up to five characters |
| `CODEX_USAGE_CACHE_TTL_SECONDS` | `90`; `0` disables cache reuse |
| `CODEX_USAGE_TIMEOUT_MS` | `12000`; positive per-request timeout |
| `CODEX_USAGE_CACHE_FILE` | `~/.cache/codex-usage-bar/usage.json` |
| `CODEX_USAGE_TITLE_MODE_FILE` | `~/.cache/codex-usage-bar/title-mode.json` |
| `CODEX_USAGE_SHOW_ACTIVITY` | `0`; set `1` for optional token activity |

`XDG_CACHE_HOME` changes the default cache directory. Paths support `~/`.
With `CODEX_USAGE_LIMIT_ID=codex_bengalfox`, for example, the menu bar can show the
Spark pool if your account reports it. An unavailable selection displays `?`
instead of substituting another pool. The dropdown always includes all pools.

Optional activity shows lifetime tokens, peak daily tokens and the current daily
streak from `account/usage/read`. If unsupported or unavailable, quotas still
load. These historical totals are not remaining allowance or purchased credits.

## Reading the display

- Percentages are **remaining** allowance, with colors at 10%, 25%, and 40%.
- Missing windows are omitted; unknown values show `?`, never a fabricated 100%.
- Window labels come from the API duration, including durations other than 5h/1w.
- A single window gets its next reset on the second title line. With two windows,
  both percentages are shown. Full reset details appear in the menu.
- At zero allowance, switch the second title line between reset time and credit
  balance using the menu. The old `tokens` preference automatically means credits.
  If multiple windows are exhausted, the latest required reset is shown.
- `Credits` is a credit balance, with fractional values and unlimited balances
  preserved. It is not a count of model tokens.
- Available resets are informational. Open the usage page to manage allowance;
  this plugin does not redeem resets, purchase credits or send owner emails.
- **Refresh now** bypasses the cache. After a network error, the last successful
  reading is marked **STALE** and rendered gray. A passed reset triggers a fresh
  read instead of resetting the percentage locally.

The versioned cache contains normalized display data only, is written atomically
with mode 0600, and discards the old incorrectly labeled format. Source, auth-file
and config-file changes invalidate it. Credential stores outside auth.json may
take up to the cache TTL to reflect an account switch. A cache write failure does
not hide successfully fetched live data. Tokens, raw server errors, account IDs
and reset-credit IDs are never written to the cache or displayed.

## Validation

```sh
node --test .codex-usage/usage.test.js
zsh -n codex-usage.1m.sh
./codex-usage.1m.sh refresh
```

Tests use synthetic responses and a local fake App Server, without real account
credentials or network calls. See [RESEARCH.md](RESEARCH.md) for findings and scope.
