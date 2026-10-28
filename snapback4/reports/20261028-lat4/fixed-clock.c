/* Measurement control only: equal wall clocks; monotonic timers remain real. */
#define _GNU_SOURCE
#include <time.h>
#include <sys/time.h>
#include <dlfcn.h>
int clock_gettime(clockid_t clock, struct timespec *value) {
    if (clock == CLOCK_REALTIME) { value->tv_sec=1793160000; value->tv_nsec=123000000; return 0; }
    static int (*real_clock)(clockid_t,struct timespec *);
    if (!real_clock) real_clock=dlsym(RTLD_NEXT,"clock_gettime");
    return real_clock(clock,value);
}
int gettimeofday(struct timeval *value, void *zone) {
    (void)zone; value->tv_sec=1793160000;value->tv_usec=123000;return 0;
}
