#!/usr/bin/env bash
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
cd "$HOME/sb4-intent/lane-ns-verify/snapback4" || exit 1
python3 "$HOME/sb4-intent/ns-r2-verify-source.py" .. "$HOME/sb4-intent/ns-r2-suite-source.json" > "$HOME/sb4-intent/ns-r2-source-before.txt" || exit 1
{ uname -a; uptime; node --version; bun --version; cargo --version; } > "$HOME/sb4-intent/ns-r2-full-suite-host.txt"
bash scripts/test.sh > "$HOME/sb4-intent/ns-r2-full-suite.log" 2>&1
ns_status=$?
printf '%s\n' "$ns_status" > "$HOME/sb4-intent/ns-r2-full-suite.exit"
python3 "$HOME/sb4-intent/ns-r2-verify-source.py" .. "$HOME/sb4-intent/ns-r2-suite-source.json" > "$HOME/sb4-intent/ns-r2-source-after.txt"
exit "$ns_status"
