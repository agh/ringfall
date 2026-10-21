import { spawn } from 'node:child_process';

/**
 * Serves the production build with `vite preview` on `port` and resolves once it answers.
 * `--strictPort` makes a port already in use an error instead of a silent move to the next
 * one (which would leave the script talking to whatever is on the port it asked for). The
 * caller owns the returned process and kills it in a `finally`.
 */
export const startPreview = async (port, { outDir, attempts = 40, interval = 500 } = {}) => {
  const url = `http://127.0.0.1:${port}/`;
  // A server already answering here is a stale preview (a run that died before its `finally`):
  // the new one would exit on --strictPort while the poll below adopts the old one's dist/.
  const occupied = await fetch(url).then(
    () => true,
    () => false,
  );
  if (occupied) {
    throw new Error(`something already answers on ${url}; stop the stale preview first`);
  }
  const args = [
    'exec',
    'vite',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--strictPort',
  ];
  if (outDir) args.push('--outDir', outDir);
  const server = spawn('pnpm', args, { stdio: 'ignore' });
  let exited = false;
  server.once('exit', () => {
    exited = true;
  });
  for (let attempt = 0; attempt < attempts && !exited; attempt += 1) {
    await new Promise((r) => setTimeout(r, interval));
    try {
      const res = await fetch(url);
      if (res.ok) return server;
    } catch {
      // Not up yet.
    }
  }
  server.kill();
  throw new Error(
    exited
      ? `vite preview exited before answering on ${url} (port in use, or no build in dist/?)`
      : `vite preview did not come up on ${url}`,
  );
};
