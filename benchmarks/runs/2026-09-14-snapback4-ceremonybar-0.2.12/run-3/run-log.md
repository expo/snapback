start=1789406410
1789406410 milestone=documentation start
1789406410 lookup source=package-README reading public README
1789406426 lookup source=package-guide language,bounds,effects,search; source=why E_BOUND
1789406512 milestone=documentation green; milestone=schema start+green; lookup source=generated-types snapback/generated/api.ts; check passed with N_NO_CURSOR note for bounded small-seed search
1789406666 milestone=seed+harness start; lookup source=model-knowledge Node HTTP, subprocess lifecycle, assertions; authored headless transport and acceptance
1789406681 loop=1 attribution=agent-error failed="npm run acceptance" resolution="Renamed runPeriod start argument, which shadowed the server start function"
schema-shape={"workTables":["digestDeliveries"],"perPrincipalCounterTables":[],"auxiliaryOperations":[]}
Schema choices: posts, likes and follows hold public social facts; postLikes maintains counts per post, not per principal. The maintain is world-readable because its source likes and posts are public and the trending query displays those counts. Profiles hold explicit activity, never connection state. Chats, members, messages and acknowledgements hold private current-membership domain facts. Acknowledgements are per message and principal; application mutations preserve read as the terminal state.
Work-table accounting: digestDeliveries is conservatively listed because digest writes and later reads it for durable per-principal/per-period emission suppression. It holds no numeric accumulator or application answer. The marker and real emitted effect commit together. There are no per-principal counter tables and no auxiliary operations. profile, post, follow, createChat and addMember are ordinary authority-enforcing domain creation operations used by the seed; they are not job helpers.
Bounds: queries inspect finite pages suitable for this small application (100 memberships/roster/search matches, 200 social or chat rows). No package ceiling is changed. Larger datasets may require pagination or further maintains; acceptance checks completeness recursively for the full seed and positive probes.
1789406704 milestone=seed green; milestone=baseline green; milestone=durable-digest start; milestone=schema-record green
1789406727 milestone=durable-digest green; milestone=scheduled-boundary start; loop=1 attribution=agent-error resolution-verified="Restart and next-period digest tests now pass"
1789406800 milestone=scheduled-boundary green; milestone=positive-probes start+green; milestone=acceptance green; milestone=check green; milestone=final-report start+green
1789406800 loop=1 attribution=agent-error failed="npm run acceptance" resolution="Renamed shadowing argument; full acceptance including real schedule and positive probes passed"
green=1789406800
