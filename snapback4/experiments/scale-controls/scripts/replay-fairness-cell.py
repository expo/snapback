#!/usr/bin/env python3
"""Replay one matched S1-FR cell with the private fixtures and unchanged search.

Run detached with setsid nohup; record the launcher PID and poll until exit.
"""
import argparse
from pathlib import Path

from fairness import Raw, Supabase
from run import write


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--target',choices=['raw-pg','raw-pg-no-token','supabase'],required=True)
    p.add_argument('--out',required=True)
    p.add_argument('--workload',choices=['W1','W2','W3','W4','W5'],required=True)
    p.add_argument('--delay-us',choices=[0,500],type=int,required=True)
    p.add_argument('--keys',choices=['disjoint','same','hot1'],default='disjoint')
    p.add_argument('--tunnel-base',type=int,default=63100)
    args=p.parse_args()
    if args.workload in ('W1','W2','W3','W4') and args.keys!='disjoint': p.error('W1-W4 use disjoint')
    if args.workload=='W5' and args.keys not in ('same','hot1'): p.error('W5 uses same or hot1')
    args.warmup_ms=10000;args.duration_ms=20000;args.repeats=3
    args.max_rate=128000;args.rates=None;args.load_cores='3-5,9-11'
    run=Supabase(args) if args.target=='supabase' else Raw(args)
    run.query_pool_budget=32
    try:
        run.start(34 if args.target=='supabase' else 33)
        run.fixture(1000000)
        workers=128 if args.workload in ('W1','W2','W3') else 32
        run.cell(args.workload,1000000,args.delay_us,workers,args.keys)
    finally: run.close()


if __name__=='__main__': main()
