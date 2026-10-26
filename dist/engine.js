/**
 * UNCOUNTED — executable reference engine.
 * Runs real in-process service methods against an in-memory customer account.
 * Faults and service durations are deliberately synthetic; no production traffic is used.
 * `source` is a trusted-producer contract inside this sandbox, not a signature.
 * Production collectors must authenticate producers before accepting their envelopes.
 */
export const SCHEMA_VERSION = 1;
export const DEFAULT_POLICIES = [
  { id: 'access-guardrail', name: 'Access policy before activation', version: '3.2', kind: 'mandatory', description: 'Enterprise environments require an allow decision before activation.', expectedAction: 'access_guardrail_evaluated', beforeAction: 'account_activated', evidenceSource: 'authorization_service', boundarySource: 'activation_gateway', owner: 'Security Engineering', enabled: true, approved: true, customerTier: 'enterprise', authorizedApprovers: ['security-lead'] },
  { id: 'identity-resilience', name: 'Verified identity, accountable recovery', version: '1.1', kind: 'resilience', description: 'Identity must be verified. A fallback can fulfill the outcome while exposing primary degradation.', expectedAction: 'identity_verified', beforeAction: 'account_activated', evidenceSource: 'identity_gateway', owner: 'Identity Platform', enabled: true, approved: true, authorizedApprovers: [] },
  { id: 'priority-policy', name: 'Prefer feasible higher-value work', version: '2.0', kind: 'priority', description: 'When capacity is constrained, prefer higher value per unit effort among comparable eligible tasks unless an approved exception applies.', expectedAction: 'select_highest_eligible', beforeAction: 'queue_dispatch', evidenceSource: 'priority_queue', owner: 'Revenue Operations', enabled: true, approved: true, authorizedApprovers: ['operations-lead'] },
  { id: 'workflow-progress', name: 'A viable path to activation', version: '1.0', kind: 'progress', description: 'Declared prerequisites and initial resources must permit the activation target to be reached.', expectedAction: 'reach_activation', evidenceSource: 'workflow_orchestrator', owner: 'Workflow Platform', enabled: true, approved: true, authorizedApprovers: [] },
];
export const SCENARIOS = [
  { id: 'healthy', title: 'Healthy onboarding', description: 'All applicable checks execute before activation.', icon: 'check' },
  { id: 'skipped_guardrail', title: 'Skipped guardrail', description: 'Activation succeeds; a complete gateway record proves the required check was omitted.', icon: 'shield' },
  { id: 'missing_telemetry', title: 'Missing evidence', description: 'The check executes, but both its normal log and complete gateway evidence are unavailable.', icon: 'eye' },
  { id: 'fallback_rescue', title: 'Fallback rescue', description: 'The primary identity provider times out; a backup verifies the customer.', icon: 'repeat' },
  { id: 'priority_ignored', title: 'Priority ignored', description: 'The queue dispatches comparable lower-value work while a higher-value request is feasible.', icon: 'priority' },
  { id: 'priority_exception', title: 'Approved priority exception', description: 'An approved urgent-work exception explains the scheduling decision.', icon: 'check' },
  { id: 'deadlock', title: 'Dependency deadlock', description: 'Neither cyclic prerequisite can be supplied by an initial resource or alternative transition.', icon: 'lock' },
  { id: 'late_guardrail', title: 'Late guardrail', description: 'The access check runs after activation and cannot satisfy its original precondition.', icon: 'clock' },
  { id: 'waived_guardrail', title: 'Approved guardrail waiver', description: 'A scoped, authorized exception covers this activation.', icon: 'check' },
  { id: 'telemetry_discrepancy', title: 'Gateway recovers evidence', description: 'The application log is missing, but the complete gateway record confirms the check.', icon: 'eye' },
  { id: 'pending_obligation', title: 'Awaiting activation', description: 'The workflow is still open; no protected operation or deadline has made the check overdue.', icon: 'clock' },
];
const STATUSES = ['fulfilled', 'missed', 'unverified', 'waived', 'pending', 'not_applicable'];
const KINDS = ['mandatory', 'resilience', 'priority', 'progress'];
const clone = value => JSON.parse(JSON.stringify(value));
const time = value => typeof value === 'number' ? value : Date.parse(value);
const iso = value => new Date(value).toISOString();
const str = value => typeof value === 'string' && value.length > 0;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const eventOrder = (a, b) => time(a.at) - time(b.at) || (Number.isInteger(a.seq) && Number.isInteger(b.seq) ? a.seq - b.seq : 0);
const active = policy => policy.enabled === true && policy.approved === true;
function before(a, b) {
  if (!a || !b || !Number.isFinite(time(a.at)) || !Number.isFinite(time(b.at))) return null;
  if (time(a.at) < time(b.at)) return true;
  if (time(a.at) > time(b.at)) return false;
  if (Number.isInteger(a.seq) && Number.isInteger(b.seq) && a.seq !== b.seq) return a.seq < b.seq;
  return null;
}
function atOrBefore(a, b) { return Number.isFinite(time(a)) && Number.isFinite(time(b)) && time(a) <= time(b); }
function approvedPolicies(policies) {
  if (!Array.isArray(policies) || policies.length > 100) throw new Error('Policies must be an array of at most 100 rules.');
  const seen = new Set();
  return policies.map(p => {
    if (!p || !str(p.id) || !str(p.name) || !str(p.version) || !KINDS.includes(p.kind) || typeof p.enabled !== 'boolean' || typeof p.approved !== 'boolean') throw new Error('Each policy requires an id, name, version, kind, enabled flag, and approval flag.');
    if (seen.has(p.id)) throw new Error('Duplicate policy id: ' + p.id);
    seen.add(p.id);
    return clone(p);
  });
}

/** Monotonic resource reachability; alternatives are OR sets of AND prerequisites. */
export function analyzeProgress(graph) {
  if (!graph || !Array.isArray(graph.initialResources) || !Array.isArray(graph.transitions) || !str(graph.target)) return { reachable: false, blocked: false, valid: false, reason: 'The dependency model is incomplete.' };
  if (graph.initialResources.some(x => !str(x)) || graph.transitions.length > 1000 || graph.transitions.some(t => !t || !str(t.id) || !Array.isArray(t.requires) || !Array.isArray(t.provides) || [...t.requires, ...t.provides].some(x => !str(x)) || (t.alternatives && (!Array.isArray(t.alternatives) || t.alternatives.some(a => !Array.isArray(a) || a.some(x => !str(x))))))) return { reachable: false, blocked: false, valid: false, reason: 'The dependency model contains an invalid transition.' };
  if (new Set(graph.transitions.map(t => t.id)).size !== graph.transitions.length) return { reachable: false, blocked: false, valid: false, reason: 'The dependency model contains duplicate transition ids.' };
  const resources = new Set(graph.initialResources), executed = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const transition of graph.transitions) {
      if (executed.includes(transition.id)) continue;
      const routes = [transition.requires, ...(transition.alternatives || [])];
      if (routes.some(requirements => requirements.every(item => resources.has(item)))) {
        executed.push(transition.id);
        for (const item of transition.provides) resources.add(item);
        changed = true;
      }
    }
  }
  const reachable = resources.has(graph.target);
  const unmet = graph.transitions.filter(t => !executed.includes(t.id)).map(t => ({ id: t.id, requires: t.requires.filter(r => !resources.has(r)) }));
  return { reachable, blocked: !reachable, valid: true, resources: [...resources], executed, unmet, reason: reachable ? 'The modeled activation target is reachable from the available resources.' : 'After exhausting every available transition, the modeled activation target remains unreachable.' };
}

function eventCollector(run, startingAt) {
  let clock = startingAt, sequence = 0;
  const versions = Object.fromEntries(run.policySnapshot.map(p => [p.id, p.version]));
  return {
    advance(ms = 1) { clock += ms; return clock; },
    get now() { return clock; },
    emit(type, source, data = {}, { visible = true } = {}) {
      const event = { id: `${run.id}-e${String(++sequence).padStart(2, '0')}`, type, at: iso(clock), seq: sequence, source, authoritative: true, data: { workflowId: run.id, policyVersions: { ...versions }, ...data } };
      if (visible) run.events.push(event);
      clock += 1;
      return event;
    },
  };
}
class AuthorizationService {
  constructor(collector, policy) { this.collector = collector; this.policy = policy; }
  async evaluate(account, visible = true) {
    this.collector.advance(35);
    const result = account.permissions.includes('owner') ? 'allow' : 'deny';
    const event = this.collector.emit('access_guardrail_evaluated', 'authorization_service', { policyId: this.policy.id, policyVersion: this.policy.version, accountId: account.id, result }, { visible });
    return { result, event };
  }
}
class IdentityService {
  constructor(collector, provider, fault = false) { this.collector = collector; this.provider = provider; this.fault = fault; }
  async verify(account) {
    const durationMs = this.fault ? 800 : this.provider === 'fallback' ? 165 : 92;
    this.collector.advance(durationMs);
    const status = this.fault ? 'timeout' : 'verified';
    const event = this.collector.emit('identity_attempt', 'identity_gateway', { provider: this.provider, status, durationMs, accountId: account.id });
    return { provider: this.provider, status, durationMs, at: event.at, seq: event.seq, eventId: event.id };
  }
}
class AccountService {
  constructor(collector) { this.collector = collector; this.accounts = new Map(); }
  async create(customer) {
    this.collector.advance(18);
    const account = { id: 'acct-' + this.collector.now.toString(36), customer, permissions: ['owner'], status: 'provisioned' };
    this.accounts.set(account.id, account);
    this.collector.emit('account_created', 'account_service', { accountId: account.id, status: account.status });
    return account;
  }
  async activate(account) {
    this.collector.advance(24);
    account.status = 'active';
    return this.collector.emit('account_activated', 'account_service', { accountId: account.id, status: account.status, httpStatus: 200 });
  }
}
class ActivationGateway {
  constructor(collector, service) { this.collector = collector; this.service = service; this.actions = []; this.protectedAction = null; }
  async evaluate(authorization, account, visible) {
    const result = await authorization.evaluate(account, visible);
    this.actions.push({ action: result.event.type, at: result.event.at, seq: result.event.seq, eventId: result.event.id, result: result.result, policyId: authorization.policy.id, policyVersion: authorization.policy.version });
    return result;
  }
  async activate(account) {
    const event = await this.service.activate(account);
    this.protectedAction = { action: event.type, at: event.at, seq: event.seq, eventId: event.id };
    return event;
  }
  close(complete) {
    return this.collector.emit('gateway_snapshot', 'activation_gateway', { scope: 'activation-decision', complete, protectedAction: this.protectedAction, actions: complete ? clone(this.actions) : [], observationNote: complete ? 'All authorization invocations through the controlled activation gateway are included.' : 'The gateway decision export is incomplete; absence cannot establish omission.' });
  }
}
function healthyGraph() {
  return { initialResources: ['registration'], transitions: [{ id: 'create-account', requires: ['registration'], provides: ['account'] }, { id: 'verify-identity', requires: ['account'], provides: ['identity'] }, { id: 'grant-access', requires: ['identity'], provides: ['access'] }, { id: 'activate', requires: ['account', 'access'], provides: ['activated'] }], target: 'activated' };
}
function deadlockedGraph() {
  return { initialResources: ['registration'], transitions: [{ id: 'grant-permission', requires: ['approval'], provides: ['permission'] }, { id: 'issue-approval', requires: ['permission'], provides: ['approval'] }, { id: 'activate', requires: ['approval', 'permission'], provides: ['activated'] }], target: 'activated' };
}

/** Each scenario alters executable service behavior; receipts are derived afterward. */
export async function runScenario(scenarioId, { id, now, policies = DEFAULT_POLICIES, customer } = {}) {
  if (!SCENARIOS.some(s => s.id === scenarioId)) throw new Error('Unknown scenario: ' + scenarioId);
  const start = now === undefined ? Date.now() : time(now);
  if (!Number.isFinite(start)) throw new Error('The execution time is invalid.');
  const workflowId = id || `run-${start.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  if (!str(workflowId)) throw new Error('A workflow id must be a non-empty string.');
  const run = { id: workflowId, workflowId, scenario: scenarioId, customer: typeof customer === 'string' ? customer : customer?.name || 'Meridian Labs', customerTier: typeof customer === 'object' ? customer.tier || 'enterprise' : 'enterprise', startedAt: iso(start), completedAt: null, outcome: 'pending', agentVersion: 'acme-onboarding/1.0', synthetic: true, latencyKind: 'synthetic service clock', policySnapshot: approvedPolicies(policies), events: [], receipts: [] };
  const capture = eventCollector(run, start);
  capture.emit('onboarding_requested', 'onboarding_agent', { customer: run.customer, tier: run.customerTier });
  const graph = scenarioId === 'deadlock' ? deadlockedGraph() : healthyGraph();
  run.graph = clone(graph);
  capture.emit('workflow_snapshot', 'workflow_orchestrator', { complete: true, graph });
  const reachability = analyzeProgress(graph);
  if (!reachability.reachable) {
    capture.emit('workflow_blocked', 'workflow_orchestrator', { reason: reachability.reason, unmet: reachability.unmet });
    run.outcome = 'blocked';
  } else if (scenarioId === 'pending_obligation') {
    capture.emit('workflow_waiting', 'workflow_orchestrator', { reason: 'Activation has not started; its preconditions remain open.' });
  } else {
    const accounts = new AccountService(capture);
    const account = await accounts.create(run.customer);
    const gateway = new ActivationGateway(capture, accounts);
    const guardrail = run.policySnapshot.find(p => p.id === 'access-guardrail') || DEFAULT_POLICIES[0];
    const authorization = new AuthorizationService(capture, guardrail);
    const primary = await new IdentityService(capture, 'primary', scenarioId === 'fallback_rescue').verify(account);
    const attempts = [primary];
    if (primary.status !== 'verified') attempts.push(await new IdentityService(capture, 'fallback').verify(account));
    capture.emit('identity_boundary', 'identity_gateway', { complete: true, eligible: true, attempts, verified: attempts.some(a => a.status === 'verified') });
    if (scenarioId.startsWith('priority_')) {
      const candidates = [{ id: 'standard-request', value: 100, effort: 1, eligible: true, feasible: true, risk: 'normal', urgent: false }, { id: 'enterprise-request', value: 1000, effort: 1, eligible: true, feasible: true, risk: 'normal', urgent: false }];
      const exception = scenarioId === 'priority_exception' ? { approvedBy: 'operations-lead', authorized: true, reason: 'Time-limited incident response commitment takes precedence.', policyId: 'priority-policy', policyVersion: run.policySnapshot.find(p => p.id === 'priority-policy')?.version, workflowId: run.id } : null;
      capture.emit('scheduling_decision', 'priority_queue', { complete: true, capacityConstrained: true, selectedId: candidates[0].id, candidates, exception });
    }
    if (scenarioId === 'waived_guardrail') {
      capture.emit('policy_waiver', 'policy_registry', { policyId: guardrail.id, policyVersion: guardrail.version, authorized: true, approvedBy: 'security-lead', scope: 'run', validFrom: iso(start - 1000), validUntil: iso(start + 3600000), reason: 'Sandbox activation approved with equivalent manual access verification.' });
    }
    const skip = ['skipped_guardrail', 'late_guardrail', 'waived_guardrail'].includes(scenarioId);
    if (!skip && active(guardrail)) await gateway.evaluate(authorization, account, !['missing_telemetry', 'telemetry_discrepancy'].includes(scenarioId));
    capture.emit('activation_tool_selected', 'onboarding_agent', { tool: 'activate_environment', accountId: account.id });
    await gateway.activate(account);
    if (scenarioId === 'late_guardrail' && active(guardrail)) await gateway.evaluate(authorization, account, true);
    gateway.close(scenarioId !== 'missing_telemetry');
    capture.emit('onboarding_completed', 'onboarding_agent', { httpStatus: 200, accountId: account.id, accountStatus: account.status });
    run.account = clone(account);
    run.outcome = 'success';
  }
  run.completedAt = run.outcome === 'pending' ? null : iso(capture.now);
  run.durationMs = capture.now - start;
  run.observedAt = iso(capture.now);
  run.receipts = reconcile(run, run.policySnapshot, capture.now);
  return run;
}

function receipt(run, policy) {
  return { id: `${run.id}:${policy.id}:${policy.version}`, runId: run.id, title: policy.name, kind: policy.kind, status: 'pending', reason: 'The opportunity remains open.', expected: policy.description || policy.expectedAction || policy.name, observed: 'No conclusive evidence yet.', policyId: policy.id, policyVersion: policy.version, evidenceIds: [], owner: policy.owner || 'Unassigned', rescued: false, execution: 'healthy', due: false, applicable: true, confidence: 'open', actionable: false, assumptions: [] };
}
function finish(base, status, reason, evidence = [], fields = {}) {
  return { ...base, status, reason, observed: reason, evidenceIds: [...new Set(evidence.filter(Boolean).map(e => typeof e === 'string' ? e : e.id))], confidence: ['fulfilled', 'missed', 'waived'].includes(status) ? 'established within declared boundary' : status === 'unverified' ? 'insufficient evidence' : 'open', actionable: ['missed', 'unverified'].includes(status), ...fields };
}
function trustedEvents(run, policy, now) {
  return (run.events || []).filter(event => event && event.authoritative === true && event.data?.workflowId === (run.workflowId || run.id) && event.data?.policyVersions?.[policy.id] === policy.version && Number.isFinite(time(event.at)) && time(event.at) >= time(run.startedAt) && time(event.at) <= now).sort(eventOrder);
}
function sourceEvents(events, type, source) { return events.filter(e => e.type === type && e.source === source); }
function ambiguousLatest(events) {
  const latest = events[events.length - 1];
  return latest && events.some(other => other !== latest && eventOrder(other, latest) === 0 && JSON.stringify(other.data) !== JSON.stringify(latest.data));
}
function getActivation(events) {
  const operations = sourceEvents(events, 'account_activated', 'account_service');
  return operations.slice().sort((a, b) => time(a.at) - time(b.at))[0];
}
function validWaiver(events, policy, boundary) {
  return sourceEvents(events, 'policy_waiver', 'policy_registry').find(e => e.data.policyId === policy.id && e.data.policyVersion === policy.version && e.data.authorized === true && (policy.authorizedApprovers || []).includes(e.data.approvedBy) && e.data.scope === 'run' && str(e.data.reason) && before(e, boundary) === true && atOrBefore(e.data.validFrom, boundary.at) && atOrBefore(boundary.at, e.data.validUntil));
}
function guardrailReceipt(run, policy, base, events, now) {
  if (run.customerTier !== (policy.customerTier || 'enterprise')) return finish(base, 'not_applicable', 'This customer does not match the policy trigger.', [], { applicable: false });
  const activated = getActivation(events);
  const gatewayEvents = sourceEvents(events, 'gateway_snapshot', policy.boundarySource || 'activation_gateway').filter(e => e.data.scope === 'activation-decision' && e.data.protectedAction?.action === 'account_activated' && str(e.data.protectedAction.eventId) && Number.isFinite(time(e.data.protectedAction.at)) && time(e.data.protectedAction.at) >= time(run.startedAt) && time(e.data.protectedAction.at) <= time(e.at) && (!activated || (e.data.protectedAction.eventId === activated.id && time(e.data.protectedAction.at) === time(activated.at))));
  const snapshot = gatewayEvents[gatewayEvents.length - 1];
  const boundary = activated ? { ...activated, seq: activated.seq ?? snapshot?.data.protectedAction?.seq } : snapshot?.data.protectedAction;
  if (!boundary) {
    if (run.outcome === 'success' && atOrBefore(run.completedAt, now)) return finish(base, 'unverified', 'The workflow reports success, but a trustworthy activation boundary is unavailable.', [], { due: true, dueAt: run.completedAt });
    return finish(base, 'pending', 'Activation has not been established. The before-activation obligation is still open.');
  }
  base = { ...base, due: true, dueAt: boundary.at };
  if (ambiguousLatest(gatewayEvents)) return finish(base, 'unverified', 'Conflicting gateway snapshots have no established relative order.', [activated, ...gatewayEvents]);
  if (activated && snapshot && Number.isInteger(activated.seq) && Number.isInteger(snapshot.data.protectedAction.seq) && activated.seq !== snapshot.data.protectedAction.seq) return finish(base, 'unverified', 'The activation event and gateway record disagree about execution order.', [activated, snapshot]);
  const waiver = validWaiver(events, policy, boundary);
  if (waiver) return finish(base, 'waived', `Authorized exception by ${waiver.data.approvedBy}: ${waiver.data.reason}`, [waiver, activated, snapshot]);
  const checks = sourceEvents(events, policy.expectedAction || 'access_guardrail_evaluated', policy.evidenceSource || 'authorization_service').filter(e => e.data.policyId === policy.id && e.data.policyVersion === policy.version && e.data.result === 'allow');
  const direct = checks.find(e => before(e, boundary) === true);
  const actions = snapshot?.data.actions;
  const relevant = Array.isArray(actions) ? actions.filter(a => a && a.action === (policy.expectedAction || 'access_guardrail_evaluated') && a.policyId === policy.id && a.policyVersion === policy.version && a.result === 'allow') : [];
  if (direct && snapshot?.data.complete === true && (!Array.isArray(actions) || !relevant.some(a => a.eventId === direct.id && time(a.at) === time(direct.at)))) return finish(base, 'unverified', 'The authorization event and complete gateway record conflict. Resolve the inconsistent evidence before accounting for this obligation.', [direct, snapshot, activated]);
  if (direct) return finish(base, 'fulfilled', 'An authorized allow decision preceded account activation under the recorded policy version.', [direct, activated, snapshot]);
  const recoverable = relevant.find(a => before(a, boundary) === true && time(a.at) >= time(run.startedAt));
  if (recoverable) return finish(base, 'fulfilled', 'The gateway decision record confirms a pre-activation allow decision, even though its application event is unavailable.', [snapshot, activated], { telemetryDiscrepancy: true });
  if (checks.some(e => before(e, boundary) === null) || relevant.some(a => before(a, boundary) === null)) return finish(base, 'unverified', 'A matching check exists, but the available timestamps do not establish whether it preceded activation.', [snapshot, activated, ...checks]);
  if (snapshot?.data.complete === true && Array.isArray(actions)) {
    const malformed = actions.some(a => !a || !str(a.action) || !Number.isFinite(time(a.at)) || time(a.at) < time(run.startedAt) || time(a.at) > time(snapshot.at));
    if (malformed) return finish(base, 'unverified', 'The declared complete gateway record contains invalid action evidence.', [snapshot, activated]);
    const late = [...checks, ...relevant].some(a => before(a, boundary) === false);
    return finish(base, 'missed', late ? 'The required allow decision occurred after activation. Later evidence cannot satisfy the original ordering constraint.' : 'A complete gateway decision record shows that activation proceeded without the required pre-activation allow decision.', [snapshot, activated, ...checks]);
  }
  return finish(base, 'unverified', 'Activation succeeded, but the observation boundary is incomplete. Missing logs do not prove the check was omitted.', [snapshot, activated]);
}
function resilienceReceipt(run, policy, base, events, now) {
  const activation = getActivation(events);
  const attempts = sourceEvents(events, 'identity_attempt', policy.evidenceSource || 'identity_gateway');
  const boundaries = sourceEvents(events, 'identity_boundary', policy.evidenceSource || 'identity_gateway');
  const boundary = boundaries[boundaries.length - 1];
  if (ambiguousLatest(boundaries)) return finish(base, 'unverified', 'Conflicting identity snapshots have no established relative order.', boundaries, { due: Boolean(activation), fallbackEligible: true });
  if (boundary?.data.eligible === false) return finish(base, 'not_applicable', 'This execution did not require identity verification.', [boundary], { applicable: false });
  if (!attempts.length && !boundary && !activation) return run.outcome === 'success' && atOrBefore(run.completedAt, now) ? finish(base, 'unverified', 'The workflow reports success without trustworthy identity evidence.', [], { due: true, dueAt: run.completedAt }) : finish(base, 'pending', 'The identity step has not started; the workflow remains open.');
  base = { ...base, due: Boolean(activation), dueAt: activation?.at };
  const beforeActivation = item => !activation || before(item, activation) === true;
  const recorded = Array.isArray(boundary?.data.attempts) ? boundary.data.attempts.filter(a => a && ['primary', 'fallback'].includes(a.provider) && ['verified', 'timeout', 'failed'].includes(a.status) && Number.isFinite(time(a.at)) && time(a.at) >= time(run.startedAt) && time(a.at) <= time(boundary.at)).sort(eventOrder) : [];
  const observed = [...attempts.filter(e => ['primary', 'fallback'].includes(e.data.provider)).map(e => ({ ...e.data, at: e.at, seq: e.seq, eventId: e.id })), ...recorded].sort(eventOrder);
  const successful = observed.filter(a => a.status === 'verified' && beforeActivation(a));
  const verified = successful[0];
  const degraded = observed.some(a => a.provider === 'primary' && ['timeout', 'failed'].includes(a.status));
  if (verified) {
    const providerAmbiguous = successful.some(a => a.provider !== verified.provider && eventOrder(a, verified) === 0);
    const rescued = !providerAmbiguous && verified.provider === 'fallback' && observed.some(a => a.provider === 'primary' && ['timeout', 'failed'].includes(a.status) && before(a, verified) === true);
    if (providerAmbiguous) return finish(base, 'fulfilled', 'Identity was verified before activation, but tied provider evidence cannot establish whether fallback was required.', [...attempts, boundary, activation], { rescued: false, execution: degraded ? 'degraded' : 'healthy', fallbackEligible: true, primaryDegraded: degraded, recoveryUnverified: true });
    return finish(base, 'fulfilled', rescued ? 'The primary identity provider timed out. The fallback verified the customer and preserved the successful outcome.' : 'Identity verification completed before activation.', [...attempts, boundary, activation], { rescued, execution: rescued ? 'rescued' : degraded ? 'degraded' : 'healthy', fallbackEligible: true, primaryDegraded: degraded });
  }
  if (!activation) return finish(base, 'pending', 'Identity verification has not completed; activation has not been observed.', [...attempts, boundary], { execution: degraded ? 'degraded' : 'healthy', fallbackEligible: true });
  if (boundary?.data.complete === true) return finish(base, 'missed', 'The complete identity boundary contains no successful verification before activation.', [...attempts, boundary, activation], { execution: degraded ? 'degraded' : 'healthy', fallbackEligible: true });
  return finish(base, 'unverified', 'Identity evidence is insufficient to establish a successful pre-activation verification.', [...attempts, boundary, activation], { execution: degraded ? 'degraded' : 'healthy', fallbackEligible: true });
}
function priorityReceipt(run, policy, base, events) {
  const decisions = sourceEvents(events, 'scheduling_decision', policy.evidenceSource || 'priority_queue');
  const decision = decisions[decisions.length - 1];
  if (ambiguousLatest(decisions)) return finish(base, 'unverified', 'Conflicting scheduling decisions have no established relative order.', decisions, { due: true });
  if (!decision || decision.data.capacityConstrained !== true) return finish(base, 'not_applicable', 'No capacity-constrained scheduling decision was recorded in this workflow.', [], { applicable: false });
  base = { ...base, due: true, dueAt: decision.at, assumptions: ['Candidate feasibility and eligibility are accurately declared.', 'Value estimates and effort units are comparable.', 'Unrecorded constraints may change the decision; this is an advisory finding.'] };
  const data = decision.data;
  if (data.complete !== true || !Array.isArray(data.candidates)) return finish(base, 'unverified', 'The queue snapshot does not establish the full eligible decision set.', [decision]);
  const exception = data.exception;
  if (exception && exception.authorized === true && (policy.authorizedApprovers || []).includes(exception.approvedBy) && str(exception.reason) && exception.policyId === policy.id && exception.policyVersion === policy.version && exception.workflowId === run.id) return finish(base, 'waived', `Authorized scheduling exception: ${exception.reason}`, [decision]);
  if (data.candidates.some(c => !c || typeof c !== 'object')) return finish(base, 'unverified', 'The queue snapshot contains invalid candidate evidence.', [decision]);
  const selected = data.candidates.find(c => c.id === data.selectedId);
  if (!selected || !finite(selected.value) || !finite(selected.effort) || Number(selected.effort) <= 0 || selected.eligible !== true || selected.feasible !== true) return finish(base, 'unverified', 'The selected task lacks sufficient comparable feasibility or value evidence.', [decision]);
  const comparable = data.candidates.filter(c => c.eligible === true && c.feasible === true && c.risk === selected.risk && c.urgent === selected.urgent && finite(c.value) && finite(c.effort) && Number(c.effort) > 0);
  const selectedScore = Number(selected.value) / Number(selected.effort);
  const deferred = comparable.filter(c => Number(c.value) / Number(c.effort) > selectedScore);
  if (deferred.length) return finish(base, 'missed', `Under the declared policy, ${deferred.length} feasible higher-value request${deferred.length > 1 ? 's were' : ' was'} deferred while lower-ranked work was selected. Review possible unrecorded constraints.`, [decision], { advisory: true, deferredCount: deferred.length, selectedId: selected.id, deferredIds: deferred.map(c => c.id) });
  return finish(base, 'fulfilled', 'No comparable feasible candidate outranked the selected request under the declared decision rule.', [decision], { advisory: true, deferredCount: 0 });
}
function progressReceipt(run, policy, base, events) {
  const snapshots = sourceEvents(events, 'workflow_snapshot', policy.evidenceSource || 'workflow_orchestrator');
  const snapshot = snapshots[snapshots.length - 1];
  if (ambiguousLatest(snapshots)) return finish(base, 'unverified', 'Conflicting workflow snapshots have no established relative order.', snapshots);
  if (!snapshot || snapshot.data.complete !== true) return finish(base, 'unverified', 'The available dependency model is incomplete; reachability cannot be established.', [snapshot]);
  const result = analyzeProgress(snapshot.data.graph);
  if (!result.valid) return finish(base, 'unverified', result.reason, [snapshot]);
  return finish(base, result.reachable ? 'fulfilled' : 'missed', result.reason, [snapshot], { due: true, blocked: result.blocked, analysis: result, assumptions: ['Reachability is limited to the declared monotonic resource model.', 'External resources or transitions not in this snapshot may change the conclusion.'] });
}

/** Historical expectations are evaluated against their execution-time policy snapshot. */
export function reconcile(run, policies = DEFAULT_POLICIES, now) {
  if (!run || !str(run.id) || !Array.isArray(run.events)) throw new Error('A run requires an id and an events array.');
  const evaluatedAt = now === undefined ? Math.max(Date.now(), time(run.observedAt || run.completedAt) || 0) : time(now);
  if (!Number.isFinite(evaluatedAt)) throw new Error('The reconciliation time is invalid.');
  const historical = Array.isArray(run.policySnapshot) ? run.policySnapshot : policies;
  return historical.map(policy => {
    const base = receipt(run, policy);
    if (!active(policy)) return finish(base, 'not_applicable', policy.approved !== true ? 'This proposed rule was not approved when the workflow began.' : 'This policy was disabled when the workflow began.', [], { applicable: false });
    const events = trustedEvents(run, policy, evaluatedAt);
    if (policy.id === 'access-guardrail') return guardrailReceipt(run, policy, base, events, evaluatedAt);
    if (policy.id === 'identity-resilience') return resilienceReceipt(run, policy, base, events, evaluatedAt);
    if (policy.id === 'priority-policy') return priorityReceipt(run, policy, base, events);
    if (policy.id === 'workflow-progress') return progressReceipt(run, policy, base, events);
    return finish(base, 'unverified', 'No deterministic evaluator is registered for this approved policy.');
  });
}

export function summarize(runs = []) {
  const states = Object.fromEntries(STATUSES.map(s => [s, 0]));
  const receipts = runs.flatMap(run => Array.isArray(run.receipts) ? run.receipts : reconcile(run));
  for (const item of receipts) if (Object.hasOwn(states, item.status)) states[item.status]++;
  const obligations = receipts.filter(r => r.kind === 'mandatory' && r.applicable !== false && r.status !== 'not_applicable' && r.due === true);
  const missedObligations = obligations.filter(r => r.status === 'missed').length;
  const unverifiedObligations = obligations.filter(r => r.status === 'unverified').length;
  const fallbackEligibleRuns = runs.filter(run => run.receipts?.some(r => r.kind === 'resilience' && r.fallbackEligible === true)).length;
  const rescuedRuns = runs.filter(run => run.receipts?.some(r => r.rescued === true)).length;
  const durations = runs.filter(r => r.outcome === 'success' && finite(r.durationMs)).map(r => Number(r.durationMs)).sort((a, b) => a - b);
  const successfulRuns = runs.filter(r => r.outcome === 'success').length;
  const pct = (numerator, denominator) => denominator ? +(100 * numerator / denominator).toFixed(1) : 0;
  const applicableOpportunities = receipts.filter(r => r.status !== 'not_applicable').length;
  return { totalRuns: runs.length, successfulRuns, successRate: pct(successfulRuns, runs.length), p95LatencyMs: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : 0, eligibleObligationsDue: obligations.length, missedObligations, unverifiedObligations, obligationMissRate: pct(missedObligations, obligations.length), evidenceGapRate: pct(unverifiedObligations, obligations.length), fallbackEligibleRuns, rescuedRuns, recoveryDependence: pct(rescuedRuns, fallbackEligibleRuns), priorityDeferred: receipts.filter(r => r.kind === 'priority' && r.status === 'missed').reduce((n, r) => n + (r.deferredCount || 0), 0), blockedRuns: runs.filter(r => r.receipts?.some(item => item.kind === 'progress' && item.blocked === true)).length, applicableOpportunities, totalReceipts: receipts.length, states, conservationHolds: applicableOpportunities === states.fulfilled + states.missed + states.waived + states.pending + states.unverified, latencyKind: 'synthetic service clock', denominators: { obligationMissRate: 'Due applicable mandatory obligations', evidenceGapRate: 'Due applicable mandatory obligations', recoveryDependence: 'Requests with an observed eligible identity step', successRate: 'All workflow executions' } };
}
export async function createSeedRuns({ now = Date.now() } = {}) {
  const anchor = time(now);
  if (!Number.isFinite(anchor)) throw new Error('The seed population time is invalid.');
  const sequence = ['healthy', 'healthy', 'telemetry_discrepancy', 'healthy', 'fallback_rescue', 'healthy', 'skipped_guardrail', 'healthy', 'healthy', 'priority_ignored', 'healthy', 'missing_telemetry', 'healthy', 'fallback_rescue', 'healthy', 'priority_exception', 'healthy', 'healthy', 'waived_guardrail', 'healthy', 'fallback_rescue', 'healthy', 'skipped_guardrail', 'healthy', 'healthy', 'priority_ignored', 'healthy', 'fallback_rescue', 'healthy', 'missing_telemetry', 'healthy', 'healthy', 'late_guardrail', 'healthy', 'fallback_rescue', 'healthy', 'priority_ignored', 'healthy', 'deadlock', 'fallback_rescue'];
  const cadenceMs = 330000;
  // Leave a full cadence before the anchor so fresh experiments sort ahead of examples.
  const start = anchor - sequence.length * cadenceMs;
  const customers = ['Meridian Labs', 'Northstar Health', 'Orbit Financial', 'Aperture Systems', 'Juniper Studio', 'Helix Analytics', 'Arcadia Cloud', 'Cinder Research'];
  const runs = [];
  for (let i = 0; i < sequence.length; i++) runs.push(await runScenario(sequence[i], { id: `UC-${String(1041 + i).padStart(4, '0')}`, now: start + i * cadenceMs, customer: customers[i % customers.length] }));
  return runs;
}

/** Importing a workspace rebuilds its receipts; imported derived classifications are ignored. */
export function validateImport(value) {
  if (!value || typeof value !== 'object' || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.runs) || !Array.isArray(value.policies)) throw new Error('Expected an UNCOUNTED workspace export with schemaVersion 1, runs, and policies.');
  if (value.runs.length > 10000) throw new Error('A workspace import may contain at most 10,000 runs.');
  const policies = approvedPolicies(value.policies);
  const ids = new Set();
  const runs = value.runs.map((input, index) => {
    if (!input || !str(input.id) || input.id.length > 200 || ids.has(input.id)) throw new Error(`Run ${index + 1} has a missing, duplicate, or invalid id.`);
    ids.add(input.id);
    if (input.workflowId !== input.id || !str(input.customer) || !str(input.customerTier) || !Number.isFinite(time(input.startedAt)) || !['success', 'blocked', 'pending'].includes(input.outcome) || !Array.isArray(input.events) || input.events.length > 10000 || !Array.isArray(input.policySnapshot)) throw new Error(`Run ${input.id} has an invalid execution envelope.`);
    if (input.completedAt !== null && (!Number.isFinite(time(input.completedAt)) || time(input.completedAt) < time(input.startedAt))) throw new Error(`Run ${input.id} has an invalid completion time.`);
    if (input.outcome !== 'pending' && !input.completedAt) throw new Error(`Run ${input.id} requires a completion time.`);
    if (!finite(input.durationMs) || Number(input.durationMs) < 0) throw new Error(`Run ${input.id} has an invalid duration.`);
    const run = clone(input);
    run.policySnapshot = approvedPolicies(input.policySnapshot);
    const eventIds = new Set();
    for (const event of run.events) {
      if (!event || !str(event.id) || eventIds.has(event.id) || !str(event.type) || !str(event.source) || !Number.isFinite(time(event.at)) || typeof event.authoritative !== 'boolean' || !event.data || typeof event.data !== 'object' || Array.isArray(event.data)) throw new Error(`Run ${run.id} contains an invalid or duplicate event.`);
      eventIds.add(event.id);
      if (event.data.workflowId !== run.id || !event.data.policyVersions || typeof event.data.policyVersions !== 'object') throw new Error(`Run ${run.id} contains an event from another workflow or without policy provenance.`);
    }
    run.receipts = reconcile(run);
    return run;
  });
  return { schemaVersion: SCHEMA_VERSION, policies, runs };
}
