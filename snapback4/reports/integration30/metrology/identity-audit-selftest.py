from pathlib import Path
import ast,json,collections,re,copy
root=Path(__file__).parent;ns={'json':json,'collections':collections,'missing':object()}
source=root/'identity-tools/direct-upload-audit.py';tree=ast.parse(source.read_text())
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)],type_ignores=[]),str(source),'exec'),ns)
tree=ast.parse((root/'qualify-identity.py').read_text())
nonce_ns={'re':re};exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='valid_nonce_pair'],type_ignores=[]),'qualify-identity.py','exec'),nonce_ns)
old='01HF7YAT00'+'0'*16;new=old[:-1]+'1'
def media(value):return {'Map':{'id':{'Id':value},'bytes':{'Int':1},'type':{'String':'image/png'}}}
a={'reviews':[{'witness':{'id':'fixed','row':{'photo':media(old),'owner':'owner-fixed'},'history':[1,2]}}]}
b=copy.deepcopy(a);b['reviews'][0]['witness']['row']['photo']=media(new)
tests=[]
def check(name,value):assert value,name;tests.append(name)
check('typed media nonce accepted',ns['audit'](a,b,{'photo'})['accepted'])
for name,change in [
 ('ordinary owner ID remains exact',lambda x:x['reviews'][0]['witness']['row'].__setitem__('owner',new)),
 ('witness identity remains exact',lambda x:x['reviews'][0]['witness'].__setitem__('id','changed')),
 ('array order remains exact',lambda x:x['reviews'][0]['witness'].__setitem__('history',[2,1])),
 ('typed scalar remains exact',lambda x:x['reviews'][0]['witness']['row']['photo']['Map'].__setitem__('bytes',{'Int':True})),
 ('MIME remains exact',lambda x:x['reviews'][0]['witness']['row']['photo']['Map'].__setitem__('type',{'String':'text/plain'})),
]:
 c=copy.deepcopy(b);change(c);check(name,not ns['audit'](a,c,{'photo'})['accepted'])
check('logical timestamp remains exact',not nonce_ns['valid_nonce_pair'](old,'02HF7YAT00'+'0'*16))
check('valid ULID pair accepted',nonce_ns['valid_nonce_pair'](old,new))
c,d=copy.deepcopy(a),copy.deepcopy(b)
c['reviews'][0]['witness']['row']['owner']=old;d['reviews'][0]['witness']['row']['owner']=old
check('unchanged graph aliases cannot be lost',not ns['audit'](c,d,{'photo'})['accepted'])
result=dict(passed=len(tests),controls=tests)
(root/'identity-audit-controls.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
