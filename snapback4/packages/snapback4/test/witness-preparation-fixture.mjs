// Command-boundary doubles for preparation tests: the real prepare.mjs owns
// inventory, receipt, HBC, compatibility and failure decisions on both routes.
import fs from 'node:fs';
import path from 'node:path';
import child from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const root = process.env.NP_FIXTURE_ROOT, fault = process.env.NP_FIXTURE_FAULT;
Object.defineProperty(process, 'platform', { value: 'darwin' });
Object.defineProperty(process, 'arch', { value: 'arm64' });
const fixture = path.join(root, 'fixture.app');
child.spawnSync = (exe, args, options) => {
  let stdout = '';
  if (exe === '/usr/bin/plutil') stdout = fs.readFileSync(args.at(-1), 'utf8');
  else if (args[0] === '-e') stdout = JSON.stringify({ hash: 'fingerprint', sources: [] });
  else if (exe === 'xcodebuild') {
    if (args.includes('-version')) stdout = 'Xcode 27.0\nBuild version test';
    else if (args.includes('-list')) stdout = JSON.stringify({ workspace: { schemes: ['App'] } });
    else if (args.includes('-showBuildSettings')) stdout = JSON.stringify([{ target: 'App', buildSettings: {
      PRODUCT_TYPE: 'com.apple.product-type.application', TARGET_BUILD_DIR: root, FULL_PRODUCT_NAME: 'fixture.app' } }]);
    else fs.mkdirSync(args[args.indexOf('-resultBundlePath') + 1], { recursive: true });
  } else if (exe === 'xcrun') {
    stdout = args.includes('--show-sdk-version') ? '27.0' : args.includes('--show-sdk-build-version') ? 'test' : '{"runtimes":[]}';
  } else if (exe === 'pod') stdout = '1.17.0';
  else if (exe === '/usr/bin/rsync') {
    const src = args.at(-2), dest = args.at(-1);
    for (const name of fs.readdirSync(dest)) fs.rmSync(path.join(dest, name), { recursive: true, force: true });
    for (const name of fs.readdirSync(src).filter(n => n !== '.snapback4-witness')) fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true, verbatimSymlinks: true });
  } else if (exe === '/bin/cp') {
    fs.cpSync(args[1], args[2], { recursive: true });
    if (fault === 'build-hbc') corrupt(args[2]);
  } else if (exe.endsWith('/hermesc')) stdout = 'HBC bytecode version: 98';
  else if (args[1] === 'config') stdout = '{}';
  else if (args.includes('--source-app')) {
    const dest = args[args.indexOf('--output') + 1];
    fs.cpSync(args[args.indexOf('--source-app') + 1], dest, { recursive: true });
    const file = path.join(dest, 'main.jsbundle'), bytes = fs.readFileSync(file);
    bytes[40]++; fs.writeFileSync(file, bytes);
    if (fault === 'repack-hbc') corrupt(dest);
    fs.mkdirSync(path.join(args[args.indexOf('--working-directory') + 1], 'bundles/assets/assets'), { recursive: true });
  } else throw Error('unexpected fixture command ' + JSON.stringify([exe, args, options.cwd]));
  return { status: 0, stdout, stderr: '' };
};
function corrupt(app) {
  const file = path.join(app, 'main.jsbundle'), bytes = fs.readFileSync(file);
  bytes.writeUInt32LE(97, 8); fs.writeFileSync(file, bytes);
}
syncBuiltinESMExports();
