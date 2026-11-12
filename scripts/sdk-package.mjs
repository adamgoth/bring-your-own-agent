import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const sdk = join(root, 'byoa-extension/sdk');
const scratch = mkdtempSync(join(tmpdir(), 'byoa-package-'));
const env = { ...process.env, npm_config_cache: join(scratch, 'npm-cache') };
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit', env });
try {
  run('pnpm', ['run', 'build'], sdk);
  const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', scratch], { cwd: sdk, encoding: 'utf8', env }))[0];
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(scratch, packed.filename)], scratch);
  writeFileSync(join(scratch, 'consumer.ts'), `import { byoa, agentboard, createClient, discoverProviders, type AgentProvider, type TaskEvent } from '@byoagent/browser';\nconst providers = await discoverProviders();\nconst provider: AgentProvider | undefined = providers[0]?.provider;\nconst client = createClient(provider);\nconst event: TaskEvent | null = await client.getTask('synthetic-task');\nvoid [byoa, agentboard, event, client.listTasks(), client.providers()];\n`);
  run(resolve(root, 'byoa-extension/node_modules/.bin/tsc'), ['--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--lib', 'ES2022,DOM', 'consumer.ts'], scratch);
  run('node', ['--input-type=module', '-e', "Object.defineProperty(globalThis,'window',{get(){throw Error('window accessed during SSR import')}}); const sdk = await import('@byoagent/browser'); if(sdk.byoa !== sdk.agentboard) throw Error('alias'); console.log('Packed consumer and SSR import passed');"], scratch);
  if (process.argv.includes('--keep')) console.log(`Tarball: ${join(scratch, packed.filename)}`);
} finally { if (!process.argv.includes('--keep')) rmSync(scratch, { recursive: true, force: true }); }
