// Keep taskset's 80-95 mask immutable in this experiment's descendants.
// Some third-party worker pools replace an inherited mask with CPUs 0..N.
// This local seccomp filter refuses affinity changes; it changes no host policy
// and attaches to no other process. Apply taskset before invoking this wrapper.
#define _GNU_SOURCE
#include <errno.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sched.h>
#include <stddef.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc < 2) return 125;
    cpu_set_t cpus;
    if (sched_getaffinity(0, sizeof(cpus), &cpus)) { perror("get affinity"); return 125; }
    for (int cpu = 0; cpu < CPU_SETSIZE; cpu++) {
        if (!!CPU_ISSET(cpu, &cpus) != (cpu >= 80 && cpu <= 95)) {
            fprintf(stderr, "confine: taskset must install exactly CPUs 80-95 first\n");
            return 125;
        }
    }
    struct sock_filter filter[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_X86_64, 3, 0),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, AUDIT_ARCH_I386, 0, 5),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, 241 /* i386 sched_setaffinity */, 4, 3),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
        BPF_STMT(BPF_ALU | BPF_AND | BPF_K, ~0x40000000U /* x32 syscall bit */),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_sched_setaffinity, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM),
    };
    struct sock_fprog program = { .len = sizeof(filter) / sizeof(filter[0]), .filter = filter };
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) {
        perror("install affinity guard"); return 125;
    }
    execvp(argv[1], &argv[1]);
    perror("execvp");
    return 127;
}
