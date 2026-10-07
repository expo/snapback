// Darwin test inspection only. Keep the exact microsecond birth used by the
// native witness records; ps lstart loses that precision. Never sends signals.
#include <libproc.h>
#include <sys/sysctl.h>
#include <sys/proc.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>

int main(int argc, char **argv) {
    char *end;
    if (argc != 2) return 2;
    long number = strtol(argv[1], &end, 10);
    if (*end || number <= 0 || number > INT_MAX) return 2;
    int pid = (int)number;
    struct proc_bsdinfo info;
    int size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info));
    if (!size && errno == ESRCH) return 3;
    if (size != sizeof(info) || info.pbi_pid != pid) return 2;
    if (info.pbi_status == SZOMB) return 3;
    int mib[] = { CTL_KERN, KERN_ARGMAX }, maximum;
    size_t bytes = sizeof(maximum);
    if (sysctl(mib, 2, &maximum, &bytes, NULL, 0) || maximum <= 0) return 2;
    char *data = malloc(maximum);
    if (!data) return 2;
    int args_mib[] = { CTL_KERN, KERN_PROCARGS2, pid };
    bytes = maximum;
    if (sysctl(args_mib, 3, data, &bytes, NULL, 0)) return errno == ESRCH ? 3 : 2;
    if (bytes < sizeof(int)) return 2;
    int count;
    memcpy(&count, data, sizeof(count));
    if (count < 1) return 2;
    char *cursor = data + sizeof(count), *limit = data + bytes;
    // executable path, padding, then exactly argc NUL-terminated arguments.
    char *nul = memchr(cursor, 0, limit - cursor);
    if (!nul) return 2;
    cursor = nul + 1;
    while (cursor < limit && !*cursor) cursor++;
    char *first = cursor;
    for (int i = 0; i < count; i++) {
        nul = memchr(cursor, 0, limit - cursor);
        if (!nul) return 2;
        cursor = nul + 1;
    }
    struct proc_bsdinfo after;
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after)) != sizeof(after)
        || after.pbi_pid != pid || after.pbi_status == SZOMB
        || after.pbi_start_tvsec != info.pbi_start_tvsec
        || after.pbi_start_tvusec != info.pbi_start_tvusec) return 3;
    printf("{\"start\":[%llu,%llu],\"parent\":%u}\n", (unsigned long long)info.pbi_start_tvsec,
        (unsigned long long)info.pbi_start_tvusec, after.pbi_ppid);
    if (fwrite(first, 1, cursor - first, stdout) != (size_t)(cursor - first)) return 2;
    free(data);
    return ferror(stdout) ? 2 : 0;
}
