#!/usr/bin/env node
// Resolve and validate a release target without changing tags or the worktree.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { skillFrontmatter, metadataVersion, latestChangelogVersion } from './skill-version.mjs';
import { decodeUtf8 } from './pre-scan.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function readCommitText(sha, file) {
  // Keep the committed bytes intact until UTF-8 and document structure are checked.
  const bytes = execFileSync('git', ['cat-file', 'blob', sha + ':' + file], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    return decodeUtf8(bytes);
  } catch {
    throw new Error('invalid UTF-8 in ' + file + ' at ' + sha);
  }
}
try {
  const version = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'
    ? (process.env.INPUT_VERSION || git('describe', '--tags', '--abbrev=0'))
    : process.env.GITHUB_REF_NAME;
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(version || '')) {
    throw new Error('version must look like vX.Y.Z');
  }
  const [major, minor] = version.slice(1).split('.').map(Number);
  // The caller's QA invokes --report-out and gates link-outside-root on the target checkout.
  // Both are supported starting with v1.17.0; do not weaken QA for older tags.
  if (major < 1 || (major === 1 && minor < 17)) {
    throw new Error('release QA requires v1.17.0 or newer; selected ' + version);
  }
  const tags = git('tag', '--list', version);
  if (!tags && process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('pushed tag does not exist: ' + version);
  }
  const sha = git('rev-parse', '--verify', tags ? 'refs/tags/' + version + '^{commit}' : 'HEAD^{commit}');
  if (process.env.GITHUB_EVENT_NAME === 'push') {
    const eventSha = process.env.GITHUB_SHA ?? '';
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(eventSha)) {
      throw new Error('tag push requires a valid GITHUB_SHA');
    }
    const eventCommit = git('rev-parse', '--verify', eventSha + '^{commit}');
    if (eventCommit !== sha) throw new Error('pushed tag no longer matches the event commit: ' + version);
  }
  const skill = readCommitText(sha, 'SKILL.md');
  const declared = metadataVersion(skillFrontmatter(skill));
  const latest = latestChangelogVersion(readCommitText(sha, 'CHANGELOG.md'));
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
