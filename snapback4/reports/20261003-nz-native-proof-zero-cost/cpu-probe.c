// Host-specific measurement only, never shipped in the CLI. Darwin ARM64 CPU
// register layout: apple-oss-distributions/xnu, libsyscall/os/tsd.h (2026-10-03).
// This private layout is not a portable API. Cross-check IDs against IORegistry.
#include <pthread.h>
#include <sys/qos.h>
#include <sys/resource.h>
#include <stdint.h>
#include <stdio.h>
#include <time.h>
#define THREADS 6
struct sample { uint64_t cpus[4096], work; unsigned qos; } samples[THREADS];
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec/1e9; }
static void *work(void *arg) {
  struct sample *s = arg;
  qos_class_t qos; pthread_get_qos_class_np(pthread_self(), &qos, NULL); s->qos = qos;
  double end = now() + 3;
  uint64_t value = 0x123456789abcdef;
  do {
    for (int i = 0; i < 10000; i++) { value ^= value << 13; value ^= value >> 7; value ^= value << 17; }
    uint64_t cpu; __asm__ volatile("mrs %0, TPIDR_EL0" : "=r"(cpu));
    s->cpus[cpu & 4095]++; s->work++;
  } while (now() < end);
  return (void *)(uintptr_t)value;
}
int main(void) {
  pthread_t threads[THREADS];
  for (int i = 0; i < THREADS; i++) if (pthread_create(&threads[i], NULL, work, &samples[i])) return 1;
  for (int i = 0; i < THREADS; i++) pthread_join(threads[i], NULL);
  printf("{\"darwinBackground\":%d,\"threads\":[", getpriority(PRIO_DARWIN_PROCESS, 0));
  for (int i = 0; i < THREADS; i++) {
    if (i) printf(","); printf("{\"requestedQos\":%u,\"samples\":{", samples[i].qos);
    int comma = 0;
    for (int c = 0; c < 4096; c++) if(samples[i].cpus[c]) { if (comma++) printf(","); printf("\"%d\":%llu", c, samples[i].cpus[c]); }
    printf("}}");
  }
  printf("]}\n"); return 0;
}
