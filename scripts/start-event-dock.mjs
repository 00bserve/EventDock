import { spawn } from 'node:child_process';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electron from 'electron';
import { buildEventEditor } from './build-event-editor.mjs';

const directory = await mkdtemp(join(tmpdir(), 'eventdock-editor-'));
const bundle = join(directory, 'editor.mjs');
try {
  await buildEventEditor(bundle);

  const child = spawn(electron, ['.', ...process.argv.slice(2)], {
    env: { ...process.env, EVENT_DOCK_EDITOR_BUNDLE: bundle },
    stdio: 'inherit',
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} finally {
  await rm(bundle, { force: true });
  await rmdir(directory);
}
