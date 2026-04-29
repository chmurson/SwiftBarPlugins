#!/bin/zsh

PLUGIN_DIR="${0:A:h}"
SCRIPT="$PLUGIN_DIR/.claude-usage/claude-usage.js"

for NODE in \
  "$HOME/.nvm/versions/node"/*/bin/node \
  "$(command -v node 2>/dev/null)" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node
do
  if [[ -n "$NODE" && -x "$NODE" ]] && "$NODE" --version >/dev/null 2>&1; then
    export CLAUDE_USAGE_NODE="$NODE"
    export CLAUDE_USAGE_NODE_VERSION="$("$NODE" --version 2>/dev/null)"
    exec "$NODE" "$SCRIPT"
  fi
done

echo "○ Claude ? | color=gray"
echo "---"
echo "Node.js not found | color=red"
echo "Install Node.js or add it to SwiftBar's PATH. This plugin uses only Node built-ins, no npm packages. | color=red"
echo "---"
echo "Open Node.js | href=https://nodejs.org/"
