# gitpuake

Git client desktop ala GitKraken — Tauri 2 + Vue 3. Backend cuma menjalankan `git` CLI.

Fitur: commit graph, stage/unstage per file atau per hunk, diff split/unified, discard, commit + amend, stash,
branch (buat/checkout/merge/rebase/hapus), interactive rebase, undo (Ctrl+Z), banner conflict, cari commit (Ctrl+F),
ahead/behind, menu klik kanan commit (checkout, branch, tag, cherry-pick, revert, reset), fetch/pull/push.

## Jalankan

Butuh: Rust (`~/.cargo/bin` di PATH), Node, git, dan dependency sistem Tauri (webkit2gtk-4.1).

```sh
npm install
npm run tauri dev      # development
npm run tauri build    # bundle rilis
node src/graph.test.js && node src/diff.test.js && node src/rebase.test.js # self-check
```
