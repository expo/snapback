#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdio.h>
#include <stdint.h>
#include <time.h>
#include <unistd.h>
#include <stdatomic.h>
#include <string.h>
struct stat { _Atomic uint64_t calls, bytes, ns; } read_stats, write_stats, sync_stats;
static struct stat fd_reads[4],fd_writes[4],fd_syncs[4];
static int kinds[4096];
static int kind(int fd) {
 if(fd<0 || fd>=4096)return 3;
 if(kinds[fd])return kinds[fd]-1;
 char path[64],target[4096];snprintf(path,sizeof path,"/proc/self/fd/%d",fd);
 ssize_t n=readlink(path,target,sizeof(target)-1);int k=3;
 if(n>=0){target[n]=0;if(strstr(target,"-wal"))k=1;else if(strstr(target,"etilqs"))k=2;else if(strstr(target,".sqlite"))k=0;}
 kinds[fd]=k+1;return k;
}
int close(int fd) {
 static int(*next)(int);if(!next)next=dlsym(RTLD_NEXT,"close");
 if(fd>=0 && fd<4096)kinds[fd]=0;
 return next(fd);
}
static void record_io(struct stat *stats,uint64_t n,uint64_t elapsed) { stats->calls++;stats->bytes+=n;stats->ns+=elapsed; }

static uint64_t ns(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC,&t); return (uint64_t)t.tv_sec*1000000000+t.tv_nsec; }
#define WRAP_IO(name, stats) \
ssize_t name(int fd, void *buf, size_t count, off_t off) { \
 static ssize_t (*next)(int,void *,size_t,off_t); if(!next) next=dlsym(RTLD_NEXT,#name); \
 uint64_t start=ns(); ssize_t n=next(fd,buf,count,off); \
 uint64_t elapsed=ns()-start; record_io(&stats,n>0?n:0,elapsed); record_io(&fd_reads[kind(fd)],n>0?n:0,elapsed); return n; }
WRAP_IO(pread, read_stats)
WRAP_IO(pread64, read_stats)
ssize_t pwrite(int fd,const void *buf,size_t count,off_t off) {
 static ssize_t (*next)(int,const void *,size_t,off_t);if(!next)next=dlsym(RTLD_NEXT,"pwrite");
 uint64_t start=ns();ssize_t n=next(fd,buf,count,off);uint64_t elapsed=ns()-start;record_io(&write_stats,n>0?n:0,elapsed);record_io(&fd_writes[kind(fd)],n>0?n:0,elapsed);return n;
}
ssize_t pwrite64(int fd,const void *buf,size_t count,off64_t off) {
 static ssize_t (*next)(int,const void *,size_t,off64_t);if(!next)next=dlsym(RTLD_NEXT,"pwrite64");
 uint64_t start=ns();ssize_t n=next(fd,buf,count,off);uint64_t elapsed=ns()-start;record_io(&write_stats,n>0?n:0,elapsed);record_io(&fd_writes[kind(fd)],n>0?n:0,elapsed);return n;
}
#define WRAP_SYNC(name) \
int name(int fd) { static int(*next)(int);if(!next)next=dlsym(RTLD_NEXT,#name);uint64_t start=ns();int n=next(fd);uint64_t elapsed=ns()-start;record_io(&sync_stats,0,elapsed);record_io(&fd_syncs[kind(fd)],0,elapsed);return n; }
WRAP_SYNC(fsync)
WRAP_SYNC(fdatasync)
__attribute__((destructor)) static void report(void) {
 const char *names[]={"main","wal","temp","other"};
 for(int i=0;i<4;i++)fprintf(stderr,"IO_FILE %s read_bytes=%lu read_ms=%.3f write_bytes=%lu write_ms=%.3f syncs=%lu sync_ms=%.3f\n",names[i],fd_reads[i].bytes,fd_reads[i].ns/1e6,fd_writes[i].bytes,fd_writes[i].ns/1e6,fd_syncs[i].calls,fd_syncs[i].ns/1e6);
 fprintf(stderr,"IO_PROFILE reads=%lu read_bytes=%lu read_ms=%.3f writes=%lu write_bytes=%lu write_ms=%.3f syncs=%lu sync_ms=%.3f\n",read_stats.calls,read_stats.bytes,read_stats.ns/1e6,write_stats.calls,write_stats.bytes,write_stats.ns/1e6,sync_stats.calls,sync_stats.ns/1e6);
}
