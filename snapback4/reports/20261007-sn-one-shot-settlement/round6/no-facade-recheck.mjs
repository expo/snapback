import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({load(url,ctx,next){
 const out=next(url,ctx);
 if(!url.endsWith('/dist/app-client.js')) return out;
 const source=String(out.source), needle='await read.wait(signal); after = await refusal();';
 assert.equal(source.split(needle).length,2);
 return {...out,source:source.replace(needle,'await read.wait(signal);')};
}});
