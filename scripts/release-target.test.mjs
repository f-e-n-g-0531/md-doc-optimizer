#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./release-target.mjs', import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), 'release-target-'));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (version) => {
  writeFileSync(join(cwd, 'SKILL.md'), '---\nname: test\nmetadata:\n  version: "' + version + '"\n---\n');
  writeFileSync(join(cwd, 'CHANGELOG.md'), '## ' + version + '\n');
  git('add', '.'); git('commit', '-m', version);
  return git('rev-parse', 'HEAD');
};
const run = (version, event = 'workflow_dispatch') => spawnSync(process.execPath, [script], {
  cwd, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '', INPUT_VERSION: version,
    GITHUB_EVENT_NAME: event, GITHUB_REF_NAME: version },
});
try {
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false'); git('config', 'tag.gpgsign', 'false');
  const old = commit('1.0.0'); git('tag', '-a', 'v1.0.0', '-m', 'old');
  const head = commit('2.0.0');
  for (const [version, event, sha] of [
    ['v1.0.0', 'workflow_dispatch', old], ['v1.0.0', 'push', old],
    ['v2.0.0', 'workflow_dispatch', head], ['', 'workflow_dispatch', old],
  ]) {
    const result = run(version, event);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('sha=' + sha + '\n'));
  }
  for (const [version, event] of [['v9.9.9', 'workflow_dispatch'], ['v2x0x0', 'workflow_dispatch'],
    ['v2.0.0', 'push'], ['--bad', 'workflow_dispatch']]) {
    const result = run(version, event);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
  git('tag', 'v9.0.0');
  assert.equal(run('v9.0.0').status, 1, 'existing tag version must match content');
  writeFileSync(join(cwd, 'CHANGELOG.md'), '## 3.0.0\n');
  git('add', '.'); git('commit', '-m', 'mismatch');
  assert.equal(run('v2.0.0').status, 1, 'changelog mismatch rejected');
  assert.equal(git('tag', '--list', 'v2.0.0'), '', 'resolver never creates tags');
  console.log('release-target self-test: OK (10 scenarios; no release side effects)');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
