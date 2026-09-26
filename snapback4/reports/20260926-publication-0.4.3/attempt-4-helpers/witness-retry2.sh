#!/bin/bash
export VERSION=0.4.3 PUBDATE=20260926 ATTEMPT=4
export ROOT=/Users/ccheever/projects/snapback-pub-043/snapback4
export H=/Users/ccheever/projects/snapback-eph-program/pub/helpers-043
export REP=$ROOT/reports/$PUBDATE-publication-$VERSION
S=~/projects/snapback-eph-program/pub/pubstep.sh
U=81961F7D-DF85-4A7A-B376-20D9073AC101
step() { "$S" "$@" || { echo "STOPPED at $1"; echo "stopped $1" > ~/projects/snapback-eph-program/pub/witness-retry2.exit; exit 1; }; }
step native-witness-retry-2 . env WITNESS_UDID=$U WITNESS_PORT=44441 WITNESS_ARTIFACTS=$ROOT/reports/$PUBDATE-expo-$VERSION node witness/expo.mjs
step native-qualification-verification . python3 $H/native-verify.py
step simulator-shutdown . xcrun simctl shutdown $U
echo "WITNESS RETRY DONE"; echo done > ~/projects/snapback-eph-program/pub/witness-retry2.exit
