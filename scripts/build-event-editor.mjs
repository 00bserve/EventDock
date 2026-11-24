import { build } from 'esbuild';
import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const packagedEditor = fileURLToPath(new URL('../src/renderer/eventDock/editor.bundle.js', import.meta.url));

export async function buildEventEditor(outfile = packagedEditor) {
  const { outputFiles } = await build({
    entryPoints: ['src/renderer/eventDock/editor.js'],
    outfile,
    write: false,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome130',
    minify: true,
  });
  const output = Buffer.from(outputFiles[0].contents);
  const existing = await readFile(outfile).catch(error => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (!existing?.equals(output)) await writeFile(outfile, output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildEventEditor();
}
