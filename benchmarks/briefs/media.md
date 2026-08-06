# Brief: media-heavy ("trip photo journal")

**Status:** authored 2026-08-06 for LLP 0186 W1's diversification
requirement ("add … one media-heavy brief so wins don't overfit to
chat"). No prior run; not yet calibrated. Scope is deliberately
comparable to `messaging.md`, with the weight shifted from realtime
coordination to the upload/processing/delivery pipeline the upload
bakeoffs and diary 0058's asset findings exercised.

## The brief

Build a shared trip photo journal as an Expo (Expo Router) client on the
lane's backend, with:

- **Entities:** trips, members, entries (a dated post belonging to a
  trip, with a caption and one or more photos), and per-photo metadata
  (caption, taken-at date, order within the entry).
- **Uploads from the device:** photos come from Expo ImagePicker (a
  native URI, not a browser File — diary 0059 hit exactly this
  URI-to-upload-body bridge). Uploads must show progress, survive
  app-level retry, and enforce a declared policy: JPEG/PNG only, a size
  ceiling (10 MB), and location-metadata (GPS/EXIF) stripping before
  delivery. If the platform cannot enforce a constraint server-side,
  implement it client-side and record the difference — client-side-only
  enforcement is a labeled caveat, not parity.
- **Renditions:** each photo needs a thumbnail and a display-size
  rendition; the gallery must render thumbnails, the detail view the
  display rendition, with originals reachable.
- **Atomicity:** an entry and its photo references become visible
  together. If the platform's flow allows an uploaded-but-unreferenced
  blob (the orphan window diary 0058 documented for the three-step URL
  flow), demonstrate the window and describe the cleanup story; if the
  platform closes it (typed attach / transactional reference),
  demonstrate that.
- **Gallery views:** a per-trip chronological gallery and a per-member
  "photos I posted" view, both server-shaped.
- **Deletion:** deleting an entry removes its photos from delivery;
  state what actually happens to the bytes.
- **Seeded data:** a versioned, idempotent seed with 2 trips, 4 members,
  8 entries, and at least 12 photos (seed bytes may be small generated
  images; at least one acceptance upload must use a real photo-sized
  file).
- **A fast test-persona switcher** for acting as different members
  (visibly labeled test seam; not production authentication).

Record the experience in a run diary.

## Acceptance shape

Per lane: a real byte-verified upload from the app path (not only an
operator/CLI path — the 0058/0059 runs showed those can differ sharply);
delivered thumbnail and display renditions fetched with correct content
types; EXIF/GPS absent from delivered bytes; the orphan-window
demonstration or its closure; galleries correct against the seed;
deletion's delivery effect proven.

## Notes for lane fairness

- Upload authority must be labeled like auth parity: whether the lane's
  uploads are anonymous, session-scoped, or brokered is recorded, and
  extra work a lane spends enforcing real ownership is scored under
  guarantees, not penalized as ceremony (see `../README.md` fairness
  rules; diary 0059's session-broker dilemma is the motivating case).
- No realtime or offline requirement; presence/live updates earn no
  credit here.
