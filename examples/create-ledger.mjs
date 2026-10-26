// Generate a complete, valid ledger by executing the instrumented sandbox.
// Run from the project root: node examples/create-ledger.mjs > sample-ledger.json
import { DEFAULT_POLICIES, runScenario } from '../dist/engine.js';

const scenarios = ['skipped_guardrail', 'missing_telemetry', 'fallback_rescue'];
const runs = [];
for (const [index, scenario] of scenarios.entries()) {
  runs.push(await runScenario(scenario, {
    id: `example-${index + 1}`,
    now: new Date(Date.parse('2026-10-26T10:00:00.000Z') + index * 60_000).toISOString(),
    customer: 'Example Enterprise',
  }));
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  policies: DEFAULT_POLICIES,
  runs,
}, null, 2)}\n`);
