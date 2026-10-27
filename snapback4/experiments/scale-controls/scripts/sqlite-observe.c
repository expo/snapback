/* Opt-in, separate-run SQLite statement/fsync observation of an immutable ELF.
 * No SQL text, values, tokens or rows are logged. Not a capacity build/run.
 * sqlite3_open_v2's verified direct jump is redirected to a nearby relay;
 * the wrapper calls its original target then installs sqlite3_trace_v2.
 * All database operations and real sync syscalls retain their semantics.
 * Symbol offsets must come from nm on the exact measured executable.
 */
#define _GNU_SOURCE
#include <ctype.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <link.h>
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

static int output=-1;
static uintptr_t base;
static int (*original_open)(const char*,void**,int,const char*);
static int (*trace_v2)(void*,unsigned,int(*)(unsigned,void*,void*,void*),void*);
static const char* (*stmt_sql)(void*);
static int (*exec_sql)(void*,const char*,int(*)(void*,int,char**,char**),void*,char**);
static long long stamp(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return (long long)t.tv_sec*1000000000+t.tv_nsec;}
static void event(const char*kind,long long begin,long long end,int rc,int data){
 if(output<0)return;
 char b[256];int n=snprintf(b,sizeof b,"{\"pid\":%d,\"tid\":%ld,\"kind\":\"%s\",\"start\":%lld,\"end\":%lld,\"rc\":%d,\"data\":%d}\n",getpid(),syscall(SYS_gettid),kind,begin,end,rc,data);
 (void)!write(output,b,n);
}
static int callback(unsigned type,void*ctx,void*stmt,void*x){
 (void)type;(void)ctx;(void)x;const char*s=stmt_sql(stmt);if(!s)s="";
 while(isspace((unsigned char)*s))s++;
 const char*kind=!strncasecmp(s,"BEGIN",5)?"begin":!strncasecmp(s,"COMMIT",6)?"commit":!strncasecmp(s,"ROLLBACK",8)?"rollback":!strncasecmp(s,"SAVEPOINT",9)?"savepoint":!strncasecmp(s,"RELEASE",7)?"release":!strncasecmp(s,"SELECT",6)?"select":!strncasecmp(s,"INSERT",6)?"insert":!strncasecmp(s,"UPDATE",6)?"update":!strncasecmp(s,"DELETE",6)?"delete":!strncasecmp(s,"PRAGMA",6)?"pragma":"other";
 long long at=stamp();event(kind,at,at,0,0);return 0;
}
static int pragma(void*ctx,int n,char**values,char**names){
 (void)names;if(n && values[0]){
 char b[256];int len=snprintf(b,sizeof b,"{\"pid\":%d,\"kind\":\"setting\",\"name\":\"%s\",\"value\":\"%s\"}\n",getpid(),(char*)ctx,values[0]);(void)!write(output,b,len);
 }return 0;
}
static int observed_open(const char*file,void**db,int flags,const char*vfs){
 int rc=original_open(file,db,flags,vfs);
 if(rc==0){
  exec_sql(*db,"PRAGMA journal_mode",pragma,"journal_mode",NULL);
  /* This is the new connection's default. Store::open then sets FULL;
   * the SQLite default is FULL too; no pragma assignment is performed here. */
  exec_sql(*db,"PRAGMA synchronous",pragma,"synchronous_at_open",NULL);
  trace_v2(*db,1,callback,NULL);
 }
 return rc;
}
static int locate(struct dl_phdr_info*i,size_t n,void*d){(void)n;(void)d;if(!i->dlpi_name[0]){base=i->dlpi_addr;return 1;}return 0;}
static uintptr_t offset(const char*name){const char*s=getenv(name);if(!s)_exit(122);return strtoull(s,NULL,16);}
__attribute__((constructor)) static void setup(void){
 const char*path=getenv("SB4_SQLITE_PROBE");if(!path)return;
 char executable[1024];ssize_t length=readlink("/proc/self/exe",executable,sizeof executable-1);
 if(length<0)return;
 executable[length]=0;
 const char*name=strrchr(executable,'/');if(strcmp(name?name+1:executable,"snapback4"))return;
 output=open(path,O_WRONLY|O_CREAT|O_APPEND|O_CLOEXEC,0600);if(output<0)_exit(123);
 dl_iterate_phdr(locate,NULL);
 unsigned char*entry=(void*)(base+offset("SB4_SQLITE_OPEN_OFFSET"));
 if(memcmp(entry,"\xf3\x0f\x1e\xfa\xe9",5))_exit(124);
 int32_t displacement;memcpy(&displacement,entry+5,4);
 original_open=(void*)(entry+9+displacement);
 trace_v2=(void*)(base+offset("SB4_SQLITE_TRACE_OFFSET"));stmt_sql=(void*)(base+offset("SB4_SQLITE_SQL_OFFSET"));exec_sql=(void*)(base+offset("SB4_SQLITE_EXEC_OFFSET"));
 void*relay=MAP_FAILED;
 for(uintptr_t delta=0x10000000;delta<0x70000000;delta+=0x100000){
  relay=mmap((void*)((base+delta)&~(uintptr_t)4095),4096,PROT_READ|PROT_WRITE,MAP_PRIVATE|MAP_ANONYMOUS|MAP_FIXED_NOREPLACE,-1,0);if(relay!=MAP_FAILED)break;
 }
 if(relay==MAP_FAILED)_exit(125);
 unsigned char code[]={0xf3,0x0f,0x1e,0xfa,0x48,0xb8,0,0,0,0,0,0,0,0,0xff,0xe0};uintptr_t target=(uintptr_t)observed_open;memcpy(code+6,&target,8);memcpy(relay,code,sizeof code);
 if(mprotect(relay,4096,PROT_READ|PROT_EXEC))_exit(126);
 void*page=(void*)((uintptr_t)entry&~(uintptr_t)4095);
 if(mprotect(page,4096,PROT_READ|PROT_WRITE|PROT_EXEC))_exit(127);
 displacement=(int32_t)((unsigned char*)relay-(entry+9));memcpy(entry+5,&displacement,4);
 if(mprotect(page,4096,PROT_READ|PROT_EXEC))_exit(128);
 event("observer_ready",stamp(),stamp(),0,0);
}
static pthread_once_t sync_initialized=PTHREAD_ONCE_INIT;
static int(*real_fsync)(int),(*real_fdatasync)(int);
static void initialize_sync(void){real_fsync=dlsym(RTLD_NEXT,"fsync");real_fdatasync=dlsym(RTLD_NEXT,"fdatasync");}
static int sync_call(int fd,int data){
 pthread_once(&sync_initialized,initialize_sync);
 long long at=stamp();int rc=data?real_fdatasync(fd):real_fsync(fd),saved=errno;long long end=stamp();
 char link[64],path[1024];snprintf(link,sizeof link,"/proc/self/fd/%d",fd);ssize_t n=readlink(link,path,sizeof path-1);path[n<0?0:n]=0;
 event(strstr(path,"-wal")?"sync_wal":strstr(path,".sqlite")?"sync_database":"sync_other",at,end,rc,data);errno=saved;return rc;
}
int fsync(int fd){return sync_call(fd,0);}
int fdatasync(int fd){return sync_call(fd,1);}
