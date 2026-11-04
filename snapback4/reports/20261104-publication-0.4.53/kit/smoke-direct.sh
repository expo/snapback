#!/bin/bash
# usage: smoke-direct.sh <platform-tgz> <client-tgz> <out-dir>
# Direct-invocation smoke (coordinator ruling, 0.4.53): run it in the FOREGROUND of an interactive SSH shell (ssh -tt), never
# detached, so the process ancestry includes the root-owned sshd-session. It installs the staged platform + client tarballs into
# a scratch consumer and records that ancestry. Then, for the native binary and for the JS shim, it runs --version,
# serve --help, dev --help and a short serve start/stop: deploy, serve --port 0 until ready, stop, serve exit,
# serve --wait-stopped. Exits 0 only if every check passes.
set -u
PLAT=${1:?platform tgz}; CLIENT=${2:?client tgz}; O=${3:?out dir}
rm -rf "$O"; mkdir -p "$O/consumer"; cd "$O/consumer" || exit 2
export NPM_CONFIG_CACHE="$O/npm-cache"; unset SNAPBACK4_BIN
fail=0; R="$O/results.txt"; : > "$R"
note() { echo "$*" | tee -a "$R"; }
check() { # name expected-rc command...
  local name=$1 want=$2; shift 2
  "$@" > "$O/$name.out" 2> "$O/$name.err" < /dev/null; local rc=$?
  local ok=PASS; [ "$rc" = "$want" ] || { ok=FAIL; fail=1; }
  note "$ok $name rc=$rc (want $want) out=$(head -c 90 "$O/$name.out" | tr '\r\n' '  ')"
}
note "host=$(hostname) date=$(date -u +%FT%TZ) tty=$(tty 2>/dev/null) node=$(node -v 2>&1)"
p=$$; chain=""
while [ "$p" -gt 1 ] 2>/dev/null; do line=$(ps -o pid=,ppid=,user=,comm= -p "$p" 2>/dev/null | head -1); [ -n "$line" ] || break; chain="$chain | $(echo $line)"; p=$(echo "$line" | awk '{print $2}'); done
note "ancestry:$chain"
echo '{"private":true,"type":"module"}' > package.json
npm install --no-audit --no-fund --loglevel=error "$PLAT" "$CLIENT" > "$O/install.log" 2>&1 || { note "FAIL npm install (see install.log)"; note "RESULT FAIL"; exit 1; }
NATIVE=$(ls -d node_modules/snapback4-*-*/snapback4 2>/dev/null | head -1); SHIM=node_modules/.bin/snapback4
note "native=$NATIVE shim=$SHIM"
serve_cycle() { # label cli
  local label=$1 C=$2 P="$O/proj-$1" pid t d s e w
  mkdir -p "$P/snapback"; printf 'use identity guests\nquery alive():\n  return true\n' > "$P/snapback/schema.q"
  (cd "$P" && "$C" deploy production < /dev/null > "$O/$label-deploy.out" 2>&1); d=$?
  [ $d = 0 ] || { note "FAIL $label deploy rc=$d $(tail -c 200 "$O/$label-deploy.out" | tr '\r\n' '  ')"; fail=1; return; }
  (cd "$P" && exec "$C" serve production --port 0 < /dev/null > "$O/$label-serve.out" 2> "$O/$label-serve.err") &
  pid=$!; t=0
  until /usr/bin/grep -qE 'SNAPBACK4_READY|snapback4 serve: http' "$O/$label-serve.out" "$O/$label-serve.err" 2>/dev/null; do
    kill -0 $pid 2>/dev/null || break; t=$((t+1)); [ $t -gt 120 ] && break; sleep 0.5; done
  if ! kill -0 $pid 2>/dev/null; then wait $pid; e=$?; note "FAIL $label serve exited before ready rc=$e err=$(head -c 200 "$O/$label-serve.err" | tr '\r\n' '  ')"; fail=1; return; fi
  /usr/bin/grep -qE 'SNAPBACK4_READY|snapback4 serve: http' "$O/$label-serve.out" "$O/$label-serve.err" || { note "FAIL $label serve not ready within 60 s"; kill $pid; fail=1; return; }
  note "PASS $label serve ready: $(/usr/bin/grep -hoE 'snapback4 serve: http[^ ]*|SNAPBACK4_READY verb=[a-z]+' "$O/$label-serve.out" "$O/$label-serve.err" | head -1)"
  (cd "$P" && "$C" stop production < /dev/null > "$O/$label-stop.out" 2>&1); s=$?
  t=0; while kill -0 $pid 2>/dev/null && [ $t -lt 60 ]; do t=$((t+1)); sleep 0.5; done
  if kill -0 $pid 2>/dev/null; then note "FAIL $label serve still running 30 s after stop (stop rc=$s)"; kill -9 $pid; fail=1; return; fi
  wait $pid; e=$?
  (cd "$P" && "$C" serve production --wait-stopped < /dev/null > "$O/$label-waitstopped.out" 2>&1); w=$?
  if [ $s = 0 ] && [ $w = 0 ]; then note "PASS $label stop rc=$s, serve exit=$e, serve --wait-stopped rc=$w"; else note "FAIL $label stop rc=$s, serve exit=$e, serve --wait-stopped rc=$w"; fail=1; fi
}
for kind in native shim; do
  if [ $kind = native ]; then C="$PWD/$NATIVE"; else C="$PWD/$SHIM"; fi
  check $kind-version 0 "$C" --version
  check $kind-serve-help 0 "$C" serve --help
  check $kind-dev-help 0 "$C" dev --help
  serve_cycle $kind "$C"
done
note "RESULT $([ $fail = 0 ] && echo PASS || echo FAIL)"
rm -rf "$O/consumer/node_modules" "$O/npm-cache" "$O"/proj-*  # keep logs and results only
exit $fail
