#!/bin/bash
# Assemble the 0.4.37 publication records into the records worktree (layout of the 0.4.35 records commit).
set -e
W=/home/ccheever/sb4-records-0437/snapback4; P=/home/ccheever/sb4-pub-0437-records; M=$P/mac-pull; K=/home/ccheever/sb4-pub-0437-kit
R=$W/reports/20261022-publication-0.4.37; E=$W/reports/20261022-expo-0.4.37
[ -e $R ] && { echo "exists $R"; exit 1; }
cp -a $M/20261022-publication-0.4.37 $R; cp -a $M/20261022-expo-0.4.37 $E
gzip -9 $R/attempt-1-publication-dry-run.log $R/attempt-2-publication-dry-run.log $E/offline-ios-device.log $E/restart-ios-device.log
# kit/: Mac scripts, helpers, logs, gate log
mkdir -p $R/kit
(cd $M/sb4-pub-0437 && cp -a *.sh *.py helpers-0.4.37 *.log witness.jsonl.native-0437.diff $R/kit/)
cp $K/mac/setup-mac-0437.sh $R/kit/
(cd $M/sb4-pub-0437 && for f in *.exit *.env-invalid; do echo "${f%.*}: $(cat $f)"; done) > $R/kit/exits.txt
# linux/: receipt, proofs, logs and the Linux kit
mkdir -p $R/linux
(cd $P/linux-qualification-0.4.37 && cp *.json rule-recipes.log $R/linux/ && gzip -9c suite.log > $R/linux/suite.log.gz)
cp $P/attempt-2-linux-*.json $P/attempt-2-linux-bun-install.log $P/attempt-2-linux-lean-setup.log $R/linux/
gzip -9c $P/attempt-2-linux-qualify.log > $R/linux/attempt-2-linux-qualify.log.gz
cp $K/linux.sh $K/step.sh $K/watch-gate.sh $K/xfer.sh $K/poll.sh $K/pull-client.sh $K/kill-linux.sh $K/assemble-records.sh $K/linux-2.out $R/linux/
cp $K/watch-gate.out $R/linux/
echo "linux-2: $(cat $P/linux-2.exit)" > $R/linux/exits.txt
# superseded/: attempt 1 at ee5a053303 (Linux red: dirty tree from wave14 logs; Mac native/prepare/lean/warm)
S=$R/superseded/attempt-1-ee5a053303-linux; mkdir -p $S/isolated
A=$P/attempt-1-ee5a053303-linux
cp $A/DIAGNOSIS.md $A/linux-1.out $A/linux-1.exit $A/isolated.out $A/attempt-1-linux-*.json $A/attempt-1-linux-bun-install.log $A/attempt-1-linux-lean-setup.log $S/
gzip -9c $A/linux-qualification-0.4.37/suite.log > $S/suite.log.gz
cp $A/isolated/*.log $A/isolated/load.txt $S/isolated/
for d in $A/stray-packages-snapback4-logs $A/isolated/wave14-stray-logs-*; do echo "$(basename $d): $(ls $d | tr '\n' ' ')"; done > $S/isolated/stray-logs-listing.txt
cp $K/iso-linux-a1.sh $S/
MA=$R/superseded/mac-a1-ee5a053303; cp -a $M/sb4-pub-0437/archive-a1-ee5a053303 $MA
find $MA -type f -size +200k ! -name '*.mp4' ! -name '*.gz' -exec gzip -9 {} \;
cp $K/mac/chain-a1.sh $MA/
# metrics: append the published lines
grep '^+{' $M/publish.jsonl.diff | cut -c2- >> $W/metrics/publish.jsonl
grep '^+{' $M/sb4-pub-0437/witness.jsonl.native-0437.diff | cut -c2- >> $W/metrics/witness.jsonl
du -sh $R $E; find $R $E -type f | wc -l
