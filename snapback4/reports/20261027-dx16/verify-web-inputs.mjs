import{execFileSync}from'node:child_process';import{readFileSync}from'node:fs';
const changed=execFileSync('git',['diff','--name-only','c9c3a35461','HEAD','--','snapback4/crates/snapback4-core','snapback4/crates/snapback4-device'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const allowed=['snapback4/crates/snapback4-core/src/store/inspect.rs','snapback4/crates/snapback4-core/src/store/inspect_merged.rs','snapback4/crates/snapback4-core/src/store/port/tooling.rs','snapback4/crates/snapback4-core/src/engine/revision_cache_grant_tests.rs'];
if(changed.some(path=>!allowed.includes(path)))throw Error('Web semantic inputs changed: '+changed);
if(!readFileSync('snapback4/crates/snapback4-core/src/lib.rs','utf8').includes('#[cfg(feature = "sqlite")]\npub mod store;'))throw Error('Store no longer excluded from web');
if(!readFileSync('snapback4/crates/snapback4-core/src/engine/revision_cache.rs','utf8').includes('#[cfg(test)]\n#[path = "revision_cache_tests.rs"]'))throw Error('Upstream grant test no longer cfg(test)');
console.log('Reuse built web device: only sqlite store inspection and an upstream cfg(test) grant test changed; no device/schema/version change.');
