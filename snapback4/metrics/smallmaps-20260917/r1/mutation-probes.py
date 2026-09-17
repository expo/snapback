from pathlib import Path
import subprocess, sys
base=Path('crates/snapback4-core')
probes=[
 ('entry', base/'src/smallmap.rs', 'if let Ok(index) = self.index { f(&mut self.map.0[index].1); }', 'if let Ok(_index) = self.index { let _ = f; }', ['cargo','test','-p','snapback4-core','--test','smallmap','seeded_operations_match_btree']),
 ('identity', base/'src/smallmap.rs', 'serializer.collect_map(self)', 'serializer.collect_map(self.iter().rev())', ['cargo','test','-p','snapback4-core','--test','ordered_identity']),
 ('row-type', base/'tests/smallmap.rs', 'small_fields(&original);', 'small_fields(&std::sync::Arc::new(BTreeMap::<String, Value>::new()));', ['cargo','test','-p','snapback4-core','--test','smallmap','row_images_keep_sharing_order_and_meter_charges']),
]
for name,path,before,after,command in probes:
 if len(sys.argv) > 1 and name != sys.argv[1]: continue
 text=path.read_text(); assert before in text
 try:
  path.write_text(text.replace(before,after,1))
  with open('target/d2/r1/red-mutation-'+name+'.log','w') as log:
   log.write('Mutation: '+before+' => '+after+'\nCommand: '+' '.join(command)+'\n');log.flush()
   result=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
  assert result.returncode != 0, name+' mutation escaped'
  print(name,'rejected with exit',result.returncode,flush=True)
 finally:path.write_text(text)
