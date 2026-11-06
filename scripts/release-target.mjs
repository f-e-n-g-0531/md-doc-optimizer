#!/usr/bin/env node
// Resolve and validate a release target without changing tags or the worktree.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
try {
  const version = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    ? (process.env.INPUT_VERSION || git('describe', '--tags', '--abbrev=0'))
    : process.env.GITHUB_REF_NAME;
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(version || '')) {
    throw new Error('version must look like vX.Y.Z');
  }
  const tags = git('tag', '--list', version);
  if (!tags && process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('pushed tag does not exist: ' + version);
  }
  const sha = git('rev-parse', '--verify', tags ? 'refs/tags/' + version + '^{commit}' : 'HEAD^{commit}');
  const skill = git('show', sha + ':SKILL.md');
  const frontmatter = skill.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const declared = frontmatter?.[1].match(/^\s+version:\s*"([^"]+)"/m)?.[1];
  const latest = git('show', sha + ':CHANGELOG.md').match(/^##\s+(\d+\.\d+\.\d+)/m)?.[1];
  if (version !== 'v' + declared || declared !== latest) {
    throw new Error('release version does not match target SKILL.md and CHANGELOG.md');
  }
  const output = 'version=' + version + '\nsha=' + sha + '\n';
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  process.stdout.write(output);
} catch (error) {
  console.error('release-target: ' + error.message);
  process.exitCode = 1;
}
