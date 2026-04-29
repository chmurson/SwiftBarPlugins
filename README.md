# SwiftBar Plugins

Personal SwiftBar plugins.

## Plugins

- `CodexUsage` - shows Codex usage/rate-limit remaining percentages in the macOS menu bar.
- `ClaudeUsage` - displays current Claude API usage spending in dollars in the macOS menu bar.

## Installation

### Requirements

- [SwiftBar](https://swiftbar.app/) installed (or `brew install swiftbar`)
- SwiftBar plugins folder configured in SwiftBar settings
- Node.js installed

### Setup Steps

1. **Clone this repository** somewhere on your machine:
   ```bash
   git clone https://github.com/chmurson/SwiftBarPlugins.git
   # or wherever you keep it
   ```

2. **Find your SwiftBar plugins folder** - in SwiftBar preferences, you'll see the plugins folder path (usually `~/Library/Application Support/SwiftBar/Plugins`)

3. **Create a symlink** to the plugin's main script in your plugins folder:
   ```bash
   ln -s /path/to/SwiftBarPlugins/<PluginFolder>/<main-script>.1m.sh ~/Library/Application\ Support/SwiftBar/Plugins/
   ```

   Example:
   ```bash
   ln -s ~/Dev/SwiftBarPlugins/CodexUsage/codex-usage.1m.sh ~/Library/Application\ Support/SwiftBar/Plugins/
   ln -s ~/Dev/SwiftBarPlugins/ClaudeUsage/claude-usage.1m.sh ~/Library/Application\ Support/SwiftBar/Plugins/
   ```

4. **SwiftBar will automatically load** the plugin and it should appear in your menu bar

### Authentication Setup

Each plugin requires separate authentication setup. Check the README or documentation in each plugin's folder for specific instructions on how to set up credentials.
