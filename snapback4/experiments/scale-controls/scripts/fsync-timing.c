/* S1-DX diagnostic interposer: observe, preserve fdatasync/fsync semantics.
 * Only explicit SB4_DX_FSYNC runs load this library. No tokens or SQL logged.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

static int log_fd = -1;
static int (*real_fsync)(int);
static int (*real_fdatasync)(int);
static pthread_once_t initialized = PTHREAD_ONCE_INIT;

static void initialize(void) {
    real_fsync = dlsym(RTLD_NEXT, "fsync");
    real_fdatasync = dlsym(RTLD_NEXT, "fdatasync");
    const char *path = getenv("SB4_DX_FSYNC");
    if (path) log_fd = open(path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0600);
}
static long long now_ns(void) {
    struct timespec t;
    clock_gettime(CLOCK_MONOTONIC, &t);
    return (long long)t.tv_sec * 1000000000LL + t.tv_nsec;
}
static int timed(int fd, int data) {
    pthread_once(&initialized, initialize);
    long long start = now_ns();
    int rc = data ? real_fdatasync(fd) : real_fsync(fd);
    int saved_errno = errno;
    long long end = now_ns();
    if (log_fd >= 0) {
        char descriptor[64], path[1024], line[256];
        snprintf(descriptor, sizeof(descriptor), "/proc/self/fd/%d", fd);
        ssize_t path_len = readlink(descriptor, path, sizeof(path)-1);
        if (path_len < 0) path_len = 0;
        path[path_len] = '\0';
        const char *kind = strstr(path, "-wal") ? "wal" :
            strstr(path, ".sqlite") ? "database" : "other";
        int len = snprintf(line, sizeof(line),
            "{\"pid\":%d,\"tid\":%ld,\"fd\":%d,\"file\":\"%s\",\"data\":%d,\"start\":%lld,\"end\":%lld,\"rc\":%d}\n",
            getpid(), syscall(SYS_gettid), fd, kind, data, start, end, rc);
        ssize_t ignored = write(log_fd, line, (size_t)len);
        (void)ignored;
    }
    errno = saved_errno;
    return rc;
}
int fsync(int fd) { return timed(fd, 0); }
int fdatasync(int fd) { return timed(fd, 1); }
