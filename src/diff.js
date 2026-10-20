// Splits single-file `git diff` output into its file header and hunks.
// Each hunk keeps `raw` lines (for building a patch) and numbered `rows`.
export function parseDiff(text) {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const header = [], hunks = []
  let h = null, o = 0, n = 0
  for (const l of lines) {
    const m = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (m) {
      o = +m[1]
      n = +m[2]
      h = { header: l, raw: [], rows: [] }
      hunks.push(h)
      continue
    }
    if (!h) {
      header.push(l)
      continue
    }
    h.raw.push(l)
    if (l[0] === '+') h.rows.push({ type: 'add', n: n++, text: l.slice(1) })
    else if (l[0] === '-') h.rows.push({ type: 'del', o: o++, text: l.slice(1) })
    else if (l[0] !== '\\') h.rows.push({ type: 'ctx', o: o++, n: n++, text: l.slice(1) })
  }
  return { header, hunks }
}

// A patch containing only hunk `h`, for `git apply`.
export const hunkPatch = (d, h) => [...d.header, h.header, ...h.raw, ''].join('\n')

// Pairs each run of deletions with the additions after it, for side-by-side view.
export function split(rows) {
  const out = []
  for (let i = 0; i < rows.length; ) {
    if (rows[i].type === 'ctx') {
      out.push([rows[i], rows[i]])
      i++
      continue
    }
    const del = [], add = []
    while (rows[i]?.type === 'del') del.push(rows[i++])
    while (rows[i]?.type === 'add') add.push(rows[i++])
    for (let k = 0; k < Math.max(del.length, add.length); k++) out.push([del[k] ?? null, add[k] ?? null])
  }
  return out
}
