import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, summarize, validateImport, analyzeProgress, createSeedRuns, DEFAULT_POLICIES } from '../dist/engine.js';
import { createEvaluationCases } from '../dist/evaluation.js';

const copy = value => structuredClone(value);
const fixture = key => createEvaluationCases().find(item => item.id === `${key}-0`);
const guardrail = input => reconcile(input.run, DEFAULT_POLICIES, input.asOf).find(item => item.policyId === 'access-guardrail');
const shift = (at, ms) => new Date(Date.parse(at) + ms).toISOString();

test('historical policy snapshot survives a later policy disable', () => {
  const input = fixture('confirmed-omission');
  const current = copy(DEFAULT_POLICIES);
  current.find(item => item.id === 'access-guardrail').enabled = false;
  const receipt = reconcile(input.run, current, input.asOf).find(item => item.policyId === 'access-guardrail');
  assert.equal(receipt.status, 'missed');
  assert.equal(receipt.policyVersion, '3.2');
});

test('contradictory complete gateway and positive event remain unverified', () => {
  const input = fixture('guardrail-normal');
  input.run.events.find(item => item.type === 'gateway_snapshot').data.actions = [];
  assert.equal(guardrail(input).status, 'unverified');
});

test('gateway proof must correlate to the protected operation', () => {
  for (const mutation of [
    item => { item.eventId = 'some-other-activation'; },
    item => { item.at = shift(item.at, -1); },
  ]) {
    const input = fixture('confirmed-omission');
    mutation(input.run.events.find(item => item.type === 'gateway_snapshot').data.protectedAction);
    assert.equal(guardrail(input).status, 'unverified');
  }
});

test('invalid complete gateway records do not establish an omission', () => {
  for (const actions of [[null], [{ action: 'access_guardrail_evaluated', at: 'invalid' }], 'not-an-array']) {
    const input = fixture('confirmed-omission');
    input.run.events.find(item => item.type === 'gateway_snapshot').data.actions = actions;
    assert.equal(guardrail(input).status, 'unverified');
  }
});

test('records outside the as-of observation time cannot resolve a pending obligation', () => {
  const input = fixture('confirmed-omission');
  const asOf = shift(input.run.startedAt, 20);
  assert.equal(reconcile(input.run, DEFAULT_POLICIES, asOf).find(item => item.policyId === 'access-guardrail').status, 'pending');
});

test('complete success without trustworthy evidence is unverified', () => {
  const input = fixture('guardrail-normal');
  input.run.events = [];
  assert.equal(guardrail(input).status, 'unverified');
  assert.equal(guardrail(input).due, true);
});

test('latest scheduling decision is determined by event time, not delivery order', () => {
  const input = fixture('priority-ignored');
  const earlier = input.run.events[0];
  const later = copy(earlier);
  later.id += '-later';
  later.at = shift(later.at, 10);
  later.data.selectedId = 'higher-value';
  for (const events of [[earlier, later], [later, earlier]]) {
    input.run.events = events;
    const receipt = reconcile(input.run, DEFAULT_POLICIES, input.asOf).find(item => item.policyId === 'priority-policy');
    assert.equal(receipt.status, 'fulfilled');
  }
});

test('earliest successful identity response determines rescue independent of delivery order', () => {
  const input = fixture('fallback-rescues');
  const laterPrimary = copy(input.run.events.find(item => item.type === 'identity_attempt' && item.data.provider === 'fallback'));
  laterPrimary.id += '-late-primary';
  laterPrimary.at = shift(laterPrimary.at, 20);
  laterPrimary.data.provider = 'primary';
  const original = [...input.run.events, laterPrimary];
  for (const events of [original, [...original].reverse()]) {
    input.run.events = events;
    const receipt = reconcile(input.run, DEFAULT_POLICIES, input.asOf).find(item => item.policyId === 'identity-resilience');
    assert.equal(receipt.status, 'fulfilled');
    assert.equal(receipt.rescued, true);
  }
});

test('latest dependency snapshot is determined by event time, not delivery order', () => {
  const input = fixture('guardrail-normal');
  const basis = input.run.events[0];
  const snapshots = ['blocked', 'reachable'].map((kind, index) => ({
    ...copy(basis), id: `${basis.id}-graph-${kind}`, at: shift(basis.at, index * 10),
    type: 'workflow_snapshot', source: 'workflow_orchestrator',
    data: { ...copy(basis.data), complete: true, graph: { initialResources: index ? ['activated'] : [], transitions: [], target: 'activated' } },
  }));
  for (const events of [snapshots, [...snapshots].reverse()]) {
    input.run.events = events;
    const receipt = reconcile(input.run, DEFAULT_POLICIES, input.asOf).find(item => item.policyId === 'workflow-progress');
    assert.equal(receipt.status, 'fulfilled');
  }
});

test('import rebuilds classifications instead of trusting forged receipts', () => {
  const input = fixture('confirmed-omission');
  input.run.customer = 'Fixture customer';
  input.run.durationMs = 400;
  input.run.receipts = [{ policyId: 'access-guardrail', status: 'fulfilled', rescued: true }];
  const imported = validateImport({ schemaVersion: 1, policies: copy(DEFAULT_POLICIES), runs: [input.run] });
  assert.equal(imported.runs[0].receipts.find(item => item.policyId === 'access-guardrail').status, 'missed');
});

test('aggregation conserves applicable opportunities and uses due mandatory denominators', () => {
  const runs = ['guardrail-normal', 'confirmed-omission', 'executed-but-unobserved', 'not-applicable-tier'].map(key => {
    const input = fixture(key);
    input.run.receipts = reconcile(input.run, DEFAULT_POLICIES, input.asOf);
    return input.run;
  });
  const summary = summarize(runs);
  assert.equal(summary.conservationHolds, true);
  assert.equal(summary.eligibleObligationsDue, 3);
  assert.equal(summary.missedObligations, 1);
  assert.equal(summary.unverifiedObligations, 1);
  assert.equal(summary.obligationMissRate, 33.3);
  assert.equal(summary.evidenceGapRate, 33.3);
});

test('duplicate transition identities invalidate the model instead of claiming deadlock', () => {
  const result = analyzeProgress({ initialResources: [], target: 'target', transitions: [
    { id: 'duplicate', requires: [], provides: ['a'] },
    { id: 'duplicate', requires: ['a'], provides: ['target'] },
  ] });
  assert.equal(result.valid, false);
  assert.equal(result.blocked, false);
});

test('seed examples stay historical and reproduce exactly under a supplied clock anchor', async () => {
  const anchor = Date.parse('2026-10-26T04:45:00.000Z');
  const runs = await createSeedRuns({ now: anchor });
  assert.deepEqual(await createSeedRuns({ now: anchor }), runs);
  assert.equal(runs.length, 40);
  assert.ok(runs.every(run => Date.parse(run.completedAt) <= anchor - 300000));
  const later = await createSeedRuns({ now: anchor + 86400000 });
  assert.deepEqual(summarize(later), summarize(runs));
  assert.equal(Date.parse(later[0].startedAt) - Date.parse(runs[0].startedAt), 86400000);
  const currentAnchor = Date.now();
  const current = await createSeedRuns();
  assert.ok(current.every(run => Date.parse(run.completedAt) < currentAnchor));
  await assert.rejects(createSeedRuns({ now: 'not-a-time' }), /seed population time is invalid/);
});
