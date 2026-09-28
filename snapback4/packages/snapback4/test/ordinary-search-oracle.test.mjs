// @ref LLP 3000.028#7.2 — seeded real-host model with inter-page mutations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '../dist/client.js';
import { createLocalClient } from '../dist/local.js';
import { processDevice } from '../dist/native.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
import { binary, server, until } from './helpers/app-server.mjs';
import { parkedChanges } from './helpers/sync-control.mjs';
import { random, compare, SearchModel, KeysetModel, schema } from './helpers/search-oracle.mjs';
const query = { kind: 'query', name: 'search' }, wasm = readFileSync(new URL('../src/wasm/snapback4_device_bg.wasm', import.meta.url));
const decode = c => c?.startsWith('sb4s:') ? JSON.parse(Buffer.from(c.slice(5), 'base64url')) : null;
async function scenario(host, seed, currentOnly = false) {
    const rng = random(seed), direction = rng(2) ? 'first' : 'last', limit = seed % 75 === 0 ? 100 : [2, 3, 5, 9][rng(4)], mutable = seed % 11 === 0;
    const cut = seed % 75 === 0 ? 'meter' : seed % 12 === 0 ? 'words' : null, source = schema({ direction, limit, mutable });
    const callbacks = [], scope = { after: f => callbacks.push(f) }, trace = [{ seed, host, direction, limit, mutable, cut, currentOnly }], events = [];
    let client, admin, owner, offline = false, core, calls = 0, target, targetDir, generationChanges = 0;
    try {
        const initial = await server(scope, '', source, { watch: true });
        target = initial.url;
        targetDir = initial.dir;
        const rows = Array.from({ length: cut === 'meter' ? 8194 : cut === 'words' ? 42 : 22 + rng(9) }, (_, i) => ({
            id: (i % 7 === 0 ? '\ue000' : i % 7 === 1 ? '\u{10000}' : 'm') + String(i).padStart(5, '0'),
            room: cut === 'meter' ? (i < 8192 ? 'live' : 'left') : i % 2 ? 'left' : 'live',
            at: cut === 'meter' ? (i < 8192 ? i + 10 : 1) : Math.floor(i / 2) * 10, text: cut === 'words' ? `coffee${String(i).padStart(2, '0')}` : 'coffee', tombstone: false, expires: null
        }));
        rows.push({ id: 'hidden', room: 'hidden', at: 99999, text: 'coffee', tombstone: false, expires: null });
        const model = new SearchModel(rows);
        async function seedRows(url, data) { for (let n = 0; n < data.length; n += 200) {
            const batch = data.slice(n, n + 200), reply = await fetch(`${url}/seed`, { method: 'POST', body: JSON.stringify(batch) }).then(r => r.json());
            assert.equal(reply.seeded, batch.length, JSON.stringify(reply));
        } }
        const members = () => [...model.members].map(room => ({ table: 'members', row: { id: `member${room}`, room, principal: 'dev:bob' } })).concat(['live', 'left'].map(room => ({ table: 'members', row: { id: `admin${room}`, room, principal: 'dev:alice' } })));
        await seedRows(target, [...members(), ...rows.map(row => ({ table: 'messages', row }))]);
        admin = createClient({ url: target, persona: 'alice' });
        owner = createClient({ url: target, persona: 'bob' });
        const opener = host === 'wasm' ? webDevice({ wasm, persist: memoryPersistence() }) : processDevice({ binary, dir: join(initial.dir, 'device') });
        const options = { url: initial.url, persona: 'bob', device: { async open(...args) { core = await opener.open(...args); return core; } }, fetch: async (input, init) => {
                if (offline)
                    throw new TypeError('offline');
                const path = new URL(input).pathname;
                if (path === '/changes')
                    return parkedChanges(init.signal);
                if (path.startsWith('/q/'))
                    calls++;
                return fetch(String(input).replace(initial.url, target), init);
            } };
        client = await createLocalClient(options);
        await client.sync();
        model.sync();
        async function mutate(name, args) { const fields = name === 'edit' ? ['id', 'text', 'at', 'expires'] : name === 'relocate' ? ['id', 'room', 'text', 'at'] : ['room']; const r = await (name === 'leave' ? owner : admin).mutate({ kind: 'mutation', name }, Object.fromEntries(fields.map(k => [k, args[k]]))); assert.equal(r.state, 'sent', JSON.stringify(r)); }
        if (!currentOnly) {
            await mutate('leave', { room: 'left' });
            model.members.delete('left');
        }
        await client.sync();
        model.sync();
        if (mutable) {
            const row = rows.find(r => r.room === 'left'), next = { ...row, room: 'live', at: direction === 'last' ? 9990 : -10, text: 'coffee moved' };
            await mutate('relocate', next);
            model.write(next);
            trace.push('pre-traversal move');
        }
        const visible = () => model.readable(!offline && !mutable);
        const keyset = new KeysetModel(visible(), direction);
        let c, changed = false, freshIdentity = false, forceReset = false, resets = 0;
        const differential = currentOnly && !mutable && !cut;
        let serverCursor, differentialPages = 0;
        function restart() { keyset.restart(visible()); serverCursor = undefined; resets++; }
        function synced() {
            if (offline) return;
            if (freshIdentity) {
                model.reset();
                freshIdentity = false;
                changed = true;
                forceReset = !mutable;
            }
            model.sync();
        }
        for (let page = 0; page < 200; page++) {
            keyset.observe(visible());
            const before = calls, read = await client.query(query, { q: 'cof', c });
            trace.push({ page, c: !!c, ids: read.data?.map(r => r.id), loading: read.loading, denied: read.denied?.code, cut: read.cut, complete: read.complete, next: !!read.next, calls: calls - before });
            if (!offline && !mutable)
                assert.equal(calls - before, 1, 'exactly one invocation per online page');
            else if (mutable)
                assert.ok(calls - before <= 1);
            else
                assert.equal(calls, before);
            if (freshIdentity && !offline && calls > before) {
                assert.equal(read.data, undefined, 'identity change must withdraw stale attempt');
                await client.sync();
                model.reset();
                model.sync();
                c = undefined;
                restart();
                freshIdentity = false;
                changed = false;
                continue;
            }
            if (read.loading) {
                assert.ok(changed || freshIdentity || offline, 'unexplained withdrawn page');
                if (offline) {
                    offline = false;
                    trace.push('reconnect after reset without acquired data');
                }
                await client.sync();
                if (freshIdentity)
                    model.reset();
                model.sync();
                c = undefined;
                restart();
                freshIdentity = false;
                changed = false;
                continue;
            }
            if (read.denied) {
                assert.ok(cut && ['E_BOUND', 'E_SEARCH_OPEN'].includes(read.denied.code), JSON.stringify(read));
                events.push(`refusal:${read.denied.code}`);
                break;
            }
            assert.ok(Array.isArray(read.data), JSON.stringify(read));
            const old = decode(c), next = decode(read.next);
            if (forceReset && !mutable || changed && old && (offline || next && (old.epoch !== next.epoch || old.binding !== next.binding)))
                restart();
            changed = false;
            forceReset = false;
            const readable = visible(), allowed = new Map(readable.map(r => [r.id, r]));
            keyset.observe(readable);
            assert.deepEqual(read.data.map(r => r.id), [...read.data].sort((a, b) => (direction === 'first' ? 1 : -1) * compare(a, b)).map(r => r.id), 'page order');
            for (const row of read.data) {
                assert.ok(allowed.has(row.id), `unreadable ${row.id}`);
                assert.ok([allowed.get(row.id), ...(mutable ? [model.images.get(row.id)] : [])].some(r => r && Object.keys(row).every(k => row[k] === r[k])), `wrong visible image ${row.id}`);
            }
            // Cuts keep their original incomplete-subset contract. An online
            // suspended retained lane must still equal the server keyset page.
            const suspended = !offline && !mutable && (next?.localCut || old?.localCut);
            const domain = suspended ? readable.filter(row => model.members.has(row.room)) : readable;
            const remaining = keyset.remaining(domain);
            const expected = remaining.slice(0, limit);
            if (!cut || !offline && !mutable) {
                assert.deepEqual(read.data, expected, 'page equals current combined keyset model');
                if (!read.next) assert.ok(remaining.length <= limit, 'terminal keyset omission');
                if (read.complete && !read.next) assert.ok(!keyset.remaining(readable).slice(limit).length, 'false terminal complete');
                keyset.consume(expected);
            } else {
                // The ordinary device cut need not establish a global prefix;
                // authorization/order/one-call/dead-end checks still apply.
                keyset.consume(read.data);
            }
            for (const id of keyset.stable.keys()) assert.ok((keyset.counts.get(id) ?? 0) <= 1, `stable duplicate: ${id}`);
            if (differential && !offline) {
                const direct = await owner.query(query, { q: 'cof', c: serverCursor });
                assert.deepEqual(read.data, direct.data, 'server-only differential page');
                assert.equal(read.complete, direct.complete, 'server-only differential complete');
                assert.equal(!!read.next, !!direct.next, 'server-only differential continuation');
                serverCursor = direct.next;
                differentialPages++;
                events.push('differential-page');
            }
            assert.ok(read.data.length || read.complete || read.next, 'empty dead end');
            if (!read.next) {
                if (!cut)
                    for (const id of keyset.stable.keys())
                        assert.equal(keyset.counts.get(id), 1, `stable match omitted: ${id}`);
                events.push(`terminal:${read.cut ?? 'none'}`);
                break;
            }
            c = read.next;
            if (page === 199)
                assert.fail('nonterminating traversal');
            if (page >= 5)
                continue;
            let action = rng(mutable ? 11 : 10);
            const shouldSync = !!rng(2);
            // Additional server-only differential schedules stay online/current;
            // the original 300 schedules still exercise every lifecycle action.
            if (currentOnly && [1, 2].includes(action)) action = 3;
            if (currentOnly && action === 9) action = 0;
            trace.push({ action, shouldSync });
            if (action === 0) {
                if (shouldSync) {
                    await client.sync();
                    synced();
                }
                events.push('sync');
            }
            if (action === 1 || action === 2) {
                const room = rng(2) ? 'left' : 'live';
                if (model.members.has(room)) {
                    await mutate('leave', { room });
                    model.members.delete(room);
                }
                else {
                    await mutate('join', { room });
                    model.members.add(room);
                }
                changed = true;
                forceReset = shouldSync && !offline;
                events.push('membership');
                if (shouldSync) {
                    await client.sync();
                    synced();
                }
            }
            if (action === 3) {
                const row = { id: `new${page}`, room: 'live', text: 'coffee new', at: rng(250), tombstone: false, expires: null };
                await seedRows(target, [{ table: 'messages', row }]);
                model.write(row);
                events.push('new');
                if (shouldSync) {
                    await client.sync();
                    synced();
                }
            }
            if (action === 4 || action === 5 || action === 6) {
                const candidates = [...model.rows.values()].filter(r => model.members.has(r.room) && (r.expires == null || r.expires > Date.now()));
                if (!candidates.length)
                    continue;
                const row = { ...candidates[rng(candidates.length)] };
                if (action === 4)
                    row.text = rng(2) ? 'coffee edited' : 'tea';
                if (action === 5)
                    row.at = rng(300);
                if (action === 6)
                    row.expires = 1;
                trace.push({ edit: row });
                await mutate('edit', row);
                model.write(row);
                events.push(['body', 'at', 'expiry'][action - 4]);
                if (shouldSync) {
                    await client.sync();
                    synced();
                }
            }
            if (action === 7 && seed % 3 !== 0) {
                const replacement = await server(scope, '', source, { watch: true }), row = { id: `incarnation${page}`, room: 'live', text: 'coffee incarnation', at: direction === 'last' ? 9990 : -10, tombstone: false, expires: null };
                model.write(row);
                await seedRows(replacement.url, [...members(), ...[...model.rows.values()].filter(r => r.expires == null).map(row => ({ table: 'messages', row }))]);
                await admin.close();
                await owner.close();
                target = replacement.url;
                targetDir = replacement.dir;
                admin = createClient({ url: target, persona: 'alice' });
                owner = createClient({ url: target, persona: 'bob' });
                freshIdentity = true;
                events.push('replacement');
            }
            if (action === 7 && seed % 3 === 0) {
                const previous = await fetch(`${target}/schema`, { headers: { "x-snapback-persona": "bob" } }).then(r => r.json());
                writeFileSync(join(targetDir, 'snapback/schema.q'), source + `\nquery generation${++generationChanges}():\n  return true\n`);
                await until(async () => { const next = await fetch(`${target}/schema`, { headers: { "x-snapback-persona": "bob" } }).then(r => r.json()); return next.generation > previous.generation; }, 'generation adoption');
                freshIdentity = true;
                events.push('generation');
            }
            if (action === 10) {
                const candidate = [...model.rows.values()].find(r => r.room === 'left' && r.expires == null);
                if (candidate) {
                    const row = { ...candidate, room: 'live', at: rng(300) };
                    trace.push({ relocate: row });
                    await mutate('relocate', row);
                    model.write(row);
                    events.push('move');
                    if (shouldSync) {
                        await client.sync();
                        synced();
                    }
                }
            }
            if (action === 8) {
                if (shouldSync) {
                    await core.call({ op: 'clear_rows' });
                    model.reset();
                    changed = true;
                    forceReset = true;
                }
                await client.close();
                client = await createLocalClient(options);
                await client.sync();
                synced();
                events.push(shouldSync ? 'reset' : 'reopen');
            }
            if (action === 9) {
                offline = !offline;
                await client.sync();
                if (!offline) {
                    if (freshIdentity) {
                        model.reset();
                        freshIdentity = false;
                    }
                    model.sync();
                    forceReset = true;
                }
                changed = true;
                events.push('link');
            }
        }
        return { events, resets, differentialPages };
    }
    catch (error) {
        error.message += `\nORACLE ${JSON.stringify(trace)}`;
        throw error;
    }
    finally {
        await client?.close();
        await admin?.close();
        await owner?.close();
        for (const cleanup of callbacks.reverse())
            await cleanup();
    }
}
const seeds = process.env.SB4_SEARCH_SEEDS?.split(',').map(Number) ?? Array.from({ length: 300 }, (_, i) => i + 1);
for (const host of ['process', 'wasm'])
    test(`ordinary search generated oracle ${host}: ${seeds.length} seeds`, { timeout: 600000 }, async () => {
        const failures = [], coverage = {}, start = Date.now();
        for (const seed of seeds) {
            try {
                const r = await scenario(host, seed);
                if (seed % 10 === 0 && seed % 11 !== 0 && seed % 12 !== 0 && seed % 75 !== 0) {
                    const extra = await scenario(host, seed, true);
                    assert.ok(extra.differentialPages > 0, 'current-only schedule exercised differential');
                    r.events.push(...extra.events);
                }
                console.log(`ORACLE_PASS host=${host} seed=${seed}`);
                for (const e of r.events)
                    coverage[e] = (coverage[e] ?? 0) + 1;
            }
            catch (error) {
                failures.push({ seed, message: error.message });
                console.error(`ORACLE_FAIL host=${host} seed=${seed}\n${error.message}\n${error.stack}`);
            }
        }
        console.log(`ORACLE_SUMMARY ${JSON.stringify({ host, seeds: seeds.length, failed: failures.map(f => f.seed), ms: Date.now() - start, coverage })}`);
        assert.equal(failures.length, 0, JSON.stringify(failures.map(f => ({ seed: f.seed, message: f.message.split('\n')[0] }))));
    });
