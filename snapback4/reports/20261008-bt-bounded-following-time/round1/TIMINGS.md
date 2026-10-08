# Round-1 per-test timings

Seconds from Node TAP, including setup and cleanup. Original and round-0 measurements are retained from the prior report, not rerun here. Round 1 run 1 overlaps controls/regressions; runs 2 and 3 have no other test jobs from this lane. Shared-host measurements, not latency guarantees.

## bounded-following.test.mjs

| Test | Original | Round 0 median | Round 1 / 1 | Round 1 / 2 | Round 1 / 3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Whole file** | 1219.176 | 314.052 | 314.037 | 314.334 | 314.208 |
| event slots wasm: owned-event fallback waits for the source prediction | 38.529 | 8.577 | 8.553 | 8.601 | 8.515 |
| event slots wasm: rejected owned events cannot make a speculative scan publishable | 38.025 | 8.045 | 8.065 | 8.055 | 8.058 |
| bounded Following wasm: unrelated held reads cannot validate speculative refusals or empty pages | 38.183 | 13.361 | 13.340 | 13.360 | 13.312 |
| bounded Following wasm: unknown conditions preserve static and helper dependencies | 64.292 | 9.322 | 9.322 | 9.319 | 9.326 |
| bounded Following wasm: a scalar cut before the feed keeps its possible reads fenced | 35.448 | 35.434 | 35.424 | 35.453 | 35.436 |
| bounded Following wasm: a known branch wins over static server routing | 4.235 | 4.234 | 4.233 | 4.233 | 4.241 |
| bounded Following wasm: a speculative profile withholds while a non-speculative page keeps predicted rows | 34.248 | 9.297 | 9.299 | 9.300 | 9.294 |
| bounded Following wasm: a late card miss and oversized withheld output still use fallback | 1.214 | 1.209 | 1.216 | 1.206 | 1.223 |
| bounded Following wasm: untaken online-only card branches remain answerable when held | 0.506 | 0.519 | 0.516 | 0.515 | 0.514 |
| bounded Following wasm: composed reads withhold the entire answer across the prediction fence | 38.019 | 8.025 | 8.030 | 8.045 | 8.031 |
| bounded Following wasm: exact offline pages, original-cursor fallback and quiet authors | 1.154 | 1.182 | 1.173 | 1.189 | 1.182 |
| bounded Following wasm: a predicted post fences fallback until observation | 68.007 | 8.038 | 8.026 | 8.031 | 8.030 |
| bounded Following wasm: online-only cards withhold offline | 0.221 | 0.226 | 0.221 | 0.228 | 0.232 |
| bounded Following wasm: repost prediction needs a held original | 8.110 | 8.217 | 8.217 | 8.220 | 8.222 |
| bounded Following wasm: held cards and transport failures stay withheld | 0.402 | 0.402 | 0.393 | 0.413 | 0.406 |
| bounded Following wasm: online-only repost cards use the prediction fence before server routing | 68.025 | 8.041 | 8.051 | 8.047 | 8.040 |
| bounded Following wasm: a response racing prediction admission is invalidated | 30.152 | 8.070 | 8.065 | 8.085 | 8.064 |
| bounded Following wasm: repost horizon misses withhold but full-source nulls remain data | 0.213 | 0.219 | 0.217 | 0.213 | 0.217 |
| bounded Following wasm: inbox floors use all routing branches and preserve meter prefixes | 104.414 | 18.389 | 18.428 | 18.397 | 18.414 |
| event slots native: owned-event fallback waits for the source prediction | 38.139 | 8.141 | 8.193 | 8.135 | 8.147 |
| event slots native: rejected owned events cannot make a speculative scan publishable | 38.119 | 8.127 | 8.114 | 8.135 | 8.124 |
| bounded Following native: unrelated held reads cannot validate speculative refusals or empty pages | 38.207 | 13.434 | 13.433 | 13.437 | 13.420 |
| bounded Following native: unknown conditions preserve static and helper dependencies | 64.357 | 9.403 | 9.396 | 9.409 | 9.397 |
| bounded Following native: a scalar cut before the feed keeps its possible reads fenced | 35.699 | 35.667 | 35.650 | 35.674 | 35.686 |
| bounded Following native: a known branch wins over static server routing | 4.287 | 4.268 | 4.278 | 4.284 | 4.280 |
| bounded Following native: a speculative profile withholds while a non-speculative page keeps predicted rows | 34.290 | 9.366 | 9.372 | 9.382 | 9.362 |
| bounded Following native: a late card miss and oversized withheld output still use fallback | 1.888 | 1.895 | 1.944 | 1.967 | 1.951 |
| bounded Following native: untaken online-only card branches remain answerable when held | 0.563 | 0.556 | 0.556 | 0.558 | 0.570 |
| bounded Following native: composed reads withhold the entire answer across the prediction fence | 38.119 | 8.098 | 8.110 | 8.150 | 8.109 |
| bounded Following native: exact offline pages, original-cursor fallback and quiet authors | 1.240 | 1.273 | 1.255 | 1.272 | 1.284 |
| bounded Following native: a predicted post fences fallback until observation | 68.107 | 8.094 | 8.128 | 8.099 | 8.097 |
| bounded Following native: online-only cards withhold offline | 0.269 | 0.267 | 0.264 | 0.267 | 0.261 |
| bounded Following native: repost prediction needs a held original | 8.261 | 8.256 | 8.257 | 8.260 | 8.260 |
| bounded Following native: held cards and transport failures stay withheld | 0.453 | 0.451 | 0.451 | 0.450 | 0.485 |
| bounded Following native: online-only repost cards use the prediction fence before server routing | 68.139 | 8.121 | 8.090 | 8.106 | 8.118 |
| bounded Following native: a response racing prediction admission is invalidated | 30.194 | 8.142 | 8.115 | 8.135 | 8.150 |
| bounded Following native: repost horizon misses withhold but full-source nulls remain data | 0.259 | 0.257 | 0.262 | 0.261 | 0.271 |
| bounded Following native: inbox floors use all routing branches and preserve meter prefixes | 105.107 | 19.174 | 19.190 | 19.189 | 19.214 |
| bounded Following native query module: executed dependencies fence fallback until prediction observation | 69.955 | 10.042 | 10.019 | 10.074 | 10.105 |

## retained-history.test.mjs

| Test | Original | Round 0 median | Round 1 / 1 | Round 1 / 2 | Round 1 / 3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Whole file** | 192.570 | 68.989 | 68.763 | 68.763 | 68.808 |
| W14A horizon-free matching wasm: retained history and independent held coverage | 1.208 | 0.896 | 0.768 | 0.709 | 0.689 |
| W14A positive existence wasm: retained history and independent held coverage | 0.521 | 0.276 | 0.265 | 0.236 | 0.260 |
| R5 history wasm: retained history and independent held coverage | 0.755 | 0.319 | 0.303 | 0.303 | 0.321 |
| RH held leave wasm: retained history and independent held coverage | 0.529 | 0.309 | 0.309 | 0.304 | 0.336 |
| RH stalled leave wasm: retained history and independent held coverage | 1.529 | 1.309 | 1.327 | 1.310 | 1.322 |
| RH empty catch-up wasm: retained history and independent held coverage | 0.527 | 0.265 | 0.265 | 0.270 | 0.266 |
| R1a empty search wasm: retained history and independent held coverage | 0.532 | 0.258 | 0.260 | 0.256 | 0.238 |
| R1a mixed reads wasm: retained history and independent held coverage | 0.433 | 0.256 | 0.273 | 0.257 | 0.249 |
| R2 mixed result wasm: retained history and independent held coverage | 1.524 | 1.305 | 1.340 | 1.295 | 1.302 |
| R2 sync during reply wasm: retained history and independent held coverage | 0.584 | 0.289 | 0.244 | 0.289 | 0.276 |
| R2 unknown sync during reply wasm: retained history and independent held coverage | 1.008 | 0.292 | 0.298 | 0.300 | 0.272 |
| R2 relevant sync during reply wasm: retained history and independent held coverage | 1.125 | 0.295 | 0.295 | 0.286 | 0.295 |
| MQ authoritative bound wasm: retained history and independent held coverage | 1.173 | 0.444 | 0.450 | 0.455 | 0.466 |
| MQ speculative component wasm: retained history and independent held coverage | 0.807 | 0.268 | 0.274 | 0.257 | 0.267 |
| MQ speculative events wasm: retained history and independent held coverage | 68.736 | 9.415 | 9.431 | 9.409 | 9.415 |
| MQ expiry local left wasm: retained history and independent held coverage | 1.232 | 1.248 | 1.240 | 1.229 | 1.252 |
| MQ expiry local watch left wasm: retained history and independent held coverage | 1.225 | 1.241 | 1.246 | 1.240 | 1.243 |
| MQ local permit wasm: retained history and independent held coverage | 1.249 | 1.251 | 1.250 | 1.250 | 1.246 |
| MQ local permit watch wasm: retained history and independent held coverage | 1.238 | 1.250 | 1.250 | 1.250 | 1.249 |
| MQ local branch wasm: retained history and independent held coverage | 0.230 | 0.264 | 0.260 | 0.269 | 0.269 |
| MQ local branch watch wasm: retained history and independent held coverage | 0.230 | 0.259 | 0.256 | 0.263 | 0.261 |
| MQ local page wasm: retained history and independent held coverage | 0.235 | 0.259 | 0.258 | 0.259 | 0.256 |
| MQ ineligible wasm: retained history and independent held coverage | 0.261 | 0.280 | 0.294 | 0.301 | 0.280 |
| MQ points wasm: retained history and independent held coverage | 0.235 | 0.271 | 0.303 | 0.282 | 0.276 |
| MQ delete current wasm: retained history and independent held coverage | 0.331 | 0.353 | 0.331 | 0.362 | 0.349 |
| MQ revoke current wasm: retained history and independent held coverage | 0.326 | 0.329 | 0.320 | 0.342 | 0.331 |
| MQ rejoin wasm: retained history and independent held coverage | 0.323 | 0.317 | 0.318 | 0.329 | 0.329 |
| MQ held change wasm: retained history and independent held coverage | 0.338 | 0.328 | 0.310 | 0.330 | 0.326 |
| MQ close wasm: retained history and independent held coverage | 0.255 | 0.258 | 0.251 | 0.263 | 0.257 |
| MQ sign-out wasm: retained history and independent held coverage | 0.265 | 0.261 | 0.250 | 0.265 | 0.241 |
| MQ transport wasm: retained history and independent held coverage | 0.243 | 0.248 | 0.261 | 0.261 | 0.258 |
| MQ adoption wasm: retained history and independent held coverage | 0.638 | 0.686 | 0.646 | 0.664 | 0.645 |
| MQ reset wasm: retained history and independent held coverage | 1.316 | 1.330 | 1.320 | 1.339 | 1.334 |
| MQ rotation wasm: retained history and independent held coverage | 0.303 | 0.335 | 0.316 | 0.337 | 0.317 |
| MQ prediction wasm: retained history and independent held coverage | 4.372 | 4.353 | 4.356 | 4.351 | 4.355 |
| MQ expiry left wasm: retained history and independent held coverage | 0.351 | 0.342 | 0.339 | 0.347 | 0.352 |
| MQ expiry held wasm: retained history and independent held coverage | 0.328 | 0.343 | 0.343 | 0.357 | 0.362 |
| MQ interrupted snapshot wasm: retained history and independent held coverage | 1.345 | 1.341 | 1.344 | 1.355 | 1.269 |
| MQ retained snapshot wasm: retained history and independent held coverage | 0.327 | 0.332 | 0.340 | 0.336 | 0.343 |
| W14A horizon-free matching process: retained history and independent held coverage | 0.305 | 0.300 | 0.300 | 0.301 | 0.304 |
| W14A positive existence process: retained history and independent held coverage | 0.543 | 0.310 | 0.301 | 0.303 | 0.309 |
| R5 history process: retained history and independent held coverage | 0.359 | 0.343 | 0.366 | 0.361 | 0.364 |
| RH held leave process: retained history and independent held coverage | 0.397 | 0.363 | 0.392 | 0.387 | 0.392 |
| RH stalled leave process: retained history and independent held coverage | 1.377 | 1.363 | 1.392 | 1.374 | 1.377 |
| RH empty catch-up process: retained history and independent held coverage | 0.309 | 0.307 | 0.323 | 0.303 | 0.314 |
| R1a empty search process: retained history and independent held coverage | 0.304 | 0.291 | 0.299 | 0.289 | 0.298 |
| R1a mixed reads process: retained history and independent held coverage | 0.302 | 0.295 | 0.340 | 0.316 | 0.291 |
| R2 mixed result process: retained history and independent held coverage | 1.409 | 1.354 | 1.349 | 1.347 | 1.333 |
| R2 sync during reply process: retained history and independent held coverage | 0.304 | 0.311 | 0.300 | 0.286 | 0.310 |
| R2 unknown sync during reply process: retained history and independent held coverage | 0.360 | 0.337 | 0.344 | 0.348 | 0.364 |
| R2 relevant sync during reply process: retained history and independent held coverage | 0.331 | 0.345 | 0.356 | 0.346 | 0.340 |
| MQ authoritative bound process: retained history and independent held coverage | 0.501 | 0.506 | 0.493 | 0.512 | 0.512 |
| MQ speculative component process: retained history and independent held coverage | 0.334 | 0.321 | 0.315 | 0.302 | 0.341 |
| MQ speculative events process: retained history and independent held coverage | 68.293 | 9.481 | 9.484 | 9.480 | 9.518 |
| MQ expiry local left process: retained history and independent held coverage | 1.285 | 1.294 | 1.298 | 1.295 | 1.291 |
| MQ expiry local watch left process: retained history and independent held coverage | 1.328 | 1.294 | 1.287 | 1.275 | 1.296 |
| MQ local permit process: retained history and independent held coverage | 1.293 | 1.290 | 1.289 | 1.303 | 1.296 |
| MQ local permit watch process: retained history and independent held coverage | 1.288 | 1.291 | 1.292 | 1.291 | 1.305 |
| MQ local branch process: retained history and independent held coverage | 0.322 | 0.317 | 0.306 | 0.299 | 0.310 |
| MQ local branch watch process: retained history and independent held coverage | 0.311 | 0.315 | 0.310 | 0.313 | 0.310 |
| MQ local page process: retained history and independent held coverage | 0.320 | 0.311 | 0.316 | 0.304 | 0.320 |
| MQ ineligible process: retained history and independent held coverage | 0.370 | 0.373 | 0.358 | 0.370 | 0.348 |
| MQ points process: retained history and independent held coverage | 0.326 | 0.332 | 0.315 | 0.312 | 0.327 |
| MQ delete current process: retained history and independent held coverage | 0.390 | 0.385 | 0.369 | 0.391 | 0.382 |
| MQ revoke current process: retained history and independent held coverage | 0.378 | 0.388 | 0.412 | 0.394 | 0.366 |
| MQ rejoin process: retained history and independent held coverage | 0.395 | 0.374 | 0.388 | 0.404 | 0.402 |
| MQ held change process: retained history and independent held coverage | 0.382 | 0.396 | 0.388 | 0.408 | 0.389 |
| MQ close process: retained history and independent held coverage | 0.314 | 0.309 | 0.339 | 0.315 | 0.332 |
| MQ sign-out process: retained history and independent held coverage | 0.302 | 0.324 | 0.314 | 0.331 | 0.317 |
| MQ transport process: retained history and independent held coverage | 0.323 | 0.317 | 0.311 | 0.301 | 0.305 |
| MQ adoption process: retained history and independent held coverage | 0.704 | 0.699 | 0.697 | 0.696 | 0.709 |
| MQ reset process: retained history and independent held coverage | 1.358 | 1.360 | 1.379 | 1.366 | 1.413 |
| MQ rotation process: retained history and independent held coverage | 0.400 | 0.398 | 0.381 | 0.403 | 0.397 |
| MQ prediction process: retained history and independent held coverage | 4.451 | 4.457 | 4.430 | 4.462 | 4.483 |
| MQ expiry left process: retained history and independent held coverage | 0.401 | 0.406 | 0.410 | 0.423 | 0.421 |
| MQ expiry held process: retained history and independent held coverage | 0.410 | 0.437 | 0.403 | 0.420 | 0.433 |
| MQ interrupted snapshot process: retained history and independent held coverage | 1.359 | 1.356 | 1.368 | 1.343 | 1.359 |
| MQ retained snapshot process: retained history and independent held coverage | 0.382 | 0.401 | 0.410 | 0.431 | 0.409 |

## following-routing.test.mjs

| Test | Original | Round 0 median | Round 1 / 1 | Round 1 / 2 | Round 1 / 3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Whole file** | 33.195 | 4.133 | 4.136 | 4.137 | 4.138 |
| Following becomes withheld on composed re-observation: server | 1.021 | 1.022 | 1.020 | 1.021 | 1.021 |
| Following becomes withheld on composed re-observation: offline | 1.003 | 1.004 | 1.003 | 1.003 | 1.003 |
| Following becomes withheld on composed re-observation: pending | 30.065 | 1.004 | 1.003 | 1.003 | 1.003 |
| Following becomes withheld on composed re-observation: transport recovered | 1.003 | 1.004 | 1.002 | 1.004 | 1.005 |

## client-lifecycle.test.mjs

| Test | Original | Round 0 median | Round 1 / 1 | Round 1 / 2 | Round 1 / 3 |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Whole file** | 45.256 | 43.079 | 42.896 | 43.042 | 42.930 |
| online reconnect requires the authenticated GET /probe contract | 6.305 | 6.310 | 6.281 | 6.183 | 6.340 |
| online pending writes emit their terminal outcome exactly once | 0.564 | 0.560 | 0.564 | 0.562 | 0.561 |
| online auth refusal settles writes that were queued behind the refused request | 0.003 | 0.003 | 0.003 | 0.004 | 0.004 |
| local pending writes emit once with the kept device identity | 0.074 | 0.073 | 0.076 | 0.078 | 0.077 |
| local pending writes emit once with their original binding ahead of a newer device identity | 0.063 | 0.063 | 0.062 | 0.064 | 0.064 |
| local reconnect requires the authenticated GET /probe contract | 5.248 | 5.247 | 5.172 | 5.187 | 5.114 |
| local startup releases a device when initialization after the protocol probe fails | 0.001 | 0.002 | 0.003 | 0.003 | 0.003 |
| local sync shrinks response-bound pages at one cursor and exposes an indivisible refusal | 0.008 | 0.019 | 0.020 | 0.022 | 0.021 |
| local observations skip idle polls and rerun after a committed page | 0.034 | 0.036 | 0.038 | 0.041 | 0.037 |
| local generation adoption reruns observations whose dependencies changed | 0.033 | 0.039 | 0.038 | 0.034 | 0.039 |
| closing a pending watch prevents its response from scheduling expiry or rerunning dirty work | 0.054 | 0.059 | 0.053 | 0.054 | 0.059 |
| local auth invalidation notifies viewer listeners before session deletion can fail | 0.002 | 0.005 | 0.002 | 0.004 | 0.005 |
| local observations rerun when the device-reported visible lifetime expires | 0.214 | 0.217 | 0.214 | 0.216 | 0.216 |
| a refused device adopt keeps the previous backend active in JavaScript | 0.012 | 0.015 | 0.013 | 0.014 | 0.015 |
| a failed native replacement falls back without a stale local answer and is retried | 0.003 | 0.006 | 0.006 | 0.006 | 0.006 |
| every local prediction invalidates observations, including unrelated tables | 0.022 | 0.025 | 0.024 | 0.026 | 0.024 |
| online watches retain their changes watermark; bare tokens clear on refusal | 0.302 | 0.292 | 0.265 | 0.277 | 0.273 |
| wasm: pending metadata survives repeated profile/vote updates and offline replay | 2.852 | 2.952 | 2.863 | 2.967 | 2.867 |
| wasm: no-op and nosync writes retire when the partition stream is empty | 0.250 | 0.242 | 0.245 | 0.256 | 0.228 |
| wasm: a write already sending when a snapshot starts is correlated after catch-up | 0.336 | 0.296 | 0.318 | 0.303 | 0.333 |
| wasm: a sync started before admission finishes before that write can be sent | 0.254 | 0.248 | 0.250 | 0.263 | 0.254 |
| wasm: sync before a delayed write reply does not apply an increment twice | 0.307 | 0.297 | 0.303 | 0.297 | 0.298 |
| wasm: sync before a lost write reply does not apply an increment twice | 1.283 | 1.278 | 1.271 | 1.293 | 1.275 |
| wasm: background sync timestamps survive reconnect and unwraps beyond the horizon use the server | 1.477 | 1.493 | 1.519 | 1.557 | 1.478 |
| wasm: population growth cannot mint new IDs during prediction replay | 1.332 | 0.301 | 0.329 | 0.293 | 0.310 |
| wasm: retry without observers, online-only routing and denied-watch recovery | 1.003 | 0.876 | 0.848 | 0.888 | 0.869 |
| wasm: a rejected guardedEdit restores confirmed and maintained rows under a later prediction | 0.265 | 0.267 | 0.254 | 0.267 | 0.259 |
| wasm: a rejected guardedDelete restores confirmed and maintained rows under a later prediction | 0.266 | 0.253 | 0.241 | 0.250 | 0.260 |
| native: pending metadata survives repeated profile/vote updates and offline replay | 2.493 | 2.461 | 2.480 | 2.494 | 2.492 |
| native: no-op and nosync writes retire when the partition stream is empty | 0.308 | 0.288 | 0.288 | 0.294 | 0.284 |
| native: a write already sending when a snapshot starts is correlated after catch-up | 0.426 | 0.408 | 0.396 | 0.405 | 0.412 |
| native: another client sending after sync capture cannot publish an uncorrelated page | 1.225 | 1.231 | 1.331 | 1.271 | 1.235 |
| native: a sync started before admission finishes before that write can be sent | 0.287 | 0.291 | 0.300 | 0.299 | 0.354 |
| native: sync before a delayed write reply does not apply an increment twice | 0.320 | 0.371 | 0.370 | 0.368 | 0.361 |
| native: sync before a lost write reply does not apply an increment twice | 1.346 | 1.393 | 1.342 | 1.354 | 1.356 |
| native: background sync timestamps survive reconnect and unwraps beyond the horizon use the server | 1.984 | 1.990 | 1.987 | 1.987 | 1.987 |
| native: population growth cannot mint new IDs during prediction replay | 1.306 | 0.348 | 0.353 | 0.338 | 0.347 |
| native: retry without observers, online-only routing and denied-watch recovery | 1.014 | 0.836 | 0.834 | 0.845 | 0.837 |
| native: a rejected guardedEdit restores confirmed and maintained rows under a later prediction | 0.323 | 0.328 | 0.308 | 0.306 | 0.330 |
| native: a rejected guardedDelete restores confirmed and maintained rows under a later prediction | 0.325 | 0.320 | 0.319 | 0.330 | 0.316 |
| close cancels online write callers without aborting committed delivery | 0.187 | 0.183 | 0.185 | 0.183 | 0.184 |
| device process failures reject opening and pending calls instead of leaving close waiting | 0.050 | 0.050 | 0.050 | 0.050 | 0.049 |
| device compatibility rejects old and malformed protocols before online or offline startup | 0.065 | 0.063 | 0.068 | 0.064 | 0.062 |
| device compatibility closes the core and preserves operational startup errors | 0.001 | 0.001 | 0.001 | 0.001 | 0.001 |
| device compatibility accepts the current core online and on an offline reopen | 1.243 | 1.239 | 1.241 | 1.280 | 1.242 |
| online serialization failures retain the minted id without scheduling network retries | 0.001 | 0.001 | 0.001 | 0.002 | 0.001 |
| wasm: close waits for an applying acknowledgment and aborts sync | 0.258 | 0.271 | 0.263 | 0.271 | 0.267 |
| native: close waits for an applying acknowledgment and aborts sync | 0.320 | 0.323 | 0.308 | 0.309 | 0.322 |
| W13b fallback boundary: cursorless | 1.004 | 1.004 | 1.004 | 1.005 | 1.003 |
| W13b fallback boundary: meter | 1.003 | 1.003 | 1.003 | 1.003 | 1.004 |
| W13b fallback boundary: words | 1.004 | 1.004 | 1.002 | 1.004 | 1.004 |
| W13b fallback boundary: missing fact | 1.005 | 1.003 | 1.003 | 1.004 | 1.003 |
| W13b fallback boundary: presence | 1.004 | 1.003 | 1.002 | 1.004 | 1.002 |
| W13b fallback boundary: offline missing fact | 1.004 | 1.003 | 1.004 | 1.003 | 1.002 |
| W13b fallback boundary: held | 1.004 | 1.001 | 1.003 | 1.003 | 1.003 |
| W13b fallback boundary: retained | 1.002 | 1.003 | 1.002 | 1.004 | 1.004 |
| W13b fallback boundary: pending predictable write | 1.003 | 1.003 | 1.003 | 1.003 | 1.003 |
