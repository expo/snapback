#!/usr/bin/env python3
"""Generate a small solid-gradient PNG test image without external deps."""
import struct, zlib, sys

W, H = 320, 240
rows = bytearray()
for y in range(H):
    rows.append(0)  # filter: none
    for x in range(W):
        rows += bytes((int(255 * x / W), int(255 * y / H), 160))

def chunk(tag, data):
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(bytes(rows), 9))
png += chunk(b'IEND', b'')
open(sys.argv[1], 'wb').write(png)
print(f'wrote {sys.argv[1]} ({len(png)} bytes, {W}x{H})')
