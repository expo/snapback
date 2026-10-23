#!/bin/bash
# Assemble the 0.4.38 publication records into the records worktree (layout of the 0.4.37 records commit).
set -e
W=/home/ccheever/sb4-records-0438/snapback4; P=/home/ccheever/sb4-pub-0438-records; M=$P/mac-pull; K=/home/ccheever/sb4-pub-0438-kit
R=$W/reports/20261022-publication-0.4.38; E=$W/reports/20261022-expo-0.4.38
[ -e $R ] && { echo "exists $R"; exit 1; }
cp -a $M/20261022-publication-0.4.38 $R; cp -a $M/20261022-expo-0.4.38 $E
for f in $R/attempt-*-publication-dry-run.log $E/offline-ios-device.log $E/restart-ios-device.log; do if [ -e $f ]; then gzip -9 $f; fi; done
# kit/: Mac scripts, helpers, logs, gate log
mkdir -p $R/kit
(cd $M/sb4-pub-0438 && cp -a *.sh *.py helpers-0.4.38 *.log witness.jsonl.native-0438.diff isolated $R/kit/)
(cd $M/sb4-pub-0438 && for f in *.exit *.env-invalid; do if [ -e "$f" ]; then echo "${f%.*}: $(cat $f)"; fi; done) > $R/kit/exits.txt
# linux/: receipt, proofs, logs and the Linux kit
mkdir -p $R/linux
(cd $P/linux-qualification-0.4.38 && cp *.json rule-recipes.log $R/linux/ && gzip -9c suite.log > $R/linux/suite.log.gz)
cp $P/attempt-2-linux-*.json $P/attempt-2-linux-bun-install.log $P/attempt-2-linux-lean-setup.log $R/linux/
gzip -9c $P/attempt-2-linux-qualify.log > $R/linux/attempt-2-linux-qualify.log.gz
cp $K/linux.sh $K/step.sh $K/watch-gate.sh $K/watch-linux.sh $K/waitfile.sh $K/disklog.sh $K/xfer.sh $K/poll.sh $K/pull-client.sh $K/kill-linux.sh $K/assemble-records.sh $K/linux-2.out $K/watch-gate.out $R/linux/
cp $P/disk.log $R/linux/disk-a2.log; cp -a $P/precheck-a2 $R/linux/
echo "linux-2: $(cat $P/linux-2.exit)" > $R/linux/exits.txt
# superseded/: attempt 1 at cadb7c55be (Linux red from 202826334f on main; Mac native/prepare/lean/warm)
S=$R/superseded/attempt-1-cadb7c55be-linux; mkdir -p $S
A=$P/attempt-1-cadb7c55be-linux
cp -a $A/DIAGNOSIS.md $A/linux-1.out $A/linux-1.exit $A/disk.log $A/iso-a1 $A/attempt-1-linux-*.json $A/attempt-1-linux-bun-install.log $A/attempt-1-linux-lean-setup.log $S/
gzip -9c $A/linux-qualification-0.4.38/suite.log > $S/suite.log.gz
gzip -9c $A/attempt-1-linux-qualify.log > $S/attempt-1-linux-qualify.log.gz
MA=$R/superseded/mac-a1-cadb7c55be; cp -a $M/sb4-pub-0438/archive-a1-cadb7c55be $MA
find $MA -type f -size +200k ! -name '*.mp4' ! -name '*.gz' -exec gzip -9 {} \;
cp $K/mac/chain-a1.sh $K/mac/setup-mac-0438.sh $K/mac/rearm-a2.sh $MA/
# metrics: append the published lines
grep '^+{' $M/publish.jsonl.diff | cut -c2- >> $W/metrics/publish.jsonl
grep '^+{' $M/sb4-pub-0438/witness.jsonl.native-0438.diff | cut -c2- >> $W/metrics/witness.jsonl
du -sh $R $E; find $R $E -type f | wc -l
