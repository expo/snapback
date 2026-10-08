# Timings for every test in every changed file

Seconds from Node TAP `duration_ms`, including test setup/teardown. Whole-file duration includes runner overhead. Before is a fresh unchanged run. After 1 uses the disabled mutation loader; after 2/3 are serial ordinary runs. See REPORT.md for shared-host limits.

## bounded-following.test.mjs

| Test | Before | After 1 | After 2 | After 3 |
| --- | ---: | ---: | ---: | ---: |
| **Whole file** | 1219.176 | 314.008 | 314.052 | 314.261 |
| event slots wasm: owned-event fallback waits for the source prediction | 38.529 | 8.577 | 8.634 | 8.540 |
| event slots wasm: rejected owned events cannot make a speculative scan publishable | 38.025 | 8.045 | 8.050 | 8.045 |
| bounded Following wasm: unrelated held reads cannot validate speculative refusals or empty pages | 38.183 | 13.368 | 13.345 | 13.361 |
| bounded Following wasm: unknown conditions preserve static and helper dependencies | 64.292 | 9.322 | 9.335 | 9.313 |
| bounded Following wasm: a scalar cut before the feed keeps its possible reads fenced | 35.448 | 35.406 | 35.451 | 35.434 |
| bounded Following wasm: a known branch wins over static server routing | 4.235 | 4.241 | 4.232 | 4.234 |
| bounded Following wasm: a speculative profile withholds while a non-speculative page keeps predicted rows | 34.248 | 9.297 | 9.288 | 9.302 |
| bounded Following wasm: a late card miss and oversized withheld output still use fallback | 1.214 | 1.209 | 1.137 | 1.211 |
| bounded Following wasm: untaken online-only card branches remain answerable when held | 0.506 | 0.519 | 0.517 | 0.521 |
| bounded Following wasm: composed reads withhold the entire answer across the prediction fence | 38.019 | 8.025 | 8.036 | 8.025 |
| bounded Following wasm: exact offline pages, original-cursor fallback and quiet authors | 1.154 | 1.181 | 1.194 | 1.182 |
| bounded Following wasm: a predicted post fences fallback until observation | 68.007 | 8.028 | 8.041 | 8.038 |
| bounded Following wasm: online-only cards withhold offline | 0.221 | 0.225 | 0.226 | 0.237 |
| bounded Following wasm: repost prediction needs a held original | 8.110 | 8.214 | 8.233 | 8.217 |
| bounded Following wasm: held cards and transport failures stay withheld | 0.402 | 0.402 | 0.401 | 0.406 |
| bounded Following wasm: online-only repost cards use the prediction fence before server routing | 68.025 | 8.041 | 8.034 | 8.048 |
| bounded Following wasm: a response racing prediction admission is invalidated | 30.152 | 8.065 | 8.072 | 8.070 |
| bounded Following wasm: repost horizon misses withhold but full-source nulls remain data | 0.213 | 0.232 | 0.219 | 0.215 |
| bounded Following wasm: inbox floors use all routing branches and preserve meter prefixes | 104.414 | 18.389 | 18.461 | 18.387 |
| event slots native: owned-event fallback waits for the source prediction | 38.139 | 8.123 | 8.146 | 8.141 |
| event slots native: rejected owned events cannot make a speculative scan publishable | 38.119 | 8.113 | 8.127 | 8.136 |
| bounded Following native: unrelated held reads cannot validate speculative refusals or empty pages | 38.207 | 13.432 | 13.434 | 13.439 |
| bounded Following native: unknown conditions preserve static and helper dependencies | 64.357 | 9.403 | 9.385 | 9.407 |
| bounded Following native: a scalar cut before the feed keeps its possible reads fenced | 35.699 | 35.667 | 35.674 | 35.657 |
| bounded Following native: a known branch wins over static server routing | 4.287 | 4.266 | 4.268 | 4.273 |
| bounded Following native: a speculative profile withholds while a non-speculative page keeps predicted rows | 34.290 | 9.341 | 9.366 | 9.418 |
| bounded Following native: a late card miss and oversized withheld output still use fallback | 1.888 | 1.955 | 1.895 | 1.888 |
| bounded Following native: untaken online-only card branches remain answerable when held | 0.563 | 0.556 | 0.555 | 0.588 |
| bounded Following native: composed reads withhold the entire answer across the prediction fence | 38.119 | 8.098 | 8.090 | 8.102 |
| bounded Following native: exact offline pages, original-cursor fallback and quiet authors | 1.240 | 1.273 | 1.258 | 1.276 |
| bounded Following native: a predicted post fences fallback until observation | 68.107 | 8.094 | 8.096 | 8.090 |
| bounded Following native: online-only cards withhold offline | 0.269 | 0.267 | 0.269 | 0.267 |
| bounded Following native: repost prediction needs a held original | 8.261 | 8.256 | 8.256 | 8.271 |
| bounded Following native: held cards and transport failures stay withheld | 0.453 | 0.454 | 0.451 | 0.439 |
| bounded Following native: online-only repost cards use the prediction fence before server routing | 68.139 | 8.132 | 8.121 | 8.113 |
| bounded Following native: a response racing prediction admission is invalidated | 30.194 | 8.142 | 8.150 | 8.132 |
| bounded Following native: repost horizon misses withhold but full-source nulls remain data | 0.259 | 0.260 | 0.252 | 0.257 |
| bounded Following native: inbox floors use all routing branches and preserve meter prefixes | 105.107 | 19.174 | 19.167 | 19.260 |
| bounded Following native query module: executed dependencies fence fallback until prediction observation | 69.955 | 10.042 | 10.018 | 10.160 |

## retained-history.test.mjs

| Test | Before | After 1 | After 2 | After 3 |
| --- | ---: | ---: | ---: | ---: |
| **Whole file** | 192.570 | 68.683 | 68.989 | 69.031 |
| W14A horizon-free matching wasm: retained history and independent held coverage | 1.208 | 0.896 | 0.747 | 0.915 |
| W14A positive existence wasm: retained history and independent held coverage | 0.521 | 0.281 | 0.258 | 0.276 |
| R5 history wasm: retained history and independent held coverage | 0.755 | 0.311 | 0.319 | 0.321 |
| RH held leave wasm: retained history and independent held coverage | 0.529 | 0.343 | 0.300 | 0.309 |
| RH stalled leave wasm: retained history and independent held coverage | 1.529 | 1.309 | 1.321 | 1.300 |
| RH empty catch-up wasm: retained history and independent held coverage | 0.527 | 0.256 | 0.272 | 0.265 |
| R1a empty search wasm: retained history and independent held coverage | 0.532 | 0.258 | 0.258 | 0.259 |
| R1a mixed reads wasm: retained history and independent held coverage | 0.433 | 0.256 | 0.264 | 0.255 |
| R2 mixed result wasm: retained history and independent held coverage | 1.524 | 1.305 | 1.299 | 1.306 |
| R2 sync during reply wasm: retained history and independent held coverage | 0.584 | 0.289 | 0.277 | 0.299 |
| R2 unknown sync during reply wasm: retained history and independent held coverage | 1.008 | 0.292 | 0.288 | 0.305 |
| R2 relevant sync during reply wasm: retained history and independent held coverage | 1.125 | 0.295 | 0.296 | 0.285 |
| MQ authoritative bound wasm: retained history and independent held coverage | 1.173 | 0.450 | 0.444 | 0.437 |
| MQ speculative component wasm: retained history and independent held coverage | 0.807 | 0.268 | 0.263 | 0.275 |
| MQ speculative events wasm: retained history and independent held coverage | 68.736 | 9.410 | 9.415 | 9.416 |
| MQ expiry local left wasm: retained history and independent held coverage | 1.232 | 1.248 | 1.244 | 1.249 |
| MQ expiry local watch left wasm: retained history and independent held coverage | 1.225 | 1.241 | 1.231 | 1.252 |
| MQ local permit wasm: retained history and independent held coverage | 1.249 | 1.252 | 1.249 | 1.251 |
| MQ local permit watch wasm: retained history and independent held coverage | 1.238 | 1.248 | 1.250 | 1.259 |
| MQ local branch wasm: retained history and independent held coverage | 0.230 | 0.264 | 0.264 | 0.256 |
| MQ local branch watch wasm: retained history and independent held coverage | 0.230 | 0.263 | 0.259 | 0.256 |
| MQ local page wasm: retained history and independent held coverage | 0.235 | 0.268 | 0.257 | 0.259 |
| MQ ineligible wasm: retained history and independent held coverage | 0.261 | 0.280 | 0.296 | 0.279 |
| MQ points wasm: retained history and independent held coverage | 0.235 | 0.272 | 0.271 | 0.250 |
| MQ delete current wasm: retained history and independent held coverage | 0.331 | 0.353 | 0.352 | 0.354 |
| MQ revoke current wasm: retained history and independent held coverage | 0.326 | 0.329 | 0.311 | 0.331 |
| MQ rejoin wasm: retained history and independent held coverage | 0.323 | 0.317 | 0.309 | 0.331 |
| MQ held change wasm: retained history and independent held coverage | 0.338 | 0.328 | 0.309 | 0.333 |
| MQ close wasm: retained history and independent held coverage | 0.255 | 0.258 | 0.246 | 0.259 |
| MQ sign-out wasm: retained history and independent held coverage | 0.265 | 0.261 | 0.259 | 0.266 |
| MQ transport wasm: retained history and independent held coverage | 0.243 | 0.246 | 0.254 | 0.248 |
| MQ adoption wasm: retained history and independent held coverage | 0.638 | 0.690 | 0.686 | 0.662 |
| MQ reset wasm: retained history and independent held coverage | 1.316 | 1.336 | 1.329 | 1.330 |
| MQ rotation wasm: retained history and independent held coverage | 0.303 | 0.342 | 0.321 | 0.335 |
| MQ prediction wasm: retained history and independent held coverage | 4.372 | 4.345 | 4.359 | 4.353 |
| MQ expiry left wasm: retained history and independent held coverage | 0.351 | 0.342 | 0.331 | 0.354 |
| MQ expiry held wasm: retained history and independent held coverage | 0.328 | 0.349 | 0.330 | 0.343 |
| MQ interrupted snapshot wasm: retained history and independent held coverage | 1.345 | 1.286 | 1.341 | 1.355 |
| MQ retained snapshot wasm: retained history and independent held coverage | 0.327 | 0.324 | 0.337 | 0.332 |
| W14A horizon-free matching process: retained history and independent held coverage | 0.305 | 0.303 | 0.291 | 0.300 |
| W14A positive existence process: retained history and independent held coverage | 0.543 | 0.326 | 0.310 | 0.300 |
| R5 history process: retained history and independent held coverage | 0.359 | 0.331 | 0.354 | 0.343 |
| RH held leave process: retained history and independent held coverage | 0.397 | 0.333 | 0.405 | 0.363 |
| RH stalled leave process: retained history and independent held coverage | 1.377 | 1.358 | 1.379 | 1.363 |
| RH empty catch-up process: retained history and independent held coverage | 0.309 | 0.287 | 0.307 | 0.310 |
| R1a empty search process: retained history and independent held coverage | 0.304 | 0.285 | 0.291 | 0.295 |
| R1a mixed reads process: retained history and independent held coverage | 0.302 | 0.293 | 0.310 | 0.295 |
| R2 mixed result process: retained history and independent held coverage | 1.409 | 1.354 | 1.414 | 1.339 |
| R2 sync during reply process: retained history and independent held coverage | 0.304 | 0.298 | 0.311 | 0.316 |
| R2 unknown sync during reply process: retained history and independent held coverage | 0.360 | 0.334 | 0.337 | 0.340 |
| R2 relevant sync during reply process: retained history and independent held coverage | 0.331 | 0.345 | 0.337 | 0.359 |
| MQ authoritative bound process: retained history and independent held coverage | 0.501 | 0.501 | 0.513 | 0.506 |
| MQ speculative component process: retained history and independent held coverage | 0.334 | 0.308 | 0.321 | 0.333 |
| MQ speculative events process: retained history and independent held coverage | 68.293 | 9.481 | 9.498 | 9.477 |
| MQ expiry local left process: retained history and independent held coverage | 1.285 | 1.294 | 1.299 | 1.290 |
| MQ expiry local watch left process: retained history and independent held coverage | 1.328 | 1.279 | 1.298 | 1.294 |
| MQ local permit process: retained history and independent held coverage | 1.293 | 1.290 | 1.300 | 1.290 |
| MQ local permit watch process: retained history and independent held coverage | 1.288 | 1.291 | 1.294 | 1.289 |
| MQ local branch process: retained history and independent held coverage | 0.322 | 0.302 | 0.397 | 0.317 |
| MQ local branch watch process: retained history and independent held coverage | 0.311 | 0.308 | 0.315 | 0.323 |
| MQ local page process: retained history and independent held coverage | 0.320 | 0.298 | 0.311 | 0.314 |
| MQ ineligible process: retained history and independent held coverage | 0.370 | 0.353 | 0.382 | 0.373 |
| MQ points process: retained history and independent held coverage | 0.326 | 0.329 | 0.332 | 0.344 |
| MQ delete current process: retained history and independent held coverage | 0.390 | 0.385 | 0.385 | 0.391 |
| MQ revoke current process: retained history and independent held coverage | 0.378 | 0.389 | 0.384 | 0.388 |
| MQ rejoin process: retained history and independent held coverage | 0.395 | 0.391 | 0.374 | 0.365 |
| MQ held change process: retained history and independent held coverage | 0.382 | 0.404 | 0.396 | 0.384 |
| MQ close process: retained history and independent held coverage | 0.314 | 0.309 | 0.309 | 0.331 |
| MQ sign-out process: retained history and independent held coverage | 0.302 | 0.313 | 0.337 | 0.324 |
| MQ transport process: retained history and independent held coverage | 0.323 | 0.312 | 0.328 | 0.317 |
| MQ adoption process: retained history and independent held coverage | 0.704 | 0.699 | 0.682 | 0.720 |
| MQ reset process: retained history and independent held coverage | 1.358 | 1.357 | 1.418 | 1.360 |
| MQ rotation process: retained history and independent held coverage | 0.400 | 0.391 | 0.403 | 0.398 |
| MQ prediction process: retained history and independent held coverage | 4.451 | 4.457 | 4.453 | 4.467 |
| MQ expiry left process: retained history and independent held coverage | 0.401 | 0.399 | 0.406 | 0.409 |
| MQ expiry held process: retained history and independent held coverage | 0.410 | 0.451 | 0.419 | 0.437 |
| MQ interrupted snapshot process: retained history and independent held coverage | 1.359 | 1.335 | 1.408 | 1.356 |
| MQ retained snapshot process: retained history and independent held coverage | 0.382 | 0.396 | 0.401 | 0.434 |

## following-routing.test.mjs

| Test | Before | After 1 | After 2 | After 3 |
| --- | ---: | ---: | ---: | ---: |
| **Whole file** | 33.195 | 4.143 | 4.133 | 4.132 |
| Following becomes withheld on composed re-observation: server | 1.021 | 1.022 | 1.021 | 1.022 |
| Following becomes withheld on composed re-observation: offline | 1.003 | 1.004 | 1.004 | 1.003 |
| Following becomes withheld on composed re-observation: pending | 30.065 | 1.003 | 1.004 | 1.004 |
| Following becomes withheld on composed re-observation: transport recovered | 1.003 | 1.003 | 1.004 | 1.004 |

## client-lifecycle.test.mjs

| Test | Before | After 1 | After 2 | After 3 |
| --- | ---: | ---: | ---: | ---: |
| **Whole file** | 45.256 | 42.951 | 43.079 | 43.125 |
| online reconnect requires the authenticated GET /probe contract | 6.305 | 6.161 | 6.415 | 6.310 |
| online pending writes emit their terminal outcome exactly once | 0.564 | 0.560 | 0.560 | 0.555 |
| online auth refusal settles writes that were queued behind the refused request | 0.003 | 0.003 | 0.003 | 0.002 |
| local pending writes emit once with the kept device identity | 0.074 | 0.073 | 0.077 | 0.067 |
| local pending writes emit once with their original binding ahead of a newer device identity | 0.063 | 0.063 | 0.063 | 0.062 |
| local reconnect requires the authenticated GET /probe contract | 5.248 | 5.203 | 5.247 | 5.256 |
| local startup releases a device when initialization after the protocol probe fails | 0.001 | 0.002 | 0.002 | 0.003 |
| local sync shrinks response-bound pages at one cursor and exposes an indivisible refusal | 0.008 | 0.018 | 0.019 | 0.020 |
| local observations skip idle polls and rerun after a committed page | 0.034 | 0.036 | 0.036 | 0.037 |
| local generation adoption reruns observations whose dependencies changed | 0.033 | 0.039 | 0.039 | 0.040 |
| closing a pending watch prevents its response from scheduling expiry or rerunning dirty work | 0.054 | 0.056 | 0.059 | 0.059 |
| local auth invalidation notifies viewer listeners before session deletion can fail | 0.002 | 0.005 | 0.005 | 0.005 |
| local observations rerun when the device-reported visible lifetime expires | 0.214 | 0.217 | 0.217 | 0.218 |
| a refused device adopt keeps the previous backend active in JavaScript | 0.012 | 0.014 | 0.015 | 0.015 |
| a failed native replacement falls back without a stale local answer and is retried | 0.003 | 0.006 | 0.006 | 0.006 |
| every local prediction invalidates observations, including unrelated tables | 0.022 | 0.025 | 0.025 | 0.024 |
| online watches retain their changes watermark; bare tokens clear on refusal | 0.302 | 0.313 | 0.292 | 0.273 |
| wasm: pending metadata survives repeated profile/vote updates and offline replay | 2.852 | 2.952 | 2.901 | 2.956 |
| wasm: no-op and nosync writes retire when the partition stream is empty | 0.250 | 0.234 | 0.242 | 0.244 |
| wasm: a write already sending when a snapshot starts is correlated after catch-up | 0.336 | 0.291 | 0.322 | 0.296 |
| wasm: a sync started before admission finishes before that write can be sent | 0.254 | 0.246 | 0.248 | 0.252 |
| wasm: sync before a delayed write reply does not apply an increment twice | 0.307 | 0.298 | 0.297 | 0.296 |
| wasm: sync before a lost write reply does not apply an increment twice | 1.283 | 1.280 | 1.245 | 1.278 |
| wasm: background sync timestamps survive reconnect and unwraps beyond the horizon use the server | 1.477 | 1.480 | 1.493 | 1.520 |
| wasm: population growth cannot mint new IDs during prediction replay | 1.332 | 0.301 | 0.301 | 0.305 |
| wasm: retry without observers, online-only routing and denied-watch recovery | 1.003 | 0.876 | 0.875 | 0.878 |
| wasm: a rejected guardedEdit restores confirmed and maintained rows under a later prediction | 0.265 | 0.265 | 0.267 | 0.267 |
| wasm: a rejected guardedDelete restores confirmed and maintained rows under a later prediction | 0.266 | 0.253 | 0.258 | 0.253 |
| native: pending metadata survives repeated profile/vote updates and offline replay | 2.493 | 2.461 | 2.438 | 2.503 |
| native: no-op and nosync writes retire when the partition stream is empty | 0.308 | 0.285 | 0.288 | 0.292 |
| native: a write already sending when a snapshot starts is correlated after catch-up | 0.426 | 0.410 | 0.376 | 0.408 |
| native: another client sending after sync capture cannot publish an uncorrelated page | 1.225 | 1.229 | 1.231 | 1.237 |
| native: a sync started before admission finishes before that write can be sent | 0.287 | 0.291 | 0.305 | 0.291 |
| native: sync before a delayed write reply does not apply an increment twice | 0.320 | 0.375 | 0.371 | 0.346 |
| native: sync before a lost write reply does not apply an increment twice | 1.346 | 1.401 | 1.393 | 1.393 |
| native: background sync timestamps survive reconnect and unwraps beyond the horizon use the server | 1.984 | 1.994 | 1.990 | 1.975 |
| native: population growth cannot mint new IDs during prediction replay | 1.306 | 0.344 | 0.357 | 0.348 |
| native: retry without observers, online-only routing and denied-watch recovery | 1.014 | 0.935 | 0.829 | 0.836 |
| native: a rejected guardedEdit restores confirmed and maintained rows under a later prediction | 0.323 | 0.322 | 0.332 | 0.328 |
| native: a rejected guardedDelete restores confirmed and maintained rows under a later prediction | 0.325 | 0.314 | 0.320 | 0.324 |
| close cancels online write callers without aborting committed delivery | 0.187 | 0.185 | 0.183 | 0.183 |
| device process failures reject opening and pending calls instead of leaving close waiting | 0.050 | 0.049 | 0.050 | 0.050 |
| device compatibility rejects old and malformed protocols before online or offline startup | 0.065 | 0.063 | 0.061 | 0.064 |
| device compatibility closes the core and preserves operational startup errors | 0.001 | 0.001 | 0.001 | 0.001 |
| device compatibility accepts the current core online and on an offline reopen | 1.243 | 1.239 | 1.235 | 1.241 |
| online serialization failures retain the minted id without scheduling network retries | 0.001 | 0.001 | 0.001 | 0.001 |
| wasm: close waits for an applying acknowledgment and aborts sync | 0.258 | 0.268 | 0.271 | 0.272 |
| native: close waits for an applying acknowledgment and aborts sync | 0.320 | 0.315 | 0.323 | 0.328 |
| W13b fallback boundary: cursorless | 1.004 | 1.004 | 1.004 | 1.004 |
| W13b fallback boundary: meter | 1.003 | 1.003 | 1.002 | 1.004 |
| W13b fallback boundary: words | 1.004 | 1.004 | 1.004 | 1.004 |
| W13b fallback boundary: missing fact | 1.005 | 1.003 | 1.004 | 1.003 |
| W13b fallback boundary: presence | 1.004 | 1.003 | 1.003 | 1.003 |
| W13b fallback boundary: offline missing fact | 1.004 | 1.004 | 1.002 | 1.003 |
| W13b fallback boundary: held | 1.004 | 1.003 | 1.001 | 1.001 |
| W13b fallback boundary: retained | 1.002 | 1.003 | 1.003 | 1.003 |
| W13b fallback boundary: pending predictable write | 1.003 | 1.003 | 1.004 | 1.003 |
