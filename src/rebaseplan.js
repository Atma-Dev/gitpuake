// Interactive rebase plan (reword / squash / drop, multi-select cherry-pick). Re-exported by store.js.
import { computed, ref } from 'vue'
import { buildTodo, validate } from './rebase.js'
import { act, diff, error, g, gIn, headHash, menu, multi, picked, resetBack, run } from './store.js'

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
