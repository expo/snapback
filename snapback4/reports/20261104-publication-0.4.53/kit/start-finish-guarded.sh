#!/bin/bash
# Only invoked by the controller after both staged foreground smokes and audits.
set -eu
K=$HOME/sb4-pub-0453; W=$HOME/sb4-pub-0453-wt/snapback4
A=${1:?dry-run attempt}; C=${2:?source}; cd "$K"
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
[ "$(git -C "$W" rev-parse HEAD)" = "$C" ]
[ "$(cat "dry-run-$A.exit")" = done ]
[ ! -e "dry-run-$A.env-invalid" ]
/usr/bin/grep -q 'RESULT PASS' "isolated/smoke-staged/results.txt"
node --input-type=module -e 'import{readFileSync}from"node:fs"; const q=JSON.parse(readFileSync("isolated/audit-mac-final/summary.json")); if(q.status!=="passed"||q.cases.length!==2||q.cases.some(c=>c.vulnerabilities.total))process.exit(1)'
[ -e linux-prefinish-green.json ]
pmset -g batt | head -1 | /usr/bin/grep -q 'AC Power'
ioreg -r -k AppleClamshellState | /usr/bin/grep -q '"AppleClamshellState" = No'
npm whoami > npm-whoami-prefinish.out 2>&1
nohup caffeinate -ims env ATTEMPT="$A" bash ./finish.sh > "finish-a$A.log" 2>&1 < /dev/null &
echo "finish pid=$! attempt=$A source=$C"
