shape authorCard from cards

mutation sendMoney(to: users, amount: money USD, note: text <=140 ?):
  require amount > 0 else NOT_POSITIVE
  recipient = users[to]! else USER_NOT_FOUND
  require recipient.principal != viewer else SELF_PAY
  require #balances[viewer] >= amount else INSUFFICIENT_FUNDS
  t = now
  insert ledger { owner: viewer, counterparty: recipient.principal, amount: -amount, kind: 'send', note, expense: null, at: t }
  insert ledger { owner: recipient.principal, counterparty: viewer, amount, kind: 'receive', note, expense: null, at: t }
  return #balances[viewer]

mutation addExpense(c: conversations, description: text <=100, total: money USD, tipRate: decimal 4, participants: [users] <=50):
  require exists members[c, viewer] else NOT_MEMBER
  require total > 0 else NOT_POSITIVE
  require tipRate >= 0 else NEGATIVE_TIP
  require count(participants) >= 1 else NO_PARTICIPANTS
  tip = total * tipRate
  grand = total + tip
  eid = new
  t = now
  insert expenses { id: eid, conv: c, payer: viewer, description, total, tipRate, tip, grand, at: t }
  for u in participants:
    person = users[u]! else USER_NOT_FOUND
    require exists members[c, person.principal] else PARTICIPANT_NOT_MEMBER
    insert shares { expense: eid, conv: c, debtor: person.principal, amount: share(grand, participants, u), expenseDescription: description, expensePayer: viewer, expenseGrand: grand, expenseAt: t, settled: person.principal = viewer, settledAt: null }
  return eid

mutation settleShare(s: shares):
  row = shares[s]! else NOT_FOUND
  require row.debtor = viewer else NOT_YOUR_SHARE
  require not row.settled else ALREADY_SETTLED
  expense = expenses[row.expense]! else EXPENSE_NOT_FOUND
  require #balances[viewer] >= row.amount else INSUFFICIENT_FUNDS
  t = now
  insert ledger { owner: viewer, counterparty: expense.payer, amount: -row.amount, kind: 'settle', note: expense.description, expense: expense.id, at: t }
  insert ledger { owner: expense.payer, counterparty: viewer, amount: row.amount, kind: 'collect', note: expense.description, expense: expense.id, at: t }
  update shares[s] { settled: true, settledAt: t }
  return true

query myBalance():
  return #balances[viewer]

query myLedger():
  return ledger[viewer] last 50 by byOwnerAt { *, counterpartyProfile: users[principal = .counterparty] authorCard }

query convExpenses(c: conversations):
  require exists members[c, viewer] else NOT_MEMBER
  return {
    total: #convSpend[c],
    expenses: expenses[c] last 20 by byConv { *, payerProfile: users[principal = .payer] authorCard },
  }

query expenseShares(c: conversations, e: expenses):
  require exists members[c, viewer] else NOT_MEMBER
  return shares[c, e] first 50 by byConvExpense { *, debtorProfile: users[principal = .debtor] authorCard }

query myOpenShares():
  return shares[viewer, false] first 50 by byDebtorOpen {
    *,
    expenseRow: { description: .expenseDescription, payer: .expensePayer, grand: .expenseGrand, at: .expenseAt },
  }
