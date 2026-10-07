"""Inherited macOS file sandbox; one private Codex home and temp tree per lane."""
import shutil
from common import *
from derived_data import directory as derived_directory, SHARED_CACHES

def profile(backend, private, boundaries):
    lane = ROOT / 'lanes' / backend; home = Path.home()
    def rule(action, ops, kind, path): return '(' + action + ' ' + ops + ' (' + kind + ' ' + json.dumps(str(path)) + '))'
    lines = ['(version 1)', '(allow default)']
    # Closed home and scratch, with explicit tool/cache/authoring exceptions.
    for p in [home, ROOT, Path('/tmp'), Path('/private/tmp'), Path('/var/tmp'), Path('/private/var/tmp')]:
        lines.append(rule('deny', 'file-read* file-write*', 'subpath', p))
    # Node resolves symlinks by stat-ing each parent. Metadata permits traversal,
    # not directory listings or reading any denied benchmark file.
    lines.append('(allow file-read-metadata)')
    for p in [home / '.volta', home / '.rustup', home / '.cargo', home / '.bun',
              home / 'Library/Caches', home / '.npm', home / '.cache',
              home / '.config', home / 'Library/Preferences', home / 'Library/Developer']:
        lines.append(rule('allow', 'file-read*', 'subpath', p))
    lines.append(rule('allow', 'file-read*', 'literal', home / '.gitconfig'))
    for p in [home / '.npm', home / '.cache', home / 'Library/Caches', lane, private,
              home / '.cocoapods', home / '.expo', home / '.convex', derived_directory()]:
        lines.append(rule('allow', 'file-read* file-write*', 'subpath', p))
    for p in [ROOT / 'inputs/builder', ROOT / 'inputs/convex']:
        lines.append(rule('allow', 'file-read*', 'subpath', p))
    lines.append(rule('allow', 'file-read*', 'literal', home / '.snapback-env.sh'))
    lines.append(rule('allow', 'file-write*', 'literal', boundaries))
    # Developer contains previously built apps and simulator containers. Tool
    # metadata remains readable; old project products and app data do not.
    protected = [home / 'Library/Developer/Xcode/Archives']
    dd = derived_directory()
    if dd.exists(): protected.extend(p for p in dd.iterdir() if p.name not in SHARED_CACHES)
    devices = home / 'Library/Developer/CoreSimulator/Devices'
    if devices.exists(): protected.extend(devices.glob('*/data'))
    for p in protected:
        lines.append(rule('deny', 'file-read* file-write*', 'subpath', p))
    return '\n'.join(lines) + '\n'

def environment(boundaries, codex_home, temp):
    from xcode_environment import pinned_environment
    env = pinned_environment(os.environ)
    for k in list(env):
        if k.startswith(('SNAPBACK_', 'SNAPBACK4_', 'CONVEX_')) or k in ['CI', 'EXPO_PUBLIC_SNAPBACK_URL', 'VITE_SNAPBACK_URL']:
            env.pop(k)
    env.update(CLIQUE_BOUNDARIES=str(boundaries), CONVEX_AGENT_MODE='anonymous',
               CLIQUE_CONVEX_BACKEND=str(ROOT / 'inputs/convex/convex-local-backend'),
               CODEX_HOME=str(codex_home), TMPDIR=str(temp),
               ZDOTDIR=str(Path(codex_home).parent / 'shell'))
    return env

def prepare(backend, boundaries):
    private = ROOT / 'runtime' / ('builder-' + backend); private.mkdir(mode=0o700)
    codex_home = private / 'codex'; codex_home.mkdir(mode=0o700)
    # Credentials stay in private runtime, outside source, seal, logs and reports.
    for name in ['auth.json', 'config.toml']:
        src = Path.home() / '.codex' / name
        if src.exists(): shutil.copyfile(src, codex_home / name); (codex_home / name).chmod(0o600)
    tmp = private / 'tmp'; tmp.mkdir()
    from xcode_environment import shell_startup
    shell = private / 'shell'; shell.mkdir()
    for name in ('.zshenv', '.zprofile'):
        put(shell / name, shell_startup())
    sandbox = private / 'builder.sb'; put(sandbox, profile(backend, private, boundaries))
    return private, codex_home, tmp, sandbox
