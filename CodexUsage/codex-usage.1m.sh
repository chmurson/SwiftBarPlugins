#!/bin/zsh
# <xbar.title>Codex Usage</xbar.title>
# <xbar.version>0.2.0</xbar.version>
# <xbar.desc>Actual quota windows, additional limit pools, credits and resets.</xbar.desc>

PLUGIN_DIR="${0:A:h}"
SCRIPT="$PLUGIN_DIR/.codex-usage/codex-usage.js"

# Prefer an override, PATH/Homebrew, then the newest nvm version. Nullglob keeps
# the plugin working when nvm is not installed in SwiftBar's GUI environment.
NVM_NODES=("$HOME/.nvm/versions/node"/*/bin/node(NOn))
for NODE_BIN in \
  "${CODEX_USAGE_NODE:-}" \
  "$(command -v node 2>/dev/null)" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  "${NVM_NODES[@]}"
do
  if [[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] && "$NODE_BIN" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1; then
    # npm-installed Codex launchers also need this Node on their PATH.
    export PATH="${NODE_BIN:h}:$PATH"
    if [[ -z "${CODEX_USAGE_CODEX:-}" ]]; then
      for CODEX_BIN in "${CODEX_CLI_COMMAND:-}" "$(command -v codex 2>/dev/null)" /opt/homebrew/bin/codex /usr/local/bin/codex; do
        if [[ -n "$CODEX_BIN" && -x "$CODEX_BIN" ]]; then
          export CODEX_USAGE_CODEX="$CODEX_BIN"
          break
        fi
      done
    fi
    export CODEX_USAGE_PLUGIN_WRAPPER="$0"
    export CODEX_USAGE_NODE="$NODE_BIN"
    exec "$NODE_BIN" "$SCRIPT" "$@"
  fi
done

echo "○ Codex ? | color=gray"
echo "---"
echo "Node.js 18 or newer not found | color=red"
echo "Install a current Node.js release or set CODEX_USAGE_NODE to its absolute path."
echo "---"
echo "Open Node.js | href=https://nodejs.org/"
