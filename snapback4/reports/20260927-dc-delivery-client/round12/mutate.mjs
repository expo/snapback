import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
const edits={
 interval:['effects.parked = [...run];','effects.parked = [run[0], run[0]];'],
 reset:['if (clear) {\n            this.untilStart.clear();','this.untilStart.clear();\n        if (clear) {'],
};
const [before,after]=edits[process.env.DC_MUTANT];
registerHooks({load(url,context,next){
 const result=next(url,context);
 if(!url.endsWith('/dist/delivery.js'))return result;
 const source=String(result.source);
 assert.equal(source.split(before).length,2,'mutation must match exactly once');
 return {...result,source:source.replace(before,after)};
}});
