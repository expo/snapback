// One CPU-bound worker with constant memory and no I/O; affinity is inherited.
#include <stdint.h>
int main(void) {
    volatile uint64_t value = 1;
    for (;;) value = value * 6364136223846793005ULL + 1;
}
