import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createAppServer } from '../server.mjs';

const emptyState = () => ({ schemaVersion: 1, runs: [], policies: [] });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'uncounted-server-test-'));
  const distDir = join(root, 'dist');
  const dataDir = join(root, 'data');
  await mkdir(distDir);
  await writeFile(join(distDir, 'index.html'), '<!doctype html><title>UNCOUNTED test</title>');
  await writeFile(join(root, 'private.txt'), 'never serve this private marker');
  const servers = [];
  const start = async () => {
    const server = await createAppServer({ distDir, dataDir, initialState: emptyState });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    servers.push(server);
    return { server, url: `http://127.0.0.1:${server.address().port}` };
  };
  t.after(async () => {
    for (const server of servers) {
      server.closeAllConnections?.();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    }
    await rm(root, { recursive: true, force: true });
  });
  return { start, ...(await start()) };
}

test('server serves app and reports server mode', async t => {
  const { url } = await fixture(t);
  const app = await fetch(url);
  assert.equal(app.status, 200);
  assert.match(await app.text(), /UNCOUNTED test/);
  const health = await fetch(`${url}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).mode, 'server');
});

test('state survives a server restart', async t => {
  const { url, server, start } = await fixture(t);
  const initial = await (await fetch(`${url}/api/state`)).json();
  assert.deepEqual(initial.runs, []);
  const state = { ...emptyState(), activity: [{ id: 'independent-save', text: 'Persistence test' }] };
  const save = await fetch(`${url}/api/state`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state),
  });
  assert.ok(save.ok, `save returned ${save.status}`);
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  const restarted = await start();
  const loaded = await (await fetch(`${restarted.url}/api/state`)).json();
  assert.deepEqual(loaded.activity, state.activity);
});

test('invalid JSON and invalid state cannot overwrite saved data', async t => {
  const { url } = await fixture(t);
  const before = await (await fetch(`${url}/api/state`)).json();
  for (const body of ['{"runs":', JSON.stringify({ schemaVersion: 1, runs: 'invalid', policies: [] })]) {
    const response = await fetch(`${url}/api/state`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    assert.equal(response.status, 400);
  }
  assert.deepEqual(await (await fetch(`${url}/api/state`)).json(), before);
});

test('encoded traversal cannot read files outside the static root', async t => {
  const { url } = await fixture(t);
  for (const path of ['/..%2fprivate.txt', '/%2e%2e/private.txt', '/%2e%2e%2fprivate.txt']) {
    const response = await new Promise((resolve, reject) => {
      http.get(new URL(url).origin + path, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on('error', reject);
    });
    assert.doesNotMatch(response.body, /never serve this private marker/);
    assert.notEqual(response.status, 500);
  }
});
