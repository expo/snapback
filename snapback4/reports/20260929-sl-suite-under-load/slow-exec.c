// Linux experiment wrapper: delay successful descendant execs, not syscalls.
// PTRACE_SEIZE + LISTEN preserve job-control stops used by the suite. Every
// traced task descends from our pipe-gated child; no existing process is attached.
#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/ptrace.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

struct delayed {
    pid_t pid;
    long long due;
    struct delayed *next;
};
static struct delayed *pending;
static FILE *trace;
static long long delay_ns;

static void fail(const char *what) {
    perror(what);
    exit(125); // EXITKILL applies to our seized process tree.
}
static long long now_ns(void) {
    struct timespec ts;
    if (clock_gettime(CLOCK_MONOTONIC, &ts)) fail("clock_gettime");
    return (long long)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}
static void resume(pid_t pid, int signal) {
    if (ptrace(PTRACE_CONT, pid, 0, (void *)(long)signal) && errno != ESRCH)
        fail("PTRACE_CONT");
}
static void forget(pid_t pid) {
    struct delayed **slot = &pending;
    while (*slot) {
        if ((*slot)->pid == pid) {
            struct delayed *old = *slot;
            *slot = old->next;
            free(old);
        } else slot = &(*slot)->next;
    }
}
static void release_due(void) {
    long long time = now_ns();
    struct delayed **slot = &pending;
    while (*slot) {
        struct delayed *item = *slot;
        if (time >= item->due) {
            fprintf(trace, "resume pid=%d at_ns=%lld due_ns=%lld\n", item->pid, time, item->due);
            resume(item->pid, 0);
            *slot = item->next;
            free(item);
        } else slot = &item->next;
    }
}
int main(int argc, char **argv) {
    if (argc < 4) {
        fprintf(stderr, "usage: slow-exec DELAY_MS TRACE COMMAND [ARGS...]\n");
        return 125;
    }
    char *end;
    long ms = strtol(argv[1], &end, 10);
    if (!*argv[1] || *end || ms < 0 || ms > 10000) return 125;
    delay_ns = ms * 1000000LL;
    trace = fopen(argv[2], "we");
    if (!trace) fail("open trace");
    setvbuf(trace, NULL, _IOLBF, 0);
    int gate[2];
    if (pipe(gate)) fail("pipe");
    pid_t root = fork();
    if (root < 0) fail("fork");
    if (!root) {
        close(gate[1]);
        fclose(trace);
        char byte;
        while (read(gate[0], &byte, 1) < 0) if (errno != EINTR) _exit(125);
        close(gate[0]);
        execvp(argv[3], &argv[3]);
        perror("execvp");
        _exit(127);
    }
    close(gate[0]);
    long options = PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK | PTRACE_O_TRACECLONE
        | PTRACE_O_TRACEEXEC | PTRACE_O_EXITKILL;
    if (ptrace(PTRACE_SEIZE, root, 0, (void *)options)) {
        kill(root, SIGKILL); waitpid(root, NULL, 0); fail("PTRACE_SEIZE");
    }
    if (ptrace(PTRACE_INTERRUPT, root, 0, 0)) fail("PTRACE_INTERRUPT");
    int status;
    if (waitpid(root, &status, __WALL) != root || !WIFSTOPPED(status)) fail("initial stop");
    close(gate[1]);
    resume(root, 0);
    int root_status = 125, first_exec = 1;
    for (;;) {
        release_due();
        pid_t pid = waitpid(-1, &status, __WALL | WNOHANG);
        if (pid < 0) {
            if (errno == EINTR) continue;
            if (errno == ECHILD) break;
            fail("waitpid");
        }
        if (!pid) {
            struct timespec tick = { .tv_nsec = 1000000 }; // Only event polling, never per-syscall tracing.
            nanosleep(&tick, NULL);
            continue;
        }
        if (WIFEXITED(status) || WIFSIGNALED(status)) {
            if (pid == root) root_status = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
            forget(pid);
            continue;
        }
        if (!WIFSTOPPED(status)) continue;
        unsigned event = (unsigned)status >> 16;
        int signal = WSTOPSIG(status);
        if (event == PTRACE_EVENT_EXEC) {
            unsigned long old_tid = 0;
            if (ptrace(PTRACE_GETEVENTMSG, pid, 0, &old_tid)) fail("exec former tid");
            if ((pid_t)old_tid != pid) forget((pid_t)old_tid);
            if (pid == root && first_exec) {
                first_exec = 0;
                fprintf(trace, "root-exec pid=%d at_ns=%lld (not delayed)\n", pid, now_ns());
                resume(pid, 0);
                continue;
            }
            struct delayed *item = malloc(sizeof(*item));
            if (!item) fail("malloc");
            long long time = now_ns();
            *item = (struct delayed){ pid, time + delay_ns, pending };
            pending = item;
            fprintf(trace, "exec pid=%d at_ns=%lld due_ns=%lld\n", pid, time, item->due);
        } else if (event == PTRACE_EVENT_STOP && signal != SIGTRAP) {
            // A real group stop must remain stopped until SIGCONT.
            if (ptrace(PTRACE_LISTEN, pid, 0, 0) && errno != ESRCH) fail("PTRACE_LISTEN");
        } else if (event) {
            // Fork/clone/vfork and automatically attached children's initial stops.
            resume(pid, 0);
        } else {
            resume(pid, signal); // Preserve real signal delivery, including SIGTRAP.
        }
    }
    fclose(trace);
    return root_status;
}
