# Research and implementation — 2026-09-05

## Confirmed problem

The account's live main Codex pool returned `primary.windowDurationMins = 10080`
and `secondary = null`. The old renderer assumed primary = five hours and
secondary = one week. `Number(null) === 0` additionally turned the absent
secondary window into 100% remaining. Thus both labels in the screenshot were
misleading; the API's weekly percentage itself was valid.

The active installation is linked from `~/SwiftBarPlugins/codex-usage.1m.sh` to
`~/dev/SwiftBarPlugins/CodexUsage/codex-usage.1m.sh`. ConfigCopies contained an older
version without the current SVG display and title-mode toggle. The implementation
preserves those active features and synchronizes the configuration copy.

## API research

[Official App Server documentation](https://learn.chatgpt.com/docs/app-server)
defines a backward-compatible single limit pool plus a multi-pool response.
Windows carry their own durations and reset timestamps. Available earned-reset
counts and optional token activity are exposed through account read methods.
The installed Codex CLI 0.142.3 schema and live reads confirmed these capabilities.
The installed CLI provides the reset count; richer reset descriptions in newer
protocol versions are not required by this plugin.

The live account had a weekly main pool, a separate Spark pool and three earned
resets. During verification the main pool changed from 91% to 90% remaining.
These observations are not plan-wide guarantees and may change with account usage.

[Official pricing documentation](https://learn.chatgpt.com/docs/pricing) distinguishes
credits from tokens. The previous `Additional tokens` label for `credits.balance`
was therefore incorrect.

[SwiftBar's plugin protocol](https://github.com/swiftbar/SwiftBar#environment-variables)
documents `OS_APPEARANCE`, script actions and forwarded parameters. The plugin
uses those for appearance and explicit manual refresh.

## Implemented plan

1. Normalize windows independently of slot order and preserve unknown/null data.
2. Prefer App Server; retain an explicit direct HTTP compatibility source.
3. Display separate pools, credits, reset count, spending state and optional activity.
4. Fix cache migration/freshness, manual refresh, Node discovery, and exhausted-window reset selection.
5. Cover the reported regression, process lifecycle, cache failures and HTTP auth
   handling with offline tests, then check the real account before installation.

## Other corrections and boundaries

- Direct auth now reads nested `tokens.account_id` and never independently rotates
  a refresh token. The former code could rotate one without persisting its replacement.
- Runtime discovery no longer selects the first old nvm installation or fails on
  an unmatched zsh glob. The tested GUI-style runtime uses Node 26.
- The title grows enough to show reset text; stale values have an explicit warning.
- Fractional allowance does not round to a misleading zero or completely full quota.
- No historical token totals are used to infer remaining quota. Activity is opt-in.
- Reset redemption, credit purchases and owner emails remain outside this read-only
  monitor. No such actions were taken during development.
- No guessed model-price table or speculative `codex usage --json` command is used.

## Verification

- Offline unit/integration tests cover the production response shape, swapped and
  unknown durations, nulls, extra pools, credits, stale cache, manual refresh,
  HTTP credential headers and bounded App Server processes.
- Live App Server read returned main/Spark windows, credit balance, reset count,
  and optional activity successfully. No model turn was needed.
- The SVG title and wrapper are checked before replacing the active files.
