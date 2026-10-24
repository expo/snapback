#!/bin/bash
# Assemble the 0.4.39 publication records into the records worktree (layout of the 0.4.38 records commit b31795e07d; no superseded attempts).
set -e
W=/home/ccheever/sb4-records-0439/snapback4; P=/home/ccheever/sb4-pub-0439-records; M=$P/mac-pull; K=/home/ccheever/sb4-pub-0439-kit
R=$W/reports/20261023-publication-0.4.39; E=$W/reports/20261023-expo-0.4.39
[ -e $R ] && { echo "exists $R"; exit 1; }
cp -a $M/20261023-publication-0.4.39 $R; cp -a $M/20261023-expo-0.4.39 $E
for f in $R/attempt-*-publication-dry-run.log $E/offline-ios-device.log $E/restart-ios-device.log; do if [ -e $f ]; then gzip -9 $f; fi; done
# kit/: Mac scripts, helpers, logs, gate log
mkdir -p $R/kit
(cd $M/sb4-pub-0439 && cp -a *.sh *.py helpers-0.4.39 *.log witness.jsonl.native-0439.diff $R/kit/)
if [ -d $M/sb4-pub-0439/isolated ] && [ -n "$(ls -A $M/sb4-pub-0439/isolated)" ]; then cp -a $M/sb4-pub-0439/isolated $R/kit/; fi
(cd $M/sb4-pub-0439 && for f in *.exit *.env-invalid; do if [ -e "$f" ]; then echo "${f%.*}: $(cat $f)"; fi; done) > $R/kit/exits.txt
# linux/: receipt, proofs, logs and the Linux kit
mkdir -p $R/linux
(cd $P/linux-qualification-0.4.39 && cp *.json rule-recipes.log $R/linux/ && gzip -9c suite.log > $R/linux/suite.log.gz)
cp $P/attempt-1-linux-*.json $P/attempt-1-linux-bun-install.log $P/attempt-1-linux-lean-setup.log $R/linux/
gzip -9c $P/attempt-1-linux-qualify.log > $R/linux/attempt-1-linux-qualify.log.gz
cp $K/linux.sh $K/step.sh $K/watch-gate.sh $K/watch-linux.sh $K/waitfile.sh $K/disklog.sh $K/xfer.sh $K/poll.sh $K/pull-client.sh $K/kill-linux.sh $K/assemble-records.sh $K/linux-1.out $K/watch-gate.out $R/linux/
cp $P/disk.log $R/linux/disk-a1.log
echo "linux-1: $(cat $P/linux-1.exit)" > $R/linux/exits.txt
find $R $E -type f -size +200k ! -name '*.mp4' ! -name '*.gz' ! -name '*.tgz' -print
# metrics: append the published lines
grep '^+{' $M/publish.jsonl.diff | cut -c2- >> $W/metrics/publish.jsonl
grep '^+{' $M/sb4-pub-0439/witness.jsonl.native-0439.diff | cut -c2- >> $W/metrics/witness.jsonl
du -sh $R $E; find $R $E -type f | wc -l
