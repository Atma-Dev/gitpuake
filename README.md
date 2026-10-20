# gitpuake

Git client desktop ala GitKraken — Tauri 2 + Vue 3. Backend cuma menjalankan `git` CLI.

Fitur: commit graph, stage/unstage + diff, commit, buat/checkout/merge/hapus branch, fetch/pull/push.

## Jalankan

Butuh: Rust (`~/.cargo/bin` di PATH), Node, git, dan dependency sistem Tauri (webkit2gtk-4.1).

```sh
npm install
npm run tauri dev      # development
npm run tauri build    # bundle rilis
node src/graph.test.js # self-check algoritma graph
```
