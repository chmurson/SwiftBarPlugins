# Claude Usage Plugin

Displays your Claude API usage spending in dollars in the macOS menu bar.

Updates every 5 minutes with color-coded status (green when under $50, orange when over $50).

## Setup

### Requirements

- Node.js installed
- Access to https://claude.ai/settings/usage (requires logged-in Claude account)

### Authentication

This plugin requires your Claude authentication cookie. Follow these steps:

1. **Get your cookie:**
   - Go to https://claude.ai/settings/usage in your browser
   - Open Developer Tools (press `Cmd+Option+I` in Safari/Chrome)
   - Go to the **Network** tab
   - Look for a request to an API endpoint containing "overage_spend_limit"
   - Click on it and find the **Cookie** header in the request
   - Copy the entire cookie value

2. **Save the cookie:**
   - Create the file `~/.claude/claude-usage.cookie.txt`
   - Paste the cookie value into this file
   - Make sure it's only readable by you: `chmod 600 ~/.claude/claude-usage.cookie.txt`

   Or use the command:
   ```bash
   mkdir -p ~/.claude
   echo "YOUR_COOKIE_HERE" > ~/.claude/claude-usage.cookie.txt
   chmod 600 ~/.claude/claude-usage.cookie.txt
   ```

3. **Verify:**
   - Run the plugin manually to test: `ClaudeUsage/claude-usage.1m.sh`
   - It should display your current usage

## Notes

- Cookies can expire. If the plugin stops showing data, repeat the authentication steps.
- The cookie file is gitignored and will not be committed to the repository.
- Cache TTL is 5 minutes, so updates may be slightly delayed.

## Configuration

Optional environment variables:

- `CLAUDE_USAGE_CACHE_TTL_SECONDS` - cache duration (default: 300 seconds)
- `CLAUDE_USAGE_TIMEOUT_MS` - request timeout (default: 12000ms)
- `CLAUDE_USAGE_COOKIE_FILE` - custom path to cookie file
