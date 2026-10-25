Scope: W4, W5 exact, W5 nominal 1% mix A/B; default synchronous arm S, shipped depth 2; G6=1000,250.
Governing: LLP 3000#7-decisions-during-execution; LLP 3000.009.001.002#5-workloads and #6-method-and-metrics; LLP 3000.009.001.000.000.002#8.1 (G7.2 and pipeline-aware fill), #8.3; LLP 0189.
Constraints: unchanged runner, fixture, authorization, seeds, pinning, intended-arrival SLOs, counter equality including warm-up, three complete repetitions; retain every failure. No fetch/push/product changes. Raw outside Git.
Diagnostic: shipped serve does not expose Queue::batch_stats (serve accessor is cfg(test)); stock core loopback diagnostic fails at depth two on B; preserve it and use an outside-Git release helper reading public Queue statistics on a clone of the validated 1M fixture, owned/G6/default policy. It is not an S1 capacity result. No per-cell batch statistics are inferred.
Risk: shared host and serial historical comparison; diagnostic has direct Context calls rather than native HTTP token authentication; stock test failure is unresolved. HTTP smoke and matrix share one fresh fixture, with fresh service per cell.
Doc update: requested results directory only; hand-off none.
