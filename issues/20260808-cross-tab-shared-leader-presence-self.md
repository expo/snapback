# Cross-tab shared-leader connection makes presence read as "self"

**Filed:** 2026-08-08 (run-6 N≥3 series residue, round 4; diary 0072; record 2026-08-08-messaging-0115-n3.md)

Two browser tabs sharing one Chrome profile share a leader connection; ephemeral presence published by one tab is classified as self by the other, so typing indicators never render. Replicated by two independent lanes (A-skill, C-skill); one captured a WS trace showing `ephemeral_unsubscribe` refused `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` and a containment-minted connection with no WS attached. Workaround both lanes found: isolated browser contexts/instances (the honest two-device shape).

**Ask:** a guide/skill line naming the cross-tab leader behavior on the presence page, and consider a per-tab identity option or a clearer refusal.
