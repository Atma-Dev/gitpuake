# gitpuake

Git client desktop ala GitKraken — Tauri 2 + Vue 3. Backend cuma menjalankan `git` CLI.

Fitur: commit graph, stage/unstage per file, per hunk, atau per baris, riwayat file & blame, diff split/unified dengan syntax highlight, discard, commit + amend, stash,
branch (buat/checkout/merge/rebase/hapus), interactive rebase, undo (Ctrl+Z), banner conflict, cari commit (Ctrl+F),
ahead/behind, menu klik kanan commit (checkout, branch, tag, cherry-pick, revert, reset), kelola remote & tag,
fetch/pull/push (force push dengan --force-with-lease saat ditolak), auto-fetch tiap 5 menit, tab multi-repo,
editor merge conflict, virtual scroll (hingga 20.000 commit), Pull Request GitHub (lihat, checkout, buat),
opsi diff (abaikan spasi, beda per kata), diff gambar berdampingan, simpan / terapkan patch (format-patch, am, apply), dan stash per file.

## Jalankan

Butuh: Rust (`~/.cargo/bin` di PATH), Node, git, dan dependency sistem Tauri (webkit2gtk-4.1).
Opsional: [GitHub CLI](https://cli.github.com) (`gh auth login`) untuk fitur Pull Request.

```sh
npm install
npm run tauri dev      # development
npm run tauri build    # bundle rilis
for t in graph diff rebase blame merge words; do node src/$t.test.js; done # self-check
(cd src-tauri && cargo test --lib)                                # cek keamanan path file
```
