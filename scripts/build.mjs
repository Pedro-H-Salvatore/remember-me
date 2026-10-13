import { mkdirSync, cpSync, writeFileSync, existsSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
for (const dir of ['src', 'public']) cpSync(dir, 'dist/' + dir, { recursive: true });
for (const file of ['package.json', 'package-lock.json', '.env.example'])
  if (existsSync(file)) cpSync(file, 'dist/' + file);
writeFileSync(
  'dist/build.json',
  JSON.stringify({ builtAt: new Date().toISOString(), node: process.version }),
);
console.log('Build disponível em dist/. Sem credenciais ou dados pessoais.');
