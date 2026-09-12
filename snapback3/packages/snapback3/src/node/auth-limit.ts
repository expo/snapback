import { OwnerError } from "./worker.js";

/** The fixed owner budget also bounds retained account/IP metadata. Forwarded
 * headers are deliberately irrelevant: the HTTP owner supplies the peer IP. */
export class PasswordAttempts {
  private active = 0;
  private attempts: Array<{ at: number; peer: string; account: string }> = [];

  constructor(private readonly clock: () => number = Date.now) {}

  acquire(peer: string, email: string): () => void {
    const now = this.clock(), account = email.trim().toLowerCase();
    this.attempts = this.attempts.filter(attempt => attempt.at > now - 60_000);
    if (this.active >= 2) throw new OwnerError("S3_AUTH_RATE_LIMIT", "Two authentication attempts are already running. Try again shortly.");
    if (this.attempts.length >= 32
      || this.attempts.filter(attempt => attempt.peer === peer).length >= 16
      || this.attempts.filter(attempt => attempt.account === account).length >= 8) {
      throw new OwnerError("S3_AUTH_RATE_LIMIT", "Too many authentication attempts. Wait a minute and try again.");
    }
    this.attempts.push({ at: now, peer, account });
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}
