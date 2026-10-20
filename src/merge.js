// Splits a file containing conflict markers into segments:
// { lines } for text both sides agree on, or a conflict
// { ours, base, theirs, oursLabel, baseLabel, theirsLabel, choice } (base only with diff3 style).
export function parseConflicts(text) {
  const segs = []
  let common = [], c = null, part = ''
  for (const l of text.split('\n')) {
    if (!c && l.startsWith('<<<<<<<')) {
      if (common.length) segs.push({ lines: common })
      common = []
      c = { ours: [], base: null, theirs: [], oursLabel: l.slice(8), baseLabel: '', theirsLabel: '', choice: null }
      part = 'ours'
    } else if (c && part === 'ours' && l.startsWith('|||||||')) {
      c.base = []
      c.baseLabel = l.slice(8)
      part = 'base'
    } else if (c && part !== 'theirs' && l === '=======') part = 'theirs'
    else if (c && part === 'theirs' && l.startsWith('>>>>>>>')) {
      c.theirsLabel = l.slice(8)
      segs.push(c)
      c = null
    } else if (c) c[part].push(l)
    else common.push(l)
  }
  if (c) throw new Error('Penanda conflict tidak lengkap; selesaikan file ini lewat Edit manual.')
  segs.push({ lines: common })
  return segs
}

const PICK = {
  ours: c => c.ours,
  theirs: c => c.theirs,
  both: c => [...c.ours, ...c.theirs],
  'both-rev': c => [...c.theirs, ...c.ours],
}
const markers = c => [
  '<<<<<<< ' + c.oursLabel,
  ...c.ours,
  ...(c.base ? ['||||||| ' + c.baseLabel, ...c.base] : []),
  '=======',
  ...c.theirs,
  '>>>>>>> ' + c.theirsLabel,
]

// Rebuilds the file from the segments; conflicts without a choice keep their markers.
export const compose = segs => segs.flatMap(s => s.lines ?? (s.choice ? PICK[s.choice](s) : markers(s))).join('\n')
