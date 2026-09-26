import re,sys
old,new=sys.argv[1],sys.argv[2]
def sub(path, a, b, count):
    s=open(path).read(); n=s.count(a); assert n==count,(path,a,n); open(path,'w').write(s.replace(a,b))
sub('Cargo.toml',f'version = "{old}"',f'version = "{new}"',1)
sub('packages/snapback4-darwin-arm64/package.json',f'"version": "{old}"',f'"version": "{new}"',1)
sub('packages/snapback4-expo/package.json',f'"version": "{old}"',f'"version": "{new}"',1)
sub('packages/snapback4/package.json',f'"version": "{old}"',f'"version": "{new}"',1)
sub('packages/snapback4/package.json',f'"snapback4-darwin-arm64": "{old}"',f'"snapback4-darwin-arm64": "{new}"',1)
s=open('Cargo.lock').read(); blocks=s.split('[[package]]'); n=0
for i,b in enumerate(blocks):
    if re.search(r'name = "(snapback4[^"]*)"\nversion = "'+re.escape(old)+'"',b): blocks[i]=b.replace(f'version = "{old}"',f'version = "{new}"',1); n+=1
assert n==6,n; open('Cargo.lock','w').write('[[package]]'.join(blocks))
b=open('bun.lock').read(); lines=b.split('\n'); n=0
for i,l in enumerate(lines):
    if re.fullmatch(r'\s*"version": "'+re.escape(old)+'",', l) or re.fullmatch(r'\s*"snapback4-darwin-arm64": "'+re.escape(old)+'",?', l):
        lines[i]=l.replace(old,new); n+=1
assert n==4,n; open('bun.lock','w').write('\n'.join(lines))
print("bumped",old,"->",new)
