#!/usr/bin/env python3
"""Negative controls mutate only the temporary scaffold, never repository code."""
import os
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parents[3]
binary = str(root / 'target/debug/snapback4')
args = sys.argv[1:]
if not args or args[0] != 'new':
    os.execv(binary, [binary, *args])
run = subprocess.run([binary, *args])
if run.returncode:
    sys.exit(run.returncode)
dir = Path(args[1])
mode = os.environ['SR_MUTATION']
def edit(name, old, new):
    path = dir / name
    text = path.read_text()
    assert text.count(old) == 1, (mode, path, old)
    path.write_text(text.replace(old, new))
if mode == 'cleanup':
    edit('src/intents.ts', 'proposals = proposals.filter(p => needed.has(p.proposed));', '/* mutation: keep orphan associations */')
elif mode == 'association':
    edit('src/Conversation.tsx', 'journal.remember(intent, conversation === proposed ? other : undefined);', 'journal.remember(intent);')
elif mode == 'fanout':
    edit('src/Conversation.tsx', '{proposals.some(p => !p.canonical) && <ResolveProposal conversation={conversation} resolve={resolve} />}',
         '{[...new Set(proposals.filter(p => !p.canonical).map(p => p.other))].map(other => <ResolveProposal key={other} other={other} resolve={resolve} />)}')
    edit('src/Conversation.tsx', '''function ResolveProposal({ conversation, resolve }: { conversation: string; resolve(other: string, canonical: string): void }) {
  const pair = useQuery(api.directPeer, { conversation });
  const other = "data" in pair && !pair.revalidating && pair.data && !pair.data.pending ? pair.data.peer : null;
  useEffect(() => { if (other) resolve(other, conversation); }, [other, conversation, resolve]);''', '''function ResolveProposal({ other, resolve }: { other: string; resolve(other: string, canonical: string): void }) {
  const pair = useQuery(api.directConversation, { other });
  const id = "data" in pair && !pair.revalidating && pair.data && !pair.data.pending ? pair.data.conversation : null;
  useEffect(() => { if (id) resolve(other, id); }, [other, id, resolve]);''')
elif mode == 'rejoin':
    edit('snapback/schema.q', 'insert <- created conversations[.conversation] or exists members[.conversation, viewer]',
         'insert <- created conversations[.conversation] or exists members[.conversation, viewer] or .principal = viewer')
    edit('snapback/schema.q', '  if pair != null:\n    return pair.conversation', '''  if pair != null:
    insert members { conversation: pair.conversation, principal: viewer, joinedOrdinal: 0 } if absent
    return pair.conversation''')
elif mode == 'orphan':
    edit('snapback/schema.q', '  if pair != null:\n    return pair.conversation', '''  if pair != null:
    orphan = insert conversations { id, title: 'Orphan', creatorId: viewer }
    insert members { conversation: orphan.id, principal: viewer, joinedOrdinal: 0 }
    return pair.conversation''')
elif mode == 'complete':
    edit('src/Conversation.tsx', '!member.data && member.complete && member.fresh', '!member.data && member.fresh')
else:
    raise ValueError(mode)
