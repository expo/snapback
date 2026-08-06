# Browser TUS uploads blocked by CORS on Expo web: allow-headers omits TUS headers

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 4
**Confidence:** 5
**Systems:** Assets, Server HTTP surface, Expo client
**Date:** 2026-08-06
**Related:** Diary 0065; `demos/rematch-bakeoff/snapback/build-log.md`
(loop 4); LLP 0044

## Problem

A browser client (Expo web) driving the typed upload flow fails at the
TUS `PATCH`: the server's `access-control-allow-headers` response omits
`upload-offset` and `tus-resumable`, so the preflight refuses. The paved
browser answer is the Vite dev relay, which an Expo-web app does not
have; the rematch bakeoff's cold agent wrote its own ~80-line CORS relay
to complete the brief.

## Fix shape

Add the TUS protocol headers to the dev/sessions CORS allow-list (the
server already enumerates a long allow-headers set — see the /llms.txt
response headers for the current list), or ship a first-party relay seam
for the Expo-web carrier. Acceptance: an Expo-web app completes
picker → `useSnapbackAssetUpload` → typed attach against a local dev
server with no app-authored proxy.
