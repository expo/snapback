#!/bin/bash
export PATH=/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/opt/homebrew/bin:/usr/bin:/bin
D=$HOME/sb4-pub-0437/clean-install; rm -rf $D; mkdir -p $D && cd $D
npm init -y >/dev/null && npm install snapback4@0.4.37 --prefer-online --no-audit --no-fund 2>&1 | tail -2
npx --no-install snapback4 --version; npx --no-install snapback4 init 2>&1 | tail -2; npx --no-install snapback4 check 2>&1 | tail -2; echo "check rc=$?"
