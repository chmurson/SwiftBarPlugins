# Codex Usage Plugin

Displays Codex usage and rate-limit remaining percentages in the macOS menu bar.

Shows both 5-hour window and weekly rate limits with color-coded status (green = healthy, yellow = warning, orange = critical).

## Setup

### Requirements

- [Codex CLI](https://platform.openai.com/docs/guides/codex) installed and authenticated
- Node.js installed

### Authentication

The plugin reads the Codex authentication token that the Codex CLI saves. Make sure the Codex CLI is properly authenticated:

```bash
codex login
```

The plugin looks for the auth token in these locations (in order):
1. `~/.codex/auth.json` (default)
2. Custom path via `CODEX_HOME` environment variable

Once the Codex CLI is authenticated, this plugin will automatically find and use the stored credentials.

## Configuration

Optional environment variables:

- `CODEX_USAGE_SOURCE` - data source (`auth-json` or `codex-cli`, default: `auth-json`)
- `CODEX_USAGE_ENDPOINT` - custom endpoint URL
- `CODEX_USAGE_CACHE_TTL_SECONDS` - cache duration (default: 90 seconds)
- `CODEX_USAGE_TIMEOUT_MS` - request timeout (default: 12000ms)
