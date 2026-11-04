import assert from 'node:assert/strict'; import {cli} from 'snapback4/proof';
    const options={cwd:"/home/ccheever/sb4-intent/0453/linux-qualification-0.4.53/day2-compatibility/fixture-agreement"};
    const tested=await cli(['test'],options); assert.equal(tested.code,0,tested.stdout+tested.stderr);
    const checked=await cli(['check','--json'],options); assert.equal(checked.code,0,checked.stdout+checked.stderr);
    assert.doesNotMatch(checked.stdout,/N_FIXTURE_ARGUMENT_DRIFT/);
    console.log('packed fixture check/test agreement passed');