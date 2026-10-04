#!/usr/bin/env python3
"""Freeze taskset's inherited <=16 CPU mask for this command and descendants.

Chromium's SwiftShader workers can replace inherited affinity with CPUs 0..N.
An unprivileged, inherited seccomp filter denies sched_setaffinity, preserving
the chosen mask without changing rendering flags or any other process.
"""
import ctypes
import errno
import os
import platform
import sys

assert sys.platform == 'linux'
assert 0 < len(os.sched_getaffinity(0)) <= 16, 'run with taskset on at most 16 CPUs'
assert len(sys.argv) > 1, 'usage: confine.py command [args...]'
arch, affinity_call = {
    'x86_64': (0xC000003E, 203),
    'aarch64': (0xC00000B7, 122),
}[platform.machine()]

class Filter(ctypes.Structure):
    _fields_ = [('code', ctypes.c_ushort), ('jt', ctypes.c_ubyte),
               ('jf', ctypes.c_ubyte), ('k', ctypes.c_uint)]

class Program(ctypes.Structure):
    _fields_ = [('length', ctypes.c_ushort), ('filter', ctypes.POINTER(Filter))]

deny = 0x00050000 | errno.EPERM
filters = (Filter * 8)(
    Filter(0x20, 0, 0, 4),                 # load seccomp_data.arch
    Filter(0x15, 1, 0, arch),              # reject an unexpected ABI
    Filter(0x06, 0, 0, deny),
    Filter(0x20, 0, 0, 0),                 # load syscall number
    Filter(0x54, 0, 0, 0xBFFFFFFF),        # include x32 affinity calls
    Filter(0x15, 0, 1, affinity_call),
    Filter(0x06, 0, 0, deny),
    Filter(0x06, 0, 0, 0x7FFF0000),        # otherwise allow
)
program = Program(len(filters), filters)
libc = ctypes.CDLL(None, use_errno=True)
for args in [(38, 1, 0, 0, 0), (22, 2, ctypes.byref(program), 0, 0)]:
    if libc.prctl(*args) != 0:
        raise OSError(ctypes.get_errno(), 'could not freeze inherited CPU affinity')
try:
    os.sched_setaffinity(0, os.sched_getaffinity(0))
except OSError as error:
    assert error.errno == errno.EPERM, error
else:
    raise AssertionError('affinity filter did not deny its native syscall')
os.environ['LU_AFFINITY_LOCKED'] = str(os.getpid())
os.execvp(sys.argv[1], sys.argv[1:])
