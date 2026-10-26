#include "postgres.h"
#include "fmgr.h"
#include "executor/executor.h"
#include "miscadmin.h"
#include <time.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
PG_MODULE_MAGIC;
static ExecutorRun_hook_type previous;
static uint64 nanos(clockid_t clock) {struct timespec t;clock_gettime(clock,&t);return (uint64)t.tv_sec*1000000000+t.tv_nsec;}
static void run(QueryDesc *q,ScanDirection dir,uint64 count,bool once) {
 bool tail=q->sourceText && strstr(q->sourceText,"jsonb_to_recordset") && strstr(q->sourceText,"_commits");
 uint64 cpu=tail?nanos(CLOCK_THREAD_CPUTIME_ID):0,wall=tail?nanos(CLOCK_MONOTONIC):0;
 if(previous)previous(q,dir,count,once);else standard_ExecutorRun(q,dir,count,once);
 if(tail) {
  uint64 used=nanos(CLOCK_THREAD_CPUTIME_ID)-cpu,elapsed=nanos(CLOCK_MONOTONIC)-wall;
  const char *directory=getenv("WF_PG_CPU_DIR");
  if(directory) {char path[1024];snprintf(path,sizeof(path),"%s/%d.csv",directory,MyProcPid);FILE *f=fopen(path,"a");if(f){fprintf(f,"%llu,%llu\n",(unsigned long long)used,(unsigned long long)elapsed);fclose(f);}}
 }
}
void _PG_init(void) {previous=ExecutorRun_hook;ExecutorRun_hook=run;}
