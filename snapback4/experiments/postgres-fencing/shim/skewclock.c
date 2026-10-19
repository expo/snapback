/* LD_PRELOAD clock skew for witness 5 (libfaketime is not installed here).
 *
 *   SKEW_REALTIME_S=<seconds>  add this offset to CLOCK_REALTIME*, gettimeofday, time
 *   SKEW_MONO_RATE=<float>     make CLOCK_MONOTONIC* and CLOCK_BOOTTIME advance at this
 *                              rate relative to real time (0.1 = ten times slower)
 *
 * Rust's std (SystemTime, Instant) and tokio call clock_gettime through libc,
 * so interposing it skews the host's notion of both clocks for that process.
 * Build: gcc -O2 -shared -fPIC -o skewclock.so skewclock.c -ldl
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <sys/time.h>
#include <time.h>

static int (*real_clock_gettime)(clockid_t, struct timespec *);
static long long realtime_off_ns;
static double mono_rate = 1.0;
static long long mono_base[16];
static int mono_base_set[16];

__attribute__((constructor)) static void init(void) {
  real_clock_gettime = dlsym(RTLD_NEXT, "clock_gettime");
  const char *s = getenv("SKEW_REALTIME_S");
  if (s) realtime_off_ns = (long long)(atof(s) * 1e9);
  const char *r = getenv("SKEW_MONO_RATE");
  if (r) mono_rate = atof(r);
}

static long long to_ns(const struct timespec *ts) { return (long long)ts->tv_sec * 1000000000LL + ts->tv_nsec; }
static void from_ns(long long ns, struct timespec *ts) {
  ts->tv_sec = ns / 1000000000LL;
  ts->tv_nsec = ns % 1000000000LL;
}

int clock_gettime(clockid_t id, struct timespec *ts) {
  if (!real_clock_gettime) init();
  int rc = real_clock_gettime(id, ts);
  if (rc != 0) return rc;
  switch (id) {
    case CLOCK_REALTIME:
    case CLOCK_REALTIME_COARSE:
      from_ns(to_ns(ts) + realtime_off_ns, ts);
      break;
    case CLOCK_MONOTONIC:
    case CLOCK_MONOTONIC_COARSE:
    case CLOCK_MONOTONIC_RAW:
    case CLOCK_BOOTTIME:
      if (mono_rate != 1.0 && id >= 0 && id < 16) {
        long long now = to_ns(ts);
        if (!__atomic_load_n(&mono_base_set[id], __ATOMIC_ACQUIRE)) {
          long long expected = 0;
          __atomic_compare_exchange_n(&mono_base[id], &expected, now, 0, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
          __atomic_store_n(&mono_base_set[id], 1, __ATOMIC_RELEASE);
        }
        long long base = __atomic_load_n(&mono_base[id], __ATOMIC_ACQUIRE);
        from_ns(base + (long long)((double)(now - base) * mono_rate), ts);
      }
      break;
    default:
      break;
  }
  return 0;
}

int gettimeofday(struct timeval *tv, void *tz) {
  (void)tz;
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  tv->tv_sec = ts.tv_sec;
  tv->tv_usec = ts.tv_nsec / 1000;
  return 0;
}

time_t time(time_t *t) {
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  if (t) *t = ts.tv_sec;
  return ts.tv_sec;
}
