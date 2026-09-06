# Sleep Control

A dependency-free SwiftBar plugin that shows whether macOS system sleep is
allowed and lets you toggle it from the menu bar.

- `🌙` — system sleep is allowed (`disablesleep 0`)
- `☕` — system sleep is disabled (`disablesleep 1`)

## Installation

Make the plugin executable:

```bash
chmod +x SleepControl/sleep-control.10s.sh
```

Then symlink it into your SwiftBar plugins folder:

```bash
ln -s /path/to/SwiftBarPlugins/SleepControl/sleep-control.10s.sh \
  "$HOME/Library/Application Support/SwiftBar/Plugins/"
```

When you select the toggle action, macOS shows its native administrator prompt
and runs one of these commands with elevated privileges:

```bash
/usr/bin/pmset -a disablesleep 1
/usr/bin/pmset -a disablesleep 0
```

The plugin also checks the status every 10 seconds, so its icon updates shortly
after the command completes.
