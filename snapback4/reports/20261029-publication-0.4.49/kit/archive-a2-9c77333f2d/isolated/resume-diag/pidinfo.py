# Read-only: does proc_pidinfo(PROC_PIDTBSDINFO) succeed for given pids as this (non-root) user? (snapback4 supervisor identity())
import ctypes, sys, ctypes.util
libproc = ctypes.CDLL(ctypes.util.find_library('proc') or '/usr/lib/libproc.dylib', use_errno=True)
PROC_PIDTBSDINFO = 3; SIZE = 136  # sizeof(struct proc_bsdinfo)
for pid in map(int, sys.argv[1:]):
    buf = ctypes.create_string_buffer(SIZE)
    n = libproc.proc_pidinfo(pid, PROC_PIDTBSDINFO, ctypes.c_uint64(0), buf, SIZE)
    print(pid, 'read', n, 'of', SIZE, 'errno', ctypes.get_errno())
