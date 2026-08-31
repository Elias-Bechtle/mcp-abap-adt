// The release, as one command: changelogen decides the version and writes the
// changelog; this wrapper then folds server.json into the same release commit.
//
// server.json is the MCP registry manifest and carries the version twice.
// Nothing in changelogen knows the file, which is how it silently sat at 2.0.0
// for four releases - and bumping it by hand ahead of time once produced the
// opposite failure, a manifest pinning an npm version that did not exist yet.
// Syncing it from package.json after changelogen ran, inside the release
// commit, removes both failure modes.
//
// Everything here happens locally before any push, which is what makes the
// amend and the tag move safe.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

function run(command) {
  execSync(command, { stdio: 'inherit' });
}

run('npx changelogen --release --clean');

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(readFileSync('server.json', 'utf8'));

if (manifest.version === version && manifest.packages[0].version === version) {
  console.log(`server.json already at ${version}.`);
} else {
  manifest.version = version;
  manifest.packages[0].version = version;
  writeFileSync('server.json', JSON.stringify(manifest, null, 2) + '\n');

  run('git add server.json');
  run('git commit --amend --no-edit');
  // The amend changed the commit hash, so the tag changelogen just created
  // points at a dropped commit; recreate it the way changelogen does.
  run(`git tag -f -am "v${version}" "v${version}"`);
  console.log(`server.json synced to ${version} inside the release commit.`);
}

console.log('\nReview the release commit and tag, then push and publish yourself.');
