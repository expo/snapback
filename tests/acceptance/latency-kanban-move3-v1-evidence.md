# Latency Kanban Move-3 exit evidence

**Run date:** 2026-08-04

**Controlled run:** PASS

Each row is a separate receipt section. A sandbox socket denial is recorded as
BLOCKED and is never promoted to PASS.

| Section | Status | Evidence |
| --- | --- | --- |
| sourceIdentity | PASS | {} |
| localEvaluation | PASS | {"allFivePaintedFromIr":true,"latencyMs":{"create":20.266,"edit":11.802,"assign":20.512,"archive":19.827,"reorder":11.71},"lockedRefusalLocalMs":13.34,"rapidMoves":{"count":20,"stackPaintMs":208.068,"peakLayers":20,"visibleRowsBefore":2,"visibleRowsAfter":2}} |
| settlement | PASS | {"settlements":[{"verb":"create","clientMutationId":"mut_01kzbgwzyjetgvn64e2rykwhn3","operationHash":"sha256:9f6ccd09e05d732c1b80a861db6c3281ad3babb19aecfe7e88c741704b2fffa3","retiredLayer":true},{"verb":"edit","clientMutationId":"mut_01kzbgwzzhesfvzw8080t3e8wx","operationHash":"sha256:9205ee2708a8aee48d64714ee77602effaddcea65bd531f985a05e70160795d9","retiredLayer":true},{"verb":"assign","clientMutationId":"mut_01kzbgx00hedgapjqssxh065zc","operationHash":"sha256:93a4b72b3a9bd54608c624c89c3a6e76c4bbd1b93d176e46d2240836b5c9b112","retiredLayer":true},{"verb":"reorder","clientMutationId":"mut_01kzbgx01jfmmbtrc6nes22ctb","operationHash":"sha256:535af230e807ad93697bb79d853b7a9b017f25c5d9382a9925227718a89327f9","retiredLayer":true},{"verb":"archive","clientMutationId":"mut_01kzbgx02hfhcsq21ega9x3kfb","operationHash":"sha256:ea61fc9522df550105697563d4af13476a243a999cd9e5b46337cdbed13616db","retiredLayer":true},{"verb":"create-locked","clientMutationId":"mut_01kzbgx03ge7dv486kzedqx1ag","operationHash":"sha256:9f6ccd09e05d732c1b80a861db6c3281ad3babb19aecfe7e88c741704b2fffa3","retiredLayer":true}],"rapidSettlementIdentities":["mut_01kzbgx04gf4yts8c67d06wkvp","mut_01kzbgx04gf1etw61dcb4mp16m","mut_01kzbgx04gejtvehx91kzf038n","mut_01kzbgx04gektsjfk2jw1mk5qe","mut_01kzbgx04gema8rnmjr71fr0zh","mut_01kzbgx04hf0y9vtg59m8qdwad","mut_01kzbgx04hfx78cqm2grqys4aw","mut_01kzbgx04hf55rpr0rmcpxkhp4","mut_01kzbgx04he8m97kv7bx4kgvvy","mut_01kzbgx04hfkntvgjygk7htq24","mut_01kzbgx04hfthrxe0rgkjr2s2t","mut_01kzbgx04he34v4m4mh7tttsw4","mut_01kzbgx04her3t6h78j750mfbv","mut_01kzbgx04jeczseaefgm69wqb5","mut_01kzbgx04jfq7bmb8t2czav8cy","mut_01kzbgx04je8xrpg43ej7qmv39","mut_01kzbgx04jemr9nh44thxr0vgz","mut_01kzbgx04jfw1b8g4esrvxe8tx","mut_01kzbgx04jffb9xbx9bhk982n1","mut_01kzbgx04jfrzrgpjk4v33qazp"],"concurrentSettlementIdentities":["mut_01kzbgx1d8ez3vq3dfrbmtfjzb","mut_01kzbgx1d8fw7ty63jappp5f9f"],"refusal":{"code":"KANBAN_CARD_LOCKED","surfaced":true}} |
| observerConvergence | PASS | {"secondClient":true,"authoritativeRows":3,"signaturesEqual":true,"concurrentMoves":{"count":2,"finalCard":{"_id":"cards_01kzbgwzz1fvs8x2efnjg0bger","_version":29,"_createdAt":1786019479521,"_updatedAt":1786019481023,"boardId":"boards_01kzbgwzgceegtkhnkck1jj2s3","title":"Edited in IR","column":"ready","rank":800,"assignee":"Ada","archived":true,"locked":false,"revision":26}}} |
| lossFreeReload | PASS | {"processKilledWith":"SIGKILL","queuedIdentity":"mut_01kzbgx1haeqcanvpqmj325bd0","preKillLayers":1,"relaunchLayers":1,"postIntentRowsBeforeNetwork":1,"replayed":1,"authoritativeApplications":1} |
