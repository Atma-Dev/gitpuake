const SEP = '\x1f'
export const LOG_FORMAT = '--format=' + ['%H', '%P', '%D', '%an', '%at', '%s'].join('%x1f')

export function parseLog(out) {
  return out.split('\n').filter(Boolean).map(line => {
    const [hash, parents, refs, author, time, subject] = line.split(SEP)
    return {
      hash,
      parents: parents ? parents.split(' ') : [],
      refs: refs ? refs.split(', ') : [],
      author,
      time: +time,
      subject,
    }
  })
}

const free = lanes => {
  const i = lanes.indexOf(null)
  return i === -1 ? lanes.length : i
}

// Assigns each commit (in topo order, newest first) a lane `col`, plus the
// line segments of its row as [fromLane, toLane, kind]:
//   'pass'   vertical through the row, 'top' upper half into the node,
//   'bottom' lower half from the node toward a parent's lane.
// lanes[i] holds the hash lane i is waiting for; indices stay stable.
export function layout(commits) {
  const lanes = []
  let width = 1
  for (const c of commits) {
    let col = lanes.indexOf(c.hash)
    if (col === -1) col = free(lanes)
    c.col = col
    c.lines = []
    lanes.forEach((h, i) => {
      if (h === null || h === undefined) return
      if (h === c.hash) {
        c.lines.push([i, col, 'top'])
        lanes[i] = null
      } else c.lines.push([i, i, 'pass'])
    })
    c.parents.forEach((p, n) => {
      let j = n === 0 ? col : lanes.indexOf(p)
      if (j === -1) j = free(lanes)
      lanes[j] = p
      c.lines.push([col, j, 'bottom'])
    })
    while (lanes.length && lanes.at(-1) == null) lanes.pop()
    width = Math.max(width, lanes.length, col + 1)
  }
  return width
}
