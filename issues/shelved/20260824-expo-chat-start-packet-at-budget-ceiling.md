# The expo-chat first-read packet is at its LLP 0259 budget ceiling

Status: open
Filed: 2026-08-24
Area: guide/start, packages/snapback-cli/templates/expo-chat

## Symptom

`guide/start/expo-chat.md` cannot absorb any new posture bullet. Adding three
lines takes the deduped steering aggregate to 16,616 bytes against the 16,384
(16 KiB) `maxBytes`; the eight-line version reached 16,935. The baseline is
therefore within ~230 bytes of the ceiling.

Encountered while landing the LLP 0151 shared development provider profile: the
template's posture list is the natural home for "this template declares no
identity providers, and `snapback auth enable` adds them", and there is no room
for it. The line went on `guide/auth/native-apps.md` instead.

## Why this matters

The budget is deliberate (LLP 0259): the start packet is an orientation
surface, not a reference. But a packet at 98.6% of its ceiling means every
future capability that touches this template either displaces existing text or
silently goes unmentioned in the first read. Neither is decided by the person
landing the capability; both should be.

## Next action

Either measure and reclaim room in the existing posture bullets — several
carry rationale that could move to the pages they already link — or record a
deliberate ruling that the expo-chat packet is closed to additions and new
capabilities point at deeper pages by design. A one-notch budget raise is the
option LLP 0259 most obviously did not intend.
