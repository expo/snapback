#!/usr/bin/env python3
"""Read-only, every-frame review material and all-tree census; no pass synthesis.

Usage: inspect.py EVIDENCE_DIR OUTPUT_DIR. Requires the archived NI2 cv2/Pillow
venv. Every frame is hashed and included, without sampling, in a numbered sheet.
Review the sheets and full-resolution screenshots alongside the tree census.
"""
import collections, hashlib, json, sys
from pathlib import Path
import cv2
from PIL import Image, ImageDraw

root, out = map(lambda x: Path(x).resolve(), sys.argv[1:])
out.mkdir(parents=True, exist_ok=True)
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return json.loads(path.read_text())
def nodes(value):
    if isinstance(value, dict):
        if 'children' in value or 'frame' in value: yield value
        for child in value.get('children', []): yield from nodes(child)
    elif isinstance(value, list):
        for child in value: yield from nodes(child)

videos = []
for video in sorted(root.glob('*.mp4')):
    cap = cv2.VideoCapture(str(video)); declared = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frames, pages = [], []; folder = out / video.stem; folder.mkdir(exist_ok=True)
    while True:
        ok, frame = cap.read()
        if not ok: break
        index = len(frames); seconds = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
        frames.append({'index': index, 'seconds': seconds, 'decodedSha256': hashlib.sha256(frame.tobytes()).hexdigest()})
        if index % 100 == 0:
            sheet = Image.new('RGB', (1500, 1870), '#bbb'); draw = ImageDraw.Draw(sheet)
            draw.text((5, 5), f'{root} | {video.name} | from frame {index}', fill='black')
        # Five groups of 20, each arranged in five columns and four rows.
        group, slot = divmod(index % 100, 20)
        x = (group % 3) * 500 + (slot % 5) * 100
        y = (group // 3) * 920 + (slot // 5) * 230 + 30
        thumb = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)); thumb.thumbnail((97, 213))
        draw.text((x + 1, y), f'{index} {seconds:.3f}s', fill='black'); sheet.paste(thumb, (x, y + 16))
        if index % 100 == 99:
            page = folder / f'sheet-{index // 100:03}.jpg'; sheet.save(page, quality=92); pages.append(page.name)
    if frames and len(frames) % 100:
        page = folder / f'sheet-{(len(frames)-1) // 100:03}.jpg'; sheet.save(page, quality=92); pages.append(page.name)
    cap.release()
    if declared != len(frames): raise RuntimeError(f'incomplete decode: {video}: {len(frames)} != {declared}')
    videos.append({'video': video.name, 'sha256': digest(video), 'declaredFrames': declared,
        'decodedFrames': len(frames), 'everyFrameIncluded': True, 'pages': pages, 'frames': frames})
fixture = read(root / 'native-fixture.json'); trees = []
for path in sorted(root.glob('*.json')):
    value = read(path); all_nodes = list(nodes(value))
    if not all_nodes: continue
    rows = [n for n in all_nodes if n.get('id') == 'sm-convo-bubble']
    visible = [n for n in rows if n.get('hittable')]
    ids = [n.get('value') for n in visible]
    target = {}
    for kind in ('history', 'ordinary', 'viewOnce'):
        mid = fixture[kind]['messageId']; match = [n for n in rows if n.get('value') == mid]
        target[kind] = [{'frame': n.get('frame'), 'hittable': n.get('hittable'),
            'children': [{k: c.get(k) for k in ('id','value','label','frame','hittable')} for c in nodes(n) if c is not n and c.get('id')]} for n in match]
    trees.append({'file': path.name, 'sha256': digest(path), 'visibleIds': ids,
        'duplicateVisibleIds': [k for k,v in collections.Counter(ids).items() if v>1],
        'allBubbleCount': len(rows), 'targets': target,
        'selectors': dict(collections.Counter(n.get('id') for n in all_nodes if n.get('id')))})
events = [json.loads(l) for l in (root / 'native-observations.jsonl').read_text().splitlines()]
summary = {'evidence': str(root), 'videos': [{k:v for k,v in x.items() if k!='frames'} for x in videos],
    'trees': trees, 'eventCounts': dict(collections.Counter(e['kind'] for e in events)),
    'fixtureSha256': digest(root / 'native-fixture.json'), 'status': read(root / 'status.json'),
    'scope': 'review census; visual interpretation is separate and no result is inferred for unexecuted assertions'}
(out / 'every-frame.json').write_text(json.dumps(videos,indent=2)+'\n')
(out / 'census.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({'videos': summary['videos'], 'trees': len(trees), 'eventCounts':summary['eventCounts']}))
