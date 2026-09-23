# Diary 0122: Clique cal16 native extension

**Date:** 2026-09-22
**Author:** Codex / Astra xhigh
**Application:** frozen Clique cal16, post-grade native extension
**Related:** [LLP 3000.011.005.000](../llp/3000.011.005.000-qualify-the-built-application.rfc.md), [execution report](../snapback4/reports/20260922-clique-native-extension.md)

## 2026-09-22 — preserve the measured app, then qualify its native host

The builder, independent grade and score finished before this work began.
Their result remains 104 pass, 0 fail, 15 not run and score 88. I copied the
graded source, lock and grade artifacts before changing a separate app. The
full stopped final-schema M8 store was also copied with its assets and SQLite
sidecars. The original extension consumed published Snapback 4 0.2.32 and Expo module
0.2.23. Later candidate-only work is recorded separately below.

The published witness is a useful boundary: it owns the backend, proves that
its port refuses connections, kills/relaunches the actual installed app and
retains the video, app assertions and manifest. The application still needs
to say what its content means. I mounted the actual Clique chat/search
components and exposed their existing send and media callbacks only for
witness launches. Credentials come from external fixture files and enter the
simulator as a private session plan; they are not compiled into JavaScript.

Reading the actual app changed two assumptions in the prepared plan. Its
message table has no acquisition horizon: `last 50` is a page, not permission
to call the whole retained history partial. Its native video component
already uses `expo-video`, despite the neighboring web file using `<video>`.
Both are reasons to inspect the completed application rather than port the
previous calibration's names and assumptions.

The revocation contract also needs two separate observations. Delivered
history can retain text after a learned leave, but native media authorization
uses the current membership and purges ordinary bytes. The witness therefore
requires retained text, absent media and no later delivery; retained text
alone would not qualify that boundary.

Installation, native dependency installation and the extension typecheck
passed. The first Release build then exposed a mistake in my prepared command:
disabling signing prevented SecureStore from accessing the simulator keychain.
An explicitly re-signed copy was refused at launch. Using the ordinary Xcode
simulator signing path resolved setup; both failed attempts remain recorded.

The third attempt reached the actual media path and reproduced a product
problem. React Native supplied a successful 2,062-byte response Blob without
`arrayBuffer()`, but the ordinary retention code called that method. The real
image/video hooks reported denied and no ordinary native cache bytes existed.
I preserved the exact installed-package reproduction and requested a narrow
SDK repair; I did not add an app shim or change the published package pin.
This is why a web or Node media test did not settle the native question.

The independent full-fixture acquisition did work on the original packages.
With a fresh store, real inbox content laid out in 11.160 seconds, after the
original app opener returned acquired in 11.018 seconds. Cold offline reopen
took 68 ms. The task observed 59.281 MB of response JSON bodies and a sampled
own-app RSS maximum of 416.334 MB. SQLite plus its retained WAL used much more
disk than the response body size; the report records each file separately.
These are host observations with response-copying overhead, not a comparison
with another backend or a physical lower bound.

There was a second evidence trap in my first assertion plan. The offline
screen showed all 100 inbox entries, but the exact 10,000-message-ID SQLite
comparison happened after reconnect. I labeled that timing and added an
explicit enumeration through every actual local thread page before the
driver's offline milestone. That stronger condition is in the review packet
and awaits the corrected-package run; it does not retroactively change the
two completed acquisition attempts.

The original grade/score stays frozen. Ordinary media, once exclusion,
restart/read progression and learned revocation remain pending the repaired
published SDK and actual reruns. The owned simulator and backend are stopped
while the release lead qualifies that repair.

## 2026-09-22 — candidate media repair and stricter witness review

A digest-bound unpublished SDK 0.2.33 candidate fixed ordinary native byte
retention without an app shim. The real image loaded, and both ordinary image
and video files matched the fixture digests. The next actual once open failed.
An ordinary-only Blob probe then showed the host URL function calling a missing
bridgeless proxy. The client was online and the Blob was valid; the outward
offline refusal hid a host exception. This second failure is why checking
cache bytes alone would have overstated the repair. The probe used no once
grant and closed its own Blob through the public method.

The candidate did pass the full offline message audit: 10,000 exact IDs through
299 actual thread-query pages before reconnect, across all 100 required scopes.
That resolves the evidence gap for this specific candidate. First real content
layout took 12.170 seconds, acquired opener return 12.035 seconds, and cold
open 72.897 ms. These measured runs remain distinct from the original public
pins and the future corrected candidate.

Independent witness review caught three more ways a scenario could be too
lenient: empty receipt subsets passing every(), a cached post-leave answer
being mistaken for an online reconnect, and checking once bytes only after its
handle closed. The revised witness requires both exact IDs, explicit online
state, and file/manifest absence while the actual loaded once handle stays
live. It also rechecks settlement count/order/failures at final completion.
Actual Image load and a fresh offline VideoView first frame are required;
a poster or an earlier online frame cannot stand in for video rendering.
The final revision has not run yet. All prior packets and failed attempts
remain intact; no original grade or score changes with this extension.

## 2026-09-22 — once playback works; video bytes need a usable native name

The second SDK candidate rendered the actual once image. While that image's
handle remained open, the witness confirmed no durable once file or manifest
entry and retained ordinary positive controls. The same app then failed to
open its ordinary video. The content was not malformed: its cached bytes
matched the original MP4, and AVFoundation decoded those exact bytes when
named `.mp4`. The extensionless native cache name failed with the same media
format error as the actual player. The diagnostic copies never entered the
app's playback path. This is another distinction a byte-only media test misses.

The setup retry before this run was my error: I checked an unsupported route
for backend readiness. It produced no native/once result and is preserved
separately. The real video failure is also preserved; it is not converted to
a pass by substituting a poster or changing the fixture. Native cache playback
needs a platform remedy before the remaining scenario can complete.

I also tightened terminal-state and distinct-ID predicates after the other
review family examined them. This is witness hardening, not evidence that the
SDK emits nonterminal callbacks. The new source delta remains separate from
the successful once observation and failed video attempt.


## 2026-09-23 — the actual native scenarios pass on the corrected candidates

SDK candidate 0.2.33 plus native Expo candidate 0.2.24 now pass all three
installed Release scenarios. CocoaPods had to regenerate the project for the
new Swift media-file helper; merely rebuilding the old project would not have
qualified that source. I retained the earlier Release, regenerated Pod lock,
exact package integrities and all failed attempts. Full TypeScript and normal
Release signing passed. The app's media code remains unchanged apart from
witness observations and controls; no application workaround masks the fixes.

The actual native video rendered its first frame from the canonical `.mp4`
cache file, then did so from fresh player mounts in both offline processes.
The ordinary image also loaded offline. The actual once image loaded while
its bytes remained absent from file storage and the media manifest. Positive
ordinary byte controls accompany the live checks, with independent fixture-
digest controls after the app stops. The recipient
had never uploaded or picked the once fixture, so unrelated source files
cannot confuse that result.

Both original pending messages survived process death with the same IDs.
Exactly two terminal sent events settled in order, then the other participant
advanced the same messages through delivered and read. A separate fresh-store
run learned leave, retained delivered text, purged media, reopened offline,
and explicitly reconnected online without receiving the later message.
Revision 4's stricter exact-pair and final settlement checks ran successfully;
the earlier weaker assertions and failures remain preserved.

The full final-schema fixture also passed the stronger offline audit: all
10,000 required IDs in 100 scopes, across 299 actual local query pages, before
reconnect. First real inbox layout took 20.417 seconds, acquired opener return
20.212 seconds, and cold offline open 115 ms. The ID audit itself took 7.616
seconds. The run observed 59.281 MB of JSON response bodies and sampled
421.003 MB maximum own-app RSS. This attempt was slower than earlier ones;
these single runs are not a controlled comparison, so the report retains each
measurement rather than selecting the best result.

The useful lesson is concrete: cache bytes, valid media and actual rendering
are different checks. Here the browser-style Blob API, host object-URL path
and native cache filename each failed at a different boundary. The existing
witness made those failures reproducible, but adapting its assertions to the
real application still required care about exact IDs, online state, live once
handles and rendered frames. The fixes belong in the SDK/native host so future
applications do not need the same workarounds.

Driver durations were 54.498 seconds for restart, 31.053 for revocation and
42.742 for acquisition; outer wrapper durations are recorded separately.
These are unpublished-candidate results, not final registry-pin proof. Final
public pins await publication and an affected rerun. Real provider delivery
still has no selected account/recipient. No Android, physical power-loss or
instant decoder-memory erasure claim follows. The original grade/score stays
frozen, and the owned simulator/backend are stopped while publication runs.
