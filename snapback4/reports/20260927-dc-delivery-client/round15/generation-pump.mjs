import {registerHooks} from 'node:module';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
registerHooks({load(url,context,next){
 const result=next(url,context);
 if(!url.endsWith('/test/delivery.test.mjs'))return result;
 const source=execFileSync('git',['show','b8400c291:snapback4/packages/snapback4/test/delivery.test.mjs'],{encoding:'utf8'});
 const before='pending.resolve(ok);await settle();assert.deepEqual(groups(await h.state())[0].owed,[[2,2]]);';
 assert.equal(source.split(before).length,2);
 return {...result,source:source.replace(before,before.replace('await settle();','await h.flush();'))};
}});
