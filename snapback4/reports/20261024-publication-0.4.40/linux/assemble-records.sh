#!/bin/bash
# Assemble the 0.4.40 publication records into the records worktree (layout of the 0.4.39 records commit 6cbe3869da).
# 0.4.40 deltas: Linux attempt 2 is the qualified one; attempt 1's red (suite log + qualify log + disk log) and the Linux
# isolation runs are kept under linux/; the Mac chain gate (chain-gate-a1.sh/.out) is in kit/.
set -e
W=/home/ccheever/sb4-records-0440/snapback4; P=/home/ccheever/sb4-pub-0440-records; M=$P/mac-pull; K=/home/ccheever/sb4-pub-0440-kit
R=$W/reports/20261024-publication-0.4.40; E=$W/reports/20261024-expo-0.4.40
[ -e $R ] && { echo "exists $R"; exit 1; }
cp -a $M/20261024-publication-0.4.40 $R; cp -a $M/20261024-expo-0.4.40 $E
for f in $R/attempt-*-publication-dry-run.log $E/offline-ios-device.log $E/restart-ios-device.log; do if [ -e $f ]; then gzip -9 $f; fi; done
# kit/: Mac scripts, helpers, logs, gate log
mkdir -p $R/kit
(cd $M/sb4-pub-0440 && cp -a *.sh *.py helpers-0.4.40 *.log witness.jsonl.native-0440.diff $R/kit/ && for f in *.out; do if [ -e "$f" ]; then cp -a "$f" $R/kit/; fi; done)
if [ -d $M/sb4-pub-0440/isolated ] && [ -n "$(ls -A $M/sb4-pub-0440/isolated)" ]; then cp -a $M/sb4-pub-0440/isolated $R/kit/; fi
(cd $M/sb4-pub-0440 && for f in *.exit *.env-invalid; do if [ -e "$f" ]; then echo "${f%.*}: $(cat $f)"; fi; done) > $R/kit/exits.txt
# linux/: receipt, proofs, logs and the Linux kit
mkdir -p $R/linux
(cd $P/linux-qualification-0.4.40 && cp *.json rule-recipes.log $R/linux/ && gzip -9c suite.log > $R/linux/suite.log.gz)
cp $P/attempt-*-linux-*.json $P/attempt-*-linux-bun-install.log $P/attempt-*-linux-lean-setup.log $R/linux/
gzip -9c $P/attempt-2-linux-qualify.log > $R/linux/attempt-2-linux-qualify.log.gz
# attempt 1 (red in the client pool; killed after the suite): suite log, qualify log, disk log
gzip -9c $P/archive-linux-1/linux-qualification-0.4.40/suite.log > $R/linux/attempt-1-suite.log.gz
gzip -9c $P/archive-linux-1/attempt-1-linux-qualify.log > $R/linux/attempt-1-linux-qualify.log.gz
cp $P/archive-linux-1/disk.log $R/linux/disk-a1.log; cp $P/disk.log $R/linux/disk-a2.log
mkdir -p $R/linux/isolated; cp -a $K/isolated/l1 $R/linux/isolated/
cp $K/linux.sh $K/step.sh $K/watch-gate.sh $K/watch-linux.sh $K/waitfile.sh $K/disklog.sh $K/xfer.sh $K/poll.sh $K/pull-client.sh $K/kill-linux.sh $K/assemble-records.sh $K/iso-quote.sh $K/wait-mac.sh $K/macpoll.sh $K/linux-1.out $K/linux-2.out $K/watch-gate.out $K/wait-mac.out $R/linux/
cp $K/mac/setup-mac-0440.sh $K/mac/chain-gate-a1.sh $R/linux/ 2>/dev/null || true
(for a in 1 2; do echo "linux-$a: $(cat $P/linux-$a.exit)"; done) > $R/linux/exits.txt
find $R $E -type f -size +200k ! -name '*.mp4' ! -name '*.gz' ! -name '*.tgz' -print
# metrics: append the published lines
grep '^+{' $M/publish.jsonl.diff | cut -c2- >> $W/metrics/publish.jsonl
grep '^+{' $M/sb4-pub-0440/witness.jsonl.native-0440.diff | cut -c2- >> $W/metrics/witness.jsonl
du -sh $R $E; find $R $E -type f | wc -l
