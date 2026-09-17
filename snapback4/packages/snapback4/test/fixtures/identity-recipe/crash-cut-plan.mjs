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

export function selectMintStepDoneCut({ getInvocation, mode, phase, path, selected }) {
  if (mode !== "after-step" || phase !== "await-step-done" || selected === true
    || !/^\/actions\/[^/]+\/steps\/oidc\.mint\/done$/.test(path ?? "")) return null;
  const invocation = getInvocation();
  return path === `/actions/${encodeURIComponent(invocation)}/steps/oidc.mint/done` ? invocation : null;
}

export function requireMintStepDurableObservation({ invocation, observation, expected }, require) {
  require(observation?.requestId === invocation, "cut-mint-durable-invocation");
  require(observation.stepInvocation != null && observation.stepName === "oidc.mint",
    "cut-mint-durable-step-missing");
  require(observation.stepInvocation === invocation, "cut-mint-durable-invocation");
  require(observation.stepState === "done", "cut-mint-durable-step-not-done");
  require(observation.stepResult?.minted === true
    && observation.stepResult.principal === expected?.principal
    && observation.stepResult.kind === expected?.kind
    && observation.stepResult.expiresAt === expected?.expiresAt,
  "cut-mint-durable-step-result");
  require(observation.requestName === "completeOidc" && observation.requestState === "running"
    && observation.requestResult === null && observation.requestSettledAt === null,
  "cut-mint-request-settled");
}

export function requireCrashCutWorkers({ firstKilledPid, recoveredMintPid, donePid, finalMintPid }, require) {
  require(Number.isInteger(firstKilledPid) && Number.isInteger(recoveredMintPid)
    && Number.isInteger(donePid) && Number.isInteger(finalMintPid), "cut-worker-pid-missing");
  require(recoveredMintPid !== firstKilledPid && donePid === recoveredMintPid,
    "cut-recovered-worker-binding");
  require(finalMintPid !== firstKilledPid && finalMintPid !== recoveredMintPid,
    "cut-final-worker-distinct");
}

export function appendCrashCutObservation(observations, mode, cleanupComplete, require) {
  require(cleanupComplete === true, "cut-observation-before-cleanup");
  observations.push(mode === "before-mint" ? "before-mint-commit-process-crash-first-binding"
    : "after-mint-step-done-process-crash-third-worker-recovery");
}
