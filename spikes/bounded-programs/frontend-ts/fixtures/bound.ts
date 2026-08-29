const expenses = table("expenses");
const shares = table("shares");

export const expensesByShares = query({ groupId: scalar() }, ({ db, args }) => {
  for (const expense of db.scan(expenses.byGroup, [args.groupId], { take: 500 })) {
    for (const share of db.scan(shares.byExpense, [expense.id], { take: 50 })) {
      let observed = share;
    }
  }
});
