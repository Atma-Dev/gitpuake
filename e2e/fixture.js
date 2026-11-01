// Runs the real frontend (Vite) in WebKit with the Tauri backend replaced by a Node one that
// executes the same commands, so every flow touches real git in a throwaway repository.
import { test as base, expect } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// keep the user's own git config (signing, hooks, aliases) out of the tests
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' }

export const git = (repo, ...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' })
export const write = (repo, file, text) => fs.writeFileSync(path.join(repo, file), text)
export const read = (repo, file) => fs.readFileSync(path.join(repo, file), 'utf8')

export function makeRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpuake-e2e-'))
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.name', 'Puake Test')
  git(repo, 'config', 'user.email', 'test@example.invalid')
  write(repo, 'a.txt', 'one\ntwo\nthree\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'first commit')
  return repo
}

// Same contract as src-tauri/src/lib.rs: stdout on success, stderr as the error.
function exec(program, repo, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { cwd: repo, env })
    let out = '', err = ''
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (err += d))
    child.on('error', e => reject(new Error(`${program}: ${e.message}`)))
    child.on('close', code => (code !== 0 && err.trim() ? reject(new Error(err.trim())) : resolve(out)))
    child.stdin.on('error', () => {}) // git may exit before we write: EPIPE on Linux
    child.stdin.end(input ?? '')
  })
}

async function backend(cmd, a) {
  switch (cmd) {
    case 'git':
      return exec('git', a.repo, a.args, a.input)
    case 'shell':
      return exec('sh', a.repo, ['-c', a.line]).catch(e => String(e.message))
    case 'gh':
      // canned answers for the two calls the app makes on a GitHub remote; the rest behaves as "not installed"
      if (a.args[0] === 'api') return 'test@example.invalid\thttps://avatars.example.invalid/u/1\n'
      if (a.args[0] === 'search') return JSON.stringify([{ number: 7, title: 'Please review me', url: 'https://github.com/o/r/pull/7', repository: { nameWithOwner: 'o/r' } }])
    // fallthrough
    case 'glab':
      throw new Error(`${cmd}: No such file or directory (os error 2)`) // not installed
    case 'read_file':
      return read(a.repo, a.path)
    case 'write_file':
      return write(a.repo, a.path, a.content)
    case 'plugin:dialog|message': // confirm every dialog with its first button
      return a.buttons?.OkCancelCustom?.[0] ?? a.buttons?.YesNoCancelCustom?.[0] ?? 'Yes'
    case 'plugin:dialog|open':
      return null
    default:
      throw new Error('e2e backend: unknown command ' + cmd)
  }
}

export const test = base.extend({
  repo: async ({}, use) => {
    const repo = makeRepo()
    await use(repo)
    fs.rmSync(repo, { recursive: true, force: true })
  },
  // `setup(repo)` runs before the app loads, for state the app should find on start
  app: async ({ page, repo }, use) => {
    const errors = []
    page.on('pageerror', e => errors.push(e))
    await page.exposeFunction('__e2eInvoke', backend)
    await page.addInitScript(dir => {
      localStorage.setItem('repo', dir)
      localStorage.setItem('tabs', JSON.stringify([dir]))
      window.__TAURI_INTERNALS__ = {
        invoke: (cmd, args) => window.__e2eInvoke(cmd, args ?? {}),
        transformCallback: () => 0,
        unregisterCallback() {},
      }
    }, repo)
    const open = async () => {
      await page.goto('/')
      await expect(page.locator('.row .subject').first()).toBeVisible()
      return page
    }
    await use(open)
    expect(errors, 'uncaught errors in the page').toEqual([])
  },
})
export { expect }
