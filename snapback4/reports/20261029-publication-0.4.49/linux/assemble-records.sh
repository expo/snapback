#!/bin/bash
# Assemble the 0.4.49 publication records into the records worktree (layout of the 0.4.43 records commit 750a8c34fa).
# 0.4.49 from 55a4d4e39c (Integration 33 final). 0.4.44-0.4.48 were never published; the STATUS files of the abandoned
# 0.4.44/0.4.46/0.4.47 attempts and the main red-check list ride along under linux/prior-*.
# env: LQ (qualified Linux attempt), LA (space-separated earlier Linux attempts, may be empty)
set -e
LQ=${LQ:?qualified linux attempt}; LA=${LA:-}
W=/home/ccheever/sb4-records-0449/snapback4; P=/home/ccheever/sb4-pub-0449-records; M=$P/mac-pull; K=/home/ccheever/sb4-pub-0449-kit
R=$W/reports/20261029-publication-0.4.49; E=$W/reports/20261029-expo-0.4.49
[ -e $R ] && { echo "exists $R"; exit 1; }
cp -a $M/20261029-publication-0.4.49 $R; cp -a $M/20261029-expo-0.4.49 $E
for f in $R/attempt-*-publication-dry-run.log $E/offline-ios-device.log $E/restart-ios-device.log; do if [ -e $f ]; then gzip -9 $f; fi; done
mkdir -p $R/kit
(cd $M/sb4-pub-0449 && cp -a *.sh *.py helpers-0.4.49 $R/kit/ && for f in *.log *.out *.diff; do if [ -e "$f" ]; then cp -a "$f" $R/kit/; fi; done)
if [ -d $M/sb4-pub-0449/isolated ] && [ -n "$(ls -A $M/sb4-pub-0449/isolated)" ]; then cp -a $M/sb4-pub-0449/isolated $R/kit/; fi
for a in $(cd $M/sb4-pub-0449 && ls -d archive-* 2>/dev/null); do cp -a $M/sb4-pub-0449/$a $R/kit/; done
find $R/kit -name '*.mp4' -delete
for f in $(find $R/kit -name '*.log' -size +200k); do gzip -9 $f; done
(cd $M/sb4-pub-0449 && for f in *.exit *.env-invalid; do if [ -e "$f" ]; then echo "${f%.*}: $(cat $f)"; fi; done) > $R/kit/exits.txt
mkdir -p $R/linux
(cd $P/linux-qualification-0.4.49 && cp *.json $R/linux/ && for f in *.log; do if [ "$f" != suite.log ]; then cp $f $R/linux/; fi; done && gzip -9c suite.log > $R/linux/suite.log.gz)
cp $P/attempt-$LQ-linux-*.json $P/attempt-$LQ-linux-bun-install.log $P/attempt-$LQ-linux-lean-setup.log $R/linux/
gzip -9c $P/attempt-$LQ-linux-qualify.log > $R/linux/attempt-$LQ-linux-qualify.log.gz; cp $P/disk.log $R/linux/disk-a$LQ.log
for n in $LA; do S=$P/archive-linux-$n; D=$R/linux/attempt-$n; mkdir -p $D
  for f in $S/*; do case "$f" in */linux-qualification-0.4.49) ;; *.log) gzip -9c $f > $D/$(basename $f).gz ;; *) cp -a $f $D/ ;; esac; done
  if [ -d $S/linux-qualification-0.4.49 ]; then mkdir -p $D/qualification; (cd $S/linux-qualification-0.4.49 && for f in *; do case "$f" in suite.log) gzip -9c $f > $D/qualification/suite.log.gz;; *.json|*.log) cp $f $D/qualification/;; esac; done); fi
done
if [ -d $K/isolated ] && [ -n "$(ls -A $K/isolated)" ]; then mkdir -p $R/linux/isolated; cp -a $K/isolated/* $R/linux/isolated/; for f in $(find $R/linux/isolated -name '*.log' -size +200k); do gzip -9 $f; done; fi
cp $K/*.sh $K/*.out $R/linux/ 2>/dev/null || true; cp -a $K/mac $R/linux/mac-kit-sources
for f in verify-registry.out clean-install-linux.out clean-install-mac.out; do if [ -e $P/$f ]; then cp $P/$f $R/linux/; fi; done
cp $P/STATUS.md $R/linux/STATUS.md; cp /home/ccheever/sb4-pub-0444-records/STATUS.md $R/linux/prior-0.4.44-STATUS.md
cp /home/ccheever/sb4-pub-0446-records/STATUS.md $R/linux/prior-0.4.46-STATUS.md; cp /home/ccheever/sb4-pub-0447-records/STATUS.md $R/linux/prior-0.4.47-STATUS.md; cp /home/ccheever/sb4-pub-0447-records/REDS-main.md $R/linux/prior-REDS-main.md
(for n in $LA; do echo "linux-$n: $(cat $P/archive-linux-$n/linux-$n.exit)"; done; echo "linux-$LQ: $(cat $P/linux-$LQ.exit)") > $R/linux/exits.txt
find $R $E -type f -size +300k ! -name '*.mp4' ! -name '*.gz' ! -name '*.tgz' -print
grep '^+{' $M/publish.jsonl.diff | cut -c2- >> $W/metrics/publish.jsonl
grep '^+{' $M/sb4-pub-0449/witness.jsonl.native-0449.diff | cut -c2- >> $W/metrics/witness.jsonl
du -sh $R $E; find $R $E -type f | wc -l
