// Test-only fault injection at the real publisher's namespace syscall.
#define _GNU_SOURCE
#include <stdlib.h>
#include <signal.h>
#include <string.h>
#include <stdio.h>
#include <unistd.h>
#include <dlfcn.h>
static int selected(const char *target) {
    const char *want = getenv("SB4_FAULT_TARGET");
    return want && strcmp(want, target) == 0;
}
static void boundary(const char *target, int after) {
    if (!selected(target)) return;
    const char *fault = getenv("SB4_FAULT");
    if (!fault) return;
    if ((!after && !strcmp(fault, "pause-before")) || (after && !strcmp(fault, "pause-after"))) {
        const char *barrier = getenv("SB4_FAULT_BARRIER");
        char temporary[4096], request[4096];
        if (!barrier || snprintf(temporary, sizeof(temporary), "%s.tmp.XXXXXX", barrier) >= sizeof(temporary)
            || snprintf(request, sizeof(request), "%s.kill", barrier) >= sizeof(request)) _exit(125);
        int fd = mkstemp(temporary);
        FILE *out = fd >= 0 ? fdopen(fd, "w") : NULL;
        if (!out) _exit(125);
        int written = fprintf(out, "%ld\n", (long)getpid());
        int closed = fclose(out);
        if (written < 0 || closed != 0 || rename(temporary, barrier) != 0) _exit(125);
        // The private barrier belongs to this one paused publisher. A request
        // kills the observing process itself: no cached PID can be recycled
        // between the parent's validation and delivery of the fault.
        while (access(request, F_OK) != 0) usleep(10000);
        raise(SIGKILL); _exit(137);
    }
    if ((!after && !strcmp(fault, "before")) || (after && !strcmp(fault, "after"))) {
        raise(SIGTERM); _exit(143);
    }
    if (after && !strcmp(fault, "tamper")) {
        char file[4096]; snprintf(file, sizeof(file), "%s/bundle", target);
        FILE *out = fopen(file, "w"); if (out) { fputs("tampered", out); fclose(out); }
    }
}
#ifdef __APPLE__
#include <sys/stdio.h>
static int intercepted(const char *source, const char *target, unsigned int flags) {
    boundary(target, 0);
    int status = renamex_np(source, target, flags);
    if (!status) boundary(target, 1);
    return status;
}
__attribute__((used)) static struct { const void *replacement; const void *original; } interpose
__attribute__((section("__DATA,__interpose"))) = { (const void *)intercepted, (const void *)renamex_np };
#else
int renameat2(int sfd, const char *source, int tfd, const char *target, unsigned int flags) {
    boundary(target, 0);
    int (*original)(int,const char*,int,const char*,unsigned int) = dlsym(RTLD_NEXT, "renameat2");
    int status = original(sfd, source, tfd, target, flags);
    if (!status) boundary(target, 1);
    return status;
}
#endif
