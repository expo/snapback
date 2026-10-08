// Reproduction load only. Own children exit and are reaped; no process signals.
#include <sys/prctl.h>
#include <sys/wait.h>
#include <unistd.h>
#include <signal.h>
#include <stdio.h>
#include <errno.h>
static volatile sig_atomic_t done;
static void stop(int sig) { (void)sig; done = 1; }
int main(void) {
    signal(SIGTERM, stop);
    unsigned long count = 0;
    while (!done) {
        int children = 0;
        for (int i = 0; i < 32 && !done; i++) {
            pid_t pid = fork();
            if (pid == 0) {
                prctl(PR_SET_NAME, i % 2 ? "pg (odd) name" : "pg plain", 0, 0, 0);
                usleep(1000);
                _exit(0);
            }
            if (pid > 0) { children++; count++; }
        }
        while (children) {
            if (wait(NULL) > 0) children--;
            else if (errno != EINTR) return 1;
        }
    }
    printf("created_and_reaped=%lu\n", count);
    return 0;
}
