import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = join(root, 'packages', 'company-discord-setup');
const output = join(root, 'setup-artifacts');
mkdirSync(output, { recursive: true });
// Windows PowerShell 5 needs a BOM to read the Japanese messages correctly.
const script = readFileSync(join(root, 'scripts', 'employee-codex-setup.ps1'), 'utf8').replace(/^\uFEFF/, '');
writeFileSync(join(dir, 'codex-setup.ps1'), '\uFEFF' + script);
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script via npm run pack:setup.');
const packed = spawnSync(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', output], { cwd: dir, encoding: 'utf8' });
if (packed.status !== 0) throw new Error(packed.stderr || 'npm pack failed');
const [info] = JSON.parse(packed.stdout);
const allowed = new Set(['package.json', 'README.md', 'bin/cli.mjs', 'codex-setup.ps1']);
if (info.files.some(file => !allowed.has(file.path))) throw new Error('Unexpected file in setup package.');
const archive = join(output, 'company-discord-setup.tgz');
renameSync(join(output, info.filename), archive);
console.log(archive);
