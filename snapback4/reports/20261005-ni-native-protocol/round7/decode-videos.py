#!/usr/bin/env python3
"""Decode EVERY retained XCTest video frame into timestamped contact sheets.

Read-only post-run inspection, not a driver/validator or video replacement.
No frame sampling or scene-change threshold is used.
"""
import hashlib
import json
from pathlib import Path
import sys
import cv2
from PIL import Image, ImageDraw

root = Path(sys.argv[1]).resolve()
records = []
for video in sorted(root.rglob('*.mp4')):
    output = video.parent.parent / 'all-frames'
    output.mkdir(exist_ok=True)
    capture = cv2.VideoCapture(str(video))
    declared = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    frames = []
    pages = []
    while True:
        ok, frame = capture.read()
        if not ok: break
        index = len(frames)
        timestamp = capture.get(cv2.CAP_PROP_POS_MSEC) / 1000
        if index % 20 == 0:
            sheet = Image.new('RGB', (1000, 1840), 'white')
            draw = ImageDraw.Draw(sheet)
        thumb = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        thumb.thumbnail((194, 426))
        x, y = index % 5 * 200, index % 20 // 5 * 460
        sheet.paste(thumb, (x, y + 22))
        draw.text((x + 2, y + 3), f'{index:04d}  {timestamp:.3f}s', fill='black')
        frames.append(dict(index=index, seconds=timestamp,
                           decodedPixelsSha256=hashlib.sha256(frame.tobytes()).hexdigest()))
        if index % 20 == 19:
            page = output / f'page-{len(pages):02d}.jpg'
            sheet.save(page, quality=88)
            pages.append(str(page.relative_to(root)))
    if len(frames) % 20:
        page = output / f'page-{len(pages):02d}.jpg'
        sheet.save(page, quality=88)
        pages.append(str(page.relative_to(root)))
    capture.release()
    if len(frames) != declared:
        raise RuntimeError(f'incomplete-decode: {video}: {len(frames)} != {declared}')
    records.append(dict(video=str(video.relative_to(root)),
                        sha256=hashlib.sha256(video.read_bytes()).hexdigest(),
                        declaredFrames=declared, decodedFrames=len(frames),
                        everyFrameIncluded=True, pages=pages, frames=frames))
(root / 'whole-video-decode.json').write_text(json.dumps(records, indent=2) + '\n')
print(json.dumps([{k: v for k, v in record.items() if k != 'frames'} for record in records], indent=2))
