export const ACTIONS = ['pick', 'reword', 'squash', 'fixup', 'drop']

const shq = s => "'" + s.replace(/'/g, "'\\''") + "'"

// Builds a `git rebase -i` todo from items listed newest first (as in the graph).
// Reword becomes pick + an exec that amends only the subject, keeping the body.
export function buildTodo(items) {
  const lines = []
  for (const it of [...items].reverse()) {
    if (it.action !== 'reword') lines.push(`${it.action} ${it.hash}`)
    else {
      const subject = it.msg.replace(/\s*\n\s*/g, ' ').trim()
      lines.push(`pick ${it.hash}`, `exec git commit --amend -q -m ${shq(subject)} -m "$(git log -1 --format=%b)"`)
    }
  }
  return lines.join('\n') + '\n'
}

// Returns why the plan can't run, or '' when it can.
export function validate(items) {
  const kept = [...items].reverse().filter(it => it.action !== 'drop')
  if (['squash', 'fixup'].includes(kept[0]?.action)) return 'Commit paling lama tidak bisa di-squash/fixup karena tidak ada commit sebelumnya untuk digabung.'
  if (items.some(it => it.action === 'reword' && !it.msg.trim())) return 'Pesan reword tidak boleh kosong.'
  return ''
}
