# UNCOUNTED

**Account for what your workflows were obligated to do—even when the request succeeded.**

UNCOUNTED is a working, self-contained MVP of the opportunity-ledger concept. It runs an instrumented fictional AcmeCloud onboarding workflow, captures the evidence produced by that execution, reconciles declared obligations, and explains each result in a reviewable receipt.

The core distinction is deliberate: **missing evidence is not proof of a missed action**. A confirmed omission needs an authoritative, complete observation boundary. A successful fallback remains a successful customer outcome, with recovery dependence recorded separately.

## Public app

The GitHub Pages deployment is configured for **https://kopriya.github.io/uncounted/**.

This is an interactive sandbox: visitors can run every experiment, inspect receipts, edit policies, run the evaluation, and export/import their own ledger. Each browser keeps its own workspace. There are no accounts or shared server data; the first visit creates fictional AcmeCloud examples. Use **Export evidence** to keep a backup or move a workspace to another browser.

Only `dist/` is published as the website. Your local `data/store.json` is excluded from Git and deployment. Public pages use browser storage directly, and storage keys are scoped to the app's path so separate deployments do not accidentally reuse each other's ledger. Path scoping avoids collisions; it is not an access-control boundary between sites sharing an origin. If browser storage is unavailable, the app clearly labels the session as temporary and offers export before leaving.

### Deploy from GitHub

1. Push this project to the `main` branch of `KOPRIYA/uncounted`.
2. In the repository's **Settings → Pages → Build and deployment**, set **Source** to **GitHub Actions**.
3. Open **Actions → Test and deploy GitHub Pages** and run the workflow if the initial push happened before Pages was enabled.
4. Open the URL shown by the successful **Publish the public app** job.

Future pushes to `main` run the tests and deploy automatically. Pull requests run checks without publishing. The workflow uploads only the static app; no deployment secrets, API keys, package installation, or paid hosting service are required. See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

The Node server below remains a local development option. A shared service with accounts and synchronized workspaces would require authenticated access and a production database.

## Run locally

Requires **Node.js 22 or newer**. There are no third-party runtime dependencies and no build or package installation step.

```sh
npm start
```

Open **http://127.0.0.1:4173**. Keep the terminal open while using the project. Stop it with Ctrl+C.

To choose another port:

```sh
PORT=4180 npm start
```

The first start creates a sandbox baseline with a repeatable scenario sequence and timestamps preceding the current time. Subsequent starts load your workspace from `data/store.json`. State updates are validated and written through a serialized queue using an atomic file replacement. Invalid existing data is preserved and reported at startup rather than silently discarded.

## Try the central demonstration

1. Inspect the overview. Compare successful customer outcomes with the independently measured obligation and evidence indicators.
2. Run a skipped-guardrail experiment. The sandbox can activate the account successfully while the complete gateway decision record proves that its required precondition was missed.
3. Run the missing-telemetry experiment. The engine distinguishes what a trusted boundary can prove from what an incomplete observation can support.
4. Run a fallback experiment. Identity verification succeeds through the backup service; the receipt preserves that success and records primary-service degradation.
5. Inspect the priority and blocked-workflow experiments. Their findings expose the policy, declared eligibility, and dependency assumptions behind the conclusion.
6. Open a receipt to trace its expectation, applicable policy version, observed evidence, and classification reason.

The UI also supports reviewing policies, inspecting execution evidence, and exporting/importing the ledger. A policy snapshot belongs to the execution that created it: later policy editing must not silently rewrite the requirements that applied to old runs.

The engine includes eleven executable scenarios: `healthy`, `skipped_guardrail`, `missing_telemetry`, `fallback_rescue`, `priority_ignored`, `priority_exception`, `deadlock`, `late_guardrail`, `waived_guardrail`, `telemetry_discrepancy`, and `pending_obligation`.

## What actually runs

The sandbox executes JavaScript workflow and service functions. Those functions emit timestamped evidence at meaningful decision boundaries; the reconciliation engine derives receipts from that evidence. The application does not merely switch between prewritten result cards.

The fictional customers, faults, workloads, service timings, and business policies are synthetic. Timing uses a synthetic service clock and must not be interpreted as a production performance benchmark. The instrumented services run inside this project, without connections to real customer systems.

The application uses deterministic rules and explanatory investigator guidance. **No Meta model, other LLM, or external service is connected.** It needs no API keys. A real integration would need an authenticated event producer, an agreed observation boundary, and service-specific evidence capture. Model-assisted policy drafting would be an additional reviewed feature, not a replacement for deterministic reconciliation.

## The accounting model

Each opportunity has exactly one primary state:

| State | Meaning |
| --- | --- |
| `fulfilled` | Applicable evidence confirms the expected action or condition. |
| `missed` | A due obligation was not fulfilled, with authoritative evidence supporting that conclusion. |
| `unverified` | The available evidence cannot establish whether the obligation was fulfilled. |
| `waived` | A valid authorized exception applies. |
| `pending` | The obligation is still active or its deadline has not arrived. |
| `not_applicable` | The trigger or eligibility conditions do not apply. |

Recovery/degradation is a separate dimension. The applicable opportunity count must equal fulfilled + missed + waived + pending + unverified. Not-applicable candidates are excluded from that count.

The dashboard keeps its indicators separate:

- **Obligation miss rate:** confirmed misses among eligible mandatory obligations due.
- **Evidence gap rate:** unverified obligations among eligible mandatory obligations due.
- **Recovery dependence:** requests requiring fallback among requests eligible for that fallback.

These measures have different populations and are not additive. They are not an invented overall health score or a monetary liability estimate. Priority findings describe a contradiction under the configured policy and recorded constraints; they do not establish a globally optimal business decision.

## Browser and local-server storage

The static `dist/` application can be hosted on a static web server. In that edition, each browser keeps its own ledger in browser-local storage for that site. Data is not shared between people or automatically synchronized between devices. Export the ledger before clearing site data, changing browser, or moving to a different origin.

When served by `server.mjs`, the UI discovers `/api/health` and uses the local JSON store. This edition persists your workspace across browser refreshes and server restarts. Export/import transfers a versioned JSON ledger between editions. Imports are validated and receipts are reconciled from execution evidence instead of treating imported receipt conclusions as authoritative.

This local server is a development and demonstration tool. It binds to `127.0.0.1`, accepts local same-origin requests, and serves only files inside `dist/`. It does not provide accounts, production authentication, a shared multi-user database, immutable audit storage, cryptographic evidence verification, or cross-device synchronization. Whole-state saves are serialized; separate simultaneous clients still use last-writer-wins workspace replacement.

## Project structure

```text
uncounted/
  dist/
    index.html      Browser application entry point
    app.js          UI, interactions, and storage adapter
    engine.js       Instrumented sandbox and deterministic reconciliation
    ...             Styles and public assets
  server.mjs        Local HTTP server and persistent state store
  tests/            Independent engine and server tests
  examples/         Runnable ledger-generation example
  package.json      Run and test commands; no runtime dependencies
  data/store.json   Created at runtime; excluded from source control
```

The engine is an ES module shared by the browser and Node. It exports `DEFAULT_POLICIES`, `SCENARIOS`, `runScenario`, `reconcile`, `summarize`, `createSeedRuns`, and `validateImport`.

- `runScenario(scenarioId, options)` executes the sandbox and returns a run. Options include an ID, clock time, policy set, and customer.
- `reconcile(run, policies, now)` derives opportunity receipts from a run.
- `summarize(runs)` derives aggregate indicators from ledger contents.
- `createSeedRuns({now?})` executes the repeatable sample population. Supplying a fixed clock anchor reproduces its timestamps; the default keeps the examples in the recent past.
- `validateImport(value)` validates a versioned ledger and reconciles its runs.

## Local HTTP API

The API uses JSON and the same origin as the UI. It is a local workspace API, not an authenticated external telemetry collector.

| Method | Path | Result |
| --- | --- | --- |
| `GET` | `/api/health` | `{ "mode": "server", "schemaVersion": 1 }` |
| `GET` | `/api/state` | Current validated workspace. |
| `POST` | `/api/state` | Validate and replace the workspace; return the saved workspace. |

`POST` requires `Content-Type: application/json`. The maximum request size is 8 MB, with at most 5,000 runs. Error responses are JSON with an `error` string and an appropriate HTTP status. State has this envelope:

```json
{
  "schemaVersion": 1,
  "runs": [],
  "policies": [],
  "activity": [],
  "seededAt": "2026-10-26T09:00:00.000Z"
}
```

`activity` and `seededAt` are optional. The displayed envelope describes field structure; actual policy objects and run records must satisfy the engine validator. Use an exported ledger as a complete example.

### Evidence and import contract

A run contains its ID and workflow ID, customer and tier, start/completion timestamps, outcome, agent version, immutable policy snapshot, and event array. Events include:

```json
{
  "id": "event-unique-id",
  "type": "event-type-defined-by-the-engine",
  "at": "2026-10-26T09:00:00.000Z",
  "source": "producer-name",
  "authoritative": true,
  "data": {
    "workflowId": "matching-run-id",
    "policyVersions": {}
  }
}
```

The event's `data` also carries the evidence fields required for its specific type. `workflowId` must associate the event with the correct run. Policy references and versions must match the execution context. Event type and payload requirements are defined in `dist/engine.js`; use the exported sandbox executions and the tests as concrete fixtures.

Setting `authoritative: true` in JSON is a producer assertion, not cryptographic proof. This MVP assumes trusted local producers. A production adapter must authenticate the producer, establish complete coverage for each decision boundary, and protect the evidence from tampering before using absence within that boundary to confirm a miss.

The sample documents an import format, not a general SDK that understands arbitrary application logs. Unknown, incomplete, or unrelated evidence cannot justify inventing a fulfilled or missed obligation.

Generate a complete importable example by running three sandbox executions:

```sh
node examples/create-ledger.mjs > sample-ledger.json
```

The resulting file contrasts a confirmed skipped guardrail, missing observation, and a successful fallback. Import it through the app or send the versioned ledger envelope to `POST /api/state` to replace the current local workspace.

## Validate

```sh
npm test
```

The test command is equivalent to:

```sh
node --test tests/*.test.mjs
```

The tests exercise known execution ground truth, evidence-aware classifications and accounting, and local-server behavior. Test fixtures are synthetic, and their results establish behavior only within the modeled policies and observation boundaries. No production accuracy, global optimality, patent novelty, or customer-demand claim follows from them.

## Extend the prototype

The next integration step is to instrument one real workflow with stable run IDs and explicit policy versions, capture its decision boundary in a trusted service, and translate its events into the existing run/evidence contract. Keep policy review and provenance explicit. Add a database and authenticated ingestion before making it a shared service. The present scope demonstrates guardrail accountability, incomplete observation, recovery dependence, priority-policy contradictions, and dependency blocking; broad vulnerability management and arbitrary path optimization need separate validated adapters and detectors.
