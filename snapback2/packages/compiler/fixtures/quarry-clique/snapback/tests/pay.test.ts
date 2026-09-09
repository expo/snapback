import { api } from "snapback2/client";
import { journey } from "snapback2/test";

function expectData<T>(value: { state: string; data?: T }, label: string): T {
  if (!("data" in value)) throw new Error(`${label} returned ${value.state}`);
  return value.data as T;
}

function expectRejected(value: { state: string; code?: string; rule?: string; family?: string }, code: string, family?: string): void {
  const refused = (value.state === "rejected" && value.code === code)
    || (value.state === "denied" && value.rule === code);
  if (!refused || (family && value.family !== family)) {
    throw new Error(`expected ${family ?? "any"}/${code}, got ${JSON.stringify(value)}`);
  }
}

journey("Clique Pay covers wallets, exact splits, settlement, and privacy", async ({ as }) => {
  const alice = as("alice");
  const bob = as("bob");
  const carol = as("carol");
  const dave = as("dave");

  const aliceLedgerBefore = expectData<any[]>(await alice.query(api.pay.myLedger, {}), "Alice ledger before send");
  const bobLedgerBefore = expectData<any[]>(await bob.query(api.pay.myLedger, {}), "Bob ledger before send");
  const sent = await alice.mutation(api.pay.sendMoney, { to: "user-bob", amount: 250, note: "lunch" });
  if (sent.state !== "committed" || sent.data !== 9750) throw new Error(`send result was ${JSON.stringify(sent)}`);
  if (expectData<number>(await alice.query(api.pay.myBalance, {}), "Alice balance") !== 9750) throw new Error("Alice balance was not 9750");
  if (expectData<number>(await bob.query(api.pay.myBalance, {}), "Bob balance") !== 10250) throw new Error("Bob balance was not 10250");
  const aliceLedger = expectData<any[]>(await alice.query(api.pay.myLedger, {}), "Alice ledger after send");
  const bobLedger = expectData<any[]>(await bob.query(api.pay.myLedger, {}), "Bob ledger after send");
  if (aliceLedger.length !== aliceLedgerBefore.length + 1 || bobLedger.length !== bobLedgerBefore.length + 1) throw new Error("send did not add exactly one entry per wallet");
  const debit = aliceLedger.find((row) => row.kind === "send" && row.note === "lunch");
  const credit = bobLedger.find((row) => row.kind === "receive" && row.note === "lunch");
  if (debit?.amount !== -250 || credit?.amount !== 250 || debit.at !== credit.at) throw new Error("send entries lost amount or shared commit time");
  if (aliceLedger[0]?.kind !== "send" || aliceLedger[0]?.counterpartyProfile?.handle !== "bob"
    || bobLedger[0]?.kind !== "receive" || bobLedger[0]?.counterpartyProfile?.handle !== "alice") {
    throw new Error("ledger was not newest-first with counterparty profiles");
  }

  expectRejected(await alice.mutation(api.pay.sendMoney, { to: "user-bob", amount: 100000, note: null }), "INSUFFICIENT_FUNDS");
  expectRejected(await alice.mutation(api.pay.sendMoney, { to: "user-alice", amount: 1, note: null }), "SELF_PAY");
  expectRejected(await alice.mutation(api.pay.sendMoney, { to: "user-bob", amount: 0, note: null }), "NOT_POSITIVE");
  const fractional = await alice.mutation(api.pay.sendMoney, { to: "user-bob", amount: 2.5, note: null });
  const fractionalRefused = fractional.state === "rejected"
    && fractional.message.includes("numeric arguments must be integers");
  if (!fractionalRefused) throw new Error("fractional money input was not refused before dispatch");
  const aliceAfterRefusals = expectData<any[]>(await alice.query(api.pay.myLedger, {}), "Alice ledger after refusals");
  if (aliceAfterRefusals.length !== aliceLedger.length) throw new Error("a refused send wrote ledger state");

  const dinner = await alice.mutation(api.pay.addExpense, {
    c: "conversation-group", description: "dinner", total: 1000, tipRate: 1800,
    participants: ["user-carol", "user-alice", "user-bob"],
  });
  if (dinner.state !== "committed" || typeof dinner.data !== "string") throw new Error(`dinner was ${JSON.stringify(dinner)}`);
  const dinnerId = dinner.data;
  const dinnerShares = [...expectData<any[]>(await alice.query(api.pay.expenseShares, {
    c: "conversation-group", e: dinnerId,
  }), "dinner shares")].sort((left: any, right: any) => left.debtor.localeCompare(right.debtor));
  if (JSON.stringify(dinnerShares.map((row: any) => [row.debtor, row.amount, row.settled])) !== JSON.stringify([
    ["dev:alice", 394, true], ["dev:bob", 393, false], ["dev:carol", 393, false],
  ])) throw new Error(`dinner shares were ${JSON.stringify(dinnerShares)}`);

  const bobOpen = expectData<any[]>(await bob.query(api.pay.myOpenShares, {}), "Bob open shares");
  const bobDinner = bobOpen.find((row) => row.expense === dinnerId);
  if (!bobDinner || bobDinner.amount !== 393) throw new Error("Bob dinner share was not open");
  expectRejected(await carol.mutation(api.pay.settleShare, { s: bobDinner.id }), "NOT_YOUR_SHARE");
  const settled = await bob.mutation(api.pay.settleShare, { s: bobDinner.id });
  if (settled.state !== "committed" || settled.data !== true) throw new Error("Bob could not settle dinner");
  if (expectData<number>(await bob.query(api.pay.myBalance, {}), "Bob settled balance") !== 9857) throw new Error("Bob settled balance was not 9857");
  if (expectData<number>(await alice.query(api.pay.myBalance, {}), "Alice collected balance") !== 10143) throw new Error("Alice collected balance was not 10143");
  const settledShares = expectData<any[]>(await alice.query(api.pay.expenseShares, {
    c: "conversation-group", e: dinnerId,
  }), "settled expense shares");
  const settledShare = settledShares.find((row: any) => row.id === bobDinner.id);
  if (!settledShare?.settled || typeof settledShare.settledAt !== "number") throw new Error("settled share lost its settlement time");
  expectRejected(await bob.mutation(api.pay.settleShare, { s: bobDinner.id }), "ALREADY_SETTLED");

  const coffee = await alice.mutation(api.pay.addExpense, {
    c: "conversation-group", description: "coffee", total: 1001, tipRate: 1800,
    participants: ["user-alice", "user-bob", "user-carol"],
  });
  if (coffee.state !== "committed") throw new Error("coffee did not commit");

  const cab = await alice.mutation(api.pay.addExpense, {
    c: "conversation-group", description: "cab", total: 2, tipRate: 1800,
    participants: ["user-alice", "user-bob", "user-carol"],
  });
  if (cab.state !== "committed") throw new Error("cab did not commit");
  const cabShares = expectData<any[]>(await alice.query(api.pay.expenseShares, {
    c: "conversation-group", e: cab.data as string,
  }), "cab shares");
  if (JSON.stringify([...cabShares].sort((a: any, b: any) => a.debtor.localeCompare(b.debtor)).map((row: any) => row.amount)) !== "[1,1,0]") {
    throw new Error("cab deterministic remainder assignment changed");
  }

  expectRejected(await alice.mutation(api.pay.addExpense, {
    c: "conversation-group", description: "outsider", total: 100, tipRate: 0,
    participants: ["user-alice", "user-dave"],
  }), "PARTICIPANT_NOT_MEMBER");
  expectRejected(await alice.mutation(api.pay.addExpense, {
    c: "conversation-group", description: "duplicate", total: 100, tipRate: 0,
    participants: ["user-alice", "user-alice"],
  }), "E_INPUT", "input");
  expectRejected(await alice.mutation(api.pay.addExpense, {
    c: "conversation-group", description: "empty", total: 100, tipRate: 0, participants: [],
  }), "NO_PARTICIPANTS");

  const rounded = expectData<any>(await alice.query(api.pay.convExpenses, { c: "conversation-group" }), "rounded expenses");
  if (rounded.total !== 2363 || rounded.expenses.length !== 3) throw new Error(`conversation spend was ${JSON.stringify(rounded)}`);
  if (JSON.stringify(rounded.expenses.map((row: any) => [row.description, row.tip, row.grand])) !== JSON.stringify([
    ["cab", 0, 2], ["coffee", 180, 1181], ["dinner", 180, 1180],
  ])) throw new Error(`expenses were not newest-first and exact: ${JSON.stringify(rounded.expenses)}`);
  expectRejected(await dave.query(api.pay.convExpenses, { c: "conversation-group" }), "NOT_MEMBER");
  expectRejected(await dave.query(api.pay.expenseShares, { c: "conversation-group", e: dinnerId }), "NOT_MEMBER");

  if (expectData<number>(await dave.query(api.pay.myBalance, {}), "Dave zero balance") !== 0) throw new Error("Dave missing balance was not zero");
  expectRejected(await dave.mutation(api.pay.sendMoney, { to: "user-bob", amount: 1, note: null }), "INSUFFICIENT_FUNDS");
});
