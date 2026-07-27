// Fails the release when a push adds a CHANGELOG section numbered for a
// different version than the one actually being published.
//
// Why this exists: the version is computed from the latest published release,
// so a section written as `## 0.1.19` goes stale the moment someone else
// releases first. release-notes.js then finds no matching section, quietly sets
// has_notes=false, and the release ships with auto-generated commit notes - the
// curated text is silently dropped and nobody notices until a user reads the
// in-app "What's new". That happened to v0.1.20.
//
// Only pushes that *add* a `## <version>` heading are checked, so purely
// internal pushes (CI, refactors, docs) still release with fallback notes as
// intended.
//
// Usage: node .github/scripts/check-changelog.js <version>
const { execSync } = require('node:child_process')

const version = (process.argv[2] || '').replace(/^v/, '').trim()
if (!version) {
  console.error('check-changelog: no version argument')
  process.exit(1)
}

let diff
try {
  diff = execSync('git diff HEAD~1 HEAD -- CHANGELOG.md', { encoding: 'utf8' })
} catch {
  // Shallow clone or the very first commit - nothing to compare against.
  console.log('check-changelog: no previous commit to diff, skipping')
  process.exit(0)
}

// Added heading lines only: "+## 1.2.3 — 2026-01-01".
const added = [...diff.matchAll(/^\+##\s+v?(\d+\.\d+\.\d+)/gm)].map((m) => m[1])

if (added.length === 0) {
  console.log('check-changelog: this push adds no CHANGELOG section, nothing to verify')
  process.exit(0)
}

if (added.includes(version)) {
  console.log(`check-changelog: CHANGELOG section ${version} matches the release being published`)
  process.exit(0)
}

console.error(
  [
    '',
    `This push adds a CHANGELOG section for ${added.join(', ')},`,
    `but the release being published is ${version}.`,
    '',
    'The version comes from the latest published release, patch-bumped, so an',
    'entry written earlier goes stale as soon as someone else releases first.',
    'Left alone, this release would ship with auto-generated commit notes and',
    'your text would never reach the in-app "What\'s new".',
    '',
    `Fix: rename the heading in CHANGELOG.md to "## ${version} — <date>" and push again.`,
    ''
  ].join('\n')
)
process.exit(1)
