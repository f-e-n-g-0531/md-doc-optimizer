#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./release-target.mjs', import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), 'release-target-'));
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const commit = (version) => {
  writeFileSync(join(cwd, 'SKILL.md'), '---\nname: test\nmetadata:\n  version: "' + version + '"\n---\n');
  writeFileSync(join(cwd, 'CHANGELOG.md'), '## ' + version + '\n');
  git('add', '.'); git('commit', '--allow-empty', '-m', version);
  return git('rev-parse', 'HEAD');
};
const run = (version, event = 'workflow_dispatch', output = '', eventSha = '') => spawnSync(process.execPath, [script], {
  cwd, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, INPUT_VERSION: version,
    GITHUB_EVENT_NAME: event, GITHUB_REF_NAME: version, GITHUB_SHA: eventSha },
});
try {
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false'); git('config', 'tag.gpgsign', 'false');
  for (const version of ['1.9.0', '1.14.1', '1.16.0']) {
    commit(version);
    git('tag', 'v' + version);
    for (const event of ['workflow_dispatch', 'push']) {
      const result = run('v' + version, event);
      assert.equal(result.status, 1, `v${version} cannot run the current release QA`);
      assert.match(result.stderr, /release QA requires v1\.17\.0 or newer/);
      assert.equal(result.stdout, '');
    }
  }
  const legacyDefault = run('');
  assert.equal(legacyDefault.status, 1);
  assert.match(legacyDefault.stderr, /selected v1\.16\.0/);
  assert.equal(legacyDefault.stdout, '');
  const old = commit('1.17.0'); git('tag', '-a', 'v1.17.0', '-m', 'old');
  const head = commit('2.0.0');
  for (const [version, event, sha] of [
    ['v1.17.0', 'workflow_dispatch', old], ['v1.17.0', 'push', old],
    ['v2.0.0', 'workflow_dispatch', head], ['', 'workflow_dispatch', old],
  ]) {
    const result = run(version, event, '', event === 'push' ? git('rev-parse', 'refs/tags/' + version) : '');
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('sha=' + sha + '\n'));
  }
  for (const [eventSha, expected] of [[old, 0], [head, 1], ['', 1]]) {
    const result = run('v1.17.0', 'push', '', eventSha);
    assert.equal(result.status, expected, 'tag push uses the event commit: ' + eventSha);
    if (expected) assert.equal(result.stdout, '');
  }
  for (const [version, event] of [['v9.9.9', 'workflow_dispatch'], ['v2x0x0', 'workflow_dispatch'],
    ['v2.0.0', 'push'], ['--bad', 'workflow_dispatch']]) {
    const result = run(version, event);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
  const eventOriginal = commit('2.1.0');
  git('tag', 'v2.1.0', eventOriginal);
  assert.match(run('v2.1.0', 'push', '', eventOriginal).stdout, new RegExp('sha=' + eventOriginal));
  git('commit', '--allow-empty', '-m', 'same version at another commit');
  const changedTip = git('rev-parse', 'HEAD');
  git('tag', '--force', 'v2.1.0', changedTip);
  const moved = run('v2.1.0', 'push', '', eventOriginal);
  assert.equal(moved.status, 1);
  assert.match(moved.stderr, /pushed tag no longer matches the event commit/);
  assert.equal(moved.stdout, '');
  const manualMoved = run('v2.1.0');
  assert.equal(manualMoved.status, 0, manualMoved.stderr);
  assert.match(manualMoved.stdout, new RegExp('sha=' + changedTip));

  const ciOutput = join(cwd, '.git', 'test-ci-output');
  for (const file of ['SKILL.md', 'CHANGELOG.md']) {
    commit('2.0.0');
    const path = join(cwd, file);
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from([0xff])]));
    git('add', file); git('commit', '-m', 'invalid UTF-8 in ' + file);
    writeFileSync(ciOutput, 'sentinel\n');
    const result = run('v2.0.0', 'workflow_dispatch', ciOutput);
    assert.equal(result.status, 1, file + ' must be valid UTF-8');
    assert.ok(result.stderr.includes('invalid UTF-8 in ' + file), result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(readFileSync(ciOutput, 'utf8'), 'sentinel\n');
  }
  commit('2.0.0');
  const skillPath = join(cwd, 'SKILL.md');
  writeFileSync(skillPath, '\n' + readFileSync(skillPath, 'utf8'));
  git('add', 'SKILL.md'); git('commit', '-m', 'frontmatter not at file start');
  const misplaced = run('v2.0.0');
  assert.equal(misplaced.status, 1, 'leading blank line cannot be trimmed before frontmatter validation');
  assert.equal(misplaced.stdout, '');
  commit('2.0.0');
  for (const file of ['SKILL.md', 'CHANGELOG.md']) {
    const path = join(cwd, file);
    writeFileSync(path, '\uFEFF' + readFileSync(path, 'utf8').replace(/\n/g, '\r\n') + '\r\n标题 � 😀\r\n');
  }
  git('add', '.'); git('commit', '-m', 'valid UTF-8 BOM and CRLF');
  assert.equal(run('v2.0.0').status, 0, 'valid UTF-8 BOM and CRLF remain accepted');
  git('tag', 'v9.0.0');
  assert.equal(run('v9.0.0').status, 1, 'existing tag version must match content');
  writeFileSync(join(cwd, 'CHANGELOG.md'), '## 3.0.0\n');
  git('add', '.'); git('commit', '-m', 'mismatch');
  assert.equal(run('v2.0.0').status, 1, 'changelog mismatch rejected');
  assert.equal(git('tag', '--list', 'v2.0.0'), '', 'resolver never creates tags');
  for (const suffix of ['-rc.1', '+build.1', '.1']) {
    writeFileSync(join(cwd, 'CHANGELOG.md'), '## 2.0.0' + suffix + '\n\n## 2.0.0\n');
    git('add', '.'); git('commit', '-m', 'different latest heading ' + suffix);
    const result = run('v2.0.0');
    assert.equal(result.status, 1, 'latest heading must match the whole version: ' + suffix);
    assert.match(result.stderr, /release version does not match/);
    assert.equal(result.stdout, '');
  }
  for (const [name, example] of [
    ['backtick fence', ['````markdown', '## 9.0.0', '```', '## 9.1.0', '`````']],
    ['tilde fence', ['~~~ markdown', '## 9.0.0', '~~~ not a closer', '## 9.1.0', '~~~']],
    ['HTML comment', ['<!-- example', '## 9.0.0', '~~~', '-->']],
    ['inline comment before a heading', ['<!-- example -->']],
  ]) {
    writeFileSync(join(cwd, 'CHANGELOG.md'), [...example, '## 2.0.0 (2026-11-17)', ''].join('\r\n'));
    git('add', '.'); git('commit', '-m', name);
    const result = run('v2.0.0');
    assert.equal(result.status, 0, name + ': ' + result.stderr);
    assert.equal(result.stdout, 'version=v2.0.0\nsha=' + git('rev-parse', 'HEAD') + '\n');
  }
  writeFileSync(join(cwd, 'CHANGELOG.md'), '## 2.0.0\n');
  writeFileSync(join(cwd, 'SKILL.md'), '---\nname: test\nother:\n  version: "2.0.0"\nmetadata:\n  author: Test\n---\n');
  git('add', '.'); git('commit', '-m', 'version outside metadata');
  assert.equal(run('v2.0.0').status, 1, 'unrelated version cannot authorize a release');
  writeFileSync(join(cwd, 'SKILL.md'), '---\nname: test\nmetadata:\n  version: "2.0.0"\n"metadata": {}\n---\n');
  git('add', 'SKILL.md'); git('commit', '-m', 'ambiguous release metadata');
  writeFileSync(ciOutput, 'sentinel\n');
  const ambiguous = run('v2.0.0', 'workflow_dispatch', ciOutput);
  assert.equal(ambiguous.status, 1, 'duplicate top-level metadata cannot authorize a release');
  assert.equal(ambiguous.stdout, '');
  assert.equal(readFileSync(ciOutput, 'utf8'), 'sentinel\n');
  writeFileSync(join(cwd, 'SKILL.md'), '---\nname: test\nmetadata:\n  version: "2.0.0"\n  "version": "9.0.0"\n---\n');
  git('add', 'SKILL.md'); git('commit', '-m', 'duplicate direct release version');
  const duplicateVersion = run('v2.0.0', 'workflow_dispatch', ciOutput);
  assert.equal(duplicateVersion.status, 1, 'duplicate direct version cannot authorize a release');
  assert.equal(duplicateVersion.stdout, '');
  assert.equal(readFileSync(ciOutput, 'utf8'), 'sentinel\n');
  console.log('release-target self-test: OK (37 scenarios; no release side effects)');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
