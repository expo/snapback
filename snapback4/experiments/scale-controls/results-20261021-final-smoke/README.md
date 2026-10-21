# Final lifecycle smoke

W1 at 100 requests/s, one 0.4 s measured window after 0.1 s warm-up: passes with zero errors. Verifies the final PID-bound readiness and descriptor-limit code. No capacity claim. All recorded processes/forwards stopped; cluster retained. See the main Raw PG report for matrix caveats.
