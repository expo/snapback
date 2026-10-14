// @ref LLP 3000.011.003.000.000#4 — a live keeper pins its own private group and kills that group on parent EOF.
// The frontend host is the group leader. This keeper remains alive even if
// that host is killed; EOF is kernel custody, not a cached parent PID check.
process.stdin.resume();
process.stdin.once("end", () => process.kill(0, "SIGKILL"));
process.stdin.once("error", () => process.kill(0, "SIGKILL"));
process.send?.("ready");
