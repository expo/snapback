# LLP 0297 super-refine run journal

Orchestrator: Claude Fable 5 (xhigh), this run's reviser — never a reviewer.
Review families per the current LLP 0010 §2 instantiation (2026-08-20):
codex `gpt-5.6-sol` @ ultra (read-only sandbox) and `grok-4.6` @ xhigh
(headless, full terminal ban in the prompt). Round budget: 3 (default).
Growth budget: ~20% net over the entering revision (479 lines).

Authorization: Charlie Cheever (document author; human with
repository-disclosure authority) invoked `/llp-super-refine` on LLP 0297 in a
live session on 2026-08-24 and separately confirmed the stress-test framing
below. That is document authority (review + revision) and external-send
authority both. Status transition applied at loop start: Draft → Review (the
one authorized transition). Convergence produces a recommendation only;
acceptance is the author's.

Author framing for this run (recorded verbatim in intent): the author is
explicitly unsure that the preliminary recommendation (Option C: split
canonicalization budgets by semantic class) is the right direction. Reviewers
must genuinely stress-test Option C against Options A, B, D, and unconsidered
alternatives; the Confidence section's "High" ratings are themselves under
review, not given; reviewers must flag if Findings 1–5 underdetermine the
recommendation. Rubber-stamping the existing conclusion is a review failure.

Scope-freeze note: the target is `Type: Research`. The LLP 0010 §2 scope-freeze
default applies automatically to `Type: Spec` only; no freeze is applied here
without author authorization. If freezing would plausibly help convergence,
that judgment is surfaced to the author, not decided by the orchestrator.

Blindness: structural — reviewers run with cwd set to a capsule directory
containing only the target and context documents; no `llp/reviews/0297*`
material, run journal, or orchestrator notes are present in the capsule.
Reviews are sealed from each other until both land.
