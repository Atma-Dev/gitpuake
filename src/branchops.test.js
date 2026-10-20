// node src/branchops.test.js
import assert from 'node:assert/strict'
import { NO_FILTER, logRefs, toggleHidden, toggleSolo, dropActions } from './branchops.js'

assert.deepEqual(logRefs(NO_FILTER), ['--exclude=refs/stash', '--all'])
let f = toggleHidden(NO_FILTER, 'refs/heads/wip')
assert.deepEqual(logRefs(f), ['--exclude=refs/stash', '--exclude=refs/heads/wip', '--all']) // --exclude must precede --all
f = toggleSolo(f, 'refs/heads/main')
assert.deepEqual(logRefs(f), ['--ignore-missing', 'refs/heads/main'])
assert.equal(toggleSolo(f, 'refs/heads/main').solo, '')
f = toggleHidden(f, 'refs/heads/wip') // hiding again unhides; hide/unhide also ends solo
assert.deepEqual(f, NO_FILTER)

const locals = ['main', 'feat']
assert.deepEqual(dropActions('feat', 'main', locals), ['merge', 'rebase'])
assert.deepEqual(dropActions('origin/x', 'main', locals), ['merge']) // a remote branch can't be rebased
assert.deepEqual(dropActions('feat', 'abc123', locals), ['rebase']) // nothing to merge into on a bare commit
assert.deepEqual(dropActions('main', 'main', locals), [])
assert.deepEqual(dropActions('', 'main', locals), [])
console.log('branchops ok')
