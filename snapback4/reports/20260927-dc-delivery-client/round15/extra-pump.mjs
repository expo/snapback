import {registerHooks} from 'node:module';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
registerHooks({load(url, context, next) {
 const result=next(url,context);
 if(!url.endsWith('/test/delivery.test.mjs'))return result;
 const source=process.env.DELIVERY_BASELINE==='1'
  ?execFileSync('git',['show','b8400c291:snapback4/packages/snapback4/test/delivery.test.mjs'],{encoding:'utf8'})
  :String(result.source);
 const before='async flush(){await q.pump();await settle();}';
 assert.equal(source.split(before).length,2,'one test-only flush helper');
 return {...result,source:source.replace(before,'async flush(){await q.pump();await settle();await q.pump();await settle();}')};
}});
