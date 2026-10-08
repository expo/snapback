#!/usr/bin/env python3
"""Filesystem tickets for stable, replayed Quarry disagreements. No engine fixes."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess


def open_tickets(root, signature):
    marker = f'**Failure signature:** `{signature}`'
    return sorted(p for p in (Path(root) / 'issues').glob('*.md')
                  if marker in p.read_text() and re.search(r'^\*\*Status:\*\* Open\b', p.read_text(), re.M))


def ticket_name(date, signature):
    slug = re.sub(r'[^a-z0-9-]+', '-', signature.lower()).strip('-')[:80]
    return f"{date.replace('-', '')}-quarry-difftest-{slug}-{hashlib.sha256(signature.encode()).hexdigest()[:12]}.md"


def extract(ticket, destination):
    text = Path(ticket).read_text()
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    for label, suffix in [('quarry', 'q'), ('json', 'json')]:
        match = re.search(rf'^````{label}\n(.*?)^````$', text, re.M | re.S)
        if not match:
            raise ValueError(f'missing inline case.{suffix}')
        (destination / f'case.{suffix}').write_text(match[1])


def render(artifact, source, commit, date, run_id, name, verified):
    finding = artifact['finding']
    command = f"python3 snapback4/scripts/difftest-tickets.py extract {shlex.quote('issues/' + name)} /tmp/quarry-replay\ncd snapback4\ncargo run --release -p snapback4-difftest --features postgres -- replay /tmp/quarry-replay"
    replay_status = 'The shrunk case reproduced the signature twice.' if verified else 'Ticket-format preview only: replay has not been verified.'
    return f'''# Quarry differential test: {finding['signature']}

**Status:** Open
**Impact:** 5
**Urgency:** 5
**Ease:** 3
**Confidence:** 5
**Systems:** Snapback 4, Quarry, database testing
**Date:** {date}
**Failure signature:** `{finding['signature']}`
**Detected at:** `{commit}`
**Seed:** `{artifact['case']['seed']}`
**Related:** LLP 3000.035 §5.1

## Observation

The oracle `{json.dumps(finding['oracle'], sort_keys=True)}` disagreed on
`{finding['field']}`. {replay_status}
Diagnosis is pending: inspect for an engine defect, binder defect, harness
defect or underspecified point. No engine or binder change was made by the runner.

## Replay

Start an isolated Postgres evaluation cluster and export
`SNAPBACK4_EVAL_POSTGRES` (see `snapback4/scripts/test-postgres.sh`), then:

```sh
{command}
```

## case.q

````quarry
{source}````

## case.json (typed inputs, both raw outcomes and continuation)

````json
{json.dumps(artifact, indent=2, ensure_ascii=False)}
````

## Recurrences

- {date}: run `{run_id}`, seed `{artifact['case']['seed']}`, commit `{commit}`.

When resolved, keep the case as a regression, record the resolution, and move
this ticket to `issues/closed/`.
'''


def artifacts(run):
    # Only merged campaign artifacts, never worker copies of the same signature.
    result = {}
    for campaign in [Path(run), Path(run) / 'sqlite', Path(run) / 'stores']:
        for path in sorted(campaign.glob('*/case.json')):
            if path.parent.name.startswith('worker-'):
                continue
            value = json.loads(path.read_text())
            if 'finding' not in value:
                continue
            signature = value['finding']['signature']
            if signature not in result or path.stat().st_size < result[signature].stat().st_size:
                result[signature] = path
    return result


def file_tickets(repository, run, commit, run_id, *, binary=None, output=None, date=None):
    """output means dry run: project copies under output/issues, never mutate repo."""
    if binary is None and output is None:
        raise ValueError('real ticket filing requires a replay binary')
    repository, run = Path(repository), Path(run)
    target = Path(output) if output else repository
    date = date or datetime.date.today().isoformat()
    changed = []
    for signature, path in artifacts(run).items():
        artifact = json.loads(path.read_text())
        source = path.with_name('case.q').read_text()
        if binary:
            for attempt in range(2):
                replay = subprocess.run([str(binary), 'replay', str(path.parent)], text=True, capture_output=True, timeout=300)
                (run / f'replay-{hashlib.sha256(signature.encode()).hexdigest()[:16]}-{attempt}.log').write_text(replay.stdout + replay.stderr)
                if replay.returncode != 1 or json.loads(replay.stdout).get('signature') != signature:
                    raise RuntimeError(f'unstable or unavailable replay: {signature}; no ticket filed')
        existing = open_tickets(repository, signature)
        if output:
            existing += [p for p in open_tickets(target, signature) if p.name not in {q.name for q in existing}]
        if len(existing) > 1:
            raise RuntimeError(f'multiple open tickets for {signature}: {existing}')
        (target / 'issues').mkdir(parents=True, exist_ok=True)
        if existing:
            ticket = target / 'issues' / existing[0].name
            text = ticket.read_text() if ticket.exists() else existing[0].read_text()
            line = f"- {date}: run `{run_id}`, seed `{artifact['case']['seed']}`, commit `{commit}`."
            if line not in text:
                ticket.write_text(text.rstrip() + '\n\n' + line + '\n')
                changed.append(ticket)
        else:
            name = ticket_name(date, signature)
            ticket = target / 'issues' / name
            if ticket.exists():
                raise RuntimeError(f'ticket path collision: {ticket}')
            ticket.write_text(render(artifact, source, commit, date, run_id, name, binary is not None))
            changed.append(ticket)
    return changed


def git(root, *args, check=True):
    return subprocess.run(['git', '-C', str(root), *args], check=check, text=True, capture_output=True)


def publish(repository, paths):
    """Only called by the real scheduled runner, after stable replay and filing."""
    if not paths:
        return
    names = [str(p.relative_to(repository)) for p in paths]
    git(repository, 'add', '--', *names)
    git(repository, '-c', 'user.name=Quarry differential tests', '-c', 'user.email=noreply@openai.com',
        'commit', '-m', 'chore(difftest): record scheduled Quarry disagreements')
    for attempt in range(3):
        git(repository, 'fetch', 'origin')
        if git(repository, 'rebase', 'origin/main', check=False).returncode:
            git(repository, 'rebase', '--abort', check=False)
            continue
        # A racing run can add the same signature under another filename.
        # Consolidate only the files this invocation owns, before publishing.
        for name in names:
            own = repository / name
            if not own.exists():
                continue
            text = own.read_text()
            signature = re.search(r'^\*\*Failure signature:\*\* `([^`]+)`', text, re.M).group(1)
            others = [p for p in open_tickets(repository, signature) if p != own]
            if len(others) > 1:
                raise RuntimeError(f'conflicting open tickets after rebase: {signature}')
            if others:
                destination = others[0]
                merged = destination.read_text().rstrip() + '\n'
                for line in text.splitlines():
                    if line.startswith('- ') and ': run `' in line and line not in merged:
                        merged += '\n' + line + '\n'
                destination.write_text(merged)
                own.unlink()
                git(repository, 'add', '--', name, str(destination.relative_to(repository)))
        if git(repository, 'diff', '--cached', '--quiet', check=False).returncode:
            git(repository, '-c', 'user.name=Quarry differential tests', '-c', 'user.email=noreply@openai.com', 'commit', '--amend', '--no-edit')
        if git(repository, 'push', 'origin', 'HEAD:main', check=False).returncode == 0:
            return
    raise RuntimeError('ticket push failed after three fetch/rebase retries; retained local ticket commit')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('extract'); p.add_argument('ticket'); p.add_argument('destination')
    p = sub.add_parser('dry-run'); p.add_argument('--repository', type=Path, required=True); p.add_argument('--run', type=Path, required=True)
    p.add_argument('--commit', required=True); p.add_argument('--output', type=Path, required=True); p.add_argument('--binary', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'extract':
        extract(args.ticket, args.destination)
    else:
        paths = file_tickets(args.repository, args.run, args.commit, 'dry-run', binary=args.binary, output=args.output)
        print(json.dumps([str(p) for p in paths], indent=2))


if __name__ == '__main__':
    main()
