// Transport-boundary counterexample, not an integrated DS server claim.
// A request accepted by a server may still execute after its client aborts.
import { DeliveryQueue, memoryDelivery } from '../../packages/snapback4/dist/delivery.js';
let table = 'messages', release, request;
const executed = [];
const barrier = new Promise(resolve => { release = resolve; });
const queue = new DeliveryQueue({ storage: memoryDelivery(), local: false, mint: () => '00000000000000000000000001', ready: () => true,
  send: async (mutation, body) => {
    request = { path: `/m/${mutation}`, ...body, store_id: 'same-store' };
    await barrier;
    // The server uses the mutation definition current when it takes the writer.
    executed.push({ table, group: body.args.conversation, from: body.args.from, through: body.args.through });
    return { accepted: true, json: { state: 'sent', store_id: 'same-store', head: 20, seq: 20 } };
  },
});
await queue.accept([{ table: 'messages', mutation: 'delivered', args: ['conversation','from','through'], rows: [['c',41]] }]);
await queue.pump();
table = 'photos';
await queue.reset(true); // The stipulated generation callback fence works.
release();
await new Promise(resolve => setImmediate(resolve));
await queue.stop();
console.log(JSON.stringify({ request, executed, fetchedPhotoPositions: [], note: 'The request carries neither the tracked table nor a backend generation.' }, null, 2));
