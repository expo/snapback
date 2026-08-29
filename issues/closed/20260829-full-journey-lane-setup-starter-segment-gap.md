# Full-journey lane setup invented absent starter segments

Status: Closed
Opened: 2026-08-29
Closed: 2026-08-29
Systems: benchmarks, social-messenger, lane-setup

## Problem

`benchmarks/tools/lane-setup.mjs` rendered one `starter-mN.log` link for every
requested milestone. The canonical Clique fixture pack intentionally commits
starter segments only for M1-M3, while the full continuous journey is
M1-M6 followed by M8. Asking lane setup for the full journey therefore failed
on the nonexistent `starter-m4.log` before it could create a lane packet.

This gap was first disclosed by the 2026-08-22 local-main Sonnet 5 diagnostic
run and reproduced by LLP 0317 Wave 5 before any replacement cell was admitted.

## Resolution

Lane setup now links only committed starter segments and says explicitly that
later requested milestones continue from M3 state and exercise product actions
through the application write path per the brief. A regression test generates
the complete M1-M6/M8 packet, checks every assertion row, and proves that it
does not invent a `starter-m4.log` link.
