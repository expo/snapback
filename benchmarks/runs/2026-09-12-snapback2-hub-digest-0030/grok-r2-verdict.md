I'll review the candidate from fixed Git objects only: start with the seven-file ordering delta, then check the unread-sequence repair against the prior same-timestamp rejection and the cumulative digest contract.The ordering delta is seven files as expected. Next I’ll read the repaired recipe, schema, and tests at the candidate SHA rather than relying on the truncated diff.## Verdict

**NO MATERIAL FINDING REMAINS** for `05b71a418158693b400e1bf5bb0d62c94713bb98`.

The prior same-millisecond failure is actually gone in this copy. `send` assigns `sequence = messageCount + 1`, writes that high-water on the conversation, then stores the same immutable value on the message and each `periodUnread` row (`messages.q` 41–57). `remove` / `expireDigestMessage` never touch the counter. `markRead` stores the current seat id plus that counter (`messages.q` 70–77). Digest unread is `mark.membershipId = contribution.membershipId and mark.readThrough >= contribution.sequence` (`digest.q` 66–68), with no `readAt`/`sentAt` cutoff.

Committed **markRead then send** at one millisecond therefore stays unread (`readThrough = N`, later `sequence = N+1`). Committed **send then markRead** stays read (`readThrough >= sequence`). Rejoin keeps the old mark on the deleted seat and binds new fanout to the new membership id, so the old cutoff cannot apply.

The focused test uses real `send`/`markRead`/`leave`, then `tieReadClock` only copies `readAt` (sequences asserted unchanged), both orders, and a leave/rejoin incarnation. Expected `1/499/99/98` still matches the live deltas: 900 expiries + late `chat-0000` leave + `chat-0999` leave drop the seed; `chat-0998` contributes two unreads; `chat-0997` and `chat-0996` replace their seed rows one-for-one.

Cumulative exactness is intact: 500-follow final recount, `>500` fence fallback, append-only revision cells, earliest-expiry retry, unique digest/log/effect, zero-activity silence, later-period isolation, ordinary author delete after leave, expiry helper still refuses a non-due deadline. Author cost JSON (not my run) shows the same final chunk **1515 / 31461 / 3221762 / 3446773 / writes 509**; only the unread chunk moved (**15832 / 506624**), as expected from the extra fields.

[
  {
    "type": "end",
    "stopReason": "end_turn",
    "sessionId": "01a09478-e179-7a23-8ec7-16509e50f788",
    "requestId": "fb5f13cf-cf8f-4738-b887-f345b097e321",
    "usage": {
      "input_tokens": 171035,
      "cache_read_input_tokens": 896384,
      "cache_creation_input_tokens": 0,
      "output_tokens": 30209,
      "reasoning_tokens": 25036,
      "total_tokens": 1097628
    },
    "num_turns": 16,
    "total_cost_usd": 0.33031544,
    "total_cost_usd_ticks": 3303154400,
    "modelUsage": {
      "grok-4.6-build": {
        "inputTokens": 171035,
        "outputTokens": 30209,
        "cacheReadInputTokens": 896384,
        "cacheCreationInputTokens": 0,
        "modelCalls": 16,
        "costUSD": 0.33031544
      }
    }
  }
]
