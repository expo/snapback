#!/usr/bin/env python3
"""Executable design model, NOT wired into production G6 admission.

Uses request/response intervals, not midpoint clock-offset guesses. Observed
agreement is a tripwire, never a proof of the next grant's clock contract.
Run --test for deterministic skew/pause witnesses; --live samples an explicitly
supplied private PG connection. No clock on this host or PG is modified.
"""
# @ref LLP 3000.009.001.000.002#4.2 — a sampled clock witness cannot establish a future bound.
import argparse
from collections import deque
from dataclasses import dataclass
import json
import subprocess
import time
import unittest

NS = 1_000_000_000


@dataclass(frozen=True)
class Sample:
    boot_before: int
    boot_after: int
    mono_before: int
    mono_after: int
    database: int


class Witness:
    def __init__(self, rate_ppm=1000, jump_ns=250_000_000, lease_ns=3 * NS):
        assert 0 <= rate_ppm <= 1_000_000 and 0 <= jump_ns < lease_ns
        self.rate_ppm, self.jump_ns, self.lease_ns = rate_ppm, jump_ns, lease_ns
        self.window_ns = (lease_ns - jump_ns) * 1_000_000 // (1_000_000 + rate_ppm) - 1_000_000
        assert self.window_ns > 0
        self.samples = deque()
        self.failure = None
        self.qualified = False
        self.max_excess_lower_ns = 0

    def fail(self, reason):
        self.failure = reason
        self.qualified = False
        return False

    def observe(self, s):
        if self.failure:
            return False
        if not (0 <= s.boot_after - s.boot_before <= 50_000_000):
            return self.fail('sample RTT/clock unavailable')
        if s.mono_after < s.mono_before:
            return self.fail('monotonic moved backwards')
        # Local clock reads are not simultaneous; retain 1ms sampling slack.
        if abs((s.boot_after - s.boot_before) - (s.mono_after - s.mono_before)) > 1_000_000:
            return self.fail('suspend or local clock discontinuity inside sample')
        if self.samples:
            p = self.samples[-1]
            if s.boot_before < p.boot_after or s.database < p.database:
                return self.fail('clock moved backwards')
            if abs((s.boot_before - p.boot_after) - (s.mono_before - p.mono_after)) > 1_000_000:
                return self.fail('suspend or local clock discontinuity between samples')
            if s.boot_before - p.boot_after > 750_000_000:
                return self.fail('observation gap')
        # Keep a lease horizon PLUS one cadence, to retain the sample preceding
        # each grant's start. Comparing only adjacent renewals would reset J
        # every 500ms and miss accumulated small steps inside one grant.
        while self.samples and s.boot_before - self.samples[0].boot_after > self.lease_ns + 750_000_000:
            self.samples.popleft()
        for p in self.samples:
            longest = s.boot_after - p.boot_before
            database_delta = s.database - p.database
            rate_allowance = longest * (1_000_000 + self.rate_ppm) // 1_000_000
            excess = database_delta - rate_allowance
            self.max_excess_lower_ns = max(self.max_excess_lower_ns, excess)
            # 2us covers the database timestamp's microsecond quantization.
            if excess > self.jump_ns + 2_000:
                return self.fail('database rate/forward-step envelope exceeded')
        self.samples.append(s)
        self.qualified = len(self.samples) >= 7 and s.boot_before - self.samples[0].boot_after >= self.lease_ns
        return True

    def hit(self, boot, mono, deadline):
        if self.failure or not self.qualified:
            return False
        anchor = self.samples[-1]
        # At the actual hit, no asynchronous renewal/watchdog substitutes for
        # this check. A pause included equally by both clocks expires deadline.
        if abs((boot - anchor.boot_after) - (mono - anchor.mono_after)) > 1_000_000:
            return self.fail('suspend or local clock discontinuity at hit')
        return boot < deadline and boot - anchor.boot_after <= 750_000_000

    def renewal_deadline(self, sent, received, old_deadline):
        if self.failure or not self.qualified or received >= old_deadline:
            return None
        candidate = sent + self.window_ns
        return candidate if received < candidate else None


def sample(t, database=None, mono=None, rtt=1_000_000):
    return Sample(t, t + rtt, t if mono is None else mono,
                  (t if mono is None else mono) + rtt, t if database is None else database)


class Tests(unittest.TestCase):
    def qualified(self):
        w = Witness()
        for n in range(9):
            self.assertTrue(w.observe(sample(n * NS // 2)))
        self.assertTrue(w.qualified)
        return w

    def test_normal_and_conservative_window(self):
        w = self.qualified()
        self.assertEqual(w.window_ns, 2_746_252_747)
        self.assertTrue(w.hit(4 * NS + 2_000_000, 4 * NS + 2_000_000, 6 * NS))

    def test_forward_step_sticky(self):
        w = self.qualified()
        self.assertFalse(w.observe(sample(4_500_000_000, database=5 * NS)))
        self.assertFalse(w.observe(sample(5 * NS)))

    def test_rate_accumulates_across_renewals(self):
        w = Witness()
        verdicts = [w.observe(sample(n * NS // 2, database=n * 550_000_000)) for n in range(9)]
        self.assertIn(False, verdicts)  # 10% rate excess, not just a jump.

    def test_small_jumps_share_one_budget(self):
        w = Witness()
        self.assertTrue(w.observe(sample(0)))
        self.assertTrue(w.observe(sample(500_000_000, database=600_000_000)))
        self.assertTrue(w.observe(sample(NS, database=1_200_000_000)))
        self.assertFalse(w.observe(sample(1_500_000_000, database=1_800_000_000)))

    def test_suspend_at_hit(self):
        w = self.qualified()
        self.assertFalse(w.hit(4_100_000_000, 4_010_000_000, 6 * NS))
        self.assertIn('suspend', w.failure)

    def test_pause_ages_both_clocks(self):
        w = self.qualified()
        self.assertFalse(w.hit(9 * NS, 9 * NS, 6 * NS))
        self.assertFalse(w.observe(sample(9 * NS)))

    def test_renewal_never_resurrects_old_epoch(self):
        w = self.qualified()
        self.assertIsNone(w.renewal_deadline(5 * NS, 6 * NS, 6 * NS))
        self.assertIsNotNone(w.renewal_deadline(5 * NS, 5 * NS + 1, 6 * NS))

    def test_high_rtt_and_backward_step(self):
        w = self.qualified()
        self.assertFalse(w.observe(sample(4_500_000_000, rtt=51_000_000)))
        w = self.qualified()
        self.assertFalse(w.observe(sample(4_500_000_000, database=3 * NS)))

    def test_interval_not_midpoint_rejects_no_legal_trace(self):
        w = Witness()
        for n in range(9):
            # Timestamp at either edge of a variable 40ms RTT remains legal.
            t = n * NS // 2
            self.assertTrue(w.observe(sample(t, database=t + (40_000_000 if n % 2 else 0), rtt=40_000_000)))

    def test_an_intra_interval_violation_is_unobservable(self):
        w = self.qualified()
        # DB may jump +4s at local 4.1s (expiring the grant), a successor may
        # commit revocation, and DB may step back before the 4.5s sample. Both
        # endpoints match a normal trace. No sampler can distinguish the two.
        self.assertTrue(w.hit(4_150_000_000, 4_150_000_000, 6 * NS))
        self.assertTrue(w.observe(sample(4_500_000_000)))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--test', action='store_true')
    ap.add_argument('--live', action='store_true')
    ap.add_argument('--psql')
    ap.add_argument('--connection')
    args = ap.parse_args()
    if args.test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(Tests)
        result = unittest.TextTestRunner(verbosity=2).run(suite)
        raise SystemExit(not result.wasSuccessful())
    if args.live:
        w, rtts = Witness(), []
        for _ in range(17):
            b0 = time.clock_gettime_ns(time.CLOCK_BOOTTIME)
            m0 = time.monotonic_ns()
            r = subprocess.run([args.psql, args.connection, '-XAt', '-v', 'ON_ERROR_STOP=1', '-c',
                                'SELECT floor(extract(epoch FROM clock_timestamp())*1000000)::bigint'],
                               capture_output=True, text=True, check=True, timeout=1)
            m1 = time.monotonic_ns()
            b1 = time.clock_gettime_ns(time.CLOCK_BOOTTIME)
            rtts.append((b1 - b0) / 1e6)
            if not w.observe(Sample(b0, b1, m0, m1, int(r.stdout.strip()) * 1000)):
                break
            time.sleep(.5)
        print(json.dumps({'samples': len(rtts), 'qualified': w.qualified,
                          'failure': w.failure, 'rtt_ms_min_max': [min(rtts), max(rtts)],
                          'max_excess_lower_ms': w.max_excess_lower_ns / 1e6}))
        raise SystemExit(bool(w.failure) or not w.qualified)


if __name__ == '__main__':
    main()
