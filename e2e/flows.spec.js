import { test, expect, git, write, read } from './fixture.js'

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
  await page.keyboard.press('Enter')
  await expect(page.locator('.toolbar .head')).toHaveText('⎇ feature')
  expect(git(repo, 'branch', '--show-current').trim()).toBe('feature')
})
