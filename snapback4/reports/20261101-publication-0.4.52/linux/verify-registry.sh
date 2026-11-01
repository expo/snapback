#!/bin/bash
# After finish: npm view (version + latest) for the four packages, then re-download each 0.4.52 tarball with a private cache and
# compare sha256 with the qualified/staged bytes. usage: LINUXSHA=<linux-tgz-sha256> verify-registry.sh <darwin-staged-sha256>
DARWIN=${1:?darwin staged sha256}
D=$HOME/sb4-pub-0452-records/registry-verify; rm -rf $D; mkdir -p $D/tgz; export NPM_CONFIG_CACHE=$D/npm-cache
declare -A WANT=([snapback4]=$(sha256sum "$HOME/sb4-pub-0441/snapback4/target/publication/client-0.4.52/snapback4-0.4.52.tgz" | cut -d' ' -f1) [snapback4-expo]=$(sha256sum "$HOME/sb4-pub-0441/snapback4/target/publication/client-0.4.52/snapback4-expo-0.4.52.tgz" | cut -d' ' -f1) [snapback4-linux-x64]=${LINUXSHA:?linux tgz sha256} [snapback4-darwin-arm64]=$DARWIN)
ok=1
for p in snapback4 snapback4-darwin-arm64 snapback4-linux-x64 snapback4-expo; do
  v=$(npm view $p@0.4.52 version --prefer-online 2>/dev/null | grep -v "^npm" | tail -1); l=$(npm view $p dist-tags.latest --prefer-online 2>/dev/null | grep -v "^npm" | tail -1)
  f=$(cd $D/tgz && npm pack $p@0.4.52 --prefer-online --silent 2>/dev/null | tail -1)
  h=$(sha256sum $D/tgz/$f 2>/dev/null | cut -c1-64)
  m=$([ "$h" = "${WANT[$p]}" ] && echo EQUAL || echo DIFFERENT)
  [ "$v" = 0.4.52 ] && [ "$l" = 0.4.52 ] && [ "$m" = EQUAL ] || ok=0
  echo "$p view=$v latest=$l tgz=$f sha256=${h:0:16}... want=${WANT[$p]:0:16}... $m"
done
echo "verify ok=$ok"

[ "$ok" = 1 ]
