import {journey} from './test.mjs';
const names=process.argv.includes('--list')?['target','other']:['other','target'];
for(const name of names)journey(name,()=>{if(name==='target')throw Error('selected failure');});
