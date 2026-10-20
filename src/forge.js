// Which forge hosts a remote: { forge: 'github' | 'gitlab' | 'bitbucket' | null, host, path }.
// Handles scp-style (git@host:a/b.git), ssh:// (optional port) and http(s):// URLs.
export function parseRemote(url) {
  const m = url?.trim().match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i)
  if (!m) return null
  const host = m[1].toLowerCase()
  const forge = /(^|\.)github\.com$/.test(host) ? 'github' : /(^|\.)gitlab\./.test(host) ? 'gitlab' : host === 'bitbucket.org' ? 'bitbucket' : null
  return { forge, host, path: m[2] }
}

// "Fix: crash on ünïcode title!" -> "fix-crash-on-unicode-title"
export const slug = s =>
  s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50).replace(/^-+|-+$/g, '')
export const issueBranch = (n, title) => [n, slug(title)].filter(Boolean).join('-')

// Splits a multi-file unified diff (`gh pr diff`) into [{ path, text }] for parseDiff.
export function splitDiff(text) {
  return text.split(/^(?=diff --git )/m).filter(t => t.startsWith('diff --git ')).map(t => ({
    path: t.match(/^\+\+\+ b\/(.+)$/m)?.[1] ?? t.match(/^diff --git a\/.+ b\/(.+)$/m)[1], // deleted files have +++ /dev/null
    text: t,
  }))
}

// CLI failure -> 'missing' (not installed) | 'auth' (not logged in) | the message.
export function cliError(e, cli) {
  const msg = String(e)
  return msg.startsWith(cli + ': ') && /No such file|os error 2|not found/.test(msg) ? 'missing'
    : /auth login|not logged|401|unauthori[sz]ed|no token/i.test(msg) ? 'auth'
    : msg
}
