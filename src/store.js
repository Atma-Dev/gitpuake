// App state and actions, shared by the components as a module-level singleton.
import { LOG_FORMAT, layout, parseLog } from './graph.js'
import { MODES as PULL_MODES } from './PullButton.vue'
import { ask, message, open } from '@tauri-apps/plugin-dialog'
import { buildTodo, validate } from './rebase.js'
import { compose, parseConflicts } from './merge.js'
import { computed, nextTick, ref, watch } from 'vue'
import { dropActions, loadFilter, logRefs, saveFilter, toggleHidden, toggleSolo } from './branchops.js'
import { highlightRows } from './highlight.js'
import { hunkPatch, linesPatch, parseDiff } from './diff.js'
import { invoke } from '@tauri-apps/api/core'
import { markWords } from './words.js'
import { parseBlame } from './blame.js'
import { parseRemote } from './forge.js'
import { parseSig, readIdentity } from './identity.js'
import { settings } from './settings.js'

export const ROW = 34
export const LANE = 22
export const REFS = 180
export const COLORS = ['#2fb7f5', '#e65c9c', '#8ee05b', '#f5a623', '#a77bf3', '#36d6c3', '#f2665b', '#d6d14a']
export const MAX_COMMITS = 20000 // ponytail: whole log is held in memory; page with --skip if bigger histories matter
export const OVERSCAN = 15 // extra rows rendered above/below the viewport

export const repo = ref(localStorage.getItem('repo') || '')
export const commits = ref([])
export const graphWidth = ref(1)
export const head = ref('')
export const branches = ref({ local: [], remote: [] })
export const status = ref({ staged: [], unstaged: [], conflicts: [] })
export const selected = ref('WIP')
export const commitFiles = ref([])
export const diff = ref(null)
export const msg = ref('')
export const newBranch = ref('')
export const busy = ref('')
export const error = ref('')
export const info = ref('') // success message, e.g. the URL of a new PR
export const stashes = ref([])
export const remotes = ref([]) // [{ name, url }]
export const tags = ref([]) // [{ name, oid, commit }]
export const remoteForm = ref(null) // { name, url } while adding a remote
export const amend = ref(false)
export const menu = ref(null) // commit context menu: { x, y, hash, input, value }
export const diffMode = computed(() => settings.diffMode)
export const showSettings = ref(false)
export const identity = ref(null) // effective user.name / user.email, shown in the commit box
export const sig = ref(null) // signature status of the selected commit
export const ignoreWs = ref(localStorage.getItem('ignoreWs') === '1') // display-only `git diff -w`
export const wordsOn = ref(localStorage.getItem('wordsOn') !== '0') // word marks instead of syntax colors on changed pairs

export const g = (...args) => invoke('git', { repo: repo.value, args })
export const gIn = (input, ...args) => invoke('git', { repo: repo.value, args, input })
export const vFocus = { mounted: el => el.focus() }
export const selectedCommit = computed(() => commits.value.find(c => c.hash === selected.value))
export const dirty = computed(() => status.value.staged.length + status.value.unstaged.length + status.value.conflicts.length > 0)
export const x = i => LANE / 2 + 6 + i * LANE
export const color = i => COLORS[i % COLORS.length]
export const headRow = computed(() => commits.value.findIndex(c => c.refs.some(r => r === 'HEAD' || r.startsWith('HEAD -> '))))
export const headCol = computed(() => commits.value[headRow.value]?.col ?? 0)

export const initials = name => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
export const avatarColor = name => `hsl(${[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)} 45% 42%)`

export const rtf = new Intl.RelativeTimeFormat('id', { numeric: 'auto' })
export const UNITS = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
export function ago(t) {
  const s = t - Date.now() / 1000
  const [unit, size] = UNITS.find(([, n]) => Math.abs(s) >= n) ?? ['second', 1]
  return rtf.format(Math.round(s / size), unit)
}

// "main" + "origin/main" on one commit collapse into a single synced pill.
export function pills(refs, remotes) {
  const list = refs.filter(r => !r.endsWith('/HEAD')).map(r =>
    r.startsWith('tag: ') ? { name: r.slice(5), icon: '◆' }
    : r === 'HEAD' ? { name: 'HEAD', icon: '✔', head: true }
    : r.startsWith('HEAD -> ') ? { name: r.slice(8), icon: '✔', head: true }
    : remotes.has(r) ? { name: r, icon: '☁', remote: true }
    : { name: r, icon: '⎇' },
  )
  const short = p => p.name.slice(p.name.indexOf('/') + 1)
  const names = new Set(list.map(p => p.name))
  return list
    .filter(p => !(p.remote && names.has(short(p))))
    .map(p => ({ ...p, synced: list.some(q => q.remote && short(q) === p.name) }))
}

export function path([a, b, kind], r) {
  const top = r * ROW, mid = top + ROW / 2, bot = top + ROW
  const [y1, y2] = kind === 'top' ? [top, mid] : kind === 'bottom' ? [mid, bot] : [top, bot]
  const ym = (y1 + y2) / 2
  return `M${x(a)} ${y1} C${x(a)} ${ym} ${x(b)} ${ym} ${x(b)} ${y2}`
}

// ponytail: undo entries capture state when the action ran; git commands run outside the app can make them stale
export const undos = ref([]) // [{ label, undo, fn }], newest last
export const redos = ref([]) // undone entries, cleared by any new undoable action

export async function run(label, fn, undo) {
  busy.value = label
  error.value = ''
  try {
    await fn()
    if (undo) {
      undos.value = [...undos.value.slice(-19), { label, undo, fn }]
      redos.value = []
    }
  } catch (e) {
    error.value = String(e)
  }
  busy.value = ''
  await refresh()
}

export function undo() {
  const u = undos.value.at(-1)
  if (!u || busy.value) return
  undos.value = undos.value.slice(0, -1)
  redos.value = [...redos.value, u]
  run('Undo ' + u.label.toLowerCase(), u.undo)
}

export async function redo() {
  const r = redos.value.at(-1)
  if (!r || busy.value) return
  const rest = redos.value.slice(0, -1)
  await run(r.label, r.fn, r.undo)
  redos.value = rest
}

export const headHash = async () => (await g('rev-parse', '-q', '--verify', 'HEAD')).trim()
export const prevHead = async () => ({ branch: head.value, hash: await headHash() })
export const goBack = p => (p.branch ? g('switch', p.branch) : g('switch', '--detach', p.hash))
// Moves HEAD back; --keep refuses instead of overwriting uncommitted work.
export const resetBack = (hash, mode = '--keep') => () => (hash ? g('reset', mode, hash) : g('update-ref', '-d', 'HEAD'))

// Discard = stash the changes, then drop the entry but keep its commit hash so undo can re-apply it.
export async function stashAway(paths) {
  const before = (await g('rev-parse', '-q', '--verify', 'refs/stash')).trim()
  await g('stash', 'push', '-u', '--keep-index', '-m', 'gitpuake discard', '--', ...paths)
  const hash = (await g('rev-parse', '-q', '--verify', 'refs/stash')).trim()
  if (!hash || hash === before) return '' // nothing was stashed; never drop the user's own stash
  await g('stash', 'drop', '-q')
  return hash
}
// Undo of stashAway: copy the stashed working-tree files back, leaving the index alone.
// ponytail: a discarded file deletion is not re-deleted on undo
export async function unstashAway(hash) {
  const lines = s => s.split('\0').filter(Boolean)
  const tracked = lines(await g('diff', '--name-only', '-z', '--diff-filter=d', hash + '^1', hash))
  if (tracked.length) await g('restore', '--source=' + hash, '--worktree', '--', ...tracked)
  const untracked = (await g('rev-parse', '-q', '--verify', hash + '^3')).trim()
  if (untracked) await g('restore', '--source=' + untracked, '--worktree', '--', ...lines(await g('ls-tree', '-r', '-z', '--name-only', untracked)))
}

export const UNMERGED = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']
export function parseStatus(out) {
  const staged = [], unstaged = [], conflicts = []
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]
    if (!e) continue
    const [X, Y, path] = [e[0], e[1], e.slice(3)]
    if (X === 'R' || X === 'C') i++ // -z puts the rename source in the next entry
    if (UNMERGED.includes(X + Y)) {
      conflicts.push({ path, code: 'C' })
      continue
    }
    if (X !== ' ' && X !== '?') staged.push({ path, code: X })
    if (Y !== ' ') unstaged.push({ path, code: Y === '?' ? 'U' : Y })
  }
  return { staged, unstaged, conflicts }
}

export const OPS = { REBASE_HEAD: 'rebase', MERGE_HEAD: 'merge', CHERRY_PICK_HEAD: 'cherry-pick', REVERT_HEAD: 'revert' }
export const operation = ref('') // in-progress merge / cherry-pick / revert
export const resolve = p => run('Resolve', () => g('add', '--', p))
export const abortOp = async () => {
  if (await ask(`Batalkan ${operation.value}? Repo kembali ke kondisi sebelum ${operation.value} dimulai.`, { kind: 'warning' }))
    run('Abort', () => g(operation.value, '--abort'))
}
export const continueOp = () =>
  run('Continue', () =>
    operation.value === 'merge' ? g('commit', '--no-edit') : g('-c', 'core.editor=true', operation.value, '--continue'),
  )

export const query = ref('')
export const searchEl = ref(null)
export const matches = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return null
  return new Set(
    commits.value
      .filter(c => c.subject.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.hash.startsWith(q))
      .map(c => c.hash),
  )
})
export function nextMatch(back) {
  const list = commits.value.filter(c => matches.value?.has(c.hash))
  if (!list.length) return
  const i = list.findIndex(c => c.hash === selected.value)
  const c = i < 0 ? list[0] : list[(i + (back ? -1 : 1) + list.length) % list.length]
  selectCommit(c.hash)
  scrollToCommit(c.hash)
}

export async function refresh() {
  if (!repo.value) return
  readIdentity(g).then(id => (identity.value = id))
  try {
    const [log, st, refs, cur, stash, ops, remoteUrls, tagRefs, amOp] = await Promise.all([
      // empty repo has no log; stashes are listed in the sidebar instead of the graph
      g('log', ...logRefs(filter.value), '--topo-order', '-n', String(MAX_COMMITS), LOG_FORMAT).catch(() => ''),
      g('status', '--porcelain=v1', '-z', '-uall'),
      g('for-each-ref', '--format=%(refname)%1f%(upstream:track,nobracket)', 'refs/heads', 'refs/remotes'),
      g('branch', '--show-current'),
      g('stash', 'list', '--format=%gd%x1f%gs'),
      Promise.all(Object.keys(OPS).map(r => g('rev-parse', '-q', '--verify', r))), // missing ref -> ''
      g('config', '--get-regexp', '^remote\\..*\\.url$'), // no remotes -> ''
      g('for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%1f%(objectname)%1f%(*objectname)', 'refs/tags'),
      g('am', '--show-current-patch=raw').then(() => 'am', () => ''), // am leaves no ref; this fails outside an am session
    ])
    remotes.value = remoteUrls.split('\n').filter(Boolean).map(l => {
      const sp = l.indexOf(' ')
      return { name: l.slice(7, sp - 4), url: l.slice(sp + 1) } // "remote.<name>.url <url>"
    })
    tags.value = tagRefs.split('\n').filter(Boolean).map(l => {
      const [name, oid, peeled] = l.split('\x1f')
      return { name, oid, commit: peeled || oid } // annotated tags point at a tag object
    })
    stashes.value = stash.split('\n').filter(Boolean).map(l => {
      const [ref, subject] = l.split('\x1f')
      return { ref, subject }
    })
    operation.value = Object.values(OPS)[ops.findIndex(o => o.trim())] ?? amOp
    const rows = refs.split('\n').map(l => l.split('\x1f')).filter(([r]) => r && !r.endsWith('/HEAD'))
    const track = {}
    for (const [r, t] of rows) {
      if (r.startsWith('refs/heads/') && t)
        track[r.slice(11)] = { ahead: +(t.match(/ahead (\d+)/)?.[1] ?? 0), behind: +(t.match(/behind (\d+)/)?.[1] ?? 0) }
    }
    branches.value = {
      local: rows.filter(([r]) => r.startsWith('refs/heads/')).map(([r]) => r.slice(11)),
      remote: rows.filter(([r]) => r.startsWith('refs/remotes/')).map(([r]) => r.slice(13)),
      track,
    }
    const remoteBranches = new Set(branches.value.remote)
    const list = parseLog(log)
    for (const c of list) c.pills = pills(c.refs, remoteBranches)
    graphWidth.value = layout(list)
    commits.value = list
    status.value = parseStatus(st)
    head.value = cur.trim()
    if (selected.value !== 'WIP' && !selectedCommit.value) selectCommit('WIP')
  } catch (e) {
    error.value = String(e)
  }
}

export const recent = ref(JSON.parse(localStorage.getItem('recent') || '[]'))
export const saveRecent = list => localStorage.setItem('recent', JSON.stringify((recent.value = list)))
export const forget = path => saveRecent(recent.value.filter(r => r !== path))

// Open repositories as tabs; each keeps its own undo history while the app runs.
export const tabs = ref(JSON.parse(localStorage.getItem('tabs') || 'null') ?? (repo.value ? [repo.value] : []))
export const saveTabs = list => localStorage.setItem('tabs', JSON.stringify((tabs.value = list)))
export const undoStore = {}
export function closeTab(path) {
  const i = tabs.value.indexOf(path)
  saveTabs(tabs.value.filter(t => t !== path))
  delete undoStore[path]
  if (path !== repo.value) return
  const next = tabs.value[Math.min(i, tabs.value.length - 1)]
  if (next) openPath(next)
  else {
    undos.value = []
    goHome()
  }
}

export async function openPath(dir) {
  try {
    const top = (await invoke('git', { repo: dir, args: ['rev-parse', '--show-toplevel'] })).trim()
    if (repo.value) undoStore[repo.value] = undos.value
    repo.value = top
    localStorage.setItem('repo', top)
    saveRecent([top, ...recent.value.filter(r => r !== top)].slice(0, 8))
    if (!tabs.value.includes(top)) saveTabs([...tabs.value, top])
    undos.value = undoStore[top] ?? []
    redos.value = []
    query.value = ''
    selected.value = 'WIP'
    diff.value = fileView.value = plan.value = mergeView.value = null
    prView.value = null
    await refresh()
  } catch (e) {
    error.value = `${dir} bukan git repository. Pilih folder yang berisi .git, atau buat repository baru.`
  }
}
export async function openRepo() {
  const dir = await open({ directory: true })
  if (dir) openPath(dir)
}
export function goHome() {
  if (repo.value) undoStore[repo.value] = undos.value
  repo.value = ''
  localStorage.removeItem('repo')
  commits.value = []
  diff.value = fileView.value = plan.value = mergeView.value = null
}

export const nameStatus = out =>
  out.split('\n').filter(Boolean).map(l => {
    const [code, ...paths] = l.split('\t')
    return { code: code[0], path: paths.at(-1), from: paths[0] } // from: old path of a rename
  })
export async function selectCommit(hash) {
  multi.value = []
  selected.value = hash
  diff.value = null
  fileView.value = null
  compare.value = null
  commitFiles.value = []
  if (hash === 'WIP') return
  commitFiles.value = nameStatus(await g('show', '--format=', '--name-status', '--diff-merges=first-parent', hash))
}
// Ctrl/Cmd+click a second commit: files changed between the pair, older one first.
export const compare = ref(null) // { a, b, files }
export async function pickPair(hash) {
  if (selected.value === 'WIP' || selected.value === hash) return selectCommit(hash)
  const at = h => commits.value.findIndex(c => c.hash === h)
  const [a, b] = [selected.value, hash].sort((p, q) => at(q) - at(p))
  diff.value = fileView.value = null
  compare.value = { a, b, files: nameStatus(await g('diff', '--name-status', a, b)) }
}

// %G? runs gpg per signed commit, so it is only asked for the one commit on screen, not the whole log
watch(selected, async h => {
  sig.value = null
  if (h === 'WIP') return
  const s = parseSig(await g('log', '-1', '--format=%G?%x1f%GS', h).catch(() => ''))
  if (selected.value === h) sig.value = s
})

export async function showDiff(file, kind) {
  const p = file.path
  const ws = ignoreWs.value ? ['-w'] : []
  let text
  if (kind === 'commit') text = await g('show', ...ws, '--format=', '--diff-merges=first-parent', selected.value, '--', p)
  else if (kind === 'compare') text = await g('diff', ...ws, compare.value.a, compare.value.b, '--', p)
  else if (kind === 'staged') text = await g('diff', ...ws, '--cached', '--', p)
  else if (file.code === 'U' || file.code === 'C') text = await g('diff', '--no-index', '--', '/dev/null', p) // conflict: whole file with markers
  else text = await g('diff', ...ws, '--', p)
  const d = parseDiff(text)
  fileView.value = mergeView.value = null
  for (const h of d.hunks) {
    h.picked = new Set() // raw line indexes picked for line-level staging
    highlightRows(h.rows, p)
    markWords(h.rows)
  }
  diff.value = { file, kind, d, ws: !!ws.length }
}

export const setDiffMode = m => (settings.diffMode = m)
export const toggleWords = () => localStorage.setItem('wordsOn', (wordsOn.value = !wordsOn.value) ? '1' : '0')
export function toggleWs() {
  localStorage.setItem('ignoreWs', (ignoreWs.value = !ignoreWs.value) ? '1' : '0')
  if (diff.value) showDiff(diff.value.file, diff.value.kind)
  const fv = fileView.value
  if (fv?.type === 'history' && fv.sel) pickHistory(fv.items.find(it => it.hash === fv.sel))
}
// Untracked files have no index entry to patch, so they are staged whole.
// A `-w` diff does not match the files byte for byte, so it can't be applied either.
export const hunkable = computed(() => diff.value && diff.value.kind !== 'commit' && !'UC'.includes(diff.value.file.code) && !diff.value.ws)
// Applies hunk `h` of the open diff, or only its picked lines when some are picked.
export async function applyHunk(label, h, flags, undoFor) {
  const { file, kind, d } = diff.value
  const patch = h.picked.size ? linesPatch(d, h, h.picked, flags.includes('--reverse')) : hunkPatch(d, h)
  await run(h.picked.size ? label + ' baris' : label + ' hunk', () => gIn(patch, 'apply', ...flags, '-'), undoFor?.(patch))
  await showDiff(file, kind)
}
export const discardHunk = async h => {
  if (!(await ask(h.picked.size ? `Buang ${h.picked.size} baris terpilih?` : 'Buang perubahan di hunk ini?', { kind: 'warning' }))) return
  applyHunk('Discard', h, ['--reverse'], patch => () => gIn(patch, 'apply', '-'))
}

// Conflict editor: { path, segs, manual } where manual is the hand-edited text (null = use choices).
export const mergeView = ref(null)
export const unresolved = computed(() => mergeView.value?.segs.filter(s => !s.lines && !s.choice).length ?? 0)
export const conflictCount = computed(() => mergeView.value?.segs.filter(s => !s.lines).length ?? 0)
export async function openMerge(f) {
  try {
    const text = await invoke('read_file', { repo: repo.value, path: f.path })
    diff.value = fileView.value = null
    mergeView.value = { path: f.path, segs: parseConflicts(text), manual: null }
  } catch (e) {
    error.value = String(e)
  }
}
export const toggleManual = () => (mergeView.value.manual = mergeView.value.manual === null ? compose(mergeView.value.segs) : null)
export async function saveMerge() {
  const { path, segs, manual } = mergeView.value
  const content = manual ?? compose(segs)
  if (content.includes('<<<<<<<') && !(await ask('Hasil masih berisi penanda conflict (<<<<<<<). Tetap simpan?', { kind: 'warning' }))) return
  mergeView.value = null
  // undo brings the conflict (markers and unmerged index entry) back
  run(
    'Resolve',
    async () => {
      await invoke('write_file', { repo: repo.value, path, content })
      await g('add', '--', path)
    },
    () => g('checkout', '-m', '--', path),
  )
}
// Long runs of agreed text are folded to their first and last lines.
export const fold = lines => (lines.length > 8 ? { head: lines.slice(0, 3), hidden: lines.length - 6, tail: lines.slice(-3) } : { head: lines, hidden: 0, tail: [] })

export const fileView = ref(null) // { type: 'history', path, items, sel, d } | { type: 'blame', path, rev, lines }
export async function openHistory(path) {
  const out = await g('log', '--follow', '-n', '300', '--format=%x1e%H%x1f%an%x1f%at%x1f%s', '--name-only', '--', path)
  const items = out.split('\x1e').filter(c => c.trim()).map(chunk => {
    const [meta, ...files] = chunk.split('\n')
    const [hash, author, time, subject] = meta.split('\x1f')
    return { hash, author, time: +time, subject, path: files.find(Boolean) ?? path } // path at that commit (renames)
  })
  fileView.value = { type: 'history', path, items, sel: null, d: null }
  if (items.length) pickHistory(items[0])
}
export async function pickHistory(it) {
  fileView.value.sel = it.hash
  const d = parseDiff(await g('show', ...(ignoreWs.value ? ['-w'] : []), '--format=', '--diff-merges=first-parent', it.hash, '--', it.path))
  for (const h of d.hunks) {
    highlightRows(h.rows, it.path)
    markWords(h.rows)
  }
  fileView.value.d = d
}
export async function openBlame(path, rev) {
  try {
    const lines = parseBlame(await g('blame', '--porcelain', ...(rev ? [rev] : []), '--', path))
    highlightRows(lines, path)
    fileView.value = { type: 'blame', path, rev, lines }
  } catch (e) {
    error.value = String(e)
  }
}
export function jumpTo(hash) {
  if (/^0+$/.test(hash)) return
  fileView.value = null
  diff.value = null
  selectCommit(hash)
  nextTick(() => scrollToCommit(hash))
}

export const stage = p => run('Stage', () => g('add', '--', p))
export const unstage = p => run('Unstage', () => g('restore', '--staged', '--', p))
export const stageAll = () => run('Stage', () => g('add', '-A'))
export const unstageAll = () => run('Unstage', () => g('restore', '--staged', '--', '.'))
export async function discardPaths(label, paths) {
  let hash = ''
  run(label, async () => (hash = await stashAway(paths)), () => hash && unstashAway(hash))
}
export const discard = async f => {
  if (await ask(`Buang perubahan di "${f.path}"?`, { kind: 'warning' })) discardPaths('Discard', [f.path])
}
export const discardAll = async () => {
  if (await ask('Buang semua perubahan unstaged, termasuk file baru?', { kind: 'warning' })) discardPaths('Discard all', ['.'])
}

watch(amend, async on => {
  if (on && !msg.value.trim()) msg.value = (await g('log', '-1', '--format=%B')).trim()
})
export async function commit() {
  if (!msg.value.trim()) return
  const before = await headHash()
  run(
    amend.value ? 'Amend' : 'Commit',
    async () => {
      await g('commit', ...(amend.value ? ['--amend'] : []), '-m', msg.value)
      msg.value = ''
      amend.value = false
    },
    resetBack(before, '--soft'), // changes go back to staged
  )
}

export const stash = () => run('Stash', () => g('stash', 'push', '-u'), () => g('stash', 'pop', '--index'))
export async function stashDo(action, s) {
  if (action !== 'drop') return run('Stash ' + action, () => g('stash', action, s.ref))
  if (!(await ask(`Hapus ${s.ref}?`, { kind: 'warning' }))) return
  const hash = (await g('rev-parse', s.ref)).trim()
  run('Drop stash', () => g('stash', 'drop', s.ref), () => g('stash', 'store', '-m', s.subject, hash))
}
// Stashes one file's changes (staged, unstaged or untracked); undo pops it back if it is still on top.
export async function stashFile(f) {
  const top = async () => (await g('rev-parse', '-q', '--verify', 'refs/stash')).trim()
  const before = await top()
  let hash = ''
  run(
    'Stash file',
    async () => {
      await g('stash', 'push', '-u', '-m', 'gitpuake: ' + f.path, '--', f.path)
      if ((hash = await top()) === before) throw new Error('Tidak ada perubahan untuk di-stash')
    },
    async () => {
      if ((await top()) !== hash) throw new Error(`Stash "${f.path}" sudah bukan stash@{0}. Pop manual dari sidebar.`)
      await g('stash', 'pop', '--index')
    },
  )
}

// Patches: export a commit with format-patch, import with am (as a commit) or apply (working tree only).
export async function savePatch() {
  const { hash } = menu.value
  menu.value = null
  // format-patch skips merges and would quietly export an older commit instead
  if (selectedCommit.value?.parents.length > 1) return (error.value = 'Merge commit tidak bisa disimpan sebagai patch.')
  const dir = await open({ directory: true, title: 'Simpan patch ke folder' })
  if (!dir) return
  run('Simpan patch', async () => (info.value = 'Patch disimpan: ' + (await g('format-patch', '-1', hash, '-o', dir)).trim()))
}
export async function applyPatch() {
  const file = await open({ title: 'Pilih patch', filters: [{ name: 'Patch', extensions: ['patch', 'diff'] }] })
  if (!file) return
  const AM = 'Jadikan commit (git am)', APPLY = 'Working tree saja (git apply)'
  const r = await message(`Terapkan ${file.split('/').pop()}?\n\ngit am butuh patch dari format-patch dan membuat commit. git apply hanya mengubah file.`, {
    title: 'Terapkan patch',
    buttons: { yes: AM, no: APPLY, cancel: 'Batal' },
  })
  if (r === AM || r === 'Yes') {
    const prev = await headHash()
    // a conflict leaves an am session; the banner offers abort / continue
    run('Terapkan patch', () => g('am', '--3way', file), resetBack(prev))
  } else if (r === APPLY || r === 'No')
    // ponytail: undo re-reads the patch file; if it was edited or moved meanwhile, undo fails
    run('Terapkan patch', () => g('apply', file), () => g('apply', '-R', file))
}

// Shift+click builds a multi-selection (for cherry-pick / squash / drop); a plain click clears it.
export const multi = ref([])
export function toggleMulti(hash) {
  const base = multi.value.length || selected.value === 'WIP' ? multi.value : [selected.value]
  multi.value = base.includes(hash) ? base.filter(h => h !== hash) : [...base, hash]
}
const picked = () => commits.value.filter(c => multi.value.includes(c.hash)).map(c => c.hash) // newest first
export function openMenu(e, c) {
  if (!multi.value.includes(c.hash)) {
    multi.value = []
    selectCommit(c.hash)
  }
  menu.value = { x: Math.min(e.clientX, innerWidth - 240), y: Math.min(e.clientY, innerHeight - 470), hash: c.hash, input: null, value: '' }
}
// Runs a HEAD-changing action; `undoFor(prev)` builds its undo from the HEAD state before it ran.
export async function act(label, args, undoFor) {
  menu.value = null
  const prev = await prevHead()
  run(label, () => g(...args), undoFor?.(prev))
}
export const newBranchAt = (name, at) => act('Branch', ['switch', '-c', name, ...at], p => async () => {
  await goBack(p)
  await g('branch', '-D', name)
})
export async function resetTo(mode) {
  const { hash } = menu.value
  if (mode === 'hard' && !(await ask(`Reset --hard ke ${hash.slice(0, 7)}? Perubahan yang belum di-commit akan hilang dan tidak bisa di-undo.`, { kind: 'warning' }))) return
  act('Reset', ['reset', '--' + mode, hash], p => resetBack(p.hash, mode === 'hard' ? '--keep' : '--soft'))
}
export const rebaseOnto = target => act('Rebase', ['rebase', '--autostash', target], p => resetBack(p.hash))

export const showReflog = ref(false)
export const plan = ref(null) // interactive rebase: { base, items (newest first), drag }
export const planError = computed(() => plan.value && validate(plan.value.items))
export async function openRebase() {
  const base = menu.value.hash
  menu.value = null
  await openPlan(base, () => 'pick')
}
async function openPlan(base, actionOf, need = []) {
  const out = await g('log', '--format=%H%x1f%P%x1f%s', `${base}..HEAD`)
  const rows = out.split('\n').filter(Boolean).map(l => l.split('\x1f'))
  if (!rows.length) return (error.value = 'Tidak ada commit di atas commit ini untuk di-rebase.')
  if (need.some(h => !rows.some(([r]) => r === h))) return (error.value = 'Commit yang dipilih harus ada di branch aktif.')
  if (rows.some(([, parents]) => parents.includes(' ')))
    return (error.value = 'Rentang ini berisi merge commit. Interactive rebase yang melewati merge belum didukung.')
  diff.value = null
  plan.value = { base, drag: -1, items: rows.map(([hash, , subject]) => ({ hash, subject, action: actionOf(hash), msg: subject })) }
}
// Opens the rebase plan from the parent of the oldest picked commit, preset for reword / squash / drop.
export async function planFor(kind) {
  const hashes = multi.value.length > 1 ? picked() : [menu.value.hash]
  menu.value = null
  const oldest = hashes.at(-1)
  const base = (await g('rev-parse', '-q', '--verify', oldest + '^').catch(() => '')).trim()
  if (!base) return (error.value = 'Commit pertama (root) tidak bisa diubah lewat rebase.')
  const action = h => (!hashes.includes(h) ? 'pick' : kind === 'squash' ? (h === oldest ? 'pick' : 'squash') : kind)
  await openPlan(base, action, hashes)
}
export function cherryPickMany() {
  const hashes = picked().reverse() // oldest first
  multi.value = []
  act('Cherry-pick', ['cherry-pick', ...hashes], p => resetBack(p.hash))
}
// squash/fixup fold into the nearest older commit that survives on its own
export const foldTarget = i => plan.value.items.slice(i + 1).find(x => !['drop', 'squash', 'fixup'].includes(x.action))?.hash.slice(0, 7)
export function moveItem(from, to) {
  const items = plan.value.items
  if (from < 0 || to < 0 || to >= items.length || from === to) return
  items.splice(to, 0, items.splice(from, 1)[0])
}
export async function startRebase() {
  const { base, items } = plan.value
  plan.value = null
  const prev = await headHash()
  // the "editor" just writes our todo (fed on stdin) over git's
  run('Rebase', () => gIn(buildTodo(items), '-c', 'sequence.editor=cat >', '-c', 'core.editor=true', 'rebase', '-i', '--autostash', base), resetBack(prev))
}

export const copyHash = () => {
  navigator.clipboard.writeText(menu.value.hash)
  menu.value = null
}
export function submitMenu() {
  const { hash, input, value } = menu.value
  const name = value.trim()
  if (!name) return
  if (input === 'branch') newBranchAt(name, [hash])
  else act('Tag', ['tag', '-a', name, '-m', name, hash], () => () => g('tag', '-d', name))
}

export function createBranch() {
  const name = newBranch.value.trim()
  if (!name) return
  newBranchAt(name, selected.value === 'WIP' ? [] : [selected.value])
  newBranch.value = ''
}
// `switch foo` for a remote origin/foo creates a local tracking branch.
export const checkout = (b, remote) => act('Checkout', ['switch', remote ? b.slice(b.indexOf('/') + 1) : b], p => () => goBack(p))
export const MERGE_MODES = { merge: 'Merge', '--no-ff': 'Merge --no-ff (selalu buat merge commit)', squash: 'Squash (stage saja, commit sendiri)' }
export async function merge(b, mode = 'merge') {
  if (mode !== 'squash') return act('Merge', ['merge', ...(mode === 'merge' ? [] : [mode]), b], p => resetBack(p.hash))
  // undo is reset --merge, which would also wipe changes staged before; so start from an empty index
  if (status.value.staged.length) return (error.value = 'Squash butuh area staged yang kosong. Commit atau unstage dulu perubahanmu.')
  run(
    'Squash',
    async () => {
      await g('merge', '--squash', b)
      msg.value = `Squash branch ${b}`
      selectCommit('WIP')
      info.value = `Perubahan dari ${b} sudah di-stage tapi belum di-commit. Periksa, lalu klik Commit untuk menyelesaikan squash.`
    },
    () => g('reset', '--merge'),
  )
}
// Deletes a branch on the remote; undo pushes the old tip back.
export async function removeRemoteBranch(b) {
  const remote = b.slice(0, b.indexOf('/'))
  const name = b.slice(remote.length + 1)
  if (!(await ask(`Hapus branch "${name}" di remote ${remote}? Ini mengubah remote, bukan hanya salinan lokal.`, { kind: 'warning' }))) return
  const hash = (await g('rev-parse', 'refs/remotes/' + b)).trim()
  run('Hapus branch remote', () => g('push', remote, '--delete', name), () => g('push', remote, `${hash}:refs/heads/${name}`))
}
export async function removeBranch(b) {
  if (!(await ask(`Hapus branch "${b}"?`, { kind: 'warning' }))) return
  const hash = (await g('rev-parse', b)).trim()
  run('Delete branch', () => g('branch', '-d', b), () => g('branch', b, hash))
}

// Graph filter (hide / solo branches), kept per repo in localStorage.
export const filterTick = ref(0)
export const filter = computed(() => (filterTick.value, loadFilter(repo.value)))
export function setFilter(f) {
  saveFilter(repo.value, f)
  filterTick.value++
  refresh()
}
export const hideRef = r => setFilter(toggleHidden(filter.value, r))
export const soloRef = r => setFilter(toggleSolo(filter.value, r))
export const refState = r => ({ hidden: filter.value.hidden.includes(r), solo: filter.value.solo === r })

// Drag a branch onto another branch or commit -> merge / rebase menu.
export const dragRef = ref('') // branch being dragged
export const dropMenu = ref(null) // { x, y, src, dst, acts }
export const shortRef = r => (/^[0-9a-f]{40}$/.test(r) ? r.slice(0, 7) : r)
export const draggablePill = p => p.icon !== '◆' && p.name !== 'HEAD'
// a commit row drops onto its first branch, or the commit itself
export const rowTarget = c => c.pills.find(draggablePill)?.name ?? c.hash
export function dropOn(e, dst) {
  const src = dragRef.value
  dragRef.value = ''
  const acts = dropActions(src, dst, branches.value.local)
  if (acts.length) dropMenu.value = { x: Math.min(e.clientX, innerWidth - 260), y: Math.min(e.clientY, innerHeight - 90), src, dst, acts }
}
export async function dropDo(kind) {
  const { src, dst } = dropMenu.value
  dropMenu.value = null
  if (kind === 'merge' && dst === head.value) return merge(src)
  if (kind === 'rebase' && src === head.value) return rebaseOnto(dst)
  // the branch that moves isn't checked out: switch to it first, so the tree must be clean
  if (dirty.value) return (error.value = 'Commit atau stash perubahan dulu sebelum merge/rebase branch yang tidak aktif.')
  const moved = kind === 'merge' ? dst : src
  const [prev, old] = [await prevHead(), (await g('rev-parse', moved)).trim()]
  run(
    kind === 'merge' ? 'Merge' : 'Rebase',
    async () => {
      if (kind === 'merge') {
        await g('switch', dst)
        await g('merge', src)
      } else await g('rebase', dst, src) // checks out src, then rebases it
    },
    async () => {
      await g('switch', moved)
      await g('reset', '--keep', old)
      await goBack(prev)
    },
  )
}

export const lastFetch = ref(0)
export const fetchAll = () =>
  run('Fetch', async () => {
    await g('fetch', '--all', '--prune')
    lastFetch.value = Date.now()
  })
// Quiet background fetch; failures (offline, auth) just wait for the next round.
export async function autoFetch() {
  if (!repo.value || busy.value || !remotes.value.length || document.hidden) return
  try {
    await g('fetch', '--all', '--prune', '--quiet')
    lastFetch.value = Date.now()
    await refresh()
    forgeEl.value?.load()
  } catch {}
}

// Virtual scroll: only rows near the viewport of the history are rendered.
export const mainEl = ref(null)
export const scrollTop = ref(0)
export const viewH = ref(window.innerHeight)
export function onScroll() {
  scrollTop.value = mainEl.value.scrollTop
  viewH.value = mainEl.value.clientHeight
}
export const visible = computed(() => {
  const first = Math.max(0, Math.floor(scrollTop.value / ROW) - OVERSCAN)
  const last = Math.min(commits.value.length, Math.ceil((scrollTop.value + viewH.value) / ROW) + OVERSCAN)
  return { first, list: commits.value.slice(first, last) }
})
export function scrollToCommit(hash) {
  const i = commits.value.findIndex(c => c.hash === hash)
  if (i >= 0 && mainEl.value) mainEl.value.scrollTop = (i + 1) * ROW - mainEl.value.clientHeight / 2
}
export const pull = flags => act('Pull', ['pull', ...flags], p => resetBack(p.hash))
// Pull/merge requests and issues: sidebar in Forge.vue, GitHub PR detail in PRView.vue.
export const forge = computed(() => parseRemote(remotes.value.find(r => r.name === firstRemote())?.url))
export const forgeEl = ref(null)
export const prView = ref(null) // number of the PR shown in the main area
export const openPR = n => {
  diff.value = fileView.value = null
  prView.value = n
}
// returning from a diff/plan/file view re-mounts the history; resync the window
watch([diff, plan, fileView, mergeView, prView], () => nextTick(() => mainEl.value && onScroll()))

export const firstRemote = () => remotes.value.find(r => r.name === 'origin')?.name ?? remotes.value[0]?.name ?? 'origin'
export const push = () =>
  run('Push', async () => {
    try {
      await g('push', '--follow-tags')
    } catch (e) {
      const msg = String(e)
      if (msg.includes('no upstream')) return g('push', '--follow-tags', '-u', firstRemote(), 'HEAD')
      const rejected = /rejected|non-fast-forward|fetch first/.test(msg)
      if (
        rejected &&
        (await ask(
          'Push ditolak karena history di remote berbeda, misalnya setelah rebase atau amend.\n\nForce push dengan --force-with-lease? Push tetap dibatalkan kalau ada commit baru di remote sejak fetch terakhir.',
          { kind: 'warning', okLabel: 'Force push', cancelLabel: 'Batal' },
        ))
      )
        return g('push', '--follow-tags', '--force-with-lease')
      throw e
    }
  })

export function addRemote() {
  const name = remoteForm.value.name.trim(), url = remoteForm.value.url.trim()
  if (!name || !url) return
  remoteForm.value = null
  run('Tambah remote', () => g('remote', 'add', '--', name, url), () => g('remote', 'remove', name))
}
export async function removeRemote(r) {
  if (!(await ask(`Hapus remote "${r.name}"? Branch remote-nya ikut hilang dari daftar.`, { kind: 'warning' }))) return
  run('Hapus remote', () => g('remote', 'remove', r.name), () => g('remote', 'add', '--', r.name, r.url))
}
export const fetchRemote = r => run('Fetch ' + r.name, () => g('fetch', '--prune', '--', r.name))
export const pushTag = t => run('Push tag', () => g('push', firstRemote(), 'refs/tags/' + t.name))
export async function deleteTag(t) {
  if (!(await ask(`Hapus tag "${t.name}" di lokal?`, { kind: 'warning' }))) return
  run('Hapus tag', () => g('tag', '-d', t.name), () => g('update-ref', 'refs/tags/' + t.name, t.oid))
}
let fetchTimer
watch(() => settings.fetchMinutes, m => {
  clearInterval(fetchTimer)
  if (m) fetchTimer = setInterval(autoFetch, m * 60 * 1000)
}, { immediate: true })

// Command palette entries; `keys` doubles as the global shortcut (see the keydown handler).
export const showPalette = ref(false)
export const cycleTab = d => tabs.value.length > 1 && openPath(tabs.value.at((tabs.value.indexOf(repo.value) + d) % tabs.value.length))
export const commands = computed(() => {
  if (!repo.value) return []
  const idle = fn => () => !busy.value && fn()
  return [
    { label: 'Fetch semua remote', keys: 'F5', run: idle(fetchAll) },
    ...Object.values(PULL_MODES).map(m => ({ label: m.label, run: idle(() => pull(m.args)) })),
    { label: 'Push', keys: 'Ctrl+Shift+K', run: idle(push) },
    { label: 'Stash perubahan', keys: 'Ctrl+Shift+S', run: idle(() => dirty.value && stash()) },
    { label: 'Pop stash teratas', run: idle(() => stashes.value.length && stashDo('pop', stashes.value[0])) },
    { label: 'Undo', keys: 'Ctrl+Z', run: idle(undo) },
    { label: 'Redo', keys: 'Ctrl+Shift+Z', run: idle(redo) },
    { label: 'Reflog…', run: () => (showReflog.value = true) },
    { label: 'Cari commit', keys: 'Ctrl+F', run: () => nextTick(() => searchEl.value?.focus()) },
    { label: 'Terapkan patch…', run: idle(applyPatch) },
    ...(forge.value?.forge && head.value ? [{ label: forge.value.forge === 'gitlab' ? 'Buat merge request' : 'Buat pull request', run: idle(() => forgeEl.value?.openPRForm()) }] : []),
    { label: settings.treeView ? 'Daftar file: tampilan flat' : 'Daftar file: tampilan pohon folder', run: () => (settings.treeView = !settings.treeView) },
    { label: 'Diff split', run: () => setDiffMode('split') },
    { label: 'Diff unified', run: () => setDiffMode('unified') },
    { label: 'Pengaturan', keys: 'Ctrl+,', run: () => (showSettings.value = true) },
    { label: 'Buka repository…', keys: 'Ctrl+O', run: openRepo },
    { label: 'Tab berikutnya', keys: 'Ctrl+Tab', run: () => cycleTab(1) },
    { label: 'Tab sebelumnya', keys: 'Ctrl+Shift+Tab', run: () => cycleTab(-1) },
    { label: 'Tutup tab', keys: 'Ctrl+W', run: () => closeTab(repo.value) },
    { label: 'Halaman awal', run: goHome },
    ...tabs.value.filter(t => t !== repo.value).map(t => ({ label: 'Buka tab ' + t.split('/').at(-1), run: () => openPath(t) })),
    ...branches.value.local.filter(b => b !== head.value).map(b => ({ label: 'Checkout ' + b, run: idle(() => checkout(b)) })),
    ...branches.value.remote.map(b => ({ label: 'Checkout ' + b, run: idle(() => checkout(b, true)) })),
  ]
})
export const keyName = e => (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.shiftKey ? 'Shift+' : '') + (e.key.length === 1 ? e.key.toUpperCase() : e.key)

export const headTrack = computed(() => branches.value.track?.[head.value] ?? { ahead: 0, behind: 0 })
