# Native timed selection updates preserve an untimed shared row

Root read the full native proof, persistence result and assertion script.
Immutable owner06 SHA256
`7e6f0cba7676b97bf5b6a5e54adb94dadf447406fa6f266d54fb662393b1e1b6`
produced actual authenticated program/envelope pairs with durable seq1.
Advancing the clock removes a row from a moving window and makes a conditional
query stop reading/returning it. Both pairs carry changed exact readTime and
validators. The separately queried untimed anchor contains the same durable row.

The candidate file carrier accepts these pairs both warm and after close/reopen.
The retained script asserts that the anchor data/state remain unchanged, the
pool still contains one row, and no global negative is created. Both runs have
error:null. This shows real native timed omission does not become global purge
in these two cases. It is a matched historical v4 candidate proof, not a v5,
publication, native-device, arbitrary concurrency or full integrity qualification.

The result binds native inputs and four client files hashed after execution;
it does not by itself establish a frozen complete transitive client source graph.
Keep that limitation until the owner retains stronger source custody. Guard
contradiction, cross-answer revalidation, full runtime bytes and normal-history
capacity tests remain separate work. The original native proof's pending-client
wording predates the subsequent persistence result and is preserved unchanged.

Exact native inputs, complete private carrier data and prior fixture setup
failures remain under
`/Users/ccheever/clique-improvement/revisions/inbox-restore/native-clock/row-window/`.
No raw auth database or credentials are copied into this evidence directory.
