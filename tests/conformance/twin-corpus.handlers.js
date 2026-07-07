// The LLP 0048 conformance-twin corpus module: one handler set covering the
// proof's app surface (query, mutation, read-your-writes), the LLP 0009
// conformance floor (settlement, detached rejection, denial), the allowlist
// slice, and the LLP 0047 kill path. Executed unchanged on both engines by
// src/bin/snapback-conformance-twin.rs and asserted case-by-case in
// tests/conformance_twin_v0.rs-adjacent suites.
globalThis.__snapbackHandlers = {
  async addItem(ctx, args) {
    var id = await ctx.db.insert('items', { label: args.label, rank: args.rank });
    return { id: id };
  },
  async listRanked(ctx, args) {
    return await ctx.db
      .query('items')
      .gte('rank', args.min)
      .order('rank', 'asc')
      .take(10)
      .collect();
  },
  async firstItem(ctx) {
    var row = await ctx.db.query('items').order('rank', 'asc').first();
    return row ? [row] : [];
  },
  async readYourWrites(ctx, args) {
    await ctx.db.insert('items', { label: args.label, rank: 1 });
    var rows = await ctx.db.query('items').eq('label', args.label).collect();
    return { visible: rows.length };
  },
  async patchAndDelete(ctx) {
    var id = await ctx.db.insert('items', { label: 'temp', rank: 9 });
    var existed = await ctx.db.patch('items', id, { label: 'patched' });
    var seen = await ctx.db.get('items', id);
    var removed = await ctx.db.delete('items', id);
    return { existed: existed, label: seen && seen.label, removed: removed };
  },
  async nowAndId(ctx) {
    var now = await ctx.runtime.now();
    var id = await ctx.runtime.id();
    await ctx.db.insert('items', { label: 'stamped-' + id, rank: 2 });
    return { now: now, idLength: String(id).length };
  },
  async logsThings(ctx) {
    console.log('one', 1, true);
    console.warn('two');
    console.error('three');
    return [];
  },
  async allowlistSlice(ctx, args) {
    var encoder = new TextEncoder();
    var bytes = encoder.encode(args.text);
    var decoder = new TextDecoder();
    var roundTrip = decoder.decode(bytes);
    var byteList = [];
    for (var i = 0; i < bytes.length; i++) { byteList.push(bytes[i]); }
    return [{
      bytes: byteList,
      roundTrip: roundTrip,
      encoded: btoa('snapback conformance'),
      decoded: atob('c25hcGJhY2s=')
    }];
  },
  async writeInQuery(ctx) {
    await ctx.db.insert('items', { label: 'nope', rank: 0 });
    return [];
  },
  async returnsFunction(ctx) {
    await ctx.db.insert('items', { label: 'should-not-commit', rank: 4 });
    return function () {};
  },
  async hangForever(ctx) {
    await new Promise(function () {});
    return {};
  },
  async detachedRejection(ctx) {
    Promise.resolve().then(function () {
      throw new Error('detached failure');
    });
    await ctx.db.insert('items', { label: 'should-not-commit', rank: 3 });
    return {};
  },
  async busyLoop(ctx) {
    await ctx.db.insert('items', { label: 'pre-kill', rank: 5 });
    for (;;) {}
  },
  async probeFetch(ctx) {
    var value = globalThis.fetch;
    if (value === undefined || value === null) {
      return [{ reachable: false, how: 'absent' }];
    }
    try {
      value('https://example.com');
      return [{ reachable: true, how: 'callable' }];
    } catch (error) {
      var message = String(error && error.message || error);
      if (message.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') === 0) {
        return [{ reachable: false, how: 'denied' }];
      }
      return [{ reachable: true, how: 'callable-throws' }];
    }
  },
  async probeDateNow(ctx) {
    try {
      Date.now();
      return [{ reachable: true }];
    } catch (error) {
      return [{ reachable: false }];
    }
  },
  async dumpItems(ctx) {
    return await ctx.db.query('items').order('rank', 'asc').collect();
  }
};
