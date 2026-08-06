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

## Resolution (2026-08-06)

Fixed in `src/server.rs` `with_cors_headers`: the CORS header
inventories are now built once from the TUS header-name constants
(the `cors_allow_methods` anti-drift pattern, LLP 0031):

- `access-control-allow-headers` adds `tus-resumable`, `upload-offset`,
  `upload-length`, `upload-checksum` beside the existing
  content-type/authorization/dpop/x-snapback-* family. Deliberate
  omissions, documented in code: `upload-metadata` (attempt creation is
  a Snapback JSON route, not TUS creation — no route reads it) and
  `tus-version` (response-only).
- `access-control-expose-headers` adds everything
  `tus_response_headers` emits — `tus-resumable`, `tus-version`,
  `tus-extension`, `tus-checksum-algorithm`, `upload-offset`,
  `upload-length`, `upload-expires-ms`, `snapback-max-chunk-bytes` —
  so the JS client can read the acknowledged offset. `location` is
  deliberately absent: no TUS creation route exists and no handler
  emits it.

Origin admission is unchanged (loopback + leased console origins); no
security rationale for the omission was found — the list simply predated
the TUS lane (LLP 0044 amendment 2026-07-31). Server test
`tus_upload_cors_headers_cover_the_protocol` asserts the preflight
allow-list, the response expose-list, and the hostile-origin refusal.
`guide/backend/assets.md` §Browser apps now states the relay is a
Vite-loop convenience, not a CORS requirement, so Expo web needs no
app-authored proxy.

Stays open for closure at the next npm publish (0.1.11): fix is on main
pending release; npm consumers still see the old allow-list until then.
