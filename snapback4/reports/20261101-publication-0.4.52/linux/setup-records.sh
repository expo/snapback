#!/bin/bash
set -e
W=$HOME/sb4-pub-0441; R=$HOME/sb4-records-0452
[ ! -e "$R" ] || { echo 'records worktree exists; inspect before reuse'; exit 1; }
git -C "$W" fetch origin main
git -C "$W" worktree add -b sb4-pub-0452-records "$R" origin/main
git -C "$R" rev-parse HEAD
git -C "$R" status --short
