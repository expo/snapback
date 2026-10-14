// @ref LLP 3000.021#3.3 — clean distribution consumers without privileges or namespaces
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { digest, run, sri } from "./publication-artifacts.mjs";
import { prootInput, prootDistributions } from "./linux-proof-inputs.mjs";

export const proofCache = () => join(homedir(), ".cache/snapback4-qualify");
export function fetchPinned(input, cache = proofCache(), download = (url, path) => run("curl", ["--fail", "--location", "--retry", "2", "--proto", "=https", "--proto-redir", "=https", "--output", path, url])) {
  if (!/^https:\/\//.test(input.url) || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error("invalid pinned proof input");
  mkdirSync(cache, { recursive: true });
  const path = join(cache, `${input.sha256}-${basename(new URL(input.url).pathname)}`);
  const verify = file => {
    if (digest(file) !== input.sha256) throw new Error(`SHA-256 mismatch for ${input.url}; refusing cached/downloaded proof input`);
  };
  if (existsSync(path)) { verify(path); return path; }
  const temporary = mkdtempSync(join(cache, ".download-"));
  try {
    const file = join(temporary, "input"); download(input.url, file); verify(file);
    renameSync(file, path); return path;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

// Do not use -R/-S: those aliases bind host HOME, /tmp, /proc and other paths.
// proot has no read-only bind flag. Bind disposable copies, never original
// artifacts or the cache; check their hashes again after the consumer exits.
export function prootCommand(root, scratch, inputs) {
  return ["-0", "-r", root, "--kill-on-exit", "-w", "/consumer",
    "-b", `${scratch}:/consumer`, "-b", `${inputs}:/proof`,
    ...["/dev/null", "/dev/urandom", "/dev/random"].flatMap(path => ["-b", path])];
}
export function prootEnvironment(temporary) {
  return { PATH: "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", HOME: "/root", LANG: "C.UTF-8",
    TMPDIR: "/tmp", PROOT_TMP_DIR: temporary, PROOT_NO_SECCOMP: "1",
    NPM_CONFIG_USERCONFIG: "/tmp/empty-user.npmrc", NPM_CONFIG_GLOBALCONFIG: "/tmp/empty-global.npmrc",
    NPM_CONFIG_CACHE: "/tmp/npm-cache", NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/" };
}
export function prootProof(client, platform, version, cache = proofCache(), fetchInput = fetchPinned, expo) {
  const proot = fetchInput(prootInput, cache); chmodSync(proot, 0o700);
  const proofs = [];
  for (const distribution of prootDistributions) {
    const started = Date.now(), work = mkdtempSync(join(cache, "consumer-"));
    try {
      const root = join(work, "root"), scratch = join(work, "scratch"), inputs = join(work, "inputs"), temporary = join(work, "tmp");
      for (const path of [root, scratch, inputs, temporary]) mkdirSync(path);
      run("tar", ["--extract", "--file", fetchInput(distribution.rootfs, cache), "--directory", root, "--no-same-owner"]);
      for (const path of ["root", "tmp", "dev", "consumer", "proof", "usr/local"]) mkdirSync(join(root, path), { recursive: true });
      // Copy only DNS configuration; no host NSS libraries, homes or credentials.
      rmSync(join(root, "etc/resolv.conf"), { force: true });
      writeFileSync(join(root, "etc/resolv.conf"), readFileSync("/etc/resolv.conf"));
      writeFileSync(join(root, "etc/hosts"), "127.0.0.1 localhost\n::1 localhost\n");
      for (const file of ["test-command-owner.mjs", "test-owned-command.mjs", "test-command-group.mjs"])
        copyFileSync(new URL(`./${file}`, import.meta.url), join(inputs, file));
      copyFileSync(expo, join(inputs, "expo.tgz"));
      copyFileSync(new URL("./publication-starters.mjs", import.meta.url), join(inputs, "starters.mjs"));
      copyFileSync(client, join(inputs, "client.tgz")); copyFileSync(platform, join(inputs, "platform.tgz"));
      copyFileSync(new URL("./publication-roundtrip.mjs", import.meta.url), join(inputs, "roundtrip.mjs"));
      for (const tool of distribution.tools.slice(1)) {
        const file = fetchInput(tool, cache);
        if (distribution.base === "alpine") copyFileSync(file, join(inputs, basename(new URL(tool.url).pathname)));
        else run("tar", ["--extract", "--file", file, "--directory", join(root, "usr/local"), "--strip-components=1", "--no-same-owner"]);
      }
      const invoke = script => run(proot, [...prootCommand(root, scratch, inputs), "/bin/sh", "-ec", script],
        { cwd: work, env: prootEnvironment(temporary), stdio: "inherit", timeout: 1_200_000 });
      if (distribution.base === "alpine") {
        writeFileSync(join(root, "etc/apk/repositories"), "");
        invoke("apk add --no-network --no-cache /proof/*.apk");
      }
      invoke(`test -z "\${SNAPBACK4_BIN+x}"; test "$(node -v)" = v${distribution.node};
        test ! -e /host-rootfs; test ! -e /home/${basename(homedir())};
        printf '{"private":true,"type":"module"}' > package.json;
        npm install --ignore-scripts --no-audit --no-fund /proof/client.tgz /proof/platform.tgz;
        cp /proof/roundtrip.mjs .; node roundtrip.mjs ${version}; node /proof/starters.mjs /proof/client.tgz /proof/platform.tgz /proof/expo.tgz --build-only`);
      if (sri(join(inputs, "client.tgz")) !== sri(client) || sri(join(inputs, "platform.tgz")) !== sri(platform) || sri(join(inputs, "expo.tgz")) !== sri(expo))
        throw new Error("proot consumer changed its staged artifact inputs");
      proofs.push({ ...distribution, route: "proot", runtime: "proot", status: "passed", elapsedMs: Date.now() - started,
        clientIntegrity: sri(client), platformIntegrity: sri(platform), expoIntegrity: sri(expo), starters: { web: "passed", expo: "passed", adapted: "passed", templates: "passed" } });
    } finally { rmSync(work, { recursive: true, force: true }); }
  }
  return proofs;
}
