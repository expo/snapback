// Test-only Darwin owner-exit barrier. No stopped job-control groups: the
// kernel resumes orphaned stopped groups, which would erase the intended race.
#include <sys/event.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <time.h>
static int intercepted(int fd, const struct kevent *changes, int nchanges,
                       struct kevent *events, int nevents, const struct timespec *timeout) {
    int status = kevent(fd, changes, nchanges, events, nevents, timeout);
    const char *root = getenv("SB4_NZ_RETENTION_BARRIER");
    if (!root) return status;
    char path[4096]; snprintf(path, sizeof(path), "%s/pause-owner-pid", root);
    FILE *file = fopen(path, "r"); int selected = 0;
    if (file) { if (fscanf(file, "%d", &selected) != 1) selected = 0; fclose(file); }
    if (selected != getpid()) return status;
    { // Pause the selected watcher poll before killing its owner.
        snprintf(path, sizeof(path), "%s/owner-exit-paused", root);
        file = fopen(path, "w"); if (file) { fputs("ready", file); fclose(file); }
        snprintf(path, sizeof(path), "%s/resume-owner-exit", root);
        struct timespec start, now; clock_gettime(CLOCK_MONOTONIC, &start);
        // Even a dead test runner cannot leave this test barrier indefinitely.
        while (access(path, F_OK) != 0) {
            clock_gettime(CLOCK_MONOTONIC, &now);
            if (now.tv_sec - start.tv_sec >= 30) break;
            usleep(10000);
        }
    }
    return status;
}
__attribute__((used)) static struct { const void *replacement; const void *original; } interpose
__attribute__((section("__DATA,__interpose"))) = { (const void *)intercepted, (const void *)kevent };
