import {DatabaseSync} from 'node:sqlite';
export function dec(v){
  if(v===null||v===undefined) return v;
  if(v==='Null') return null;
  if(typeof v!=='object') return v;
  const k=Object.keys(v)[0];
  if(k==='Row'){const o={};for(const[a,b]of Object.entries(v.Row))o[a]=dec(b);return o;}
  if(['Id','String','Int','Bool','Time','Float','Text'].includes(k)) return v[k];
  if(k==='Some') return dec(v.Some);
  return v;
}
export function rows(db,t){return db.prepare('select row_id,data from rows where table_name=?').all(t).map(r=>({_id:r.row_id,...dec(JSON.parse(r.data))}));}
export function open(p){return new DatabaseSync(p);}
