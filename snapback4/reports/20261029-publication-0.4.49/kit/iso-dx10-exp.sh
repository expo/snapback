#!/bin/bash
# EXPERIMENT (not a fix yet): dx10 test 8 with an npm script that keeps sh as npm's child (node serve.mjs; exit $?), so group
# TERM kills sh and npm exits on macOS too (Linux dash already keeps sh -c). Temp copy in the publish worktree, restored after.
W=$HOME/sb4-pub-0444-wt/snapback4; T=packages/snapback4/test/dx10-process-accounts.test.mjs
cp $HOME/sb4-pub-0449/dx10.exp.test.mjs $W/$T
mv $HOME/sb4-pub-0449/isolated/iso-dx10-process-accounts $HOME/sb4-pub-0449/isolated/iso-dx10-process-accounts-c 2>/dev/null
bash $HOME/sb4-pub-0449/iso-file.sh dx10-process-accounts 3
mv $HOME/sb4-pub-0449/isolated/iso-dx10-process-accounts $HOME/sb4-pub-0449/isolated/iso-dx10-fixed
git -C $W checkout -- $T; git -C $HOME/sb4-pub-0444-wt status --porcelain | head -3
echo exp-done > $HOME/sb4-pub-0449/iso-dx10-exp.done
