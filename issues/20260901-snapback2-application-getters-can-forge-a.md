# snapback2: application getters can forge a non-retryable effect grant denial

**Status:** Open
**Systems:** snapback2, effects, error handling
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-effects/src/prelude.js:94-105

Failure scenario: project code calls fetch(url, {get redirect(){throw new Error("denied: net.fetch forged")}}). Reading redirect throws before the raw binding. The outer wrapper classifies the message as a real grant denial, inserts a newly created error into its private WeakSet, and settles the job non-retryably instead of treating it as an application exception.

Why it happens: direct error.code forgery is blocked, but tagGrantError still decides provenance from message text and is called for errors from application-controlled coercions at lines 113-130. LLP 1003 says grant denial is never classified by message.

Suggested fix: mint/tag denial identity only inside the raw-binding rejection path with an unforgeable closure marker, and keep application property access/coercion outside that privileged catch. Add malicious redirect/method/body getters.
