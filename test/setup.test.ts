import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Setup utilities are standalone ESM so administrators do not need a separate app.
import { updateEnv, loadEnv } from '../scripts/env-file.mjs';
import { employeeFiles } from '../scripts/build-employee-kit.mjs';

test('configuration edits preserve database key and existing secrets without interpolation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discord-setup-')), path = join(dir, '.env');
  try {
    writeFileSync(path, 'DATABASE_KEY=keep-original\nDISCORD_BOT_TOKEN=keep-secret\nDISCORD_GUILD_ID=old\n');
    updateEnv({ DISCORD_GUILD_ID: '1552927906638995466', DISCORD_CLIENT_SECRET: 'abc$&xyz#123' }, path);
    const config = loadEnv(path);
    assert.equal(config.DATABASE_KEY, 'keep-original');
    assert.equal(config.DISCORD_BOT_TOKEN, 'keep-secret');
    assert.equal(config.DISCORD_CLIENT_SECRET, 'abc$&xyz#123');
    assert.equal(config.DISCORD_GUILD_ID, '1552927906638995466');
    assert.throws(() => updateEnv({ DISCORD_BOT_TOKEN: 'unsafe\nINJECTED=x' }, path));
    assert.ok(!readFileSync(path, 'utf8').includes('INJECTED'));
  } finally { unlinkSync(path); rmdirSync(dir); }
});
test('employee bundle contains only client setup and no administrator secret settings', () => {
  const files = employeeFiles('https://mcp.company.test');
  assert.equal(JSON.parse(files['connection.json']).url, 'https://mcp.company.test/mcp');
  assert.equal(JSON.parse(files['claude-mcp.json']).mcpServers['company-discord'].type, 'http');
  const combined = Object.values(files).join('\n');
  assert.ok(!/DISCORD_BOT_TOKEN|DISCORD_CLIENT_SECRET|DATABASE_KEY|Bearer/.test(combined));
  assert.match(files['Codexに接続.cmd'], /codex-setup.ps1/);
  assert.match(files['codex-setup.ps1'], /mcpServerStatus\/list/);
  assert.match(files['register-claude-code.sh'], /--scope user/);
});
test('employee bundle refuses local, placeholder and unsafe shell URLs', () => {
  for (const bad of ['http://localhost:3000', 'https://mcp.example.com', 'https://mcp.company.test/?x=abc', 'https://user:pw@mcp.company.test', 'https://mcp.company.test/a', 'https://mcp.company.test/#x']) assert.throws(() => employeeFiles(bad));
});
