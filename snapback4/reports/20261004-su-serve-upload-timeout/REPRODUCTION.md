# Reproduction on eb1000

Base source: `2154dc163dc42e1808f12ef32e9468b2889407a3`.
The test binary was built before source edits using
`cargo test -p snapback4 --bin snapback4 --no-run --message-format=json`
from `snapback4/`, then copied from the executable path in Cargo's JSON.
`--lib` is unavailable: this package has only a binary target.

The following temporary Linux preload shim makes scheduling reproducible
without modifying either test binary or the base source. Rust names the
libtest driving thread via `pthread_setname_np`; Linux truncates that name to
15 bytes. The first connection made by that thread is the third upload,
after both background uploads have entered WorkGate. Delay this driver only;
the server and the two background clients remain runnable. The delay happens
before the third connection, so it does not consume that probe's read timeout.
The injection marker in every run proves the stall was applied.

Save as `delay.c`, build with
`cc -shared -fPIC -O2 -o delay.so delay.c -ldl -pthread`.

```c
#define _GNU_SOURCE
#include <dlfcn.h>
#include <pthread.h>
#include <stdatomic.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>
// Delay only the upload test's driving thread at its first exchange (the
// third upload). The two spawned clients and server threads keep running.
static pthread_t driver;
static _Atomic int ready = 0, delayed = 0;
int pthread_setname_np(pthread_t thread, const char *name) {
    static int (*real_name)(pthread_t, const char *);
    if (!real_name) real_name = dlsym(RTLD_NEXT, "pthread_setname_np");
    if (strncmp(name, "serve::tests::up", 15) == 0) {
        driver = thread;
        atomic_store(&ready, 1);
    }
    return real_name(thread, name);
}
int connect(int fd, const struct sockaddr *addr, socklen_t len) {
    int (*real_connect)(int, const struct sockaddr *, socklen_t) = dlsym(RTLD_NEXT, "connect");
    if (atomic_load(&ready) && pthread_equal(pthread_self(), driver) && !atomic_exchange(&delayed, 1)) {
        const char msg[] = "SU injection: driver delayed 4s before third upload; parked clients continue\n";
        write(2, msg, sizeof(msg)-1);
        struct timespec delay = {4, 0};
        while (nanosleep(&delay, &delay)) {}
    }
    return real_connect(fd, addr, len);
}
```

For each binary, run this temporary Python driver with label and absolute
binary path. It starts eight CPU hogs confined to CPUs 0–1 and runs all 50
trials sequentially on those same CPUs. Its `finally` terminates and reaps
only the hogs it launched. The actual scratch directory was
`/tmp/su-serve-timeout`; retained per-run records are `repetitions.json`.

```python
import subprocess, os, sys, time, json, pathlib
root=pathlib.Path('/tmp/su-serve-timeout')
label,binary=sys.argv[1:]
hogs=[]
rows=[]
try:
    hogs=[subprocess.Popen(['taskset','-c','0,1','python3','-c','while True: pass'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL) for _ in range(8)]
    for n in range(50):
        start=time.monotonic()
        result=subprocess.run(['taskset','-c','0,1',binary,'--exact','serve::tests::upload_disk_work_is_bounded_and_does_not_hold_the_query_engine','--nocapture'],env={**os.environ,'LD_PRELOAD':str(root/'delay.so')},capture_output=True,timeout=60)
        output=(result.stdout+result.stderr).decode()
        (root/f'{label}-{n+1:02}.log').write_text(output)
        row=dict(run=n+1,exit=result.returncode,seconds=round(time.monotonic()-start,3),injected='SU injection:' in output,client_timeout='WouldBlock' in output)
        rows.append(row)
        (root/f'{label}.json').write_text(json.dumps(rows,indent=2)+'\n')
        print(label,row,flush=True)
finally:
    for hog in hogs: hog.terminate()
    for hog in hogs: hog.wait()
```

The hang negative control used a separate shim changing only the delay from
4 to 25 seconds. With the fixed binary, both parked clients fail with
`WouldBlock` at their 23-second budget, and the driver fails on join after
25 seconds. This is expected failure evidence, not a passing trial.

This measures **confined CPU contention plus an injected driver stall**;
it does not estimate the frequency of the Darwin failure under organic load.
The fixed/full-suite runs used no modified product timeout. No remote host
or Lane FX worktree was used. All temporary code, binaries and load processes
were removed after retaining the evidence.
