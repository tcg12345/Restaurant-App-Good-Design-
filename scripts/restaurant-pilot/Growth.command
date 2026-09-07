#!/bin/bash
set -u
cd "$(dirname "$0")" || exit 1
collector_plist="$HOME/Library/LaunchAgents/com.goodeats.restaurant-collector.plist"
if ! collector_python=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$collector_plist"); then
  echo "Installed collector not found. Run this on the Mac mini with the collector installed."
  exit 1
fi
if [ ! -x "$collector_python" ]; then
  echo "The collector's Python interpreter is missing: $collector_python"
  exit 1
fi
"$collector_python" "$PWD/growth_upgrade.py"
repair_exit=$?
if [ "$repair_exit" -ne 0 ]; then
  echo "Upgrade did not finish. Existing data was retained; share the error above."
fi
read -r -p "Press Return to close this window. "
exit "$repair_exit"
