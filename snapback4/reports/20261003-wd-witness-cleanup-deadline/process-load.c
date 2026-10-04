// Lane-owned process-table/CPU load. Run with a piped stdin and a new session.
// EOF/TERM/INT/one-hour alarm drains only this helper's group and reaps children.
#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>
static volatile sig_atomic_t done;
static void stop(int signal) { (void)signal; done = 1; }
int main(int argc, char **argv) {
    if (argc != 3 || getpid() != getpgrp()) return 2;
    int idle = atoi(argv[1]), cpu = atoi(argv[2]), made = 0;
    if (idle < 0 || idle > 4000 || cpu < 0 || cpu > 72) return 2;
    signal(SIGTERM, stop); signal(SIGINT, stop); signal(SIGALRM, stop);
    alarm(3600);
    for (int i = 0; i < idle + cpu && !done; i++) {
        pid_t pid = fork();
        if (pid < 0) { perror("fork"); done = 1; break; }
        if (pid == 0) {
            signal(SIGTERM, SIG_DFL); signal(SIGINT, SIG_DFL);
            close(0); close(1); close(2);
            if (i >= idle) { volatile unsigned long x = 1; for (;;) x = x * 1664525 + 1013904223; }
            for (;;) pause();
        }
        made++;
    }
    printf("{\"group\":%d,\"idle\":%d,\"cpu\":%d,\"started\":%d}\n", getpgrp(), idle, cpu, made);
    fflush(stdout);
    while (!done) {
        struct pollfd input = { .fd = 0, .events = POLLIN | POLLHUP };
        if (poll(&input, 1, 1000) > 0) { char b; if (read(0, &b, 1) <= 0) done = 1; }
    }
    // The live parent pins the group number until all of its children are reaped.
    signal(SIGTERM, SIG_IGN);
    kill(0, SIGTERM);
    int reaped = 0;
    while (wait(NULL) >= 0 || errno == EINTR) { if (errno != EINTR) reaped++; errno = 0; }
    fprintf(stderr, "load drained: %d children started, %d reaped\n", made, reaped);
    return made == idle + cpu ? 0 : 1;
}
