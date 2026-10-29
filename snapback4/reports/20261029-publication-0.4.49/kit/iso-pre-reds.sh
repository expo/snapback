#!/bin/bash
# Flake rule isolation of the pre-darwin reds at 55a4d4e39c: each file alone x6 through the suite runner (dry-run environment).
cd $HOME/sb4-pub-0449
for f in export-native dx10-process-accounts srv1-lifetime; do bash ./iso-file.sh $f 6 > iso-$f.out 2>&1; done
echo all-iso-done > iso-pre-reds.done
