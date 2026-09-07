"""Harmless FIFO-controlled child; never imports product code or runs commands."""
import os
import select
import sys

assert len(sys.argv) == 3
ready = os.open(sys.argv[1], os.O_WRONLY)
gate = os.open(sys.argv[2], os.O_RDONLY | os.O_NONBLOCK)
os.write(ready, b'R')
os.close(ready)
print('controlled child ready', flush=True)
readable, _, _ = select.select([gate], [], [], 8)
code = 0 if readable and os.read(gate, 1) == b'0' else 77
os.close(gate)
print('controlled child exit ' + str(code), flush=True)
raise SystemExit(code)
