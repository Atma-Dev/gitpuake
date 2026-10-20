import hljs from 'highlight.js/lib/common'

// Adds `html` (escaped, highlighted) to each row that has `text`, picking the language from the file extension.
// ponytail: highlights line by line, so strings/comments spanning several lines are not tracked
export function highlightRows(rows, path) {
  const ext = path.split('/').pop().split('.').pop().toLowerCase()
  const lang = hljs.getLanguage(ext) ? ext : ext === 'vue' ? 'xml' : null
  if (!lang) return
  for (const r of rows) r.html = hljs.highlight(r.text, { language: lang, ignoreIllegals: true }).value
}
