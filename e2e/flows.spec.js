import { test, expect, git, write, read } from './fixture.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const subjects = page => page.locator('.history .row:not(.wip) .subject')
const undoBtn = page => page.getByRole('button', { name: /Undo/ })
// row buttons show on hover; `name` is the button text or its title
const fileAction = async (page, file, name) => {
  const row = page.locator('.file', { hasText: file })
  await row.hover()
  await row.getByRole('button', { name, exact: true }).or(row.getByTitle(name)).click()
}

test('stage, commit and undo the commit', async ({ app, repo }) => {
  write(repo, 'a.txt', 'one\ntwo\nthree\nfour\n')
  const page = await app()
  await fileAction(page, 'a.txt', 'Stage')
  await page.getByPlaceholder('Commit message').fill('add four')
  await page.getByRole('button', { name: 'Commit 1 file' }).click()
  await expect(subjects(page).first()).toHaveText('add four')

  await undoBtn(page).click()
  await expect(subjects(page).first()).toHaveText('first commit')
  await expect(page.getByText('Staged (1)')).toBeVisible() // the change is back in the index
  expect(git(repo, 'diff', '--cached', '--name-only').trim()).toBe('a.txt')
})

test('discard a file, then undo brings the change back', async ({ app, repo }) => {
  write(repo, 'a.txt', 'changed\n')
  const page = await app()
  await fileAction(page, 'a.txt', 'Buang perubahan')
  await expect(page.getByText('Unstaged (0)')).toBeVisible()
  expect(read(repo, 'a.txt')).toBe('one\ntwo\nthree\n')

  await undoBtn(page).click()
  await expect(page.getByText('Unstaged (1)')).toBeVisible()
  expect(read(repo, 'a.txt')).toBe('changed\n')
})

test('stage a single hunk from the diff', async ({ app, repo }) => {
  write(repo, 'a.txt', Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n') + '\n')
  git(repo, 'commit', '-qam', 'thirty lines')
  write(repo, 'a.txt', read(repo, 'a.txt').replace('line 1\n', 'LINE 1\n').replace('line 28\n', 'LINE 28\n'))
  const page = await app()
  await page.locator('.file', { hasText: 'a.txt' }).click()
  await expect(page.locator('.hunk')).toHaveCount(2)
  await page.locator('.hunk').first().getByRole('button', { name: 'Stage hunk' }).click()
  await expect.poll(() => git(repo, 'diff', '--cached')).toContain('+LINE 1')
  expect(git(repo, 'diff', '--cached')).not.toContain('LINE 28')
})

test('resolve a merge conflict in the editor and continue', async ({ app, repo }) => {
  git(repo, 'switch', '-qc', 'feature')
  write(repo, 'a.txt', 'one\nfeature\nthree\n')
  git(repo, 'commit', '-qam', 'feature change')
  git(repo, 'switch', '-q', 'main')
  write(repo, 'a.txt', 'one\nmain\nthree\n')
  git(repo, 'commit', '-qam', 'main change')
  try {
    git(repo, 'merge', 'feature')
  } catch {} // conflict expected

  const page = await app()
  await expect(page.locator('.op-banner')).toContainText('Merge sedang berlangsung')
  await page.locator('.conflicts .file', { hasText: 'a.txt' }).click()
  await page.locator('.conflict .side').nth(1).getByRole('button', { name: 'Pakai ini' }).click()
  await page.getByRole('button', { name: 'Simpan & tandai selesai' }).click()
  await expect.poll(() => read(repo, 'a.txt')).toBe('one\nfeature\nthree\n')

  await page.locator('.op-banner').getByRole('button', { name: 'Continue' }).click()
  await expect(page.locator('.op-banner')).toHaveCount(0)
  expect(git(repo, 'log', '-1', '--format=%P').trim().split(' ')).toHaveLength(2) // a merge commit
})

test('command palette checks out a branch', async ({ app, repo }) => {
  git(repo, 'branch', 'feature')
  const page = await app()
  await page.keyboard.press('Control+p')
  await page.getByPlaceholder('Ketik perintah').fill('checkout feature')
  await expect(page.getByRole('option', { name: 'Checkout feature' })).toBeVisible() // branches load after the first paint
  await page.keyboard.press('Enter')
  await expect(page.locator('.toolbar .head')).toHaveText('feature')
  expect(git(repo, 'branch', '--show-current').trim()).toBe('feature')
})

const commitFile = (repo, name) => {
  write(repo, name, name)
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', name)
}

test('shift-click two commits and squash them through the rebase plan', async ({ app, repo }) => {
  commitFile(repo, 'b.txt')
  commitFile(repo, 'c.txt')
  const page = await app()
  await subjects(page).filter({ hasText: 'c.txt' }).click()
  await subjects(page).filter({ hasText: 'b.txt' }).click({ modifiers: ['Shift'] })
  await subjects(page).filter({ hasText: 'b.txt' }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Squash jadi satu…' }).click()
  await page.getByRole('button', { name: 'Mulai rebase' }).click()
  await expect(subjects(page)).toHaveText([/^b\.txt/, 'first commit'])
  expect(git(repo, 'rev-list', '--count', 'HEAD').trim()).toBe('2')
})

test('reword an older commit from the context menu', async ({ app, repo }) => {
  commitFile(repo, 'b.txt')
  commitFile(repo, 'c.txt')
  const page = await app()
  await subjects(page).filter({ hasText: 'b.txt' }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Edit pesan commit…' }).click()
  await page.getByLabel('Judul commit baru').fill('renamed b')
  await page.getByRole('button', { name: 'Mulai rebase' }).click()
  await expect(subjects(page)).toHaveText(['c.txt', 'renamed b', 'first commit'])
})

test('reflog lists HEAD moves', async ({ app }) => {
  const page = await app()
  await page.keyboard.press('Control+P')
  await page.getByPlaceholder(/perintah/i).fill('reflog')
  await page.keyboard.press('Enter')
  await expect(page.locator('.reflog li').first()).toContainText('commit')
})

test('tree view groups files under their folder', async ({ app, repo }) => {
  fs.mkdirSync(path.join(repo, 'src'))
  write(repo, 'src/x.txt', 'x')
  write(repo, 'a.txt', 'changed\n')
  const page = await app()
  await page.keyboard.press('Control+P')
  await page.getByPlaceholder(/perintah/i).fill('pohon')
  await page.keyboard.press('Enter')
  await expect(page.locator('.dirhead', { hasText: 'src' })).toBeVisible()
  await expect(page.locator('.file', { hasText: 'x.txt' }).locator('.name')).toHaveText('x.txt')
})

test('delete a branch on the remote', async ({ app, repo }) => {
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpuake-remote-'))
  git(remote, 'init', '-q', '--bare')
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'push', '-q', 'origin', 'main:main', 'main:old')
  git(repo, 'fetch', '-q')
  const page = await app()
  await page.getByText('Remote', { exact: false }).first().click() // sections start collapsed
  const row = page.locator('.branch.nested', { hasText: 'old' })
  await row.hover()
  await row.getByTitle('Hapus branch di remote').click()
  await expect(row).toHaveCount(0)
  expect(git(remote, 'branch', '--list').includes('old')).toBe(false)
  await page.getByRole('button', { name: /Undo/ }).click()
  await expect(page.locator('.branch.nested', { hasText: 'old' })).toHaveCount(1)
  fs.rmSync(remote, { recursive: true, force: true })
})

test('terminal runs a command in the repo', async ({ app }) => {
  const page = await app()
  await page.keyboard.press('Control+`')
  await page.getByPlaceholder('perintah shell di folder repo').fill('cat a.txt')
  await page.keyboard.press('Enter')
  await expect(page.locator('.term-log pre')).toContainText('two')
})

test('bisect: start, mark and reset', async ({ app, repo }) => {
  for (const n of ['b', 'c', 'd']) commitFile(repo, n + '.txt')
  const page = await app()
  await subjects(page).filter({ hasText: 'd.txt' }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Bisect: mulai, commit ini bad' }).click()
  await expect(page.locator('.bisect-banner')).toBeVisible()
  await subjects(page).filter({ hasText: 'first commit' }).click({ button: 'right' })
  await page.getByRole('button', { name: 'Bisect: commit ini good' }).click()
  await expect(page.locator('.error.info')).toContainText('Bisecting')
  await page.locator('.bisect-banner').getByRole('button', { name: 'Selesai (reset)' }).click()
  await expect(page.locator('.bisect-banner')).toHaveCount(0)
})

test('gitflow: start a feature and finish it', async ({ app, repo }) => {
  const page = await app()
  await page.getByText('Gitflow').click()
  await page.getByPlaceholder(/Nama \(misalnya/).fill('login')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect.poll(() => git(repo, 'branch', '--show-current').trim()).toBe('feature/login')
  commitFile(repo, 'login.txt')
  await page.reload()
  await page.getByRole('button', { name: 'Finish feature/login' }).click()
  // finish switches, merges, then deletes the branch; wait for the last step
  await expect.poll(() => git(repo, 'branch', '--list', 'feature/*').trim()).toBe('')
  expect(git(repo, 'branch', '--show-current').trim()).toBe('develop')
  expect(git(repo, 'log', '-1', '--format=%P', 'develop').trim().split(' ')).toHaveLength(2) // --no-ff merge commit
})

test('theme switches to light from the palette', async ({ app }) => {
  const page = await app()
  await page.keyboard.press('Control+P')
  await page.getByPlaceholder(/perintah/i).fill('tema')
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})

test('github remote: committer photo on the graph node and PRs waiting for review', async ({ app, repo }) => {
  git(repo, 'remote', 'add', 'origin', 'git@github.com:o/r.git')
  const page = await app()
  await expect(page.locator('svg.graph image').first()).toHaveAttribute('href', /avatars\.example\.invalid\/u\/1\?s=64/)
  await page.getByRole('button', { name: /1 PR perlu review/ }).click()
  await expect(page.locator('.review-list')).toContainText('o/r#7 Please review me')
})
