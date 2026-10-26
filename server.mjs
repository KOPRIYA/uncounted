import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';

const PROJECT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_RUNS = 5000;
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  res.end(JSON.stringify(value));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateState(value, validateImport) {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new RequestError(400, 'State must be an object with schemaVersion: 1.');
  }
  if (!Array.isArray(value.runs) || value.runs.length > MAX_RUNS) {
    throw new RequestError(400, `State must contain a runs array with at most ${MAX_RUNS} runs.`);
  }
  if (!Array.isArray(value.policies)) {
    throw new RequestError(400, 'State must contain a policies array.');
  }
  if (value.activity !== undefined && (!Array.isArray(value.activity) || value.activity.length > 5000)) {
    throw new RequestError(400, 'Activity must be an array with at most 5000 entries.');
  }
  if (value.seededAt !== undefined &&
      (typeof value.seededAt !== 'string' || !Number.isFinite(Date.parse(value.seededAt)))) {
    throw new RequestError(400, 'seededAt must be a valid date string.');
  }
  let normalized;
  try {
    normalized = validateImport(value);
  } catch (error) {
    throw new RequestError(400, `Invalid ledger: ${error.message}`);
  }
  return {
    schemaVersion: 1,
    runs: normalized.runs,
    policies: normalized.policies,
    ...(value.activity !== undefined ? { activity: value.activity } : {}),
    ...(value.seededAt !== undefined ? { seededAt: value.seededAt } : {}),
  };
}

async function readJsonBody(req) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] ?? '')) {
    throw new RequestError(415, 'Use Content-Type: application/json.');
  }
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    req.resume();
    throw new RequestError(413, 'Request exceeds the 8 MB limit.');
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let length = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        reject(new RequestError(413, 'Request exceeds the 8 MB limit.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new RequestError(400, 'Request body is not valid JSON.'));
      }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new RequestError(400, 'Request body was interrupted.')));
  });
}

function assertLocalRequest(req) {
  const host = req.headers.host ?? '';
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    throw new RequestError(403, 'A local Host header is required.');
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostUrl.hostname) || hostUrl.username || hostUrl.password) {
    throw new RequestError(403, 'This server accepts local requests only.');
  }
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== `http://${host}`) {
    throw new RequestError(403, 'Cross-origin requests are not accepted.');
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') {
    throw new RequestError(403, 'Cross-site requests are not accepted.');
  }
}

function insideDirectory(root, filename) {
  const relative = path.relative(root, filename);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function serveStatic(req, res, distDir) {
  let pathname;
  try {
    pathname = decodeURIComponent((req.url ?? '/').split('?')[0]);
  } catch {
    throw new RequestError(400, 'Invalid URL encoding.');
  }
  if (pathname.includes('\0') || pathname.includes('\\') ||
      pathname.split('/').some((segment) => segment === '..' || segment.startsWith('.'))) {
    throw new RequestError(400, 'Invalid file path.');
  }
  if (pathname === '/') pathname = '/index.html';
  const filename = path.resolve(distDir, `.${pathname}`);
  if (!insideDirectory(distDir, filename)) throw new RequestError(403, 'File path is not allowed.');
  let resolvedFile;
  let resolvedRoot;
  try {
    [resolvedFile, resolvedRoot] = await Promise.all([realpath(filename), realpath(distDir)]);
    if (!insideDirectory(resolvedRoot, resolvedFile)) throw new RequestError(403, 'File path is not allowed.');
    if (!(await stat(resolvedFile)).isFile()) throw new RequestError(404, 'File not found.');
  } catch (error) {
    if (error instanceof RequestError) throw error;
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new RequestError(404, 'File not found.');
    throw error;
  }
  const contentType = MIME_TYPES.get(path.extname(resolvedFile).toLowerCase());
  if (!contentType) throw new RequestError(404, 'File type is not served.');
  const content = await readFile(resolvedFile);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': content.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}

/** Create an unbound server. Tests may pass isolated distDir/dataDir and initialState. */
export async function createAppServer({
  distDir = path.join(PROJECT_DIR, 'dist'),
  dataDir = path.join(PROJECT_DIR, 'data'),
  initialState,
} = {}) {
  const { createSeedRuns, DEFAULT_POLICIES, validateImport } = await import('./dist/engine.js');
  distDir = path.resolve(distDir);
  dataDir = path.resolve(dataDir);
  const storePath = path.join(dataDir, 'store.json');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });

  async function persist(value) {
    const temporaryPath = path.join(dataDir, `store.${randomUUID()}.tmp`);
    try {
      const file = await open(temporaryPath, 'wx', 0o600);
      try {
        await file.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporaryPath, storePath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  let state;
  try {
    state = validateState(JSON.parse(await readFile(storePath, 'utf8')), validateImport);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`Cannot load ${storePath}. Existing data was preserved. ${error.message}`, { cause: error });
    }
    const initial = typeof initialState === 'function' ? await initialState() : initialState;
    state = validateState(initial ?? {
      schemaVersion: 1,
      runs: await createSeedRuns(),
      policies: structuredClone(DEFAULT_POLICIES),
      activity: [],
      seededAt: new Date().toISOString(),
    }, validateImport);
    await persist(state);
  }

  let writes = Promise.resolve();
  const server = http.createServer(async (req, res) => {
    try {
      assertLocalRequest(req);
      const pathname = (req.url ?? '/').split('?')[0];
      if (pathname === '/api/health' && req.method === 'GET') {
        json(res, 200, { mode: 'server', schemaVersion: 1 });
        return;
      }
      if (pathname === '/api/state' && req.method === 'GET') {
        await writes;
        json(res, 200, state);
        return;
      }
      if (pathname === '/api/state' && req.method === 'POST') {
        const next = validateState(await readJsonBody(req), validateImport);
        const write = writes.then(async () => {
          await persist(next);
          state = next;
        });
        writes = write.catch(() => {});
        await write;
        json(res, 200, next);
        return;
      }
      if (pathname.startsWith('/api/')) {
        const known = pathname === '/api/health' || pathname === '/api/state';
        if (known) res.setHeader('Allow', pathname === '/api/state' ? 'GET, POST' : 'GET');
        throw new RequestError(known ? 405 : 404, known ? 'Method not allowed.' : 'API route not found.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        throw new RequestError(405, 'Method not allowed.');
      }
      await serveStatic(req, res, distDir);
    } catch (error) {
      if (!res.headersSent && !res.destroyed) {
        json(res, error.status ?? 500, {
          error: error instanceof RequestError ? error.message : 'The request could not be completed.',
        });
      } else if (!res.destroyed) {
        res.end();
      }
      if (!(error instanceof RequestError)) console.error('UNCOUNTED request failed:', error);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT === undefined ? 4173 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('PORT must be an integer from 1 to 65535.');
    process.exitCode = 1;
  } else {
    try {
      const server = await createAppServer();
      server.on('error', (error) => {
        console.error(`UNCOUNTED could not listen on port ${port}: ${error.message}`);
        process.exitCode = 1;
      });
      server.listen(port, '127.0.0.1', () => {
        console.log(`UNCOUNTED is running at http://127.0.0.1:${port}`);
        console.log('Local workspace data is stored in data/store.json. Press Ctrl+C to stop.');
      });
      const shutdown = () => server.close(() => process.exit());
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    } catch (error) {
      console.error(`UNCOUNTED could not start: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
