import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { FrontendDiagnostic, Program } from "./ir";
import { compileJourneys, lowerProject } from "./project";
import { rustCheck } from "./rust-check";
import { compileQuarry, type QuarryInput } from "./quarry/index";

type Test = (name: string, run: () => void | Promise<void>) => void;

export function registerQuarryMoneyChecks(test: Test, frontend: string): void {
  const fixtures = resolve(frontend, "fixtures");

  test("Quarry money builtins and branded multiplication preserve descriptors in TypeScript and IR", async () => {
    const schema = `table users:
  principal: principal
  public

table ledger:
  owner: principal
  amount: money USD
  public

maintain balances = sum ledger of amount by owner:
  read r <- public

table rateEntries:
  owner: principal
  rate: decimal 4
  public

maintain rates = sum rateEntries of rate by owner:
  read r <- public
`;
    const operations = `mutation exercise(amount: money USD, rate: decimal 4, other: decimal 3, recipients: [users] <=10, recipient: users, divisor: int):
  require amount > 0 else NOT_POSITIVE
  require rate >= 0 else NEGATIVE_RATE
  product = amount * rate
  reverse = rate * amount
  leftScaled = rate * other
  rightScaled = other * rate
  split = share(product, recipients, recipient)
  parts = divmod(split, divisor)
  negative = -amount
  fromZero = 0 - amount
  return { product, reverse, leftScaled, rightScaled, split, quotient: parts.quotient, remainder: parts.remainder, negative, fromZero }

query balance(owner: principal):
  return #balances[owner]

query rate(owner: principal):
  return #rates[owner]
`;
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/money.q", source: operations },
    ]);
    assert(compiled.ok, `money builtin front end refused: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const generated = compiled.modules[0]!.source;
    assert(generated.includes("deterministicShare(product, args.recipients, args.recipient)"), `share did not lower to deterministicShare:\n${generated}`);
    assert(generated.includes("divmod(split, args.divisor)"), `divmod did not lower:\n${generated}`);
    assert(generated.includes("divmod((args.amount * args.rate), 10000).quotient")
      && generated.includes("divmod((args.rate * args.amount), 10000).quotient")
      && generated.includes("divmod((args.rate * args.other), 1000).quotient")
      && generated.includes("divmod((args.other * args.rate), 10000).quotient"),
    `branded multiplication lost the dropped operand's power of ten:\n${generated}`);
    assert(generated.includes("-(args.amount)") && generated.includes("(0 - args.amount)")
      && generated.includes("args.amount > 0") && generated.includes("args.rate >= 0"),
    `unary minus or branded zero comparisons changed:\n${generated}`);

    await withProject({ "snapback/schema.q": schema, "snapback/money.q": operations }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `money builtin project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const ir = JSON.stringify(operation(lowered.project.programs, "money.exercise"));
      assert(ir.includes('"builtin":"DeterministicShare"') && occurrences(ir, '"Divmod"') >= 5
        && occurrences(ir, '"op":"Mul"') >= 4,
      `share/divmod/Mul did not reach IR: ${ir}`);
      const schemaJson = JSON.stringify(lowered.project.schema);
      assert(schemaJson.includes('"balances"') && schemaJson.includes('"value":{"Money":{"currency":"USD","scale":2}}'),
        `money maintain target lost its source descriptor: ${schemaJson}`);
      assert(schemaJson.includes('"rates"') && schemaJson.includes('"value":{"Decimal":{"scale":4}}'),
        `decimal maintain target lost its source descriptor: ${schemaJson}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `money builtin project did not certify: ${JSON.stringify(failures)}`);
    });
  });

  test("Quarry money builtins refuse arity, nominal, divisor, and currency-squared errors with rewrites", () => {
    const schema = `table users:
  principal: principal
  public

table values:
  amount: money USD
  rate: decimal 4
  public
`;
    const operations = `query shortShare(amount: money USD, recipients: [users] <=10):
  return share(amount, recipients)

query wrongRecipient(amount: money USD, recipients: [users] <=10, recipient: principal):
  return share(amount, recipients, recipient)

query shortDivmod(amount: money USD):
  return divmod(amount)

query fractionalDivisor(amount: money USD):
  return divmod(amount, 2.5)

query squared(left: money USD, right: money USD):
  return left * right

query divided(left: money USD, divisor: int):
  return left / divisor

query remainder(left: money USD, divisor: int):
  return left % divisor
`;
    const result = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/refusals.q", source: operations },
    ]);
    assert(!result.ok, "invalid money builtins compiled");
    const failures = result.diagnostics.filter((item) => item.code === "E_QUARRY_TYPE");
    assert(failures.length === 7, `money builtin refusals did not report all failures: ${JSON.stringify(result)}`);
    assert(failures.every((item) => item.site.startsWith("snapback/refusals.q:") && item.rewrite.startsWith("-- ")),
      `money builtin refusal lost site/rewrite: ${JSON.stringify(failures)}`);
    assert(failures.some((item) => item.message.includes("requires exactly 3 arguments") && item.rewrite.includes("share(amount, recipients, recipient)"))
      && failures.some((item) => item.message.includes("does not match recipient-list item type") && item.rewrite.includes("same nominal type"))
      && failures.some((item) => item.message.includes("requires exactly 2 arguments") && item.rewrite.includes("divmod(amount, integerDivisor)"))
      && failures.some((item) => item.message.includes("divisor must be an int") && item.rewrite.includes("integer literal"))
      && failures.some((item) => item.message.includes("currency-squared") && item.rewrite.includes("decimal rate or an int"))
      && failures.some((item) => item.message.includes("does not admit /") && item.rewrite.includes("divmod(left, divisor).quotient"))
      && failures.some((item) => item.message.includes("does not admit %") && item.rewrite.includes("divmod(left, divisor).remainder")),
    `money builtin refusal detail changed: ${JSON.stringify(failures)}`);
  });

  test("Quarry negation and fractional-rate refusals name the exact numeric forms", () => {
    const schema = `table values:
  label: text <=20
  amount: money USD
  public
`;
    const operations = `query badNegation(label: text <=20):
  return -label

query goodNegation(amount: money USD):
  return -amount

query bareRate(total: money USD):
  return total * 0.18
`;
    const result = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/negation.q", source: operations },
    ]);
    assert(!result.ok, "invalid negation and bare fractional rate compiled");
    const failures = result.diagnostics.filter((item) => item.code === "E_QUARRY_TYPE");
    assert(failures.length === 2
      && failures.every((item) => item.site.startsWith("snapback/negation.q:"))
      && failures.some((item) => item.message === "negation requires an int, decimal, or money value"
        && item.rewrite.includes("negate an int, decimal, or money value"))
      && failures.some((item) => item.message.includes("an int operand or a decimal-typed rate")
        && item.message.includes("bare fractional literal has no scale")
        && item.rewrite.includes("decimal S argument or column")),
    `numeric refusal guidance changed: ${JSON.stringify(result)}`);

    const accepted = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/negation.q", source: "query good(amount: money USD):\n  return -amount\n" },
    ]);
    assert(accepted.ok && accepted.modules[0]!.source.includes("-(args.amount)"),
      `money negation did not remain accepted: ${JSON.stringify(accepted)}`);
  });

  test("literal amounts widen through divmod and share so literal comparisons type-check", async () => {
    const schema = "table values:\n  amount: money USD\n  public\n";
    const module = `query quotient():
  return divmod(7, 2).quotient = 3

query portion(r: [principal] <=5):
  return share(100, r, viewer) = 34

query branded(amount: money USD):
  return divmod(amount, 3).quotient = amount
`;
    await withProject({ "snapback/schema.q": schema, "snapback/literals.q": module }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `literal divmod/share comparisons refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `literal divmod/share comparisons did not certify: ${JSON.stringify(failures)}`);
      assert(lowered.apiDts.includes("quotient: Op<{}, boolean>") && lowered.apiDts.includes("branded: Op<"),
        `literal builtin comparisons lost their boolean result type:\n${lowered.apiDts}`);
    });

    const optional = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/optional.q", source: "query neg(amount: money USD ?):\n  return -amount\n" },
    ]);
    assert(!optional.ok && optional.diagnostics.some((item) => item.code === "E_QUARRY_TYPE"
      && item.message === "negation requires a present int, decimal, or money value"
      && item.rewrite.includes("-(value!)")),
    `optional money negation lost its presence rewrite: ${JSON.stringify(optional)}`);
  });

  test("Quarry rejects a decimal literal beyond its scale at the authored q site", async () => {
    await withProject({
      "snapback/schema.q": "table rates:\n  value: decimal 4\n  public\n  insert r <- public\n",
      "snapback/rates.q": "mutation bad():\n  return +rates { value: 0.12345 }\n",
    }, async (root) => {
      const result = await lowerProject(root);
      assert(!result.ok, "0.12345 entered a decimal 4 position");
      const failure = result.diagnostics.find((item) => item.code === "E_DECIMAL_SCALE");
      assert(failure?.site.startsWith("snapback/rates.q:2:") && failure.rewrite.includes("0.12345")
        && failure.message.includes("5 fractional digits") && failure.message.includes("scale 4"),
      `over-precise literal lost its q site or scale detail: ${JSON.stringify(result)}`);
    });
  });

  test("Quarry caps decimal and money descriptors at scale 12", async () => {
    const refused = compileInline([{ fileName: "snapback/schema.q", source: `table values:
  rate: decimal 13
  amount: money USD 13
  public
` }]);
    assert(!refused.ok, "scale 13 descriptors entered Quarry");
    const scales = refused.diagnostics.filter((item) => item.code === "E_QUARRY_SYNTAX");
    assert(scales.length === 2
      && scales.every((item) => item.family === "quarry"
        && item.site.startsWith("snapback/schema.q:")
        && item.message === "decimal and money scales must be integers from 0 through 12")
      && scales.some((item) => item.rewrite === "-- use decimal 12")
      && scales.some((item) => item.rewrite === "-- use money USD 12"),
    `scale 13 refusals lost their q sites or rewrites: ${JSON.stringify(refused)}`);

    const schema = `table values:
  amount: money JPY 12
  rate: decimal 12
  public
`;
    const operationSource = `query product(amount: money JPY 12, rate: decimal 12):
  return amount * rate
`;
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/scale.q", source: operationSource },
    ]);
    assert(compiled.ok && compiled.modules[0]!.source.includes("1000000000000"),
      `scale 12 product did not use its safe-integer divisor: ${JSON.stringify(compiled)}`);
    await withProject({ "snapback/schema.q": schema, "snapback/scale.q": operationSource }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `scale 12 descriptors did not lower: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `scale 12 product did not certify: ${JSON.stringify(failures)}`);
    });
  });

  test("operation money arguments are minor-unit numbers while results remain branded", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-money"));
    assert(lowered.ok, `quarry-money refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    assert(lowered.apiDts.includes('/** money USD 2 — minor units */ amount: number')
      && lowered.apiDts.includes('/** decimal 3 — minor units */ rate: number')
      && lowered.apiDts.includes('price: Money<"USD", 2>')
      && lowered.apiDts.includes('rate: Decimal<3>'),
    `argument/result branding posture changed:\n${lowered.apiDts}`);

    const schema = "table values:\n  amount: money USD\n  public\n";
    const operationSource = "query echo(amount: money USD):\n  return amount\n";
    const positiveJourney = `import { api } from "snapback2/client";
import { journey } from "snapback2/test";
journey("minor units", async ({ as }) => {
  const client = as("alice");
  const first = await client.query(api.ops.echo, { amount: 250 });
  if (!("data" in first)) throw new Error("missing data");
  await client.query(api.ops.echo, { amount: first.data });
});
`;
    await withProject({
      "snapback/schema.q": schema,
      "snapback/ops.q": operationSource,
      "snapback/tests/money.test.ts": positiveJourney,
    }, async (root) => {
      const positive = await lowerProject(root);
      assert(positive.ok, `minor-unit number or branded result did not flow into an argument: ${positive.ok ? "" : diagnosticsText(positive.diagnostics)}`);
      const journeys = await compileJourneys(root, positive.apiDts);
      assert(journeys.ok, `minor-unit journey did not typecheck: ${journeys.ok ? "" : diagnosticsText(journeys.diagnostics)}`);
    });
    await withProject({
      "snapback/schema.q": schema,
      "snapback/ops.q": operationSource,
      "snapback/tests/money.test.ts": positiveJourney.replace("amount: 250", 'amount: "250"'),
    }, async (root) => {
      const negative = await lowerProject(root);
      assert(negative.ok, `negative journey backend refused before journey checking: ${negative.ok ? "" : diagnosticsText(negative.diagnostics)}`);
      const journeys = await compileJourneys(root, negative.apiDts);
      assert(!journeys.ok && journeys.diagnostics.some((item) => item.site.startsWith("snapback/tests/money.test.ts:")),
        `string money argument did not receive a journey type refusal: ${JSON.stringify(journeys)}`);
    });
  });

  test("computed money results retain named brands in generated API declarations", async () => {
    const operations = `query b(amount: money USD, rate: decimal 4, r: [principal] <=5):
  return { neg: -amount, zero: 0 - amount, times: amount * 2, prod: amount * rate, q: divmod(amount, 3).quotient, s: share(amount, r, viewer), plain: amount }

query order(amount: money USD, r1: decimal 4, r2: decimal 3):
  return { reverse: r1 * amount, chain: amount * r1 * r2 }
`;
    await withProject({
      "snapback/schema.q": "table rows:\n  value: int\n  public\n",
      "snapback/brands.q": operations,
    }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `computed-brand project refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const b = 'readonly b: Op<{ /** money USD 2 — minor units */ amount: number; /** decimal 4 — minor units */ rate: number; r: Principal[] }, { neg: Money<"USD", 2>; zero: Money<"USD", 2>; times: Money<"USD", 2>; prod: Money<"USD", 2>; q: Money<"USD", 2>; s: Money<"USD", 2>; plain: Money<"USD", 2> }>';
      const order = 'readonly order: Op<{ /** money USD 2 — minor units */ amount: number; /** decimal 4 — minor units */ r1: number; /** decimal 3 — minor units */ r2: number }, { reverse: Money<"USD", 2>; chain: Money<"USD", 2> }>';
      assert(lowered.apiDts.includes(b) && lowered.apiDts.includes(order)
        && !lowered.apiDts.includes("number & { readonly __money")
        && !lowered.apiDts.includes("number & { readonly __decimal"),
      `computed results lost named Money aliases:\n${lowered.apiDts}`);
    });
  });

  test("maintained money operands hoist absence fallback before exact builtins", async () => {
    const schema = `table ledger:
  owner: principal
  amount: money USD
  public

maintain balances = sum ledger of amount by owner:
  read r <- public

table expenses:
  conv: text <=20
  grand: money USD
  public

maintain convSpend = sum expenses of grand by conv:
  read r <- public
`;
    const operations = `query aggregateOperands(owner: principal, c: text <=20, recipients: [principal] <=5, rate: decimal 4):
  return { shared: share(#balances[owner], recipients, viewer), divided: divmod(#balances[owner], 3).quotient, product: #convSpend[c] * rate }
`;
    const compiled = compileInline([
      { fileName: "snapback/schema.q", source: schema },
      { fileName: "snapback/aggregates.q", source: operations },
    ]);
    assert(compiled.ok, `aggregate operands refused in Quarry: ${compiled.ok ? "" : diagnosticsText(compiled.diagnostics)}`);
    const generated = compiled.modules[0]!.source;
    assert(occurrences(generated, "?.value ?? 0") === 3
      && generated.includes("deterministicShare(__q_agg_")
      && generated.includes("divmod(__q_agg_")
      && generated.includes("divmod((__q_agg_")
      && !generated.includes("deterministicShare((db.get")
      && !generated.includes("divmod(((db.get"),
    `aggregate fallback was not hoisted before share/product:\n${generated}`);

    await withProject({ "snapback/schema.q": schema, "snapback/aggregates.q": operations }, async (root) => {
      const lowered = await lowerProject(root);
      assert(lowered.ok, `aggregate operands did not lower: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
      const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
      assert(failures.length === 0, `aggregate operands did not certify: ${JSON.stringify(failures)}`);
    });
  });

  test("Clique Pay lowers and certifies the exact 41-operation inventory", async () => {
    const lowered = await lowerProject(resolve(fixtures, "quarry-clique"));
    assert(lowered.ok, `Clique Pay refused: ${lowered.ok ? "" : diagnosticsText(lowered.diagnostics)}`);
    const names = lowered.project.programs.map((program) => program.name).sort();
    const expected = [
      "chat.addMember", "chat.chatThread", "chat.chatThreadBefore", "chat.convMembers",
      "chat.conversation", "chat.createGroup", "chat.leaveGroup", "chat.markDelivered",
      "chat.markRead", "chat.myConversations", "chat.promoteAdmin", "chat.removeMember",
      "chat.send", "chat.startDm", "pay.addExpense", "pay.convExpenses", "pay.expenseShares", "pay.myBalance",
      "pay.myLedger", "pay.myOpenShares", "pay.sendMoney", "pay.settleShare",
      "social.createPost", "social.createProfile", "social.createReply", "social.globalFeed",
      "social.globalFeedBefore", "social.laneFeed", "social.laneFeedBefore", "social.listUsers",
      "social.me", "social.myFeedMarks", "social.myFollowing", "social.myLikes", "social.profile",
      "social.profileByHandle", "social.thread", "social.toggleFollow", "social.toggleLike",
      "social.toggleRepost", "social.updateProfile",
    ].sort();
    assert(JSON.stringify(names) === JSON.stringify(expected), `Clique Pay operation inventory changed: ${JSON.stringify(names)}`);
    const failures = rustCheck(lowered.project.programs, "synthetic", lowered.project.schema).filter((item) => item.error);
    assert(failures.length === 0, `Clique Pay did not certify: ${JSON.stringify(failures)}`);
    const pay = JSON.stringify(lowered.project.programs.filter((program) => program.name.startsWith("pay.")));
    assert(pay.includes('"builtin":"DeterministicShare"') && pay.includes('"Divmod"') && pay.includes('"op":"Mul"'),
      `Clique Pay did not exercise share and rate multiplication in IR: ${pay}`);
  });
}

function compileInline(inputs: Array<{ fileName: string; source: string }>) {
  return compileQuarry(inputs.map((input): QuarryInput => ({ ...input, path: resolve("/virtual", input.fileName) })));
}

async function withProject<T>(files: Record<string, string>, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "snapback2-quarry-money-"));
  try {
    for (const [path, source] of Object.entries(files)) {
      const target = resolve(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, source);
    }
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function operation(programs: Program[], name: string): Program {
  const program = programs.find((item) => item.name === name);
  assert(program, `missing operation ${name}`);
  return program;
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function diagnosticsText(diagnostics: FrontendDiagnostic[]): string {
  return diagnostics.map((item) => `${item.code}@${item.site}: ${item.message}`).join("; ");
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
