#!/bin/bash
# Confirm the srv1-lifetime fixture fix alone on the Mac (node 24.18): copy the fixed test into the publish worktree temporarily,
# run it alone x3 through the suite runner (dry-run env), then restore the tracked file (the worktree is requalified anyway).
W=$HOME/sb4-pub-0444-wt/snapback4; T=packages/snapback4/test/srv1-lifetime.test.mjs
cp $HOME/sb4-pub-0449/srv1-lifetime.fixed.test.mjs $W/$T
mv $HOME/sb4-pub-0449/isolated/iso-srv1-lifetime $HOME/sb4-pub-0449/isolated/iso-srv1-lifetime-55a4-unfixed
bash $HOME/sb4-pub-0449/iso-file.sh srv1-lifetime 3
mv $HOME/sb4-pub-0449/isolated/iso-srv1-lifetime $HOME/sb4-pub-0449/isolated/iso-srv1-lifetime-fixed
git -C $W checkout -- $T; git -C $HOME/sb4-pub-0444-wt status --porcelain | head -3
echo fixed-iso-done > $HOME/sb4-pub-0449/iso-srv1-fixed.done
