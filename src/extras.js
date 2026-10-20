// Parsers for the sidebar's worktree and submodule sections.

// `git worktree list --porcelain`: blank-line separated records of "key value" lines.
// ponytail: newline-separated output, a path containing a newline breaks it; switch to -z (git 2.36+) if that matters
export function parseWorktrees(out) {
  return out.split('\n\n').filter(r => r.trim()).map(rec => {
    const w = {}
    for (const line of rec.split('\n')) {
      const sp = line.indexOf(' ')
      const [key, val] = sp < 0 ? [line, true] : [line.slice(0, sp), line.slice(sp + 1)]
      if (key) w[key] = val
    }
    return {
      path: w.worktree,
      head: w.HEAD ?? '',
      branch: typeof w.branch === 'string' ? w.branch.replace(/^refs\/heads\//, '') : '',
      bare: !!w.bare,
      locked: !!w.locked,
      prunable: !!w.prunable,
    }
  })
}

// `git submodule status`: "<state><sha> <path>[ (<describe>)]", state is ' ', '-', '+' or 'U'.
export function parseSubmodules(out) {
  return out.split('\n').filter(l => l.trim()).map(l => {
    const rest = l.slice(l.indexOf(' ', 1) + 1)
    return { state: l[0], sha: l.slice(1, l.indexOf(' ', 1)), path: rest.replace(/ \([^()]*\)$/, '') }
  })
}
