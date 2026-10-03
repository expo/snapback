"""Darwin KERN_PROCARGS2: emit token matches, never environment contents."""
import ctypes
import json
import os
import sys

request = json.load(sys.stdin)
libc = ctypes.CDLL(None, use_errno=True)
argmax = ctypes.c_int()
size = ctypes.c_size_t(ctypes.sizeof(argmax))
if libc.sysctl((ctypes.c_int * 2)(1, 8), 2, ctypes.byref(argmax), ctypes.byref(size), None, 0):
    raise RuntimeError("KERN_ARGMAX inspection failed")
needle = ("SNAPBACK_TEST_FILE_TOKEN=" + request["token"]).encode()
results = []
for pid in request["pids"]:
    row = {"pid": pid, "match": False}
    try:
        row["session"] = os.getsid(pid)
    except OSError as error:
        row["error"] = "getsid errno " + str(error.errno)
        results.append(row)
        continue
    buf = ctypes.create_string_buffer(argmax.value + ctypes.sizeof(ctypes.c_int))
    size = ctypes.c_size_t(len(buf))
    if libc.sysctl((ctypes.c_int * 3)(1, 49, pid), 3, buf, ctypes.byref(size), None, 0):
        row["error"] = "sysctl errno " + str(ctypes.get_errno())
    else:
        try:
            data = buf.raw[:size.value]
            argc = ctypes.c_int.from_buffer_copy(data).value
            if argc < 0:
                raise ValueError()
            offset = data.index(b"\0", ctypes.sizeof(ctypes.c_int)) + 1
            while offset < len(data) and data[offset] == 0:
                offset += 1
            for _ in range(argc):
                offset = data.index(b"\0", offset) + 1
            env = data[offset:].split(b"\0")
            # Recent Darwin kernels can redact a restricted executable's env
            # while returning success. Absence of any env is not proof of clean.
            if not any(env):
                row["error"] = "environment unavailable or empty"
            else:
                row["match"] = needle in env
        except (ValueError, IndexError):
            row["error"] = "malformed KERN_PROCARGS2 result"
    results.append(row)
json.dump(results, sys.stdout)
