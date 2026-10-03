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
    if ((!after && !strcmp(fault, "before")) || (after && !strcmp(fault, "after"))) {
        kill(getpid(), SIGTERM); _exit(143);
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
