#!/usr/bin/env python3
import argparse,json,sys
from evidence import verify_directory
p=argparse.ArgumentParser();p.add_argument('directory');p.add_argument('--segment',choices=['m6','m8'],required=True);a=p.parse_args()
try:
 m,receipts=verify_directory(a.directory,a.segment)
 value=False if any(r['pass'] is False for r in receipts) else (True if all(r['pass'] is True for r in receipts) else None)
 result={'valid':True,'pass':value,'reason':m['failure']['reason'] if m.get('failure') else (None if value is not None else 'native-unmeasured'),'requiredForGreen':False}
except Exception as e:result={'valid':False,'pass':None,'reason':str(e),'requiredForGreen':False}
print(json.dumps(result));sys.exit(0 if result['valid'] else 2)
