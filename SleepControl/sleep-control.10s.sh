#!/bin/zsh

# <xbar.title>Sleep Control</xbar.title>
# <xbar.version>1.0.1</xbar.version>
# <xbar.author>chmurson</xbar.author>
# <xbar.desc>Shows and toggles the macOS disablesleep power setting.</xbar.desc>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>

set -u

PMSET="/usr/bin/pmset"
ACTION_SCRIPT="${SWIFTBAR_PLUGIN_PATH:-${0:A}}"

case "${1:-}" in
  --set-disablesleep)
    case "${2:-}" in
      0|1)
        /usr/bin/osascript \
          -e "do shell script \"$PMSET -a disablesleep $2\" with administrator privileges"
        ACTION_STATUS=$?

        if (( ACTION_STATUS == 0 )); then
          /usr/bin/open -g "swiftbar://refreshplugin?plugin=sleep-control.10s.sh"
        fi

        exit $ACTION_STATUS
        ;;
      *)
        exit 2
        ;;
    esac
    ;;
esac

PMSET_OUTPUT="$("$PMSET" -g 2>/dev/null)"
PMSET_STATUS=$?

if (( PMSET_STATUS != 0 )); then
  echo "⚠️"
  echo "---"
  echo "Could not read power settings | color=red"
  exit 0
fi

# pmset omits disablesleep when it is set to its default value of 0.
if print -r -- "$PMSET_OUTPUT" | grep -Eq '^[[:space:]]*disablesleep[[:space:]]+1([[:space:]]|$)'; then
  echo "☕ | tooltip=System sleep is disabled"
  echo "---"
  echo "Sleep is disabled | color=#34C759"
  echo "Allow system sleep | bash=$ACTION_SCRIPT param1=--set-disablesleep param2=0 terminal=false refresh=true"
  echo "---"
  echo "sudo pmset -a disablesleep 0 | color=gray font=Menlo size=11"
else
  echo "🌙 | tooltip=System sleep is allowed"
  echo "---"
  echo "Sleep is allowed | color=#8E8E93"
  echo "Prevent system sleep | bash=$ACTION_SCRIPT param1=--set-disablesleep param2=1 terminal=false refresh=true"
  echo "---"
  echo "sudo pmset -a disablesleep 1 | color=gray font=Menlo size=11"
fi

echo "---"
echo "Refresh | refresh=true"
