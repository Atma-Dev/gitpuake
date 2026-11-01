// Bisect and Gitflow actions. store.js re-exports everything here, so components import from store.js as before.
import { computed, ref } from 'vue'
import { ask } from '@tauri-apps/plugin-dialog'
import { branches, dirty, error, g, head, info, menu, newBranchAt, run } from './store.js'

// Bisect: the banner marks HEAD; the commit menu starts a session and marks any commit.
export const bisecting = ref(false)
export const bisect = (...args) =>
  run('Bisect', async () => {
    const out = (await g('bisect', ...args)).trim()
    if (out) info.value = out.split('\n').slice(0, 6).join('\n')
  })
export const bisectStart = hash => {
  menu.value = null
  run('Bisect', async () => {
    await g('bisect', 'start')
    await g('bisect', 'bad', hash)
    info.value = 'Bisect dimulai. Klik kanan commit lama yang masih bagus, lalu pilih "Bisect: commit ini good".'
  })
}
export const bisectMark = (kind, hash) => {
  menu.value = null
  bisect(kind, hash)
}

// Gitflow: feature/ release/ hotfix/ branches, merged --no-ff on finish.
// ponytail: finish has no undo (multi-step) and stops on a merge conflict; resolve it, then finish again.
export const FLOW = ['feature', 'release', 'hotfix']
export const flowKind = computed(() => FLOW.find(k => head.value?.startsWith(k + '/')))
const trunk = () => (branches.value.local.includes('main') ? 'main' : 'master')
export async function flowStart(kind, name) {
  name = name.trim().replace(/\s+/g, '-')
  if (!name) return
  if (!branches.value.local.includes('develop')) {
    if (!(await ask(`Branch develop belum ada. Buat dari ${trunk()}?`, { kind: 'info' }))) return
    await run('Gitflow', () => g('branch', 'develop', trunk()))
  }
  newBranchAt(`${kind}/${name}`, [kind === 'hotfix' ? trunk() : 'develop'])
}
export async function flowFinish() {
  const kind = flowKind.value
  const br = head.value
  if (dirty.value) return (error.value = 'Commit atau stash perubahanmu dulu sebelum menyelesaikan ' + br + '.')
  const targets = kind === 'feature' ? ['develop'] : [trunk(), 'develop']
  if (!(await ask(`Selesaikan ${br}? Branch ini di-merge --no-ff ke ${targets.join(' lalu ')}, lalu dihapus.`, { kind: 'warning' }))) return
  run('Gitflow finish', async () => {
    for (const t of targets) {
      await g('switch', t)
      await g('merge', '--no-ff', '--no-edit', br)
      if (kind !== 'feature' && t === trunk()) await g('tag', '-a', br.slice(kind.length + 1), '-m', br)
    }
    await g('branch', '-d', br)
  })
}
