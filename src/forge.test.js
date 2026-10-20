// node src/forge.test.js
import assert from 'node:assert/strict'
import { parseRemote, issueBranch, splitDiff, cliError } from './forge.js'

const r = u => { const p = parseRemote(u); return p && [p.forge, p.host, p.path].join(' ') }
assert.equal(r('git@github.com:owner/repo.git'), 'github github.com owner/repo')
assert.equal(r('https://github.com/owner/repo'), 'github github.com owner/repo')
assert.equal(r('ssh://git@gitlab.example.com:2222/group/sub/repo.git'), 'gitlab gitlab.example.com group/sub/repo')
assert.equal(r('https://gitlab.com/group/repo.git/'), 'gitlab gitlab.com group/repo')
assert.equal(r('https://user@bitbucket.org/ws/repo.git'), 'bitbucket bitbucket.org ws/repo')
assert.equal(r('git@bitbucket.org:ws/repo.git'), 'bitbucket bitbucket.org ws/repo')
assert.equal(r('https://example.com/a/b.git'), ' example.com a/b')
assert.equal(r('/home/me/repo'), null)
assert.equal(parseRemote('file:///home/me/repo').forge, null)

assert.equal(issueBranch(42, 'Fix: crash on ünïcode title!'), '42-fix-crash-on-unicode-title')
assert.equal(issueBranch(7, '!!!'), '7')
assert.ok(!issueBranch(1, 'a '.repeat(40)).endsWith('-'))

const files = splitDiff('diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1 @@\n-a\n+b\ndiff --git a/old.txt b/old.txt\ndeleted file mode 100644\n--- a/old.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n')
assert.deepEqual(files.map(f => f.path), ['x.js', 'old.txt'])
assert.ok(files[0].text.endsWith('+b\n'))

assert.equal(cliError('gh: No such file or directory (os error 2)', 'gh'), 'missing')
assert.equal(cliError('To get started with GitHub CLI, please run:  gh auth login', 'gh'), 'auth')
assert.equal(cliError('boom', 'glab'), 'boom')
console.log('forge ok')
