# Round 2 orientation

Scope: LLP 3000.030's native preparation and startup binding, smoke residency,
owned preparation processes, helper/driver/guide tests and the macOS §11 rerun.

Governing LLPs: LLP 3000#4 (fence); LLP 2000.000#12 (bounded measured loop);
LLP 3000.030#3, #4, #5, #6 and #11 (base custody, input coverage, actual
execution, owned lifecycles and acceptance); LLP 3000.011.005.000#2 (smoke's
compiler-derived classification); LLP 3000.007#20.10 (app-owned evidence);
LLP 3000.019#3.4 (exclusive backend ownership). The Accepted 3000.030 is the
active task document; the supervisor explicitly requires its acceptance to
be re-established. This is the Snapback 4 fence, not the root gate corpus.

Constraints: the earlier host rules and §11 continue to bind. No engine,
client or published package changes; local helper changes are disclosed.
Own UDID/PIDs only, pinned PATH and DEVELOPER_DIR, no credential files, no
push/publication. Every failed attempt remains evidence. Native observations
need real simulator controls in addition to tests. The lease must outlive
preparation process-group cleanup.

Rationale: bytes on disk alone do not identify a selected runtime bundle;
compiler facts must describe the generation actually served and kept; Expo's
directory fingerprint does not resolve external Xcode inputs. These review
counterexamples govern the fixes, without creating a general native adapter.

Open risks: stricter native input support, SourceCode availability in the new
architecture, runtime global DEV visibility, new startup diagnostics, timings.
Likely docs: 3000.030 Revised/§12, smoke §2, witness card, Expo README,
round2 report and one appended journal entry. Hand-off: none.
