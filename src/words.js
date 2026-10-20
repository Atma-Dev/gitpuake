import { split } from './diff.js'

const esc = s => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const tokens = s => s.match(/\w+|\s+|[^\w\s]/g) ?? []

// Escaped HTML of `a` and `b` with the words not shared between them wrapped in <mark>,
// via an LCS over word/space/punctuation tokens. Null when the lines share no word (nothing to point at).
// ponytail: O(n·m) table; very long line pairs (>160k token pairs) are skipped, fine for code lines
export function wordDiff(a, b) {
  const x = tokens(a), y = tokens(b)
  if (x.length * y.length > 160000) return null
  const L = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1))
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const keepX = new Set(), keepY = new Set()
  for (let i = 0, j = 0; i < x.length && j < y.length; ) {
    if (x[i] === y[j]) keepX.add(i++), keepY.add(j++)
    else if (L[i + 1][j] >= L[i][j + 1]) i++
    else j++
  }
  if (![...keepX].some(i => x[i].trim())) return null
  const html = (t, keep) => {
    let out = '', open = false
    t.forEach((tok, i) => {
      const changed = !keep.has(i)
      if (changed !== open) out += (open = changed) ? '<mark>' : '</mark>'
      out += esc(tok)
    })
    return open ? out + '</mark>' : out
  }
  return [html(x, keepX), html(y, keepY)]
}

// Sets `words` (escaped HTML with marks) on each del/add pair of the hunk rows, as split view pairs them.
export function markWords(rows) {
  for (const [l, r] of split(rows)) if (l?.type === 'del' && r?.type === 'add') [l.words, r.words] = wordDiff(l.text, r.text) ?? []
}
