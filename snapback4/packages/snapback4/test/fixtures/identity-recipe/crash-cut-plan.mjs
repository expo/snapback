export function requireInitialMintCut({ invocation, phase, path, binding }, require) {
  require(phase === "initial" && path === "/auth/session" && binding?.invocationId === invocation
    && binding?.intent === "identity-session/v1" && binding.replaceLostDelivery !== true, "cut-initial-mint-request");
}

export function requireMintStepDoneCut({ invocation, phase, path, upstreamOk, reply }, require) {
  require(phase === "await-step-done" && path === `/actions/${encodeURIComponent(invocation)}/steps/oidc.mint/done`,
    "cut-mint-step-path");
  require(upstreamOk === true && reply?.ok === true && reply.step?.state === "done"
    && reply.step?.result?.minted === true, "cut-mint-step-receipt");
}

export function appendCrashCutObservation(observations, mode, cleanupComplete, require) {
  require(cleanupComplete === true, "cut-observation-before-cleanup");
  observations.push(mode === "before-mint" ? "before-mint-commit-process-crash-first-binding"
    : "after-mint-step-done-process-crash-third-worker-recovery");
}
