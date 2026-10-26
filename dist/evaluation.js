/**
 * Independent, deterministic acceptance fixtures for the UNCOUNTED prototype.
 * Expected labels and actual action truth are authored here, never obtained from
 * runScenario(), reconcile(), or an engine-generated receipt.
 */
import { DEFAULT_POLICIES, reconcile, analyzeProgress } from './engine.js';

const BASE_TIME = Date.parse('2026-10-26T08:00:00.000Z');
const VERSIONS = {
  'access-guardrail': '3.2', 'identity-resilience': '1.1',
  'priority-policy': '2.0', 'workflow-progress': '1.0',
};
const clone = value => JSON.parse(JSON.stringify(value));
const clock = () => globalThis.performance?.now?.() ?? Date.now();

function context(name, variant) {
  const epoch = BASE_TIME + variant * 7_200_000;
  const at = offset => new Date(epoch + offset).toISOString();
  const id = `fixture-${name}-${variant}`;
  const run = {
    id, workflowId: id, customerId: `customer-${variant}`, customerTier: 'enterprise',
    agentVersion: 'fixture-1.0', startedAt: at(0), completedAt: at(400),
    outcome: 'success', policySnapshot: clone(DEFAULT_POLICIES), events: [],
  };
  let count = 0;
  const event = (type, source, offset, data = {}, patch = {}) => {
    const record = {
      id: `${id}-event-${++count}`, type, source, at: at(offset), authoritative: true,
      data: { workflowId: id, policyVersions: { ...VERSIONS }, ...data },
      ...patch,
    };
    run.events.push(record);
    return record;
  };
  let activation;
  const checkEvents = [];
  const activate = () => (activation = event('account_activated', 'account_service', 200, { accountId: `acct-${id}` }));
  const check = (offset = 100, data = {}, patch = {}) => {
    const result = event('access_guardrail_evaluated', 'authorization_service', offset,
      { policyId: 'access-guardrail', policyVersion: '3.2', result: 'allow', ...data }, patch);
    checkEvents.push(result);
    return result;
  };
  const action = (offset = 100, patch = {}) => ({
    action: 'access_guardrail_evaluated', at: at(offset), eventId: checkEvents.find(item => item.at === at(offset))?.id ?? `${id}-decision`,
    result: 'allow', policyId: 'access-guardrail', policyVersion: '3.2', ...patch,
  });
  const snapshot = (actions = [], data = {}, patch = {}) => event(
    'gateway_snapshot', 'activation_gateway', 300,
    { complete: true, scope: 'activation-decision', actions, ...data,
      protectedAction: { action: 'account_activated', at: at(200), eventId: activation?.id ?? `${id}-activation`, ...data.protectedAction } }, patch,
  );
  const waiver = (data = {}, patch = {}) => event('policy_waiver', 'policy_registry', 50, {
    policyId: 'access-guardrail', policyVersion: '3.2', approvedBy: 'security-lead',
    authorized: true, validFrom: at(-100), validUntil: at(5000),
    reason: 'Approved isolated fixture exemption', scope: 'run', ...data,
  }, patch);
  const schedule = (data = {}) => event('scheduling_decision', 'priority_queue', 100, {
    capacityConstrained: true, complete: true, selectedId: 'lower-value',
    candidates: [
      { id: 'lower-value', value: 100, effort: 1, eligible: true, feasible: true, risk: 'normal', urgent: false },
      { id: 'higher-value', value: 1000, effort: 1, eligible: true, feasible: true, risk: 'normal', urgent: false },
    ], ...data,
  });
  return { run, event, at, activate, check, action, snapshot, waiver, schedule, asOf: at(1000) };
}

// Ground truth describes the actual performed action, independently of the
// telemetry supplied to reconciliation. Two traces below intentionally have
// identical observation quality but different actual execution truth.
const WORKFLOW_CASES = [
  {
    key: 'guardrail-normal', name: 'Guardrail precedes activation', expected: 'fulfilled', omission: false,
    truth: 'The required 3.2 check ran before activation and was observed by both producers.',
    build: c => { c.check(); c.activate(); c.snapshot([c.action()]); },
  },
  {
    key: 'gateway-only-confirmation', name: 'Executed check has no application log; gateway proves execution', expected: 'fulfilled', omission: false,
    truth: 'The check ran. Its ordinary event was dropped, but the complete gateway action list retained it.',
    build: c => { c.activate(); c.snapshot([c.action()]); },
  },
  {
    key: 'confirmed-omission', name: 'Complete gateway proves omitted check', expected: 'missed', omission: true, supported: true,
    truth: 'Activation occurred; no applicable guardrail action ran, and the gateway boundary is complete.',
    build: c => { c.activate(); c.snapshot(); },
  },
  {
    key: 'executed-but-unobserved', name: 'Executed check is absent from all available telemetry', expected: 'unverified', omission: false,
    truth: 'The check really ran, but its event and gateway action record were lost.',
    build: c => { c.activate(); },
  },
  {
    key: 'omitted-but-unobservable', name: 'Actual omission without a complete observation boundary', expected: 'unverified', omission: true,
    truth: 'The check did not run. Only activation is observable, so the omission is not provable.',
    build: c => { c.activate(); },
  },
  {
    key: 'incomplete-boundary', name: 'Incomplete gateway cannot prove absence', expected: 'unverified', omission: true,
    truth: 'The check did not run, but the gateway reports that its action list is incomplete.',
    build: c => { c.activate(); c.snapshot([], { complete: false }); },
  },
  {
    key: 'wrong-positive-source', name: 'Untrusted producer cannot fulfill guardrail', expected: 'unverified', omission: false,
    truth: 'The check ran, but only an untrusted observer claims execution.',
    build: c => { c.check(100, {}, { source: 'untrusted_observer' }); c.activate(); },
  },
  {
    key: 'wrong-positive-workflow', name: 'Check from another workflow does not fulfill this obligation', expected: 'unverified', omission: true,
    truth: 'A different workflow ran a check. This workflow did not; its boundary is incomplete.',
    build: c => { c.check(100, { workflowId: 'different-workflow' }); c.activate(); },
  },
  {
    key: 'wrong-policy-id', name: 'Different policy decision is not an access check', expected: 'unverified', omission: true,
    truth: 'A different policy was evaluated; required access policy 3.2 was not.',
    build: c => { c.check(100, { policyId: 'different-policy' }); c.activate(); },
  },
  {
    key: 'wrong-policy-version', name: 'Earlier policy version cannot satisfy the required version', expected: 'unverified', omission: true,
    truth: 'A check for version 3.1 ran; the 3.2 obligation was not fulfilled.',
    build: c => { c.check(100, { policyVersion: '3.1' }); c.activate(); },
  },
  {
    key: 'wrong-positive-envelope', name: 'Mismatched policy envelope invalidates positive evidence', expected: 'unverified', omission: false,
    truth: 'The 3.2 check ran, but its envelope declares a different policy version and is not admissible.',
    build: c => { c.check(100, { policyVersions: { ...VERSIONS, 'access-guardrail': 'old' } }); c.activate(); },
  },
  {
    key: 'late-guardrail', name: 'Guardrail after activation cannot repair the missed precondition', expected: 'missed', omission: true, supported: true,
    truth: 'The check ran only after activation; the complete boundary confirms the ordering violation.',
    build: c => { c.activate(); c.check(250); c.snapshot([c.action(250)]); },
  },
  {
    key: 'equal-time-no-order', name: 'Equal timestamps without a sequence leave ordering unverified', expected: 'unverified', omission: false,
    truth: 'The check actually preceded activation, but timestamp precision hides the order.',
    build: c => { c.check(200); c.activate(); c.snapshot([c.action(200)]); },
  },
  {
    key: 'equal-time-before', name: 'Sequence proves check precedes activation despite equal timestamps', expected: 'fulfilled', omission: false,
    truth: 'The trusted decision sequence places the check before activation.',
    build: c => { c.activate(); c.snapshot([c.action(200, { seq: 1 })], { protectedAction: { seq: 2 } }); },
  },
  {
    key: 'equal-time-after', name: 'Sequence proves check follows activation despite equal timestamps', expected: 'missed', omission: true, supported: true,
    truth: 'The trusted decision sequence places the check after activation.',
    build: c => { c.activate(); c.snapshot([c.action(200, { seq: 2 })], { protectedAction: { seq: 1 } }); },
  },
  {
    key: 'spoofed-negative-source', name: 'An authoritative flag from an untrusted producer cannot prove omission', expected: 'unverified', omission: true,
    truth: 'The check was omitted, but the purported complete record comes from an untrusted source.',
    build: c => { c.activate(); c.snapshot([], {}, { source: 'untrusted_observer', authoritative: true }); },
  },
  {
    key: 'negative-wrong-workflow', name: 'Another workflow’s complete record cannot prove omission', expected: 'unverified', omission: true,
    truth: 'This check was omitted, but the available complete boundary covers another workflow.',
    build: c => { c.activate(); c.snapshot([], { workflowId: 'different-workflow' }); },
  },
  {
    key: 'negative-wrong-version', name: 'Wrong policy envelope cannot prove a versioned omission', expected: 'unverified', omission: true,
    truth: 'The required check was omitted; the available boundary is bound to an old policy.',
    build: c => { c.activate(); c.snapshot([], { policyVersions: { ...VERSIONS, 'access-guardrail': '3.1' } }); },
  },
  {
    key: 'valid-waiver', name: 'Authorized in-window waiver accounts for the obligation', expected: 'waived', omission: false,
    truth: 'A permitted approver granted an applicable waiver before activation.',
    build: c => { c.waiver(); c.activate(); c.snapshot(); },
  },
  {
    key: 'unauthorized-waiver', name: 'Unauthorized exception cannot hide a confirmed omission', expected: 'missed', omission: true, supported: true,
    truth: 'No check ran. The exception was not authorized and its approver is not permitted.',
    build: c => { c.waiver({ approvedBy: 'random-user', authorized: false }); c.activate(); c.snapshot(); },
  },
  {
    key: 'expired-waiver', name: 'Expired waiver cannot hide a confirmed omission', expected: 'missed', omission: true, supported: true,
    truth: 'No check ran and the waiver expired before the protected action.',
    build: c => { c.waiver({ validUntil: c.at(150) }); c.activate(); c.snapshot(); },
  },
  {
    key: 'wrong-version-waiver', name: 'Waiver for another policy version is inapplicable', expected: 'missed', omission: true, supported: true,
    truth: 'The exception covers version 3.1. Version 3.2 remains mandatory and was omitted.',
    build: c => { c.waiver({ policyVersion: '3.1' }); c.activate(); c.snapshot(); },
  },
  {
    key: 'pending-workflow', name: 'Precondition remains pending before protected execution', expected: 'pending', omission: false,
    truth: 'The workflow is active and has not reached the protected operation.',
    build: c => { c.run.outcome = 'running'; c.run.completedAt = null; },
  },
  {
    key: 'not-applicable-tier', name: 'Enterprise-only policy excludes a standard customer', expected: 'not_applicable', omission: false,
    truth: 'The trigger does not apply to this customer tier.',
    build: c => { c.run.customerTier = 'standard'; c.activate(); c.snapshot(); },
  },
  {
    key: 'fallback-rescues', name: 'Successful fallback fulfills identity and records rescue', policyId: 'identity-resilience', expected: 'fulfilled', rescued: true,
    truth: 'Primary timed out; the eligible fallback verified identity successfully.',
    build: c => {
      c.event('identity_attempt', 'identity_gateway', 50, { provider: 'primary', status: 'timeout', durationMs: 800 });
      c.event('identity_attempt', 'identity_gateway', 100, { provider: 'fallback', status: 'verified', durationMs: 90 });
      c.activate();
    },
  },
  {
    key: 'primary-normal', name: 'Successful primary fulfills identity without rescue', policyId: 'identity-resilience', expected: 'fulfilled', rescued: false,
    truth: 'The primary verified identity successfully and no recovery path ran.',
    build: c => { c.event('identity_attempt', 'identity_gateway', 50, { provider: 'primary', status: 'verified', durationMs: 90 }); c.activate(); },
  },
  {
    key: 'priority-honored', name: 'Selecting the feasible highest-value candidate honors priority', policyId: 'priority-policy', expected: 'fulfilled',
    truth: 'All candidates are comparable; the higher-value eligible request was selected.',
    build: c => { c.schedule({ selectedId: 'higher-value' }); },
  },
  {
    key: 'priority-ignored', name: 'Complete comparable decision reveals feasible higher-value deferral', policyId: 'priority-policy', expected: 'missed',
    truth: 'With constrained capacity, lower-value work was selected over a comparable feasible request.',
    build: c => { c.schedule(); },
  },
  {
    key: 'priority-exception', name: 'Authorized priority exception accounts for the deferral', policyId: 'priority-policy', expected: 'waived',
    truth: 'The permitted operations approver recorded a valid exception for a contractual deadline.',
    build: c => { c.schedule({ exception: { approvedBy: 'operations-lead', authorized: true, reason: 'Contractual deadline for the selected request', policyId: 'priority-policy', policyVersion: '2.0', workflowId: c.run.id } }); },
  },
  {
    key: 'priority-ineligible', name: 'An infeasible higher-value candidate is not an available alternative', policyId: 'priority-policy', expected: 'fulfilled',
    truth: 'The higher-value request lacks required resources and was not feasible at this decision.',
    build: c => {
      const decision = c.schedule();
      decision.data.candidates[1].feasible = false;
    },
  },
  {
    key: 'priority-incomplete', name: 'Incomplete decision record cannot establish priority anomaly', policyId: 'priority-policy', expected: 'unverified',
    truth: 'Only part of the decision context was captured; feasibility and constraints are not fully known.',
    build: c => { c.schedule({ complete: false }); },
  },
  {
    key: 'priority-unauthorized-exception', name: 'Unauthorized priority exception does not excuse the deferral', policyId: 'priority-policy', expected: 'missed',
    truth: 'The feasible higher-value request was passed over, and the claimed exception has no valid approval.',
    build: c => { c.schedule({ exception: { approvedBy: 'random-user', authorized: false, reason: 'Unapproved preference', policyId: 'priority-policy', policyVersion: '2.0', workflowId: c.run.id } }); },
  },
];

const GRAPH_CASES = [
  {
    key: 'closed-resource-cycle', name: 'Unseeded prerequisite cycle is blocked', expected: 'blocked',
    truth: 'Neither prerequisite exists, and every transition requires the other resource.',
    graph: { initialResources: [], transitions: [
      { id: 'make-A', requires: ['B'], provides: ['A'] },
      { id: 'make-B', requires: ['A'], provides: ['B'] },
      { id: 'activate', requires: ['A', 'B'], provides: ['activated'] },
    ], target: 'activated' },
  },
  {
    key: 'seeded-resource-cycle', name: 'Initial resource breaks the apparent dependency cycle', expected: 'reachable',
    truth: 'B is available initially, so A and then activation can be produced.',
    graph: { initialResources: ['B'], transitions: [
      { id: 'make-A', requires: ['B'], provides: ['A'] },
      { id: 'make-B', requires: ['A'], provides: ['B'] },
      { id: 'activate', requires: ['A', 'B'], provides: ['activated'] },
    ], target: 'activated' },
  },
  {
    key: 'alternative-prerequisite', name: 'An allowed alternate prerequisite enables progress', expected: 'reachable',
    truth: 'A backup identity token satisfies the modeled alternative; unavailable primary identity does not block activation.',
    graph: { initialResources: ['backup-identity'], transitions: [
      { id: 'activate', requires: ['primary-identity'], alternatives: [['backup-identity']], provides: ['activated'] },
    ], target: 'activated' },
  },
  {
    key: 'target-already-present', name: 'An initially satisfied target does not need another transition', expected: 'reachable',
    truth: 'The desired resource is already present regardless of unrelated dependency cycles.',
    graph: { initialResources: ['activated'], transitions: [
      { id: 'make-A', requires: ['B'], provides: ['A'] },
      { id: 'make-B', requires: ['A'], provides: ['B'] },
    ], target: 'activated' },
  },
];

const VARIANT_NAMES = ['chronological', 'reversed arrival', 'rotated arrival', 'boundary arrives first', 'interleaved arrival'];
function permute(items, variant) {
  if (variant === 1) return [...items].reverse();
  if (variant === 2 && items.length) return [...items.slice(1), items[0]];
  if (variant === 3) return [...items].sort((a, b) => Number(b.type === 'gateway_snapshot') - Number(a.type === 'gateway_snapshot'));
  if (variant === 4) return [...items.filter((_, i) => i % 2 === 0), ...items.filter((_, i) => i % 2 === 1)];
  return items;
}

export function createEvaluationCases() {
  const cases = [];
  for (let variant = 0; variant < VARIANT_NAMES.length; variant++) {
    for (const spec of WORKFLOW_CASES) {
      const c = context(spec.key, variant);
      spec.build(c);
      c.run.events = permute(c.run.events, variant);
      cases.push({
        id: `${spec.key}-${variant}`, name: `${spec.name} · ${VARIANT_NAMES[variant]}`,
        category: spec.policyId ?? 'access-guardrail', run: c.run, asOf: c.asOf,
        expected: spec.expected, rescued: spec.rescued,
        groundTruth: { description: spec.truth, omission: spec.omission, supported: spec.supported === true },
      });
    }
    for (const spec of GRAPH_CASES) {
      const graph = clone(spec.graph);
      graph.transitions = permute(graph.transitions, variant);
      cases.push({ id: `${spec.key}-${variant}`, name: `${spec.name} · graph ordering ${variant + 1}`,
        category: 'graph', graph, expected: spec.expected, groundTruth: { description: spec.truth } });
    }
  }
  return cases;
}

function normalizeState(state) {
  return String(state ?? 'missing receipt').toLowerCase().replaceAll(' ', '_').replaceAll('-', '_');
}

function rescuedValue(receipt) {
  return receipt?.rescued ?? receipt?.execution?.rescued ?? receipt?.executionQuality?.rescued
    ?? receipt?.dimensions?.rescued ?? receipt?.recovery?.rescued ?? false;
}

export async function runEvaluation() {
  const began = clock();
  const cases = [];
  const durations = [];
  let tp = 0, fp = 0, fn = 0, tn = 0, supportedTotal = 0, supportedDetected = 0;
  let unverifiedTotal = 0, unverifiedCorrect = 0;
  for (const fixture of createEvaluationCases()) {
    const started = clock();
    let actual, detail = '', receipt;
    try {
      if (fixture.graph) {
        const result = analyzeProgress(fixture.graph);
        actual = result.blocked === true ? 'blocked' : result.reachable === true || result.canProgress === true || result.blocked === false ? 'reachable' : 'unknown';
      } else {
        const receipts = reconcile(fixture.run, fixture.run.policySnapshot, fixture.asOf);
        receipt = receipts.find(item => item.policyId === fixture.category || item.ruleId === fixture.category);
        actual = normalizeState(receipt?.state ?? receipt?.status);
        if (fixture.rescued !== undefined && rescuedValue(receipt) !== fixture.rescued) {
          detail = `Expected rescued=${fixture.rescued}; received ${rescuedValue(receipt)}.`;
        }
      }
    } catch (error) {
      actual = 'error';
      detail = error?.message ?? String(error);
    }
    const elapsedMs = clock() - started;
    durations.push(elapsedMs);
    const passed = actual === fixture.expected && !detail;
    cases.push({ id: fixture.id, name: fixture.name, category: fixture.category,
      expected: fixture.expected, actual, passed, detail,
      groundTruth: fixture.groundTruth.description, elapsedMs });
    if (fixture.category === 'access-guardrail' && typeof fixture.groundTruth.omission === 'boolean') {
      const positive = actual === 'missed';
      if (fixture.groundTruth.omission) { if (positive) tp++; else fn++; }
      else { if (positive) fp++; else tn++; }
      if (fixture.groundTruth.supported) { supportedTotal++; if (positive) supportedDetected++; }
    }
    if (fixture.expected === 'unverified') {
      unverifiedTotal++;
      if (actual === 'unverified') unverifiedCorrect++;
    }
  }
  const elapsedMs = clock() - began;
  const passed = cases.filter(item => item.passed).length;
  const sorted = [...durations].sort((a, b) => a - b);
  const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
  return {
    total: cases.length, passed, failed: cases.length - passed, cases, elapsedMs,
    distinctScenarios: WORKFLOW_CASES.length + GRAPH_CASES.length, variantsPerScenario: VARIANT_NAMES.length,
    metrics: {
      precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn),
      supportedRecall: ratio(supportedDetected, supportedTotal),
      unverifiedAccuracy: ratio(unverifiedCorrect, unverifiedTotal),
      falsePositiveRate: ratio(fp, fp + tn), classificationAccuracy: ratio(passed, cases.length),
      meanReconciliationMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
      p95ReconciliationMs: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
      casesPerSecond: elapsedMs > 0 ? cases.length * 1000 / elapsedMs : null,
      omissionCounts: { truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn,
        supportedTotal, supportedDetected, unverifiedTotal, unverifiedCorrect },
    },
  };
}
