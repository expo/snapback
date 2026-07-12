#!/usr/bin/env node

// @ref LLP 0041#demo-dependency-policy — root proof tooling has one package
// authority while self-contained consumer surfaces keep their scoped locks.
// Root dependency resolution has one authority: bun.lock. Keep npm/yarn/pnpm
// from silently creating a second graph beside it. Subprojects with their own
// locks are intentionally outside this root-workspace guard.

export function isBunInstaller({ userAgent = '', execPath = '' } = {}) {
  return userAgent.startsWith('bun/') || /(?:^|[/\\])bun(?:\.exe)?$/i.test(execPath);
}

if (!isBunInstaller({
  userAgent: process.env.npm_config_user_agent ?? '',
  execPath: process.env.npm_execpath ?? '',
})) {
  process.stderr.write(
    'SNAPBACK_PACKAGE_MANAGER_UNSUPPORTED: the repository root uses bun.lock only; ' +
    'run `bun install --frozen-lockfile` with the packageManager version from package.json.\n',
  );
  process.exit(1);
}
