"""Bounded diagnostic: unchanged normal seed 130, stop at first traced failure.

Run prepare-search-control.py first. This is not a suite replacement and makes
no claim that unexecuted repetitions passed. The parent reports its actual count.
"""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
source=root/'target/sl-load/controls/ordinary-search-trace-v2.test.mjs'
s=source.read_text();start=s.index("for (const host of ['process']) for (let repetition")
s=s[:start]+'''test('trace unchanged normal process seed 130, at most 500 repetitions', {timeout: 1_000_000}, async () => {
    for (let repetition = 1; repetition <= 500; repetition++) {
        console.log('SEARCH_REPETITION_START ' + repetition);
        await scenario('process', 130);
        console.log('SEARCH_REPETITION_PASS ' + repetition);
    }
});
'''
target=root/'target/sl-load/controls/ordinary-search-until-failure.test.mjs';target.write_text(s)
Path(__file__).with_name('search-until-failure-source.json').write_text(json.dumps({'input':str(source.relative_to(root)), 'input_sha256':hashlib.sha256(source.read_bytes()).hexdigest(), 'output':str(target.relative_to(root)), 'output_sha256':hashlib.sha256(target.read_bytes()).hexdigest(), 'seed':130, 'host':'process', 'schedule':'normal', 'maximum_repetitions':500, 'stopping_condition':'first unchanged assertion failure, explicitly traced'},indent=2)+'\n')
