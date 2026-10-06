#!/usr/bin/env python3
"""Explicit operator scratch proof, never a pilot builder or driver invocation.

Run on the mini: source ~/.snapback-env.sh; python3 scripts/toolchain_probe.py
Every app/tool command uses the unmodified generated builder profile and env.
No simulator boot, app install, backend start, or driver measurement is used.
"""
import shutil, sys, uuid
from common import *
import builder, derived_data, isolation

def remove_scratch(path):
    # Sealed helper copytree preserves read-only directories; chmod only this
    # disposable copy, never follow its node_modules links into sealed inputs.
    for parent, dirs, files in os.walk(path, followlinks=False):
        Path(parent).chmod(0o700)
    shutil.rmtree(path)

def main():
    host_check()
    lease = lock('authoring-or-operator.lock')
    name = 'native-probe-' + uuid.uuid4().hex[:10]
    lane = ROOT / 'lanes' / name; lane.mkdir()
    logs = ROOT / 'preparation/round2' / name; logs.mkdir(parents=True)
    boundaries = logs / 'boundaries.jsonl'; boundaries.touch()
    private, codex, temp, sandbox = isolation.prepare(name, boundaries)
    env = isolation.environment(boundaries, codex, temp)
    prefix = ['/usr/bin/sandbox-exec', '-f', str(sandbox)]
    state = None; success = False; cleanup = None; before_sim = None
    def step(label, argv, cwd=None, timeout=3600):
        print(label, flush=True)
        run(prefix + argv, cwd or lane, logs / (label + '.log'), env, timeout)
    try:
        state = derived_data.begin(private, logs)
        shutil.copyfile(sandbox, logs / 'builder.sb')
        put(logs / 'binding.json', {'profileSha256': sha(sandbox),
            'isolationSourceSha256': sha(ROOT / 'scripts/isolation.py'),
            'probeSourceSha256': sha(Path(__file__)), 'cwd': str(lane),
            'environment': {k: env[k] for k in ['CODEX_HOME', 'TMPDIR', 'CONVEX_AGENT_MODE',
                'CLIQUE_CONVEX_BACKEND', 'CLIQUE_BOUNDARIES', 'DEVELOPER_DIR', 'PATH']}})
        before_sim = subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', '--json'], text=True)
        put(logs / 'simulators-before.json', before_sim)
        files = {
            'package.json': json.dumps({'name': name, 'version': '1.0.0', 'private': True,
                'main': 'index.js', 'dependencies': {'expo': '57.0.22', 'react': '19.2.3',
                'react-native': '0.86.3', 'clique-native-observer': 'file:./helper'},
                'devDependencies': {'playwright': '1.62.1'}}),
            'app.json': json.dumps({'expo': {'name': 'SandboxProbe', 'slug': name,
                'ios': {'bundleIdentifier': 'dev.clique.sandboxprobe'}}}),
            'index.js': "import { registerRootComponent } from 'expo';\nimport App from './App';\nregisterRootComponent(App);\n",
            'App.js': "import React from 'react';\nimport {Text, View} from 'react-native';\nimport {useCommittedScreen} from 'clique-native-observer';\nexport default function App(){ useCommittedScreen('probe', null, []); return <View><Text>Sandbox native probe</Text></View>; }\n",
            '.gitignore': 'node_modules/\nios/\n.expo/\nFINAL.md\n',
        }
        step('01-create', ['/usr/bin/python3', '-c',
            'import json,sys,shutil; from pathlib import Path; '
            '[Path(k).write_text(v) for k,v in json.loads(sys.argv[1]).items()]; '
            'shutil.copytree(sys.argv[2], "helper")', json.dumps(files), str(ROOT / 'inputs/builder/native/helper')])
        step('02-deny', ['/usr/bin/python3', '-c', """import json,sys,os
from pathlib import Path
root=Path(sys.argv[1]); lane=Path.cwd()
denied=[root/'inputs/components/native-0.4.0-native.1/reference',
root/'inputs/components/native-0.4.0-native.1/driver', root/'lanes/snapback4',
root/'lanes/convex', root/'attempts', root/'scripts', root/'runtime/runner.json']
(lane/'escape').symlink_to(denied[0]); denied.append(lane/'escape')
for p in denied:
    try:
        if str(p).endswith('runner.json'): p.read_bytes()
        else: os.listdir(p)
    except PermissionError: continue
    raise AssertionError('sandbox exposed '+str(p))
(lane/'escape').unlink()
print(json.dumps({'denied':list(map(str,denied)), 'pass':True}))
""", str(ROOT)])
        step('03-npm-install', ['npm', 'install', '--no-audit', '--no-fund'])
        step('04-git-init', ['git', 'init'])
        step('05-git-add', ['git', 'add', '.'])
        step('06-git-commit', ['git', '-c', 'user.name=Sandbox Probe', '-c',
             'user.email=sandbox-probe@example.invalid', 'commit', '-m', 'Scratch native toolchain probe'])
        step('09-expo-prebuild', ['npx', 'expo', 'prebuild', '-p', 'ios'])
        step('10-pod-install', ['pod', 'install'], cwd=lane / 'ios')
        step('11-release-build', ['xcodebuild', '-workspace', 'SandboxProbe.xcworkspace',
            '-scheme', 'SandboxProbe', '-configuration', 'Release', '-sdk', 'iphonesimulator',
            '-destination', 'generic/platform=iOS Simulator', '-jobs', '6',
            'CODE_SIGNING_ALLOWED=NO', 'build'], cwd=lane / 'ios')
        products = list(derived_data.directory().glob('SandboxProbe-*/Build/Products/Release-iphonesimulator/SandboxProbe.app/SandboxProbe'))
        if len(products) != 1: raise RuntimeError('probe-release-product-count:' + str(products))
        put(logs / 'release.json', {'binary': str(products[0]), 'sha256': sha(products[0]),
            'bytes': products[0].stat().st_size, 'configuration': 'Release', 'sdk': 'iphonesimulator',
            'helper': inventory(lane / 'helper'), 'packageLockSha256': sha(lane / 'package-lock.json'),
            'podLockSha256': sha(lane / 'ios/Podfile.lock')})
        for path in ['package.json', 'package-lock.json', 'app.json', 'ios/Podfile', 'ios/Podfile.lock']:
            dst = logs / 'app-inputs' / path; dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(lane / path, dst)
        step('07-codex', [str(Path.home() / '.volta/bin/codex'), 'exec',
            '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', '--json',
            '--color', 'never', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort=low',
            '-c', 'features.multi_agent=false', '-C', str(lane),
            'Reply with exactly SANDBOX_MODEL_OK. Do not call tools or inspect files.'], timeout=180)
        events = [json.loads(line) for line in (logs / '07-codex.log').read_text().splitlines() if line.startswith('{')]
        thread = next(e['thread_id'] for e in events if e.get('type') == 'thread.started')
        native = builder.session_path(thread, codex)
        if not native: raise RuntimeError('probe-native-transcript-missing')
        shutil.copyfile(native, logs / 'native-rollout.jsonl')
        metered = builder.usage(logs / 'native-rollout.jsonl')
        if not metered['turns']: raise RuntimeError('probe-no-model-usage')
        put(logs / 'native-usage.json', metered)
        if not any(e.get('type') == 'turn.completed' for e in events): raise RuntimeError('probe-model-call-incomplete')
        browser = read(ROOT / 'metadata/browser.json')
        step('08-playwright', ['node', '--input-type=module', '-e', """
import {chromium} from 'playwright';
// Same launch form as the web choreography, exercising both its default and
// the recorded CHOREO_BROWSER_EXECUTABLE override. Neither opens a window.
for (const executablePath of [undefined, process.argv[1]]) {
  const browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
  try { const page = await browser.newPage(); await page.setContent('<h1>Sandbox browser OK</h1>');
    if (await page.locator('h1').textContent() !== 'Sandbox browser OK') throw Error('browser DOM failed');
    console.log(JSON.stringify({pass:true, version:browser.version(), executablePath:executablePath??'default', headless:true}));
  } finally {await browser.close();}
}
""", browser['executable']], timeout=120)
        success = True
    except BaseException as e:
        put(logs / 'failure.json', {'error': str(e), 'at': time.time()})
        raise
    finally:
        # run() stops each owned process group before it returns or raises.
        if state is not None: cleanup = derived_data.finish(state)
        if cleanup is not None:
            # Prove the next generated lane cannot read the moved products.
            if cleanup['created']:
                next_private = ROOT / 'runtime' / (name + '-next'); next_private.mkdir()
                next_profile = isolation.profile('convex', next_private, boundaries)
                next_sb = next_private / 'builder.sb'; next_sb.write_text(next_profile)
                result = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(next_sb), '/bin/ls',
                    str(Path(cleanup['destination']) / cleanup['created'][0])], capture_output=True, text=True)
                put(logs / 'next-lane-denial.json', {'exitCode': result.returncode, 'stderr': result.stderr,
                    'pass': result.returncode != 0 and 'Operation not permitted' in result.stderr})
                shutil.rmtree(next_private)
                if result.returncode == 0: raise RuntimeError('probe-next-lane-read-product')
            shutil.rmtree(cleanup['destination'])
        remove_scratch(lane)
        # Keep profile and raw evidence, remove credentials and disposable temp.
        shutil.rmtree(codex); shutil.rmtree(temp)
        after_sim = subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', '--json'], text=True)
        put(logs / 'simulators-after.json', after_sim)
        def booted(value):
            return sorted(d['udid'] for ds in json.loads(value)['devices'].values() for d in ds if d['state'] == 'Booted')
        same_boots = before_sim is not None and booted(before_sim) == booted(after_sim)
        put(logs / 'result.json', {'pass': success and same_boots and bool(cleanup and cleanup['complete']),
            'scratchLaneDeleted': not lane.exists(), 'scratchDerivedDataDeleted': bool(cleanup and not Path(cleanup['destination']).exists()),
            'privateCredentialsDeleted': not codex.exists(), 'simulatorBootsUnchanged': same_boots,
            'noSimulatorBootOrInstallCommand': True, 'noPilotBuilderOrDriver': True, 'at': time.time()})
        lease.close()
        print(str(logs), flush=True)

if __name__ == '__main__': main()
