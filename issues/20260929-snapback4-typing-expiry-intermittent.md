# Intermittent failure: `useQuery expires 4.5 s typing rows aged 0 ms before mount on both clients`

Status: Open
Date: 2026-09-29
Systems: Snapback 4 client tests (`packages/snapback4/test/typing-expiry.test.mjs`)

Lane WK's landing suite (main `398552255d` plus WK, whose changes are to workers and the
dev/serve supervisor, not React or typing) failed once in `client tests`:

```text
✖ useQuery expires 4.5 s typing rows aged 0 ms before mount on both clients (5910.127916ms)
```

It passed 5 of 5 isolated reruns in the same landing tree (2 of 2 cases each). The suite
ran with other lanes and landing suites active on eb1000. A related earlier flake is
tracked in the `react-usenow-deadline` ticket.

Next: rerun it under CPU contention, and record the expiry timer and render timeline to
find the window. Do not weaken the assertion or turn the failure into a pass.
