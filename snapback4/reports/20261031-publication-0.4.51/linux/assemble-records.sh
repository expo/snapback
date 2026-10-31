#!/bin/bash
# Assemble the 0.4.51 publication records into the records worktree (layout of the 0.4.43 records commit 750a8c34fa).
# 0.4.51 from main plus release commit; include this release evidence only.
# env: LQ (qualified Linux attempt), LA (space-separated earlier Linux attempts, may be empty)
set -euo pipefail
# Copy artifacts without following links or retaining credential/cache paths.
safe_copy() {
 rsync -a --no-links --exclude=node_modules --exclude=npm-cache --exclude=.npm --exclude=.npmrc --exclude=.harness-env.json --exclude='.env*' "$@"
}
LQ=${LQ:?qualified linux attempt}; LA=${LA:-}
W=/home/ccheever/sb4-records-0451/snapback4; P=/home/ccheever/sb4-pub-0451-records; M=$P/mac-pull; K=/home/ccheever/sb4-pub-0451-kit
R=$W/reports/20261031-publication-0.4.51; E=$W/reports/20261031-expo-0.4.51
[ -e $R ] && { echo "exists $R"; exit 1; }
safe_copy "$M/20261031-publication-0.4.51/" "$R/"; safe_copy "$M/20261031-expo-0.4.51/" "$E/"
for f in $R/attempt-*-publication-dry-run.log $E/offline-ios-device.log $E/restart-ios-device.log; do if [ -e $f ]; then gzip -9 $f; fi; done
mkdir -p $R/kit
(cd $M/sb4-pub-0451 && safe_copy *.sh *.py *.mjs *.json *.sha256 helpers-0.4.51 $R/kit/ && for f in *.log *.out *.diff; do if [ -e "$f" ]; then safe_copy "$f" $R/kit/; fi; done)
if [ -d $M/sb4-pub-0451/isolated ] && [ -n "$(ls -A $M/sb4-pub-0451/isolated)" ]; then safe_copy $M/sb4-pub-0451/isolated $R/kit/; fi
for a in $(cd $M/sb4-pub-0451 && ls -d archive-* 2>/dev/null); do safe_copy $M/sb4-pub-0451/$a $R/kit/; done
for d in auth-checks interrupted-dry-run-1-refresh-error; do if [ -d $M/sb4-pub-0451/$d ]; then safe_copy $M/sb4-pub-0451/$d $R/kit/; fi; done
find $R/kit -name '*.mp4' -delete
for f in $(find $R/kit -name '*.log' -size +200k); do gzip -9 $f; done
(cd $M/sb4-pub-0451 && for f in *.exit *.env-invalid; do if [ -e "$f" ]; then echo "${f%.*}: $(cat $f)"; fi; done) > $R/kit/exits.txt
for f in native-audits-green.sha native-final-started.sha native-a2-started.sha native-a1-power-cleanup.sha; do if [ -e "$M/sb4-pub-0451/$f" ]; then cp "$M/sb4-pub-0451/$f" "$R/kit/"; fi; done
mkdir -p $R/linux
(cd $P/linux-qualification-0.4.51 && cp *.json $R/linux/ && for f in *.log; do if [ "$f" != suite.log ]; then cp $f $R/linux/; fi; done && gzip -9c suite.log > $R/linux/suite.log.gz)
cp $P/attempt-$LQ-linux-*.json $P/attempt-$LQ-linux-bun-install.log $P/attempt-$LQ-linux-lean-setup.log $R/linux/
gzip -9c $P/attempt-$LQ-linux-qualify.log > $R/linux/attempt-$LQ-linux-qualify.log.gz; cp $P/disk.log $R/linux/disk-a$LQ.log
for n in $LA; do S=$P/archive-linux-$n; D=$R/linux/attempt-$n; mkdir -p $D
  for f in $S/*; do case "$f" in */linux-qualification-0.4.51) ;; *.log) gzip -9c $f > $D/$(basename $f).gz ;; *) safe_copy $f $D/ ;; esac; done
  if [ -d $S/linux-qualification-0.4.51 ]; then mkdir -p $D/qualification; (cd $S/linux-qualification-0.4.51 && for f in *; do case "$f" in suite.log) gzip -9c $f > $D/qualification/suite.log.gz;; *.json|*.log) cp $f $D/qualification/;; esac; done); fi
done
if [ -d $K/isolated ] && [ -n "$(ls -A $K/isolated)" ]; then mkdir -p $R/linux/isolated; safe_copy $K/isolated/* $R/linux/isolated/; for f in $(find $R/linux/isolated -name '*.log' -size +200k); do gzip -9 $f; done; fi
cp $K/*.sh $K/*.out $K/*.py $K/*.mjs $R/linux/ 2>/dev/null || true; safe_copy $K/mac $R/linux/mac-kit-sources
for f in verify-registry.out clean-install-linux.out clean-install-mac.out; do if [ -e $P/$f ]; then cp $P/$f $R/linux/; fi; done
mkdir -p $R/source $R/audits
cp $P/qualified-source.bundle $P/qualified-source-bundle-verify.out $P/lineage.json $R/source/
cp $P/release-affected*.json $P/release-affected*.log $P/release-*.exit $P/release-inventories.log $P/release-ref-check.log $R/source/
safe_copy $P/audit-linux-* $R/audits/
cp $K/audit-fast.mjs $R/audits/
python3 "$K/collect-extra-records.py" "$P" "$R"
cp $P/STATUS.md $R/linux/STATUS.md
(for n in $LA; do echo "linux-$n: $(cat $P/archive-linux-$n/linux-$n.exit)"; done; echo "linux-$LQ: $(cat $P/linux-$LQ.exit)") > $R/linux/exits.txt
find "$R/source" -type f -name '*.log' -size +200k -exec gzip -9 {} \;
find $R $E -type f -size +300k ! -name '*.mp4' ! -name '*.gz' ! -name '*.tgz' -print
grep '^+{' $M/publish.jsonl.diff | cut -c2- >> $W/metrics/publish.jsonl
grep '^+{' $M/sb4-pub-0451/witness.jsonl.native-0451.diff | cut -c2- >> $W/metrics/witness.jsonl
du -sh $R $E; find $R $E -type f | wc -l
