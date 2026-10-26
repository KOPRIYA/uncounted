const LEDGER_KEY = 'uncounted-ledger-v1';
const BROWSER_ONLY_KEY = 'uncounted-browser-only';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Derive the app directory from its module URL, independently of hash routes. */
export function storageConfig(moduleUrl) {
  const base = new URL('.', moduleUrl);
  const suffix = base.pathname === '/' ? '' : `:${base.pathname}`;
  return {
    ledgerKey: `${LEDGER_KEY}${suffix}`,
    browserOnlyKey: `${BROWSER_ONLY_KEY}${suffix}`,
    // The bundled local server serves the app at /. Public static hosts have no API.
    discoverLocalServer: base.pathname === '/' && LOOPBACK_HOSTS.has(base.hostname),
  };
}
