# Round-2 per-test timings

Seconds from Node TAP, including setup and cleanup. Original and round-1 measurements are retained from the prior reports, not rerun here. Round 2 run 1 overlaps controls/regressions; runs 2 and 3 have no other test jobs from this lane. Shared-host measurements, not latency guarantees.

## bounded-following.test.mjs

| Test | Original | Round 1 median | Round 2 / 1 | Round 2 / 2 | Round 2 / 3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Whole file** | 1219.176 | 314.208 | 313.997 | 315.826 | 317.562 |
| event slots wasm: owned-event fallback waits for the source prediction | 38.529 | 8.553 | 8.555 | 8.503 | 8.676 |
| event slots wasm: rejected owned events cannot make a speculative scan publishable | 38.025 | 8.058 | 8.053 | 8.050 | 8.042 |
| bounded Following wasm: unrelated held reads cannot validate speculative refusals or empty pages | 38.183 | 13.340 | 13.348 | 13.341 | 13.358 |
| bounded Following wasm: unknown conditions preserve static and helper dependencies | 64.292 | 9.322 | 9.320 | 9.304 | 9.323 |
| bounded Following wasm: a scalar cut before the feed keeps its possible reads fenced | 35.448 | 35.436 | 35.429 | 35.427 | 35.398 |
| bounded Following wasm: a known branch wins over static server routing | 4.235 | 4.233 | 4.236 | 4.242 | 4.240 |
| bounded Following wasm: a speculative profile withholds while a non-speculative page keeps predicted rows | 34.248 | 9.299 | 9.310 | 9.309 | 9.285 |
| bounded Following wasm: a late card miss and oversized withheld output still use fallback | 1.214 | 1.216 | 1.218 | 1.120 | 1.215 |
| bounded Following wasm: untaken online-only card branches remain answerable when held | 0.506 | 0.515 | 0.522 | 0.520 | 0.520 |
| bounded Following wasm: composed reads withhold the entire answer across the prediction fence | 38.019 | 8.031 | 8.018 | 8.031 | 8.023 |
| bounded Following wasm: exact offline pages, original-cursor fallback and quiet authors | 1.154 | 1.182 | 1.181 | 1.178 | 1.154 |
| bounded Following wasm: a predicted post fences fallback until observation | 68.007 | 8.030 | 8.017 | 8.026 | 8.031 |
| bounded Following wasm: online-only cards withhold offline | 0.221 | 0.228 | 0.242 | 0.213 | 0.233 |
| bounded Following wasm: repost prediction needs a held original | 8.110 | 8.220 | 8.215 | 8.219 | 8.221 |
| bounded Following wasm: held cards and transport failures stay withheld | 0.402 | 0.406 | 0.400 | 0.398 | 0.401 |
| bounded Following wasm: online-only repost cards use the prediction fence before server routing | 68.025 | 8.047 | 8.037 | 8.046 | 8.045 |
| bounded Following wasm: a response racing prediction admission is invalidated | 30.152 | 8.065 | 8.063 | 8.068 | 8.066 |
| bounded Following wasm: repost horizon misses withhold but full-source nulls remain data | 0.213 | 0.217 | 0.245 | 0.225 | 0.221 |
| bounded Following wasm: inbox floors use all routing branches and preserve meter prefixes | 104.414 | 18.414 | 18.414 | 18.390 | 18.430 |
| event slots native: owned-event fallback waits for the source prediction | 38.139 | 8.147 | 8.116 | 8.149 | 8.142 |
| event slots native: rejected owned events cannot make a speculative scan publishable | 38.119 | 8.124 | 8.108 | 8.117 | 8.093 |
| bounded Following native: unrelated held reads cannot validate speculative refusals or empty pages | 38.207 | 13.433 | 13.459 | 13.479 | 13.445 |
| bounded Following native: unknown conditions preserve static and helper dependencies | 64.357 | 9.397 | 9.442 | 9.446 | 9.465 |
| bounded Following native: a scalar cut before the feed keeps its possible reads fenced | 35.699 | 35.674 | 35.668 | 35.679 | 35.649 |
| bounded Following native: a known branch wins over static server routing | 4.287 | 4.280 | 4.271 | 4.284 | 4.276 |
| bounded Following native: a speculative profile withholds while a non-speculative page keeps predicted rows | 34.290 | 9.372 | 9.362 | 9.464 | 9.368 |
| bounded Following native: a late card miss and oversized withheld output still use fallback | 1.888 | 1.951 | 1.918 | 2.175 | 1.946 |
| bounded Following native: untaken online-only card branches remain answerable when held | 0.563 | 0.558 | 0.551 | 0.546 | 0.547 |
| bounded Following native: composed reads withhold the entire answer across the prediction fence | 38.119 | 8.110 | 8.089 | 8.145 | 8.139 |
| bounded Following native: exact offline pages, original-cursor fallback and quiet authors | 1.240 | 1.272 | 1.254 | 1.272 | 1.289 |
| bounded Following native: a predicted post fences fallback until observation | 68.107 | 8.099 | 8.099 | 8.072 | 8.155 |
| bounded Following native: online-only cards withhold offline | 0.269 | 0.264 | 0.264 | 0.264 | 0.260 |
| bounded Following native: repost prediction needs a held original | 8.261 | 8.260 | 8.253 | 8.254 | 8.253 |
| bounded Following native: held cards and transport failures stay withheld | 0.453 | 0.451 | 0.444 | 0.459 | 0.445 |
| bounded Following native: online-only repost cards use the prediction fence before server routing | 68.139 | 8.106 | 8.105 | 8.550 | 8.113 |
| bounded Following native: a response racing prediction admission is invalidated | 30.194 | 8.135 | 8.128 | 9.137 | 8.593 |
| bounded Following native: repost horizon misses withhold but full-source nulls remain data | 0.259 | 0.262 | 0.249 | 0.275 | 1.566 |
| bounded Following native: inbox floors use all routing branches and preserve meter prefixes | 105.107 | 19.190 | 19.144 | 19.226 | 20.694 |
| bounded Following native query module: executed dependencies fence fallback until prediction observation | 69.955 | 10.074 | 10.097 | 10.072 | 10.091 |

## retained-history.test.mjs

| Test | Original | Round 1 median | Round 2 / 1 | Round 2 / 2 | Round 2 / 3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Whole file** | 192.570 | 68.763 | 68.876 | 69.193 | 68.676 |
| W14A horizon-free matching wasm: retained history and independent held coverage | 1.208 | 0.709 | 0.750 | 0.918 | 0.676 |
| W14A positive existence wasm: retained history and independent held coverage | 0.521 | 0.260 | 0.274 | 0.276 | 0.273 |
| R5 history wasm: retained history and independent held coverage | 0.755 | 0.303 | 0.307 | 0.318 | 0.313 |
| RH held leave wasm: retained history and independent held coverage | 0.529 | 0.309 | 0.319 | 0.342 | 0.313 |
| RH stalled leave wasm: retained history and independent held coverage | 1.529 | 1.322 | 1.320 | 1.322 | 1.305 |
| RH empty catch-up wasm: retained history and independent held coverage | 0.527 | 0.266 | 0.253 | 0.269 | 0.266 |
| R1a empty search wasm: retained history and independent held coverage | 0.532 | 0.256 | 0.241 | 0.249 | 0.249 |
| R1a mixed reads wasm: retained history and independent held coverage | 0.433 | 0.257 | 0.257 | 0.258 | 0.251 |
| R2 mixed result wasm: retained history and independent held coverage | 1.524 | 1.302 | 1.357 | 1.456 | 1.303 |
| R2 sync during reply wasm: retained history and independent held coverage | 0.584 | 0.276 | 0.254 | 0.294 | 0.285 |
| R2 unknown sync during reply wasm: retained history and independent held coverage | 1.008 | 0.298 | 0.298 | 0.279 | 0.288 |
| R2 relevant sync during reply wasm: retained history and independent held coverage | 1.125 | 0.295 | 0.296 | 0.280 | 0.302 |
| MQ authoritative bound wasm: retained history and independent held coverage | 1.173 | 0.455 | 0.431 | 0.411 | 0.453 |
| MQ speculative component wasm: retained history and independent held coverage | 0.807 | 0.267 | 0.271 | 0.278 | 0.265 |
| MQ speculative events wasm: retained history and independent held coverage | 68.736 | 9.415 | 9.403 | 9.407 | 9.384 |
| MQ expiry local left wasm: retained history and independent held coverage | 1.232 | 1.240 | 1.237 | 1.264 | 1.243 |
| MQ expiry local watch left wasm: retained history and independent held coverage | 1.225 | 1.243 | 1.246 | 1.254 | 1.247 |
| MQ local permit wasm: retained history and independent held coverage | 1.249 | 1.250 | 1.248 | 1.247 | 1.239 |
| MQ local permit watch wasm: retained history and independent held coverage | 1.238 | 1.250 | 1.319 | 1.221 | 1.249 |
| MQ local branch wasm: retained history and independent held coverage | 0.230 | 0.269 | 0.265 | 0.237 | 0.246 |
| MQ local branch watch wasm: retained history and independent held coverage | 0.230 | 0.261 | 0.260 | 0.247 | 0.259 |
| MQ local page wasm: retained history and independent held coverage | 0.235 | 0.258 | 0.263 | 0.256 | 0.241 |
| MQ ineligible wasm: retained history and independent held coverage | 0.261 | 0.294 | 0.280 | 0.280 | 0.277 |
| MQ points wasm: retained history and independent held coverage | 0.235 | 0.282 | 0.271 | 0.265 | 0.240 |
| MQ delete current wasm: retained history and independent held coverage | 0.331 | 0.349 | 0.320 | 0.338 | 0.349 |
| MQ revoke current wasm: retained history and independent held coverage | 0.326 | 0.331 | 0.332 | 0.317 | 0.298 |
| MQ rejoin wasm: retained history and independent held coverage | 0.323 | 0.329 | 0.322 | 0.308 | 0.321 |
| MQ held change wasm: retained history and independent held coverage | 0.338 | 0.326 | 0.338 | 0.332 | 0.315 |
| MQ close wasm: retained history and independent held coverage | 0.255 | 0.257 | 0.264 | 0.260 | 0.270 |
| MQ sign-out wasm: retained history and independent held coverage | 0.265 | 0.250 | 0.270 | 0.263 | 0.255 |
| MQ transport wasm: retained history and independent held coverage | 0.243 | 0.261 | 0.263 | 0.271 | 0.264 |
| MQ adoption wasm: retained history and independent held coverage | 0.638 | 0.646 | 0.646 | 0.692 | 0.685 |
| MQ reset wasm: retained history and independent held coverage | 1.316 | 1.334 | 1.314 | 1.336 | 1.325 |
| MQ rotation wasm: retained history and independent held coverage | 0.303 | 0.317 | 0.329 | 0.327 | 0.335 |
| MQ prediction wasm: retained history and independent held coverage | 4.372 | 4.355 | 4.360 | 4.363 | 4.353 |
| MQ expiry left wasm: retained history and independent held coverage | 0.351 | 0.347 | 0.352 | 0.329 | 0.345 |
| MQ expiry held wasm: retained history and independent held coverage | 0.328 | 0.357 | 0.336 | 0.350 | 0.341 |
| MQ interrupted snapshot wasm: retained history and independent held coverage | 1.345 | 1.344 | 1.366 | 1.365 | 1.334 |
| MQ retained snapshot wasm: retained history and independent held coverage | 0.327 | 0.340 | 0.337 | 0.334 | 0.340 |
| W14A horizon-free matching process: retained history and independent held coverage | 0.305 | 0.301 | 0.303 | 0.306 | 0.306 |
| W14A positive existence process: retained history and independent held coverage | 0.543 | 0.303 | 0.310 | 0.316 | 0.306 |
| R5 history process: retained history and independent held coverage | 0.359 | 0.364 | 0.367 | 0.365 | 0.353 |
| RH held leave process: retained history and independent held coverage | 0.397 | 0.392 | 0.391 | 0.401 | 0.405 |
| RH stalled leave process: retained history and independent held coverage | 1.377 | 1.377 | 1.396 | 1.384 | 1.393 |
| RH empty catch-up process: retained history and independent held coverage | 0.309 | 0.314 | 0.314 | 0.312 | 0.306 |
| R1a empty search process: retained history and independent held coverage | 0.304 | 0.298 | 0.293 | 0.285 | 0.305 |
| R1a mixed reads process: retained history and independent held coverage | 0.302 | 0.316 | 0.354 | 0.301 | 0.299 |
| R2 mixed result process: retained history and independent held coverage | 1.409 | 1.347 | 1.348 | 1.380 | 1.402 |
| R2 sync during reply process: retained history and independent held coverage | 0.304 | 0.300 | 0.311 | 0.285 | 0.306 |
| R2 unknown sync during reply process: retained history and independent held coverage | 0.360 | 0.348 | 0.343 | 0.331 | 0.346 |
| R2 relevant sync during reply process: retained history and independent held coverage | 0.331 | 0.346 | 0.350 | 0.349 | 0.348 |
| MQ authoritative bound process: retained history and independent held coverage | 0.501 | 0.512 | 0.518 | 0.515 | 0.505 |
| MQ speculative component process: retained history and independent held coverage | 0.334 | 0.315 | 0.318 | 0.313 | 0.326 |
| MQ speculative events process: retained history and independent held coverage | 68.293 | 9.484 | 9.532 | 9.520 | 9.484 |
| MQ expiry local left process: retained history and independent held coverage | 1.285 | 1.295 | 1.281 | 1.296 | 1.298 |
| MQ expiry local watch left process: retained history and independent held coverage | 1.328 | 1.287 | 1.282 | 1.299 | 1.304 |
| MQ local permit process: retained history and independent held coverage | 1.293 | 1.296 | 1.288 | 1.295 | 1.285 |
| MQ local permit watch process: retained history and independent held coverage | 1.288 | 1.292 | 1.289 | 1.299 | 1.290 |
| MQ local branch process: retained history and independent held coverage | 0.322 | 0.306 | 0.322 | 0.310 | 0.306 |
| MQ local branch watch process: retained history and independent held coverage | 0.311 | 0.310 | 0.316 | 0.323 | 0.318 |
| MQ local page process: retained history and independent held coverage | 0.320 | 0.316 | 0.326 | 0.317 | 0.306 |
| MQ ineligible process: retained history and independent held coverage | 0.370 | 0.358 | 0.374 | 0.381 | 0.374 |
| MQ points process: retained history and independent held coverage | 0.326 | 0.315 | 0.341 | 0.336 | 0.315 |
| MQ delete current process: retained history and independent held coverage | 0.390 | 0.382 | 0.380 | 0.405 | 0.392 |
| MQ revoke current process: retained history and independent held coverage | 0.378 | 0.394 | 0.392 | 0.389 | 0.388 |
| MQ rejoin process: retained history and independent held coverage | 0.395 | 0.402 | 0.386 | 0.392 | 0.385 |
| MQ held change process: retained history and independent held coverage | 0.382 | 0.389 | 0.358 | 0.386 | 0.404 |
| MQ close process: retained history and independent held coverage | 0.314 | 0.332 | 0.306 | 0.304 | 0.324 |
| MQ sign-out process: retained history and independent held coverage | 0.302 | 0.317 | 0.304 | 0.335 | 0.313 |
| MQ transport process: retained history and independent held coverage | 0.323 | 0.305 | 0.299 | 0.307 | 0.306 |
| MQ adoption process: retained history and independent held coverage | 0.704 | 0.697 | 0.714 | 0.709 | 0.682 |
| MQ reset process: retained history and independent held coverage | 1.358 | 1.379 | 1.341 | 1.349 | 1.470 |
| MQ rotation process: retained history and independent held coverage | 0.400 | 0.397 | 0.400 | 0.412 | 0.377 |
| MQ prediction process: retained history and independent held coverage | 4.451 | 4.462 | 4.439 | 4.415 | 4.433 |
| MQ expiry left process: retained history and independent held coverage | 0.401 | 0.421 | 0.393 | 0.404 | 0.402 |
| MQ expiry held process: retained history and independent held coverage | 0.410 | 0.420 | 0.400 | 0.436 | 0.410 |
| MQ interrupted snapshot process: retained history and independent held coverage | 1.359 | 1.359 | 1.413 | 1.362 | 1.321 |
| MQ retained snapshot process: retained history and independent held coverage | 0.382 | 0.410 | 0.368 | 0.391 | 0.430 |

## following-routing.test.mjs

| Test | Original | Round 1 median | Round 2 / 1 | Round 2 / 2 | Round 2 / 3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Whole file** | 33.195 | 4.137 | 4.137 | 4.138 | 4.134 |
| Following becomes withheld on composed re-observation: server | 1.021 | 1.021 | 1.021 | 1.021 | 1.022 |
| Following becomes withheld on composed re-observation: offline | 1.003 | 1.003 | 1.003 | 1.003 | 1.003 |
| Following becomes withheld on composed re-observation: pending | 30.065 | 1.003 | 1.004 | 1.005 | 1.004 |
| Following becomes withheld on composed re-observation: transport recovered | 1.003 | 1.004 | 1.005 | 1.004 | 1.003 |

## client-lifecycle.test.mjs

| Test | Original | Round 1 median | Round 2 / 1 | Round 2 / 2 | Round 2 / 3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Whole file** | 45.256 | 42.930 | 42.929 | 42.961 | 42.557 |
| online reconnect requires the authenticated GET /probe contract | 6.305 | 6.281 | 6.265 | 6.337 | 6.291 |
| online pending writes emit their terminal outcome exactly once | 0.564 | 0.562 | 0.562 | 0.559 | 0.558 |
| online auth refusal settles writes that were queued behind the refused request | 0.003 | 0.004 | 0.003 | 0.003 | 0.003 |
| local pending writes emit once with the kept device identity | 0.074 | 0.077 | 0.077 | 0.077 | 0.077 |
| local pending writes emit once with their original binding ahead of a newer device identity | 0.063 | 0.064 | 0.064 | 0.064 | 0.063 |
| local reconnect requires the authenticated GET /probe contract | 5.248 | 5.172 | 5.141 | 5.072 | 5.180 |
| local startup releases a device when initialization after the protocol probe fails | 0.001 | 0.003 | 0.003 | 0.003 | 0.003 |
| local sync shrinks response-bound pages at one cursor and exposes an indivisible refusal | 0.008 | 0.021 | 0.021 | 0.015 | 0.022 |
| local observations skip idle polls and rerun after a committed page | 0.034 | 0.038 | 0.037 | 0.034 | 0.037 |
| local generation adoption reruns observations whose dependencies changed | 0.033 | 0.038 | 0.038 | 0.038 | 0.034 |
| closing a pending watch prevents its response from scheduling expiry or rerunning dirty work | 0.054 | 0.054 | 0.056 | 0.058 | 0.057 |
| local auth invalidation notifies viewer listeners before session deletion can fail | 0.002 | 0.004 | 0.005 | 0.005 | 0.005 |
| local observations rerun when the device-reported visible lifetime expires | 0.214 | 0.216 | 0.218 | 0.218 | 0.217 |
| a refused device adopt keeps the previous backend active in JavaScript | 0.012 | 0.014 | 0.015 | 0.015 | 0.015 |
| a failed native replacement falls back without a stale local answer and is retried | 0.003 | 0.006 | 0.006 | 0.006 | 0.006 |
| every local prediction invalidates observations, including unrelated tables | 0.022 | 0.024 | 0.025 | 0.022 | 0.022 |
| online watches retain their changes watermark; bare tokens clear on refusal | 0.302 | 0.273 | 0.268 | 0.294 | 0.269 |
| wasm: pending metadata survives repeated profile/vote updates and offline replay | 2.852 | 2.867 | 2.928 | 2.959 | 2.887 |
| wasm: no-op and nosync writes retire when the partition stream is empty | 0.250 | 0.245 | 0.253 | 0.248 | 0.240 |
| wasm: a write already sending when a snapshot starts is correlated after catch-up | 0.336 | 0.318 | 0.347 | 0.341 | 0.325 |
| wasm: a sync started before admission finishes before that write can be sent | 0.254 | 0.254 | 0.254 | 0.257 | 0.232 |
| wasm: sync before a delayed write reply does not apply an increment twice | 0.307 | 0.298 | 0.295 | 0.305 | 0.300 |
| wasm: sync before a lost write reply does not apply an increment twice | 1.283 | 1.275 | 1.284 | 1.283 | 1.270 |
| wasm: background sync timestamps survive reconnect and unwraps beyond the horizon use the server | 1.477 | 1.519 | 1.520 | 1.494 | 1.667 |
| wasm: population growth cannot mint new IDs during prediction replay | 1.332 | 0.310 | 0.297 | 0.305 | 0.308 |
| wasm: retry without observers, online-only routing and denied-watch recovery | 1.003 | 0.869 | 0.890 | 0.868 | 0.876 |
| wasm: a rejected guardedEdit restores confirmed and maintained rows under a later prediction | 0.265 | 0.259 | 0.260 | 0.253 | 0.258 |
| wasm: a rejected guardedDelete restores confirmed and maintained rows under a later prediction | 0.266 | 0.250 | 0.253 | 0.263 | 0.257 |
| native: pending metadata survives repeated profile/vote updates and offline replay | 2.493 | 2.492 | 2.508 | 2.470 | 2.494 |
| native: no-op and nosync writes retire when the partition stream is empty | 0.308 | 0.288 | 0.264 | 0.286 | 0.295 |
| native: a write already sending when a snapshot starts is correlated after catch-up | 0.426 | 0.405 | 0.333 | 0.392 | 0.399 |
| native: another client sending after sync capture cannot publish an uncorrelated page | 1.225 | 1.271 | 1.236 | 1.234 | 1.211 |
| native: a sync started before admission finishes before that write can be sent | 0.287 | 0.300 | 0.298 | 0.306 | 0.302 |
| native: sync before a delayed write reply does not apply an increment twice | 0.320 | 0.368 | 0.363 | 0.360 | 0.369 |
| native: sync before a lost write reply does not apply an increment twice | 1.346 | 1.354 | 1.375 | 1.370 | 1.356 |
| native: background sync timestamps survive reconnect and unwraps beyond the horizon use the server | 1.984 | 1.987 | 1.994 | 1.984 | 1.517 |
| native: population growth cannot mint new IDs during prediction replay | 1.306 | 0.347 | 0.347 | 0.350 | 0.351 |
| native: retry without observers, online-only routing and denied-watch recovery | 1.014 | 0.837 | 0.840 | 0.839 | 0.834 |
| native: a rejected guardedEdit restores confirmed and maintained rows under a later prediction | 0.323 | 0.308 | 0.330 | 0.320 | 0.322 |
| native: a rejected guardedDelete restores confirmed and maintained rows under a later prediction | 0.325 | 0.319 | 0.325 | 0.321 | 0.316 |
| close cancels online write callers without aborting committed delivery | 0.187 | 0.184 | 0.181 | 0.184 | 0.182 |
| device process failures reject opening and pending calls instead of leaving close waiting | 0.050 | 0.050 | 0.053 | 0.049 | 0.050 |
| device compatibility rejects old and malformed protocols before online or offline startup | 0.065 | 0.064 | 0.064 | 0.062 | 0.061 |
| device compatibility closes the core and preserves operational startup errors | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 |
| device compatibility accepts the current core online and on an offline reopen | 1.243 | 1.242 | 1.244 | 1.244 | 1.242 |
| online serialization failures retain the minted id without scheduling network retries | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 |
| wasm: close waits for an applying acknowledgment and aborts sync | 0.258 | 0.267 | 0.263 | 0.272 | 0.272 |
| native: close waits for an applying acknowledgment and aborts sync | 0.320 | 0.309 | 0.331 | 0.328 | 0.329 |
| W13b fallback boundary: cursorless | 1.004 | 1.004 | 1.004 | 1.004 | 1.003 |
| W13b fallback boundary: meter | 1.003 | 1.003 | 1.002 | 1.003 | 1.003 |
| W13b fallback boundary: words | 1.004 | 1.004 | 1.002 | 1.005 | 1.004 |
| W13b fallback boundary: missing fact | 1.005 | 1.003 | 1.003 | 1.002 | 1.002 |
| W13b fallback boundary: presence | 1.004 | 1.002 | 1.003 | 1.003 | 1.003 |
| W13b fallback boundary: offline missing fact | 1.004 | 1.003 | 1.003 | 1.003 | 1.004 |
| W13b fallback boundary: held | 1.004 | 1.003 | 1.003 | 1.003 | 1.003 |
| W13b fallback boundary: retained | 1.002 | 1.004 | 1.003 | 1.003 | 1.003 |
| W13b fallback boundary: pending predictable write | 1.003 | 1.003 | 1.003 | 1.003 | 1.003 |
