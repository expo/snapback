"""Small controls for the experimental containment/startup wrappers."""
import os
from pathlib import Path
import signal
import sys
import threading

mode = sys.argv[1]
if mode == 'affinity':
    expected = set(range(80, 96))
    def check():
        assert os.sched_getaffinity(0) == expected
        try:
            os.sched_setaffinity(0, set(range(96)))
        except PermissionError:
            pass
        else:
            raise AssertionError('affinity guard allowed broadening')
        assert os.sched_getaffinity(0) == expected
    check()
    failures = []
    def thread_check():
        try: check()
        except BaseException as error: failures.append(repr(error))
    worker = threading.Thread(target=thread_check)
    worker.start(); worker.join()
    assert not failures, failures
    child = os.fork()
    if child == 0:
        check(); os._exit(0)
    assert os.waitpid(child, 0)[1] == 0
elif mode == 'signals':
    read, write = os.pipe()
    child = os.fork()
    if child == 0:
        os.close(read)
        os.kill(os.getpid(), signal.SIGSTOP)
        os.write(write, b'resumed'); os._exit(7)
    os.close(write)
    status = os.waitpid(child, os.WUNTRACED)[1]
    assert os.WIFSTOPPED(status) and os.WSTOPSIG(status) == signal.SIGSTOP
    os.kill(child, signal.SIGCONT)
    assert os.read(read, 7) == b'resumed'
    status = os.waitpid(child, 0)[1]
    assert os.WIFEXITED(status) and os.WEXITSTATUS(status) == 7
    child = os.fork()
    if child == 0:
        os.kill(os.getpid(), signal.SIGTERM); os._exit(99)
    status = os.waitpid(child, 0)[1]
    assert os.WIFSIGNALED(status) and os.WTERMSIG(status) == signal.SIGTERM
elif mode == 'env-cleared':
    child = os.fork()
    if child == 0: os.execve('/usr/bin/true', ['true'], {})
    assert os.waitpid(child, 0)[1] == 0
elif mode == 'syscalls':
    for _ in range(200_000): os.getpid()
else:
    raise AssertionError(mode)
print(mode, 'passed')
