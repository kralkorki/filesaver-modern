/**
 * One-shot setup: point the package at a real GitHub owner.
 *
 * Usage:  node setup-remote.js <github-username>
 *
 * Replaces the YOUR_USERNAME placeholders in package.json, README.md and
 * CONTRIBUTING.md, sets the git remote, and rewrites the author fields. It
 * refuses to guess a username, because a wrong one here silently publishes the
 * links under someone else's name.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const username = process.argv[2];

if (!username) {
  console.error('Usage: node setup-remote.js <github-username>');
  process.exit(1);
}

if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(username)) {
  console.error(`"${username}" is not a valid GitHub username.`);
  process.exit(1);
}

const root = __dirname;
const REPO = 'filesaver-modern';
const repoUrl = `https://github.com/${username}/${REPO}.git`;
const htmlUrl = `https://github.com/${username}/${REPO}`;

// Files that carry the placeholder. Kept explicit so a stray doc cannot be
// rewritten by accident.
const targets = ['package.json', 'README.md', 'CONTRIBUTING.md'];

for (const rel of targets) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    console.warn(`skip  ${rel} (not found)`);
    continue;
  }
  const before = fs.readFileSync(file, 'utf8');
  const after = before
    .replaceAll('YOUR_USERNAME', username)
    .replaceAll('filesaver-continuation', REPO);
  if (before === after) {
    console.log(`skip  ${rel} (no placeholders found)`);
  } else {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`ok    ${rel}`);
  }
}

// Commit identity, so the history is attributed correctly.
const email = `${username}@users.noreply.github.com`;
for (const [key, value] of [['user.name', username], ['user.email', email]]) {
  execFileSync('git', ['config', key, value], { cwd: root, stdio: 'ignore' });
}
console.log(`ok    git identity → ${username} <${email}>`);

// Remote. https so the user authenticates with their own credentials.
try {
  execFileSync('git', ['remote', 'remove', 'origin'], { cwd: root, stdio: 'ignore' });
} catch (e) { /* no remote yet — expected on first run */ }
execFileSync('git', ['remote', 'add', 'origin', repoUrl], { cwd: root, stdio: 'ignore' });
console.log(`ok    remote origin → ${repoUrl}`);

// Rewrap the two existing commits so they carry the right author, instead of
// the placeholder identity they were created with.
const { execSync } = require('node:child_process');
try {
  const count = Number(execSync('git rev-list --count HEAD', { cwd: root }).toString().trim());
  if (count > 0) {
    execFileSync('git', ['filter-branch', '-f', '--env-filter',
      `echo "GIT_AUTHOR_NAME=${username}"; echo "GIT_AUTHOR_EMAIL=${email}"; ` +
      `echo "GIT_COMMITTER_NAME=${username}"; echo "GIT_COMMITTER_EMAIL=${email}"`,
      '--', 'HEAD'], { cwd: root, stdio: 'ignore' });
    console.log(`ok    rewrote author on ${count} commit(s)`);
  }
} catch (e) {
  console.warn('warn  could not rewrite commit authors — run this on a fresh clone if the names are wrong');
}

console.log('');
console.log(`Next:`);
console.log(`  1. git add -A && git commit -m "Point repository links at ${username}/${REPO}"`);
console.log(`  2. Create the repo on GitHub as "${REPO}" (public, no README — we have one)`);
console.log(`  3. git push -u origin main`);
console.log(`     When git asks for credentials: username "${username}", password = your personal access token.`);
console.log('');
console.log(`Repo will live at: ${htmlUrl}`);