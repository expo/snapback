import datetime,pathlib,sys
p=pathlib.Path('/home/ccheever/sb4-pub-0451-records/STATUS.md')
with p.open('a') as f:f.write('- '+datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')+' '+' '.join(sys.argv[1:])+'\n')
