#!/bin/bash
# Assemble the 0.4.43 publication records into the records worktree (layout of the 0.4.40 records commit 95ec6d3bd7, extended).
# 0.4.43: published from 6f3ef3b0d0 (Mac native attempt 2, Linux attempt 6, Mac dry run 3, finish attempt 1).
# Kept: Mac attempt 1 at f032742ac8 (kit/archive-a1-f032742ac8: native/prepare/warm + dry run 1 red in wave10-upgrade), Mac dry run 2
# (suite passed, env-invalid in the Darwin starters audit), Linux attempts 1-5 (linux/attempt-N-*), isolation runs and harnesses.
set -e
W=/home/ccheever/sb4-records-0443/snapback4; P=/home/ccheever/sb4-pub-0443-records; M=$P/mac-pull; K=/home/ccheever/sb4-pub-0443-kit
R=$W/reports/20261026-publication-0.4.43; E=$W/reports/20261026-expo-0.4.43
[ -e $R ] && { echo "exists $R"; exit 1; }
cp -a $M/20261026-publication-0.4.43 $R; cp -a $M/20261026-expo-0.4.43 $E
for f in $R/attempt-*-publication-dry-run.log $E/offline-ios-device.log $E/restart-ios-device.log; do if [ -e $f ]; then gzip -9 $f; fi; done
# kit/: Mac scripts, helpers, logs, gate log, isolation runs, Mac attempt-1 archive
mkdir -p $R/kit
(cd $M/sb4-pub-0443 && cp -a *.sh *.py helpers-0.4.43 *.log $R/kit/ && for f in *.out *.diff; do if [ -e "$f" ]; then cp -a "$f" $R/kit/; fi; done)
if [ -d $M/sb4-pub-0443/isolated ] && [ -n "$(ls -A $M/sb4-pub-0443/isolated)" ]; then cp -a $M/sb4-pub-0443/isolated $R/kit/; fi
cp -a $M/sb4-pub-0443/archive-a1-f032742ac8 $R/kit/
find $R/kit/archive-a1-f032742ac8 -name '*.mp4' -delete
for f in $(find $R/kit -name '*.log' -size +200k); do gzip -9 $f; done
(cd $M/sb4-pub-0443 && for f in *.exit *.env-invalid; do if [ -e "$f" ]; then echo "${f%.*}: $(cat $f)"; fi; done) > $R/kit/exits.txt
# linux/: qualified attempt 6 receipt, proofs, logs, the Linux kit; attempts 1-5 with their diagnostics
mkdir -p $R/linux
(cd $P/linux-qualification-0.4.43 && cp *.json rule-recipes.log $R/linux/ && gzip -9c suite.log > $R/linux/suite.log.gz)
cp $P/attempt-6-linux-*.json $P/attempt-6-linux-bun-install.log $P/attempt-6-linux-lean-setup.log $R/linux/
gzip -9c $P/attempt-6-linux-qualify.log > $R/linux/attempt-6-linux-qualify.log.gz; cp $P/disk.log $R/linux/disk-a6.log
for a in 1:f032742ac8 2:6f3ef3b0d0 3:6f3ef3b0d0 4:6f3ef3b0d0 5:6f3ef3b0d0; do n=${a%%:*}; s=${a#*:}; S=$P/archive-linux-$n; D=$R/linux/attempt-$n-$s; mkdir -p $D
  for f in $S/*; do case "$f" in */linux-qualification-0.4.43|*/iso-rest-out|*/iso-rest-out-2) ;; *.log) gzip -9c $f > $D/$(basename $f).gz ;; *) cp -a $f $D/ ;; esac; done
  if [ -d $S/linux-qualification-0.4.43 ]; then mkdir -p $D/qualification; (cd $S/linux-qualification-0.4.43 && for f in *; do case "$f" in suite.log) gzip -9c $f > $D/qualification/suite.log.gz;; *.json|*.log) cp $f $D/qualification/;; esac; done); fi
  for x in iso-rest-out iso-rest-out-2; do if [ -d $S/$x ]; then cp -a $S/$x $D/; fi; done
done
mkdir -p $R/linux/isolated $R/linux/iso-rest
cp -a $K/isolated/* $R/linux/isolated/; for f in $(find $R/linux/isolated -name '*.log' -size +200k); do gzip -9 $f; done
cp $K/iso-rest/*.mjs $R/linux/iso-rest/; for f in rest rest2; do if [ -e $K/iso-rest/$f.log ]; then gzip -9c $K/iso-rest/$f.log > $R/linux/iso-rest/$f.log.gz; fi; done
cp $K/*.sh $K/*.out $R/linux/ 2>/dev/null || true; cp -a $K/mac $R/linux/mac-kit-sources
cp $P/STATUS.md $R/linux/STATUS.md
(for n in 1 2 3 4 5; do echo "linux-$n: $(cat $P/archive-linux-$n/linux-$n.exit)"; done; echo "linux-6: $(cat $P/linux-6.exit)") > $R/linux/exits.txt
find $R $E -type f -size +300k ! -name '*.mp4' ! -name '*.gz' ! -name '*.tgz' -print
# metrics: append the published lines
grep '^+{' $M/publish.jsonl.diff | cut -c2- >> $W/metrics/publish.jsonl
grep '^+{' $M/sb4-pub-0443/witness.jsonl.native-0443.diff | cut -c2- >> $W/metrics/witness.jsonl
du -sh $R $E; find $R $E -type f | wc -l
