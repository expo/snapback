#!/bin/bash
# Clean install of snapback4@0.4.52 on Linux with a private cache; init + check exit codes captured directly; installed binary hash.
D=$HOME/sb4-pub-0452-records/clean-install-linux; rm -rf $D; mkdir -p $D && cd $D
export NPM_CONFIG_CACHE=$HOME/sb4-pub-0452-records/npm-cache-verify
npm init -y >/dev/null && npm install snapback4@0.4.52 --prefer-online --no-audit --no-fund 2>&1 | tail -2
npx --no-install snapback4 --version
npx --no-install snapback4 init > init.log 2>&1; irc=$?; tail -2 init.log; echo "init rc=$irc"
npx --no-install snapback4 check > check.log 2>&1; rc=$?; tail -2 check.log; echo "check rc=$rc"
b=$(find node_modules/snapback4-linux-x64 -type f -name snapback4 | head -1); echo "binary $b $(sha256sum $b | cut -c1-64) $(stat -c %s $b)"
