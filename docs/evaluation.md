# Evaluation methodology

UNCOUNTED is evaluated against **180 deterministic cases: 160 synthetic workflow records and 20 dependency-model cases**. These comprise 32 distinct workflow scenarios and 4 distinct graph scenarios, each exercised through five reproducible variations. The variations shift workflow identities and time and permute evidence or transition arrival order. They test invariance, not 180 statistically independent production samples.

The fixture implementation is `dist/evaluation.js`. Its actual-action descriptions and expected outcomes are manually specified separately from the reconciliation code. It does **not** call `runScenario()` to obtain test labels or reuse receipt classifications as ground truth. It imports the engine's default policy configuration so both sides use the same declared policy contract, then constructs its own execution envelopes. The in-app Evaluation page runs this same harness.

## Reproduce

With Node.js 22 or later, from the project directory:

```sh
npm test
node tests/evaluate.mjs
```

The first command runs the acceptance fixtures, additional engine contracts, and local HTTP persistence tests. The second emits a machine-readable report containing every case, its actual-action truth, expected and observed state, and measured reconciliation time. It exits unsuccessfully if any case fails. HTTP tests bind an ephemeral loopback port and require permission to listen locally.

## What the fixture set establishes

| Area | Covered behavior |
| --- | --- |
| Mandatory obligations | Fulfilled, confirmed missed, pending, waived, unverified, and not applicable |
| Negative evidence | Complete authoritative gateway proves an omission; absent or incomplete telemetry does not |
| Provenance | Matching workflow, expected producer, policy identity, policy version, and authoritative envelope |
| Ordering | Before activation, after activation, equal timestamps without order, and equal timestamps with a trusted sequence |
| Exceptions | Authorized waiver, unauthorized waiver, expired waiver, and waiver for another policy version |
| Resilience | Primary success and fallback success; fallback remains fulfilled while the rescue dimension is true |
| Priority | Feasible higher-value deferral, honored policy, authorized and unauthorized exceptions, infeasible alternatives, and incomplete decision context |
| Progress | Unseeded prerequisite cycle, initial resources that break a cycle, alternate prerequisites, and an already satisfied target |

Additional regression tests cover contradictory evidence, activation correlation, malformed gateway records, historical policy snapshots, evidence received after the observation time, chronologically ordered snapshots, fallback/primary response ordering, import receipt recomputation, aggregate denominators, the accounting invariant, and invalid duplicate transition identities.

The HTTP tests verify serving the app, state survival after restart, rejection of invalid input without overwriting saved data, and prevention of static-file traversal outside the public directory.

## Why there are two recall figures

Two fixtures deliberately supply equivalent incomplete observations:

1. The required check **did run**, but its normal log and gateway proof are unavailable.
2. The required check **did not run**, and the gateway proof is also unavailable.

Both must be **unverified**. A system that labels the second one missed using a hidden fixture label would be cheating; a system that labels both missed would produce a false positive.

The current expected acceptance result is:

| Metric | Expected result | Definition |
| --- | --- | --- |
| Exact case accuracy | 180 / 180 | Required primary state and, where specified, rescue flag match the independently specified expectation |
| Confirmed omission precision | 30 / 30 = 100% | Confirmed mandatory misses that correspond to actual omitted or late preconditions |
| Recall across **all** true omissions | 30 / 70 = 42.86% | Includes 40 deliberately unprovable omissions that must remain unverified |
| Recall where evidence supports confirmation | 30 / 30 = 100% | Actual omissions for which the fixture supplies a complete admissible observation boundary |
| Unverified classification accuracy | 65 / 65 = 100% | Cases deliberately requiring uncertainty that are classified unverified |
| Mandatory omission false-positive rate | 0 / 50 = 0% | Cases without an actual mandatory omission incorrectly classified missed |

These denominators are fixture counts, not estimates for customers or production workloads. The 50 negative examples for omission precision include fulfilled, validly waived, pending, inapplicable, and unobserved-but-performed checks. Priority and progress findings do not enter the mandatory-omission confusion matrix.

## Timing and trust limits

The report measures wall-clock time spent reconciling these small in-memory records. Mean and p95 timings vary with the device and browser. These figures are **not** production detection latency, ingestion throughput, network overhead, or instrumented-service overhead. Scenario service durations displayed elsewhere are explicitly synthetic service-clock values.

Within this local prototype, an expected producer name and a matching evidence envelope constitute the declared trust boundary. This is not cryptographic attestation. A person who edits an import can fabricate a complete producer envelope; receipt recomputation prevents importing a fabricated classification but cannot authenticate fabricated source events. A production collector must authenticate and authorize producers and protect the completeness of gateway records.

The tests do not validate real external services, live customer traffic, unknown policies, arbitrary business value estimates, production security, or general optimal-path discovery. Dependency analysis is bounded monotonic resource reachability. Policy drafting is a deterministic, reviewable local capability; no model API is used and no AI rule-extraction accuracy is claimed.

The machine-readable report is generated at runtime so its results always correspond to the engine code currently loaded. Any future detector or change in the evidence contract should add independently specified positive, negative, and uncertain cases before expanding the product claim.
