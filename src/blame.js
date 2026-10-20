// Parses `git blame --porcelain` into one entry per line: { hash, n, text, author, time, summary }.
// Commit details appear only the first time a hash shows up, so they are kept per hash.
export function parseBlame(out) {
  const info = {}, lines = []
  let cur
  for (const l of out.split('\n')) {
    if (l.startsWith('\t')) {
      lines.push({ ...info[cur.hash], hash: cur.hash, n: cur.n, text: l.slice(1) })
      continue
    }
    const m = l.match(/^([0-9a-f]{40}) \d+ (\d+)/)
    if (m) {
      cur = { hash: m[1], n: +m[2] }
      info[m[1]] ??= {}
      continue
    }
    const sp = l.indexOf(' ')
    const [k, v] = [l.slice(0, sp), l.slice(sp + 1)]
    if (k === 'author') info[cur.hash].author = v
    else if (k === 'author-time') info[cur.hash].time = +v
    else if (k === 'summary') info[cur.hash].summary = v
  }
  return lines
}
