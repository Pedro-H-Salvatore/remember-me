import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
let failed = false;
for (const dir of ['src', 'public', 'scripts', 'tests'])
  for (const name of readdirSync(dir))
    if (/\.(js|mjs)$/.test(name)) {
      const path = join(dir, name),
        r = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (r.status) {
        console.error(r.stderr);
        failed = true;
      }
      const text = readFileSync(path, 'utf8');
      if (/\bdebugger\s*;/.test(text)) {
        console.error('debugger em ' + path);
        failed = true;
      }
    }
if (failed) process.exit(1);
console.log('Sintaxe e regras básicas verificadas.');
