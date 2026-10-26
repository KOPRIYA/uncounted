import test from 'node:test';
import assert from 'node:assert/strict';
import { storageConfig } from '../dist/storage-config.js';

test('GitHub Pages project apps keep separate ledgers and browser-only preferences', () => {
  const project = storageConfig('https://kopriya.github.io/uncounted/app.js');
  const other = storageConfig('https://kopriya.github.io/another-app/app.js');
  const root = storageConfig('https://kopriya.github.io/app.js');
  assert.equal(project.ledgerKey, 'uncounted-ledger-v1:/uncounted/');
  assert.notEqual(project.ledgerKey, other.ledgerKey);
  assert.notEqual(project.ledgerKey, root.ledgerKey);
  assert.notEqual(project.browserOnlyKey, other.browserOnlyKey);
  assert.equal(project.discoverLocalServer, false);
  assert.equal(root.discoverLocalServer, false);
});

test('root deployments retain existing keys without importing a shared key into project apps', () => {
  const local = storageConfig('http://127.0.0.1:4173/app.js');
  assert.equal(local.ledgerKey, 'uncounted-ledger-v1');
  assert.equal(local.browserOnlyKey, 'uncounted-browser-only');
  assert.equal(local.discoverLocalServer, true);
  const project = storageConfig('http://127.0.0.1:4173/uncounted/app.js');
  assert.notEqual(project.ledgerKey, local.ledgerKey);
  assert.equal(project.discoverLocalServer, false);
});

test('only exact loopback hosts at the root discover the local API', () => {
  for (const origin of ['http://localhost:4173', 'http://127.0.0.1:4173', 'http://[::1]:4173']) {
    assert.equal(storageConfig(`${origin}/app.js`).discoverLocalServer, true, origin);
  }
  for (const origin of ['https://example.com', 'https://localhost.example.com', 'https://127.0.0.1.example.com']) {
    assert.equal(storageConfig(`${origin}/app.js`).discoverLocalServer, false, origin);
  }
});

test('nested deployment directories have stable keys across script query strings', () => {
  assert.deepEqual(
    storageConfig('https://example.com/projects/uncounted/app.js?v=2'),
    storageConfig('https://example.com/projects/uncounted/app.js'),
  );
  assert.equal(storageConfig('https://example.com/projects/uncounted/app.js').ledgerKey,
    'uncounted-ledger-v1:/projects/uncounted/');
});
