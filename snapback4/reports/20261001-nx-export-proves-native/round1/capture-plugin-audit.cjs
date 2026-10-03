const fs=require('fs'),path=require('path'),{createRequire,builtinModules}=require('module'),crypto=require('crypto');
const project=fs.realpathSync(process.argv[2] || process.cwd()),req=createRequire(project+'/package.json');
const files={}, entries={}, resolutions={};
const relative=file=>file.startsWith(project+'/packages/snapback4-expo/')?'snapback4-expo/'+path.relative(project+'/packages/snapback4-expo',file):path.relative(project+'/node_modules',file);
for(const plugin of ['expo-router','expo-sqlite','expo-secure-store','expo-status-bar','expo-image-picker','snapback4-expo/plugin']) {
  const name=plugin.split('/')[0],spec=plugin.includes('/')?plugin:plugin+'/app.plugin.js';let entry;try{entry=req.resolve(spec)}catch{continue}if(!entry.startsWith(project+'/node_modules/'))continue;const seen=new Set();
  function walk(file) {
    if(seen.has(file)) return;seen.add(file);
    const rel=relative(file);if(rel.startsWith('../'))throw Error(file);
    const bytes=fs.readFileSync(file);files[rel]=crypto.createHash('sha256').update(bytes).digest('hex');
    let dir=path.dirname(file);
    while(dir.startsWith(project+'/node_modules/') || dir.startsWith(project+'/packages/snapback4-expo')) {
      if(fs.existsSync(path.join(dir,'package.json')))walk(path.join(dir,'package.json'));
      dir=path.dirname(dir);
    }
    if(!/\.[cm]?js$/.test(file))return;
    const local=createRequire(file);
    for(const m of bytes.toString().matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)){
      if(builtinModules.includes(m[1])||m[1].startsWith('node:'))continue;
      let target;try{target=local.resolve(m[1])}catch{target=null}
      (resolutions[rel]??={})[m[1]]=target?relative(target):null;
      if(target)walk(target);
    }
  }
  walk(entry);entries[plugin]={spec,entry:relative(entry),version:req(name+'/package.json').version,files:[...seen].map(relative).sort()};
}
fs.writeFileSync(process.argv[3], JSON.stringify({entries,files,resolutions}));
console.log(Object.keys(files).length+' audited files');
