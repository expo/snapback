"""Operator-owned Node pin; retain generated Xcode environment before replacement."""
import base64, shlex
from common import *

def node_path(home=None):
    return (Path.home() if home is None else Path(home)) / '.volta/tools/image/node/24.18.0/bin/node'

def pinned_environment(env, home=None):
    env = env.copy(); node = node_path(home)
    env['PATH'] = str(node.parent) + os.pathsep + env.get('PATH', '')
    env['NODE_BINARY'] = str(node)
    return env

def shell_startup(home=None):
    # zprofile runs after macOS /etc/zprofile's path_helper; zshenv covers -c.
    return 'export PATH=' + shlex.quote(str(node_path(home).parent)) + ':"$PATH"\n'

def normalize(work, receipt, env):
    # @ref LLP 0201.000#4 — machine-generated local Xcode env is operator setup.
    work = Path(work).resolve(); ios = work / 'ios'
    node = node_path()
    version = subprocess.check_output([str(node), '--version'], env=env, text=True).strip()
    if version != 'v24.18.0': raise HarnessDefect('operator-node-pin-drift:' + version)
    before = {'exists': False}
    if ios.exists():
        if ios.is_symlink() or not ios.is_dir(): raise HarnessDefect('operator-ios-directory-required')
        path = ios / '.xcode.env.local'
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise HarnessDefect('operator-xcode-env-regular-file-required')
        if path.exists():
            data = path.read_bytes()
            before = {'exists': True, 'sha256': sha(path), 'contentBase64': base64.b64encode(data).decode(),
                      'content': data.decode('utf-8', errors='replace'), 'mode': stat.S_IMODE(path.stat().st_mode)}
    content = 'export NODE_BINARY=' + shlex.quote(str(node)) + '\n'
    # Record original bytes durably BEFORE touching the work copy. Never source them.
    put(receipt, {'path': 'ios/.xcode.env.local', 'work': str(work), 'before': before,
        'afterContent': content if ios.exists() else None, 'node': str(node), 'nodeVersion': version,
        'nodeSha256': sha(node), 'at': time.time(), 'operatorRegenerated': True,
        'scope': 'work copy only; custody and authored .xcode.env unchanged'})
    if ios.exists():
        if path.exists(): path.unlink()
        with path.open('x') as out: out.write(content)
        path.chmod(0o644)
    return read(receipt)
