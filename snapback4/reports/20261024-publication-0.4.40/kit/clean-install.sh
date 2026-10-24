#!/bin/bash
export PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/bin:/bin
D=$HOME/sb4-pub-0440/clean-install; rm -rf $D; mkdir -p $D && cd $D
npm init -y >/dev/null && npm install snapback4@0.4.40 --prefer-online --no-audit --no-fund 2>&1 | tail -2
npx --no-install snapback4 --version; npx --no-install snapback4 init > init.log 2>&1; irc=$?; tail -2 init.log; echo "init rc=$irc"; npx --no-install snapback4 check > check.log 2>&1; rc=$?; tail -2 check.log; echo "check rc=$rc"
