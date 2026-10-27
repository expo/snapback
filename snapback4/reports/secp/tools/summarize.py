#!/usr/bin/env python3
"""Summarize frozen SECP measurements and independently source-backed labels."""
import argparse,collections,gzip,hashlib,json,math,pathlib,statistics
p=argparse.ArgumentParser();p.add_argument('--before',required=True);p.add_argument('--after',required=True);p.add_argument('--older-before',required=True);p.add_argument('--older-after',required=True);p.add_argument('--wave30-manual',required=True);p.add_argument('--wave30-after',required=True);p.add_argument('--out',required=True);a=p.parse_args()
def read(path):
 raw=pathlib.Path(path).read_bytes();return json.loads(gzip.decompress(raw) if str(path).endswith('.gz') else raw)
before,after=read(a.before),read(a.after)
assert len(before)==len(after)==250
index={(r['wave'],r['lane']):r for r in before}
assert all(index[r['wave'],r['lane']]['sha256']==r['sha256'] for r in after)
manual=read(a.wave30_manual);wave30=read(a.wave30_after)
labels={}
for phase,path in [('before',a.older_before),('after',a.older_after)]:
 old=read(path);assert all(not n['uncertainty'] for n in old['notes'])
 labels[phase]=[(n['identity']['wave'],n['identity']['code'],n['classification']) for n in old['notes']]
labels['before'] += [(30,n['code'],n['classification'])for n in manual['notes']if n['phase']=='before']
labels['after'] += [(30,n['code'],n['classification'])for n in wave30['notes']]
assert all(label in ['false','real_question']for notes in labels.values()for _,_,label in notes)
codes=set(manual['scope']['codes'])
assert len(labels['before'])==sum(n['code']in codes for r in before for n in r['notes'])
assert len(labels['after'])==sum(n['code']in codes for r in after for n in r['notes'])
assert all('\n' not in n['message'] and 'saw 'in n['message'] and 'not proved:'in n['message'] for r in after for n in r['notes']if n['code']in codes)
def count(phase,waves,code=None):return dict(collections.Counter(label for wave,c,label in labels[phase]if wave in waves and (code is None or c==code)))
def dist(values):return dict(median=statistics.median(values),p90=sorted(values)[math.ceil(len(values)*.9)-1],max=max(values))
def metrics(rows):return dict(reviewDecisions=dist([sum(not v.get('acknowledged',False)for v in r['reviews'])for r in rows]),defaultCheckLines=dist([r['defaultCheck']['lines']for r in rows]),gatedQuestions=sum(len(r['gates'])for r in rows),nonzeroCheckExits=sum(r['checkExit']!=0 for r in rows))
result=dict(scope=dict(schemas=250,waves=[26,27,28,29,30],codes=sorted(codes),unchanged_source_bundles=True),inputs={key:dict(path=value,sha256=hashlib.sha256(pathlib.Path(value).read_bytes()).hexdigest()) for key,value in vars(a).items() if key!='out'},waves=[],codes=[],overall=dict(before=metrics(before),after=metrics(after)),older={},wave30={},defaultLineIncreases=[])
for wave in range(26,31):
 b=count('before',[wave]);c=count('after',[wave]);result['waves'].append(dict(wave=wave,before=b,after=c,falseReduction=1-c.get('false',0)/b['false'],beforeMetrics=metrics([r for r in before if r['wave']==wave]),afterMetrics=metrics([r for r in after if r['wave']==wave])))
for code in sorted(codes):result['codes'].append(dict(code=code,before=count('before',range(26,31),code),after=count('after',range(26,31),code)))
for key,waves in [('older',range(26,30)),('wave30',[30])]:
 b=count('before',waves);c=count('after',waves);result[key]=dict(before=b,after=c,falseReduction=1-c.get('false',0)/b['false'])
for r in after:
 b=index[r['wave'],r['lane']]
 if r['defaultCheck']['lines']>b['defaultCheck']['lines']:result['defaultLineIncreases'].append(dict(wave=r['wave'],lane=r['lane'],before=b['defaultCheck']['lines'],after=r['defaultCheck']['lines']))
result['acceptance']=dict(wave30_zero_false=result['wave30']['after'].get('false',0)==0,older_80_percent_reduction=result['older']['falseReduction']>=.8,all_selected_messages_one_line_guard_and_gap=True)
pathlib.Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(dict(older=result['older'],wave30=result['wave30'],overall=result['overall'],acceptance=result['acceptance']),indent=2))
