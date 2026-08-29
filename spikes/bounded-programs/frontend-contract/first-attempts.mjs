// The eight known-bad first attempts from frontend-ts/fixtures/first-attempts,
// re-authored as the nearest thing the Contract surface lets you type.
//
// The question is not "are they refused" — the TypeScript front end refuses all
// eight too. It is *where* the refusal happens. In TypeScript each of these is a
// well-formed program that type-checks against the shipped noLib environment and
// is then rejected by an AST policy pass. Here the question is whether the
// grammar admits the sentence at all.

import { lower, LowerError } from './lower.mjs';

const attempts = [
  ['ambient-time', `
mutation stampMessage
  arg id scalar
  update messages [id] { at: Date.now() }
  return viewer
`],
  ['helper-scan', `
query columnCards
  arg columnId scalar
  return scan cards.byParentOrder [columnId] site=helper.cards
`],
  ['split-loop', `
query resolveWords
  arg body scalar
  let result = []
  for word in tokens split(body, " ")
    push result = get users.byHandle [word]
  return result
`],
  ['structural-loop-tally', `
query waitlistDepth
  arg resourceId scalar
  let count = 0
  for entry in page waitlist.byResource [resourceId] order=asc take=100 site=w.scan
    count++
  return count
`],
  ['structural-rank', `
query largestWait
  arg resourceId scalar
  return sort(scan waitlist.byResource [resourceId] order=asc take=100 site=w.scan, byAmountDesc)[0]
`],
  ['unbound-count', `
query unreadCount
  arg conversationId scalar
  return countCapped(scan messages.byConvTime [conversationId] order=asc site=u.scan)
`],
  ['unbound-scan', `
query allCards
  arg columnId scalar
  return scan cards.byParentOrder [columnId] order=asc site=a.scan
`],
  ['while-loop', `
query drain
  arg cursor scalar
  let result = []
  while cursor != null
    push result = cursor
  return result
`],
];

let atParse = 0;
const rows = [];
for (const [name, src] of attempts) {
  try {
    lower(src);
    rows.push([name, 'ACCEPTED', '']);
  } catch (e) {
    if (e instanceof LowerError) {
      atParse += 1;
      rows.push([name, 'refused by grammar', e.message.replace(/\n\s*/g, ' | ')]);
    } else {
      rows.push([name, 'ERROR', String(e.message).slice(0, 90)]);
    }
  }
}

console.log(`\nFirst attempts refused by the grammar: ${atParse}/${attempts.length}\n`);
for (const [name, status, msg] of rows) {
  console.log(`  ${name.padEnd(24)} ${status}`);
  if (msg) console.log(`      ${msg}`);
}
console.log();
