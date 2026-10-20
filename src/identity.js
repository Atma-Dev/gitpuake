import { reactive } from 'vue'

const KEYS = ['name', 'email', 'signingkey']

// user.* from git config; `scope` is '--local', '--global' or '' for the effective value.
export async function readIdentity(g, scope = '') {
  const get = k => g('config', ...(scope ? [scope] : []), '--get', 'user.' + k).then(s => s.trim(), () => '')
  const [name, email, signingkey] = await Promise.all(KEYS.map(get))
  return { name, email, signingkey }
}

// Writes the user.* keys present in `id`; an empty value unsets the key, so
// writing back a readIdentity() result restores it exactly (used for undo).
export async function writeIdentity(g, scope, id) {
  for (const k of KEYS) {
    if (!(k in id)) continue
    const v = id[k].trim()
    await (v ? g('config', scope, 'user.' + k, v) : g('config', scope, '--unset', 'user.' + k))
  }
}

// `git log --format=%G?%x1f%GS` codes; N (no signature) gets no badge.
const SIG = {
  G: ['Terverifikasi', 'ok'],
  U: ['Valid, kunci belum dipercaya', 'warn'],
  X: ['Valid, tanda tangan kedaluwarsa', 'warn'],
  Y: ['Valid, kunci kedaluwarsa', 'warn'],
  R: ['Valid, kunci sudah dicabut', 'bad'],
  E: ['Tidak bisa dicek, kunci tidak ada', 'warn'],
  B: ['Tanda tangan tidak valid', 'bad'],
}
export function parseSig(out) {
  const [code, signer] = out.trim().split('\x1f')
  return SIG[code] ? { code, label: SIG[code][0], tone: SIG[code][1], signer: signer?.trim() ?? '' } : null
}

// Gravatar accepts SHA-256 of the trimmed, lowercased email.
export async function gravatarUrl(email) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
  const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
  return `https://gravatar.com/avatar/${hex}?s=64&d=identicon`
}

// Render-safe lookup: returns '' until the hash is ready, then the template re-renders.
const urls = reactive({})
const pending = new Set()
export function avatar(email) {
  const k = email?.trim().toLowerCase()
  if (!k) return ''
  if (!pending.has(k)) {
    pending.add(k)
    gravatarUrl(k).then(u => (urls[k] = u))
  }
  return urls[k] ?? ''
}
