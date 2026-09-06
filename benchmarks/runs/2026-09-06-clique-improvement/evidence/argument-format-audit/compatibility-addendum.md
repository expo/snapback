# Raw-IR compatibility boundary correction

2026-09-06 Root follow-up after engine source audit. The original hashed
root-contract.md is preserved as the decision record, including its overly
broad demand that old decoders refuse new formats. This addendum narrows that
compatibility statement, not the required format enforcement in the new graph.

The v5 certificate/value/evaluator identities fence compiled program custody.
ProjectJson remains version1; pre-v5 ArgType serde can ignore unknown Text
fields and recertify the reduced object. A new identity constant cannot change
that old executable. Use the matched new compiler, native owner and client;
do not claim safe arbitrary old-owner raw-IR recertification. No ProjectJson
protocol change is introduced by this correction. The engine owner retains
this limitation in final qualification and review materials.
