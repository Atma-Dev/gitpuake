// Graph filter, per repo: { hidden: [full refnames], solo: full refname | '' }.
export const NO_FILTER = { hidden: [], solo: '' }
export const loadFilter = repo => JSON.parse(localStorage.getItem('filter:' + repo) || 'null') ?? NO_FILTER
export const saveFilter = (repo, f) => localStorage.setItem('filter:' + repo, JSON.stringify(f))
export const toggleHidden = (f, ref) => ({ solo: '', hidden: f.hidden.includes(ref) ? f.hidden.filter(r => r !== ref) : [...f.hidden, ref] })
export const toggleSolo = (f, ref) => ({ ...f, solo: f.solo === ref ? '' : ref })

// Which refs `git log` starts from. Solo wins over hidden; stashes never show in the graph.
// ponytail: --exclude takes globs, so a branch named with * ? [ hides its look-alikes too
export const logRefs = f =>
  f.solo ? ['--ignore-missing', f.solo] : ['--exclude=refs/stash', ...f.hidden.map(r => '--exclude=' + r), '--all']

// Actions for dropping branch `src` onto `dst` (a branch name or a commit hash):
// merge needs a local branch to land in, rebase needs a local branch to move.
export function dropActions(src, dst, locals) {
  if (!src || !dst || src === dst) return []
  return [locals.includes(dst) && 'merge', locals.includes(src) && 'rebase'].filter(Boolean)
}
