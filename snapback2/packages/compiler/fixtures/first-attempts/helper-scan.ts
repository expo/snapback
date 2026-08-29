const cards = table("cards");

function cardsForColumn(db: Db, columnId: any) {
  return db.scan(cards.byParentOrder, [columnId]);
}

export const columnCards = query({ columnId: scalar() }, ({ db, args }) =>
  cardsForColumn(db, args.columnId),
);
