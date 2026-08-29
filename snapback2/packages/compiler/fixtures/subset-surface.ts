const counters = table("counters");

export const collectionShapes = query(
  { words: list(text({ max: 24 }), { max: 8 }) },
  ({ args }) => {
    const tallies = new Map<string, number>();
    const unique = new Set<string>();
    for (const word of args.words) {
      const prior = tallies.get(word) ?? 0;
      tallies.set(word, prior + 1);
      if (!unique.has(word)) unique.add(word);
    }
    return {
      exampleCount: tallies.get("example") ?? 0,
      hasExample: tallies.has("example"),
      uniqueCount: unique.size,
    };
  },
);

export const callbackUpdate = mutation(
  { id: id(counters), delta: int() },
  ({ db, args }) => {
    db.update(counters, args.id, (row) => ({ value: row.value + args.delta }));
    return true;
  },
);

export const callbackUpsert = mutation(
  { id: id(counters), value: int() },
  ({ db, args }) => {
    db.upsert(counters, args.id, (row) => ({
      id: args.id,
      value: row?.value ?? args.value,
    }));
    return true;
  },
);
