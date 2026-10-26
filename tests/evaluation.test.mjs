import test from 'node:test';
import assert from 'node:assert/strict';
import { runEvaluation, createEvaluationCases } from '../dist/evaluation.js';

test('180 independent fixtures reconcile to their specified accountable outcomes', async () => {
  const report = await runEvaluation();
  assert.equal(report.total, 180);
  const failures = report.cases.filter(item => !item.passed);
  assert.equal(failures.length, 0, failures.map(item =>
    `${item.name}: expected ${item.expected}; received ${item.actual}. ${item.detail}`,
  ).join('\n'));
  assert.equal(report.metrics.precision, 1, 'Untrusted or incomplete evidence must never produce false omissions.');
  assert.equal(report.metrics.supportedRecall, 1, 'Every omission with sufficient authoritative evidence must be detected.');
  assert.equal(report.metrics.unverifiedAccuracy, 1);
  assert.equal(report.metrics.falsePositiveRate, 0);
});

test('fixture truth separates real omissions from unobserved successful checks', () => {
  const fixtures = createEvaluationCases();
  const performed = fixtures.find(item => item.id === 'executed-but-unobserved-0');
  const omitted = fixtures.find(item => item.id === 'omitted-but-unobservable-0');
  assert.equal(performed.expected, 'unverified');
  assert.equal(omitted.expected, 'unverified');
  assert.equal(performed.groundTruth.omission, false);
  assert.equal(omitted.groundTruth.omission, true);
  assert.deepEqual(performed.run.events.map(item => item.type), omitted.run.events.map(item => item.type));
  assert.ok(fixtures.every(item => item.groundTruth.description.length > 20));
});
