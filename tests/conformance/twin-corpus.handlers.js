// The LLP 0048 conformance-twin corpus module: one handler set covering the
// proof's app surface (query, mutation, read-your-writes), the LLP 0009
// conformance floor (settlement, detached rejection, denial), the allowlist
// slice, and the LLP 0047 kill path. Executed unchanged on both engines by
// crates/snapback-conformance/src/bin/snapback-conformance-twin.rs and asserted case-by-case in
// tests/conformance_twin_v0.rs-adjacent suites.
globalThis.__snapbackHandlers = {
  async addItem(ctx, args) {
    var id = await ctx.db.insert('items', { label: args.label, rank: args.rank });
    return { id: id };
  },
  async listItems(ctx) {
    return await ctx.db.query('items').order('rank', 'asc').collect();
  },
  async listRanked(ctx, args) {
    return await ctx.db
      .query('items')
      .gte('rank', args.min)
      .order('rank', 'asc')
      .take(10)
      .collect();
  },
  async queryLimitValidation(ctx) {
    var invalid = [NaN, Infinity, 1.5, -1, 1025];
    var codes = [];
    for (var i = 0; i < invalid.length; i++) {
      try {
        ctx.db.query('items').take(invalid[i]);
        codes.push('accepted');
      } catch (error) {
        codes.push(error && error.__snapbackCode || 'uncoded');
      }
    }
    return [{ codes: codes }];
  },
  async implicitLimitProbe(ctx) {
    var rows = await ctx.db.query('items').collect();
    rows.sort(function(left, right) { return right.rank - left.rank; });
    return rows.slice(0, 1);
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
  async ledgeredIds(ctx, args) {
    // LLP 0051 D1: two runtime.id answers + one insert row id share one
    // ordered generatedIds sequence; now is the frozen invocation clock.
    var a = await ctx.runtime.id();
    var b = await ctx.runtime.id();
    var now = await ctx.runtime.now();
    var rowId = await ctx.db.insert('items', { label: 'ledger-' + args.tag, rank: 3 });
    return { a: a, b: b, now: now, rowId: rowId };
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
    var encoded = btoa('snapback');
    var decoded = atob(encoded);
    var byteList = [];
    for (var i = 0; i < bytes.length; i++) { byteList.push(bytes[i]); }
    console.log('allowlist slice exercised', args.text);
    return [{
      bytes: byteList,
      roundTrip: roundTrip,
      encoded: encoded,
      decoded: decoded
    }];
  },
  async atobRejectsGarbage(ctx) {
    try {
      atob('%%%not-base64%%%');
      return [{ threw: false }];
    } catch (error) {
      var message = String(error && error.message || error);
      return [{ threw: true, coded: message.indexOf('SNAPBACK_HANDLER_INVALID_CHARACTER') === 0 }];
    }
  },
  async encodingBoundaryFidelity(ctx) {
    function invalidBase64(input) {
      try {
        atob(input);
        return false;
      } catch (error) {
        var message = String(error && error.message || error);
        return message.indexOf('SNAPBACK_HANDLER_INVALID_CHARACTER') === 0;
      }
    }
    function splitDecode(bytes, options) {
      var decoder = new TextDecoder('utf-8', options || {});
      var output = [];
      for (var i = 0; i < bytes.length; i++) {
        output.push(decoder.decode(new Uint8Array([bytes[i]]), { stream: true }));
      }
      output.push(decoder.decode());
      return output;
    }
    function decoderLabelAccepted(label) {
      try {
        return new TextDecoder(label).encoding === 'utf-8';
      } catch (_) {
        return false;
      }
    }
    function decoderLabelThrows(label, errorName) {
      try {
        new TextDecoder(label);
        return false;
      } catch (error) {
        return error && error.name === errorName;
      }
    }
    function decoderConstructorLabelAccepted(label) {
      try {
        var Decoder = new TextDecoder().constructor;
        return new Decoder(label).encoding === 'utf-8';
      } catch (_) {
        return false;
      }
    }

    var flushDecoder = new TextDecoder();
    var flush = [
      flushDecoder.decode(new Uint8Array([0xE2]), { stream: true }),
      flushDecoder.decode(),
      flushDecoder.decode(new Uint8Array([0x41]))
    ];

    var fatalFlushDecoder = new TextDecoder('utf-8', { fatal: true });
    var fatalFlushFirst = fatalFlushDecoder.decode(new Uint8Array([0xE2]), { stream: true });
    var fatalFlushThrew = false;
    try { fatalFlushDecoder.decode(); } catch (_) { fatalFlushThrew = true; }
    var fatalFlushReuse = fatalFlushDecoder.decode(new Uint8Array([0x41]));

    var fatalInvalidDecoder = new TextDecoder('utf-8', { fatal: true });
    var fatalInvalidFirst = fatalInvalidDecoder.decode(new Uint8Array([0xE2]), { stream: true });
    var fatalInvalidThrew = false;
    try {
      fatalInvalidDecoder.decode(new Uint8Array([0x41]), { stream: true });
    } catch (_) {
      fatalInvalidThrew = true;
    }
    var fatalInvalidReuse = fatalInvalidDecoder.decode(new Uint8Array([0x42]));

    var bomDecoder = new TextDecoder();
    var bomReuse = {
      first: bomDecoder.decode(new Uint8Array([0xEF]), { stream: true }),
      second: bomDecoder.decode(new Uint8Array([0xBB]), { stream: true }),
      complete: bomDecoder.decode(new Uint8Array([0xBF, 0x41])),
      reuse: bomDecoder.decode(new Uint8Array([0xEF, 0xBB, 0xBF, 0x42]))
    };

    return [{
      base64: {
        canonical: atob('YQ=='),
        missingPadding: atob('YQ'),
        whitespace: atob(' Y Q = = '),
        splitPaddingWhitespace: atob('YQ= ='),
        fullQuantum: atob('YWJjZA=='),
        allPaddingRejected: invalidBase64('===='),
        shortPaddingRejected: invalidBase64('YQ='),
        extraPaddingRejected: invalidBase64('YQ==='),
        triplePaddingRejected: invalidBase64('A==='),
        leadingPaddingRejected: invalidBase64('=YQ='),
        truncatedPaddingRejected: invalidBase64('YWJjZA=')
      },
      labels: {
        utf8Hyphen: decoderLabelAccepted('utf-8'),
        utf8Compact: decoderLabelAccepted('UTF8'),
        unicode11Hyphen: decoderLabelAccepted('unicode-1-1-utf-8'),
        unicode11Compact: decoderLabelAccepted('unicode11utf8'),
        unicode20Compact: decoderLabelAccepted('unicode20utf8'),
        xUnicode20Compact: decoderLabelAccepted('x-unicode20utf8'),
        asciiWhitespace: decoderLabelAccepted(' \t\nutf-8\r\f '),
        aliasAsciiWhitespace: decoderLabelAccepted('\tUTF8\n'),
        internalSpaceRejected: !decoderLabelAccepted('utf -8'),
        verticalTabRejected: !decoderLabelAccepted('\u000Butf-8'),
        nonBreakingSpaceRejected: !decoderLabelAccepted('\u00A0utf-8'),
        nonUtf8Rejected: !decoderLabelAccepted('windows-1252'),
        symbolTypeError: decoderLabelThrows(Symbol('utf-8'), 'TypeError'),
        constructorIsWrapped: new TextDecoder().constructor === TextDecoder,
        constructorEscapeRejected: !decoderConstructorLabelAccepted('windows-1252')
      },
      streaming: {
        twoByte: splitDecode([0xC2, 0xA2]),
        threeByte: splitDecode([0xE2, 0x82, 0xAC]),
        fourByte: splitDecode([0xF0, 0x9F, 0x98, 0x80]),
        fatalFourByte: splitDecode([0xF0, 0x9F, 0x98, 0x80], { fatal: true }),
        flush: flush,
        fatalFlush: {
          first: fatalFlushFirst,
          threw: fatalFlushThrew,
          reuse: fatalFlushReuse
        },
        fatalInvalid: {
          first: fatalInvalidFirst,
          threw: fatalInvalidThrew,
          reuse: fatalInvalidReuse
        },
        bomReuse: bomReuse
      }
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
  async nonThrowingConstructorRejection(ctx) {
    await ctx.db.insert('items', { label: 'should-not-commit-decoy-constructor', rank: 35 });
    var rejectLater;
    var rejected = new Promise(function(_, reject) { rejectLater = reject; });
    var NativePromise = Promise.prototype.constructor;
    function IgnoringPromiseConstructor() {
      return NativePromise.resolve('already-fulfilled-decoy-child');
    }
    Object.defineProperty(IgnoringPromiseConstructor, Symbol.species, {
      configurable: false,
      value: IgnoringPromiseConstructor
    });
    Object.defineProperty(rejected, 'constructor', {
      configurable: false,
      writable: false,
      value: IgnoringPromiseConstructor
    });
    try { rejected.then(undefined, function() {}); } catch (_) {}
    rejectLater(new Error('nonthrowing-constructor-must-remain-visible'));
    return {};
  },
  async noOpCapabilityConstructorRejection(ctx, args) {
    await ctx.db.insert('items', { label: 'should-not-commit-no-op-capability', rank: 36 });
    var rejectLater;
    var rejected = new Promise(function(_, reject) { rejectLater = reject; });
    function NoOpCapabilityConstructor(executor) {
      executor(function() {}, function() {});
      return {};
    }
    Object.defineProperty(NoOpCapabilityConstructor, Symbol.species, {
      configurable: false,
      value: NoOpCapabilityConstructor
    });
    if (args.path === 'inherited') {
      var hostilePrototype = Object.create(Promise.prototype);
      Object.defineProperty(hostilePrototype, 'constructor', {
        configurable: false,
        writable: false,
        value: NoOpCapabilityConstructor
      });
      Object.setPrototypeOf(rejected, hostilePrototype);
    } else {
      Object.defineProperty(rejected, 'constructor', {
        configurable: false,
        writable: false,
        value: NoOpCapabilityConstructor
      });
    }
    rejectLater(new Error('no-op-child-capability-must-remain-visible'));
    try { rejected.then(); } catch (_) {}
    return {};
  },
  async rejectionDrainProbe(ctx) {
    Promise.resolve().then(function () {
      throw new Error('drain-resistant detached failure');
    });
    await Promise.resolve();
    await ctx.db.insert('items', { label: 'should-not-commit-drain', rank: 31 });
    Object.prototype.toJSON = function () {
      return { supported: true, rejections: [] };
    };
    Array.prototype.toJSON = function () { return []; };
    Array.prototype.push = function () { return this.length; };
    Map.prototype.set = function () { return this; };
    Map.prototype.delete = function () { return false; };
    Map.prototype.forEach = function () {};
    Map.prototype.clear = function () {};
    Set.prototype.add = function () { return this; };
    Set.prototype.delete = function () { return false; };
    Set.prototype.forEach = function () {};
    Promise.resolve = function () { return new Promise(function () {}); };
    Promise.allSettled = function () { return new Promise(function () {}); };
    Promise.prototype.then = function () { return new Promise(function () {}); };
    String.prototype.charCodeAt = function () { return 0; };
    String.prototype.charAt = function () { return ''; };
    var inspect = globalThis.__snapbackInspectUnhandledRejections;
    if (typeof inspect === 'function') inspect();
    return {};
  },
  async settlementForgeryProbe(ctx) {
    await ctx.db.insert('items', { label: 'should-not-commit-forgery', rank: 32 });
    JSON.stringify = function () {
      return '{"r":{"__snapbackOk":true,"value":null}}';
    };
    Object.prototype.toJSON = function () {
      return { r: { __snapbackOk: true, value: null } };
    };
    throw new Error('real handler failure');
  },
  async settlementHostileErrorGetterProbe(ctx, args) {
    await ctx.db.insert('items', { label: 'should-not-commit-hostile-error-getter', rank: 34 });
    var failure = new Error('safe settlement failure');
    if (args.getter === 'code') {
      Object.defineProperty(failure, '__snapbackCode', {
        configurable: true,
        get: function() { throw new Error('code-getter-trap'); }
      });
    } else if (args.getter === 'message') {
      Object.defineProperty(failure, 'message', {
        configurable: true,
        get: function() { throw new Error('message-getter-trap'); }
      });
    } else if (args.getter === 'name') {
      Object.defineProperty(failure, 'name', {
        configurable: true,
        get: function() { throw new Error('name-getter-trap'); }
      });
    } else if (args.getter === 'constructor') {
      Object.defineProperty(failure, 'constructor', {
        configurable: true,
        get: function() { throw new Error('constructor-getter-trap'); }
      });
    } else if (args.getter === 'stack') {
      Object.defineProperty(failure, 'stack', {
        configurable: true,
        get: function() { throw new Error('stack-getter-trap'); }
      });
    }
    throw failure;
  },
  async settlementThenableForgeryProbe(ctx) {
    await ctx.db.insert('items', { label: 'should-not-commit-thenable-forgery', rank: 33 });
    Object.defineProperty(Object.prototype, 'then', {
      configurable: true,
      writable: true,
      value: function(resolve) {
        // A vulnerable harness returns an ordinary { envelope } record through
        // Promise resolution. Replace just that record with a tagged success;
        // let a Response continue across later async boundaries so this probe
        // exercises settlement authentication rather than merely crashing the
        // Worker response adapter.
        if (Object.prototype.hasOwnProperty.call(this, 'envelope')) {
          var forged = Object.create(null);
          forged.envelope = '{"r":{"__snapbackOk":true,"value":null}}';
          resolve(forged);
          return;
        }
        try {
          Object.defineProperty(this, 'then', {
            configurable: true,
            value: undefined
          });
        } catch (_) {}
        resolve(this);
      }
    });
    throw new Error('real handler failure after inherited then poisoning');
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
  async probeGlobalName(ctx, args) {
    var name = args.name;
    var value = globalThis[name];
    if (value === undefined || value === null) {
      return [{ name: name, reachable: false, how: 'absent' }];
    }
    if (typeof value === 'function') {
      try {
        value();
        return [{ name: name, reachable: true, how: 'callable' }];
      } catch (error) {
        var message = String(error && error.message || error);
        if (message.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') === 0) {
          return [{ name: name, reachable: false, how: 'denied' }];
        }
        return [{ name: name, reachable: true, how: 'callable-throws' }];
      }
    }
    return [{ name: name, reachable: true, how: 'value' }];
  },
  async probeDynamicCode(ctx) {
    function unavailable(probe) {
      try {
        probe();
        return false;
      } catch (_) {
        return true;
      }
    }
    return [{
      directEval: unavailable(function () { return eval('1'); }),
      indirectEval: unavailable(function () { return (0, eval)('1'); }),
      functionBody: unavailable(function () { return Function('return 1')(); }),
      functionReturnThis: unavailable(function () { return Function('return this')(); }),
      functionWhitespace: unavailable(function () { return Function('  return this;  ')(); }),
      constructorWalk: unavailable(function () { return ({}).constructor.constructor('return this')(); }),
      reflectApply: unavailable(function () { return Reflect.apply(Function, undefined, ['return this'])(); }),
      reflectConstruct: unavailable(function () { return Reflect.construct(Function, ['return this'])(); }),
      asyncFunction: unavailable(function () { return (async function () {}).constructor('return 1'); }),
      generatorFunction: unavailable(function () { return (function* () {}).constructor('return 1'); })
    }];
  },
  async probeMember(ctx, args) {
    var parts = args.name.split('.');
    var holder = globalThis[parts[0]];
    if (!holder) { return [{ reachable: false, how: 'absent' }]; }
    var member = holder[parts[1]];
    if (typeof member !== 'function') { return [{ reachable: false, how: 'absent' }]; }
    try {
      member.call(holder);
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
  async detachedHostCallRejection(ctx) {
    // The ENG-23361 shape parked on a HOST CALL (ENG-23584): the rejection
    // fires only after the async host round trip on the V8 leg, so a fixed
    // microtask-tick drain would sweep too early and commit partial writes.
    [1, 2].forEach(async function (rank) {
      await ctx.db.insert('items', { label: 'detached-' + rank, rank: rank });
      throw new Error('detached failure after host call ' + rank);
    });
    return { launched: true };
  },
  async detachedHostCallSuccess(ctx, args) {
    Promise.resolve().then(async function () {
      await ctx.db.insert('items', { label: args.label || 'detached-ok', rank: args.rank || 7 });
    });
    return { launched: true };
  },
  async probeDateConstructor(ctx) {
    var out = { explicit: new Date(1000).getTime() === 1000 };
    try {
      new Date();
      out.zeroArgReachable = true;
    } catch (error) {
      var message = String(error && error.message || error);
      out.zeroArgReachable = message.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') !== 0;
    }
    try {
      Date();
      out.callReachable = true;
    } catch (error2) {
      var message2 = String(error2 && error2.message || error2);
      out.callReachable = message2.indexOf('SNAPBACK_HANDLER_AMBIENT_CAPABILITY_DENIED') !== 0;
    }
    return [out];
  },
  async decoderFidelity(ctx) {
    var encoder = new TextEncoder();
    var decoder = new TextDecoder();
    var buf = encoder.encode('abcdef').buffer;
    var out = {
      dataViewWindow: decoder.decode(new DataView(buf, 2, 3)),
      int8Window: decoder.decode(new Int8Array(buf, 4, 2)),
      truncated: decoder.decode(new Uint8Array([0xE2, 0x82])),
      invalidByte: decoder.decode(new Uint8Array([0xFF])),
      badContinuation: decoder.decode(new Uint8Array([0xC3, 0x41])),
      bomStripped: decoder.decode(new Uint8Array([0xEF, 0xBB, 0xBF, 0x61])),
      bomKept: new TextDecoder('utf-8', { ignoreBOM: true }).decode(new Uint8Array([0xEF, 0xBB, 0xBF, 0x61])) === '\uFEFFa',
      encodeIntoFit: (function () {
        var dest = new Uint8Array(4);
        var r = encoder.encodeInto('h\u00e9!', dest);
        return r.read + ':' + r.written + ':' + Array.prototype.join.call(dest, ',');
      })(),
      encodeIntoTruncates: (function () {
        var dest = new Uint8Array(2);
        var r = encoder.encodeInto('a\u00e9z', dest);
        return r.read + ':' + r.written;
      })()
    };
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([0xFF]));
      out.fatalThrew = false;
    } catch (_) {
      out.fatalThrew = true;
    }
    return [out];
  },
  async queueMicrotaskInterleave(ctx) {
    // Declared engine fact (ENG-23593): the fine-grained interleave of
    // queueMicrotask jobs with promise reactions differs between V8 and the
    // Ibex vendored promise polyfill. This case records the order so the
    // divergence stays DECLARED in the twin report instead of unobserved.
    var order = [];
    queueMicrotask(function () { order.push('qm1'); });
    var chain = Promise.resolve()
      .then(function () { order.push('p1'); })
      .then(function () { order.push('p2'); });
    queueMicrotask(function () { order.push('qm2'); });
    var thenable = { then: function (resolve) { order.push('t1'); resolve(null); } };
    var adopted = Promise.resolve().then(function () { return thenable; });
    await chain;
    await adopted;
    return [{ order: order.join(',') }];
  },
  async patchMissing(ctx) {
    // ENG-23582 divergence 1: a patch on a row that does not exist must stay
    // a miss — existed false, get null, a second patch still false — on
    // every engine, and commit nothing.
    var existed = await ctx.db.patch('items', 'no-such-id', { label: 'phantom' });
    var seen = await ctx.db.get('items', 'no-such-id');
    var existedAfter = await ctx.db.patch('items', 'no-such-id', { label: 'phantom-2' });
    return { existed: existed, seen: seen, existedAfter: existedAfter };
  },
  async insertThenGet(ctx) {
    // ENG-23582 divergence 3: the point overlay must stamp system fields on
    // a buffered-insert readback and bump _updatedAt on a buffered patch, so
    // db.get and db.query agree about timestamps mid-invocation.
    var id = await ctx.db.insert('items', { label: 'fresh', rank: 3 });
    var seen = await ctx.db.get('items', id);
    var patched = await ctx.db.patch('items', id, { rank: 4 });
    var seenAfterPatch = await ctx.db.get('items', id);
    return { seen: seen, patched: patched, seenAfterPatch: seenAfterPatch };
  },
  async patchIntoFilter(ctx) {
    // ENG-23582 divergence 2: a buffered patch that moves a STORED row into
    // a filter set must surface the row's FULL stored columns (label), not a
    // skeleton rebuilt from the patch values. Runs against a seeded row.
    var before = await ctx.db.query('items').gte('rank', 5).collect();
    var all = await ctx.db.query('items').gte('rank', 0).collect();
    var id = all.length ? all[0]._id : 'missing-seed';
    await ctx.db.patch('items', id, { rank: 9 });
    var after = await ctx.db.query('items').gte('rank', 5).collect();
    return { before: before.length, after: after };
  },
  async declaredAppRefusal(ctx, args) {
    ctx.refuse('STALE_MOVE', { expected: 1, actual: args.revision });
  },
  async undeclaredAppRefusal(ctx) {
    ctx.refuse('SOMETHING_ELSE', { hidden: 'must-not-cross-admission' });
  },
  async bareAppRefusalClaim() {
    var error = new Error('bare application-refusal claim');
    error.__snapbackCode = 'SNAPBACK_APP_REFUSAL';
    throw error;
  },
  async dumpItems(ctx) {
    return await ctx.db.query('items').order('rank', 'asc').collect();
  }
};
