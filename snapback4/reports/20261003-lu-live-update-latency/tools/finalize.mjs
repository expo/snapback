// Replay streamed evidence without retaining its (potentially GB-sized) events.
import {createReadStream,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {stamps,stages,quantile} from './stages.mjs';
for(const path of process.argv.slice(2)) {
 const data=JSON.parse(readFileSync(path,'utf8')),groups=new Map(),csv=[];
 const fields=['commit','delivery','published','received','notice','deliveredNotice','sync','evaluation','observation','render'];
 csv.push(['burners','run','shape','viewer',...fields].join(','));
 function add(s) {
  const key=s.burners+':'+s.shape;
  if(!groups.has(key))groups.set(key,{views:[],slowest:[],chunks:[],reads:[]});
  const g=groups.get(key);
  g.slowest.push(Math.max(...s.views.map(v=>v.trial.render-s.commit.at)));
  for(const [viewer,v]of s.views.entries()) {
   g.views.push(v.events?stages(s,v):v.stages);
   if(v.events){
    const t=stamps(s,v);csv.push([s.burners,s.run,s.shape,viewer,...fields.map(f=>Number.isFinite(t[f])?t[f].toFixed(3):'')].join(','));
    const starts=new Map(v.events.filter(e=>e.stage==='request'&&e.path.startsWith('/q/')&&e.at>=s.commit.at).map(e=>[e.id,e.at]));
    for(const e of v.events)if(e.stage==='response'&&starts.has(e.id)&&e.at<=t.render)g.reads.push(e.at-starts.get(e.id));
   }
  }
  const end=s.shape==='repost'?s.server.find(e=>e.stage==='delivery'&&e.kind==='delivery'&&e.done&&e.at>=s.commit.at)?.at:s.commit.at;
  g.chunks.push(s.server.filter(e=>e.stage==='delivery'&&e.at>=s.commit.at&&e.at<end).length);
 }
 if(existsSync(path+'.jsonl')) {
  for await(const line of createInterface({input:createReadStream(path+'.jsonl'),crlfDelay:Infinity}))if(line)add(JSON.parse(line));
 } else for(const s of data.samples)add(s);
 const load={};
 for(const burners of data.metadata.levels) {
  const rows=data.loads.filter(x=>x.burners===burners),busy=[];
  for(let i=1;i<rows.length;i++) {
   let total=0,idle=0;
   for(let j=0;j<rows[i].cpu.length;j++) {
    const a=rows[i-1].cpu[j],b=rows[i].cpu[j];
    for(let k=1;k<=8;k++)total+=b[k]-a[k];
    idle+=b[4]-a[4]+b[5]-a[5];
   }
   if(total>0)busy.push(100*(total-idle)/total);
  }
  load[burners]={burnersPerCpu:burners/data.metadata.cpus,scopedBusyPercent:quantile(busy),hostOneMinuteLoad:quantile(rows.map(x=>x.load[0]))};
 }
 const result={metadata:data.metadata,errors:data.errors,load,groups:Object.fromEntries([...groups].map(([key,g])=>[key,{
  slowestRemoteRender:quantile(g.slowest),chunksBeforeDelivery:quantile(g.chunks),httpQueryRoundTrip:quantile(g.reads),
  stages:Object.fromEntries([...new Set(g.views.flatMap(Object.keys))].map(field=>[field,quantile(g.views.map(r=>r[field]))]))
 }]))};
 writeFileSync(path.replace(/\.json$/,'.summary.json'),JSON.stringify(result,null,2)+'\n');
 if(csv.length>1)writeFileSync(path.replace(/\.json$/,'.stamps.csv'),csv.join('\n')+'\n');
 console.log(path,JSON.stringify(Object.fromEntries(Object.entries(result.groups).map(([k,g])=>[k,g.slowestRemoteRender]))));
}
