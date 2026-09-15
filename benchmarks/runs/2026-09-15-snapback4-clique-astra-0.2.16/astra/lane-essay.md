# Building Clique on the published Snapback 4 surface

This was a cold build from the public `snapback4@0.2.16` and `snapback4-expo@0.2.7` packages. I did not consult another Clique implementation, a Snapback checkout, or a previous benchmark diary. The useful comparison with Convex and Supabase is therefore a comparison of the work I had to do here with the architectural approaches I know, not a controlled timing result against those products. The full scale replay was still running when I wrote this essay. Its completed checkpoints had already changed the design, but the final tally had not been assembled.

## The strongest reduction in friction was shared semantics

A messenger forces several systems to agree about the same event. A message must be authorized, ordered, stored, delivered to another device, shown optimistically, and eventually acknowledged. A disappearing image adds another condition: the row and the ability to fetch its bytes must stop being available even when no application is open. In this build, much of that agreement lived in one Quarry schema. Membership rules, synchronization audiences, asset columns, expiry and mutations were adjacent declarations. The client ran the same compiled backend model through the replica.

That changed the shape of the work. I still wrote product rules: who may edit, how long deletion is allowed, what a group administrator can change, and which members contribute to a receipt. I did not separately implement a server database adapter, a local database schema, a delta protocol, and a durable message queue. The no-client expiry probe was particularly useful evidence. A timer in the browser could have made an attractive demonstration; it could not have passed that probe. The server-owned expiry declaration did the right kind of work.

Against a conventional Supabase design, this is a substantial reduction in integration code. I would expect to express authorization in PostgreSQL policies, use database functions or application endpoints for coordinated writes, and assemble the local persistence and replay behavior separately. Those components are powerful and familiar, but keeping their meanings aligned would be my responsibility. Against the Convex model I know, typed reactive operations already provide a strong application boundary. Snapback's distinctive contribution here was the explicit device interpreter and durable replica, rather than merely a pleasant subscription interface.

## The language made costs and uncertainty visible

Quarry was concise, but concision did not mean that I could write any loop and discover its cost later. The compiler asked whether a page's access policy could be decided from its index prefix. It distinguished a complete answer from a bounded or unavailable one. It told me when a mutation could no longer predict because it read an online-only table. These were useful constraints once I understood them. At first they were also a tax on momentum.

The clearest example was offline sending. A redundant message-existence guard seemed harmless from ordinary server programming experience. It prevented the replica from predicting the write with the facts it held. Removing that guard and relying on stable mutation IDs produced the intended durable queue behavior. The correction was about aligning the operation with the platform's retry and knowledge model. It was not a reason to invent a second client-side message store.

I also met that proof model while implementing feed cleanup. Adding an actor index did not make an OR-based read rule uniformly decidable in the way I expected. The final delivery projection exposes only information already public in posts and follow edges, so I made that policy explicit and retained the viewer prefix in the application query. This was a real modeling decision, not just syntax repair. In SQL I would have had more freedom to write the query immediately; I would also have had to establish its plan and policy behavior through different tools.

## Scale rewarded a change in architecture

My first Following feed merged one lane for every followed account. It was understandable, correct at the tested state, and fast in absolute time. It nevertheless failed the instrument's relative degradation rule for a user following many accounts. The guide's feed recipe supplied a more appropriate design: delivery entries for smaller authors and a small shared broadcast merge for popular authors. Following then became an indexed read over work performed when events were created or relationships changed.

The important lesson was not that every backend should use this particular feed arrangement. Convex, PostgreSQL and a custom server could all implement variants of it. The benefit here was that the published guide described an executable arrangement in the same language as the app, including promotion, backfill and unfollow behavior. The cost was additional projection tables, explicit cleanup, and an honest backfill limit. A tiny first implementation was not the final production shape.

Insights followed the same principle. The client never paged a corpus to count it. Maintained facts supplied lifetime and UTC-day totals. Trending used a score index over entries with server-enforced expiry, so the query did not sort the entire trailing-day corpus. These read models are familiar database engineering. Snapback made the maintained counters compact; it did not absolve me from deciding which events they represented or repairing historical data after introducing them.

## Scheduling was part of the backend, but still required design

The digest ran as a Quarry schedule, not a browser callback or an external cron service. That reduced the number of moving pieces. Its work was resumable, period receipts committed with the emission decision, and the effect worker logged through the requested seam. The worker needed explicit effect-ID deduplication because logging an effect and acknowledging its delivery are separate actions.

A naive per-user digest loop would have put all of a very active user's conversations under one execution meter. I split the final job into membership chunks followed by user-level emission. The last step checks current membership before using a chat's count. The acceptance probe closed clients, restarted the backend, verified exact counts, and then verified a quiet following period through both the absence of emissions and the presence of zero-valued server receipts. Absence alone would have been weak evidence: a broken scheduler also emits nothing.

Supabase would give this work the expressive range of SQL and database scheduling facilities; Convex offers a function-oriented way to structure background work. Here, keeping jobs beside rules and aggregates made the authority boundary easy to inspect. Bounded chunks and durable progress were helpful, but they required deliberate planning. The schedule declaration itself was the easy part.

## The application shell remained my responsibility

A local-first backend does not make an Expo web export load with the network disabled. I supplied a narrowly scoped service worker for static application files. The replica retained ordinary viewed assets independently; the shell cache did not indiscriminately cache authenticated asset responses. View-once bytes were requested only when the viewer opened them. A persistent-browser close and relaunch demonstrated that queued messages survived an offline restart, beyond the warm-offline choreography.

The native arm was installed from its exact published package and every milestone produced an iOS Hermes export. That is valuable build evidence, but it is not a simulator or physical-device execution result. I have kept that distinction in the record. Similarly, the first scale attempt's loopback socket exhaustion was an environment/transport issue, addressed with pacing and stable-ID retries. It should not be confused with the application architecture failure exposed by the original Following query.

## What I can say about earlier generations

Earlier Snapback generations are the least defensible part of a direct comparison in this run. I deliberately did not inspect their source, implementations or prior results, and I have no measured before-and-after result here. I therefore cannot attribute a difficulty to an old release or claim that an earlier generation lacked a feature merely because this release documents it. What I can evaluate is the current published contract: a compact language, generated application types, executable rules on server and device, explicit completeness, and integrated assets and jobs.

That contract reduced glue work and increased the importance of modeling bounded, knowable operations. Familiarity with relational indexes, account-level cursors, idempotency, service workers and effect delivery saved time. Familiarity with ordinary unrestricted server functions sometimes led me in the wrong direction. I finished with more explicit read models than I initially expected, and less custom synchronization machinery. For this application, that is the central trade: Snapback moved effort from connecting independent infrastructure pieces into expressing the product correctly inside one constrained execution model.

A final native review reinforced that last distinction: my session-store wrapper had omitted the key normalization present in the generated starter. I corrected it and rebuilt the Hermes export. The shared execution model reduced synchronization work, but it did not remove ordinary platform integration mistakes, and bundle success alone would not have exposed this one.
