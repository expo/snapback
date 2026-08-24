export const R2_EXECUTION_ENVIRONMENT_VERSION = "snapback.r2-execution-environment.v1";

export const R2_FORBIDDEN_NODE_ENVIRONMENT_VARIABLES = Object.freeze([
  "DYLD_FALLBACK_FRAMEWORK_PATH",
  "DYLD_FALLBACK_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_COMPILE_CACHE",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_PRESERVE_SYMLINKS",
  "NODE_REPL_EXTERNAL_MODULE",
]);

export function registeredR2ExecutionEnvironmentPolicy() {
  return {
    version: R2_EXECUTION_ENVIRONMENT_VERSION,
    inheritedNodeLoaderHooks: "forbidden-and-absent",
    forbiddenVariables: [...R2_FORBIDDEN_NODE_ENVIRONMENT_VARIABLES],
    nativeHarnessEnvironment: "scrub-forbidden-variables",
  };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateR2ExecutionEnvironmentPolicy(policy) {
  const expected = registeredR2ExecutionEnvironmentPolicy();
  if (!sameJson(policy, expected)) {
    throw new Error(
      "R2_EXECUTION_ENVIRONMENT: harness config lacks the exact no-loader/preload environment policy",
    );
  }
  return expected;
}

export function assertR2ExecutionEnvironment({ harnessConfig = null, environment = process.env } = {}) {
  const policy = harnessConfig === null
    ? registeredR2ExecutionEnvironmentPolicy()
    : validateR2ExecutionEnvironmentPolicy(harnessConfig.execution?.environment);
  const present = policy.forbiddenVariables.filter((name) => Object.hasOwn(environment, name));
  if (present.length > 0) {
    throw new Error(
      `R2_EXECUTION_ENVIRONMENT: forbidden Node loader/preload environment is present (${present.join(", ")})`,
    );
  }
  return policy;
}

export function scrubR2NodeLoaderEnvironment(environment = process.env) {
  const scrubbed = { ...environment };
  for (const name of R2_FORBIDDEN_NODE_ENVIRONMENT_VARIABLES) delete scrubbed[name];
  return scrubbed;
}
