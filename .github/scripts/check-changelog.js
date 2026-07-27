// Fails the release when a push writes CHANGELOG notes under a heading
// numbered for a different version than the one actually being published.
//
// Why this exists: the version is computed from the latest published release,
// so a section written as `## 0.1.19` goes stale the moment someone else
// releases first. release-notes.js then finds no matching section, quietly sets
// has_notes=false, and the release ships with auto-generated commit notes - the
// curated text is dropped without a word. That happened three times in a row
// (Y2K, telemetry, the iteo themes).
//
// Two kinds of push are deliberately let through:
//   - one that adds no heading at all: internal changes (CI, refactors, docs)
//     are meant to fall back to generated notes
//   - one that only renumbers existing headings: renaming `## 0.1.15` to
//     `## 0.1.17` to match the tag it really shipped under is a correction to
//     history, not an entry for this release. It is told apart by the diff
//     carrying no new body text - a rename touches the heading line and nothing
//     else, while a real entry brings bullets with it.
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

// Added lines only, minus the `+++ b/CHANGELOG.md` file header.
const addedLines = diff
  .split('\n')
  .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
  .map((l) => l.slice(1))

const addedHeadings = addedLines
  .map((l) => /^##\s+v?(\d+\.\d+\.\d+)/.exec(l))
  .filter(Boolean)
  .map((m) => m[1])

if (addedHeadings.length === 0) {
  console.log('check-changelog: this push adds no CHANGELOG section, nothing to verify')
  process.exit(0)
}

const addedBody = addedLines.filter((l) => l.trim() !== '' && !/^##\s/.test(l))
if (addedBody.length === 0) {
  console.log(
    `check-changelog: only renumbered headings (${addedHeadings.join(', ')}), no new notes, skipping`
  )
  process.exit(0)
}

if (addedHeadings.includes(version)) {
  console.log(`check-changelog: CHANGELOG section ${version} matches the release being published`)
  process.exit(0)
}

console.error(
  [
    '',
    `This push adds CHANGELOG notes under ${addedHeadings.join(', ')},`,
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
