"""Sealed operator toolchain input and the environment actually used for audits/builds."""
from common import *

# These are operator choices, not builder-selected binary/source substitutions.
BUILD_OVERRIDES = ('ENTRY_FILE', 'CLI_PATH', 'BUNDLE_COMMAND', 'SKIP_BUNDLING',
                   'NODE_BINARY', 'BUNDLE_FILE', 'PROJECT_ROOT', 'REACT_NATIVE_PATH')

def sealed_environment(root=ROOT, home=None):
    home = Path.home() if home is None else Path(home)
    receipt = read(root / 'metadata/operator-environment.json')
    source = root / 'metadata/operator-environment.sh'
    live = home / '.snapback-env.sh'
    if source.is_symlink() or sha(source) != receipt['sha256'] or sha(live) != receipt['sha256']:
        raise RuntimeError('operator-environment-seal-drift')
    return {**receipt, 'exactContents': source.read_text(), 'verifiedAt': time.time(),
            'livePath': str(live), 'sealedPath': str(source)}

def clean_environment():
    env = os.environ.copy()
    for key in list(env):
        if key.startswith(('CONVEX_', 'SNAPBACK_', 'SNAPBACK4_', 'EXPO_PUBLIC_', 'VITE_')) or key in BUILD_OVERRIDES:
            env.pop(key)
    return env

def execution_environment(backend):
    from xcode_environment import pinned_environment
    env = pinned_environment(clean_environment())
    env.update(CLIQUE_NATIVE_ORIGIN='http://127.0.0.1:' + str(PORTS[backend][0]),
        CLIQUE_NATIVE_WEB_ORIGIN='http://127.0.0.1:' + str(PORTS[backend][0] + 2),
        CLIQUE_NATIVE_BUNDLE_ID='dev.clique.pilot.' + backend,
        CLIQUE_CONVEX_BACKEND=str(ROOT / 'inputs/convex/convex-local-backend'),
        CLIQUE_PLAYWRIGHT_PACKAGE=str(ROOT / 'runtime/node/package.json'))
    personas = read(WEB / 'fixtures/social-messenger/personas.json')['starter']
    for name in ['alice', 'bob']:
        person = next(x for x in personas if x['id'] == name)
        env['CLIQUE_' + name.upper() + '_EMAIL'] = person['email']
        env['CLIQUE_' + name.upper() + '_PASSWORD'] = person['password']
    return env

def audit_inputs(env):
    source = sealed_environment()
    keys = ['VOLTA_HOME', 'DEVELOPER_DIR', 'PATH', 'CARGO_INCREMENTAL',
            'CARGO_PROFILE_DEV_DEBUG', 'CARGO_PROFILE_TEST_DEBUG', 'SNAPBACK4_BIN',
            'CLIQUE_NATIVE_ORIGIN', 'CLIQUE_NATIVE_WEB_ORIGIN', 'CLIQUE_NATIVE_BUNDLE_ID',
            'CLIQUE_CONVEX_BACKEND', *BUILD_OVERRIDES]
    return {'source': source, 'fixedEnvironment': {key: env.get(key) for key in keys},
            'nullMeans': 'unset by operator', 'authority': 'P2A Round 4 lead ruling',
            'policy': 'Sourcing ~/.snapback-env.sh is mandated and admissible. Operator variables are fixed by the operator, not chosen by the builder. Still flag builder-authored substitutions.'}
