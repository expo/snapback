import {parse} from '@babel/parser';import generateImport from '@babel/generator';import fs from 'node:fs';
const generate=generateImport.default??generateImport;
for(const file of ['src/chat.tsx','src/acquire.ts','src/client.tsx']){const source=parse(fs.readFileSync(file,'utf8'),{sourceType:'module',plugins:['typescript','jsx']});fs.writeFileSync(file,generate(source,{compact:false}).code+'\n');}
