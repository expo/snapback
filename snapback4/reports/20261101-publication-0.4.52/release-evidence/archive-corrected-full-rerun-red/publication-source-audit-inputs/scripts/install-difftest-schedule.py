#!/usr/bin/env python3
"""Install a daily Quarry campaign on macOS launchd or a Linux user timer."""
import argparse
import os
from pathlib import Path
import platform
import plistlib
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkout', type=Path, required=True, help='existing clean dedicated clone, fast-forwardable to origin/main')
    parser.add_argument('--state-dir', type=Path, default=Path.home() / '.snapback-quarry-difftest')
    parser.add_argument('--interval', type=int, default=86400)
    parser.add_argument('--workers', type=int, default=min(8, os.cpu_count() or 1))
    parser.add_argument('--render-only', type=Path, help='write service files here without installing or invoking any service manager')
    parser.add_argument('--platform', choices=['Darwin', 'Linux'], default=platform.system())
    args = parser.parse_args()
    if args.interval < 3600 or not 1 <= args.workers <= 64:
        parser.error('interval must be at least 3600 seconds; workers in 1..64')
    checkout, state = args.checkout.resolve(), args.state_dir.resolve()
    if checkout == state or checkout in state.parents:
        parser.error('state must be outside the checkout')
    if not args.render_only:
        if not (checkout / '.git').is_dir():
            parser.error('checkout must be an existing independent clone')
        if subprocess.check_output(['git', '-C', str(checkout), 'status', '--porcelain']).strip():
            parser.error('dedicated checkout is dirty')
    script = checkout / 'snapback4/scripts/difftest-scheduled.sh'
    command = ['/bin/bash', str(script), '--checkout', str(checkout), '--state-dir', str(state), '--workers', str(args.workers)]
    environment_path = os.environ.get('PATH', '')
    label = 'com.snapback.quarry-difftest'
    if args.platform == 'Darwin':
        directory = args.render_only or Path.home() / 'Library/LaunchAgents'
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f'{label}.plist'
        log = state / 'scheduled.log'
        value = {'Label': label, 'ProgramArguments': command, 'StartInterval': args.interval,
                 'RunAtLoad': False, 'EnvironmentVariables': {'PATH': environment_path},
                 'StandardOutPath': str(log), 'StandardErrorPath': str(log),
                 'ProcessType': 'Background'}
        path.write_bytes(plistlib.dumps(value))
        if not args.render_only:
            state.mkdir(parents=True, exist_ok=True)
            subprocess.run(['launchctl', 'bootout', f'gui/{os.getuid()}/{label}'], check=False)
            subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(path)], check=True)
    else:
        directory = args.render_only or Path.home() / '.config/systemd/user'
        directory.mkdir(parents=True, exist_ok=True)
        # systemd uses its own quoting and percent/dollar expansion, not a shell.
        def quote(value):
            return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%').replace('$', '$$').replace('\n', '\\n') + '"'
        path = directory / f'{label}.service'
        path.write_text('[Unit]\nDescription=Quarry differential tests\n[Service]\nType=oneshot\n'
                        + 'Environment=' + quote('PATH=' + environment_path) + '\n'
                        + 'ExecStart=' + ' '.join(map(quote, command)) + '\nTimeoutStartSec=infinity\n')
        (directory / f'{label}.timer').write_text('[Unit]\nDescription=Daily Quarry differential tests\n[Timer]\n'
                    + f'OnBootSec=10min\nOnUnitInactiveSec={args.interval}s\nPersistent=true\n[Install]\nWantedBy=timers.target\n')
        if not args.render_only:
            state.mkdir(parents=True, exist_ok=True)
            subprocess.run(['systemctl', '--user', 'daemon-reload'], check=True)
            subprocess.run(['systemctl', '--user', 'enable', '--now', f'{label}.timer'], check=True)
    print(f'{"Rendered (not installed)" if args.render_only else "Installed"}: {path}')


if __name__ == '__main__':
    main()
