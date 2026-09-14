lane id muse-clique-snapback4-full-20260913
model muse-spark-1.3
effort=xhigh
backend=snapback4-0.2.6
phase=m7
start=1789376048
1789376359 m7-start fresh-backend-setup ports=49310,49311
1789376359 knowledge-lookup quarry-reads-writes-types-bounds source=npx-snapback4-guide
1789376359 knowledge-lookup schema-evolution-deploy-adoption source=package-README-dev-release-sections
1789376436 server-pids m7-backend=63759 port=49310 evidence=lsof
1789376501 snapshot-pre-m7 done out=m7/pre-snapshot files=9 evidence=manifest.json
1789376501 pre-m7-count-structure YES maintain-messageCounts-by-chatId inbox+chatDetail-count-fields semantics=raw-totals-incl-tombstoned evidence=snapback/schema.q:199,429,432
