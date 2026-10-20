# gitpuake

Git client desktop ala GitKraken — Tauri 2 + Vue 3. Backend cuma menjalankan `git` CLI.

Fitur: commit graph, stage/unstage per file, per hunk, atau per baris, riwayat file & blame, diff split/unified dengan syntax highlight, discard, commit + amend, stash,
branch (buat/checkout/merge/rebase/hapus), interactive rebase, undo (Ctrl+Z), banner conflict, cari commit (Ctrl+F),
ahead/behind, menu klik kanan commit (checkout, branch, tag, cherry-pick, revert, reset), kelola remote & tag,
fetch/pull/push (force push dengan --force-with-lease saat ditolak), auto-fetch (interval diatur di Pengaturan), tab multi-repo,
editor merge conflict, virtual scroll (hingga 20.000 commit), Pull Request GitHub (lihat, checkout, buat, detail: checks, komentar, review, merge, diff file),
issue (lihat, buat, buat branch dari issue), Merge Request & issue GitLab, link PR Bitbucket di browser,
halaman Pengaturan (identitas git lokal/global, profil identitas sekali klik, diff bawaan), status tanda tangan commit,
avatar Gravatar (mati secara bawaan karena mengirim hash email author ke gravatar.com),
pull merge/rebase/fast-forward, merge --no-ff/squash, submodule, worktree, Git LFS (pull, track pola),
bandingkan dua commit (Ctrl+klik), seret branch untuk merge/rebase, filter graph (sembunyikan / solo branch),
opsi diff (abaikan spasi, beda per kata), diff gambar berdampingan, simpan / terapkan patch (format-patch, am, apply), stash per file, dan command palette (Ctrl+P) dengan shortcut keyboard.


## Jalankan

Butuh: Rust (`~/.cargo/bin` di PATH), Node, git, dan dependency sistem Tauri (webkit2gtk-4.1).
Opsional: [GitHub CLI](https://cli.github.com) (`gh auth login`) untuk fitur Pull Request & issue,
[GitLab CLI](https://gitlab.com/gitlab-org/cli) (`glab auth login`) untuk Merge Request GitLab.

```sh
npm install
npm run tauri dev      # development
npm run tauri build    # bundle rilis
for t in src/*.test.js; do node "$t"; done # self-check
(cd src-tauri && cargo test --lib)         # cek keamanan path file
```

## Rilis & update

Rilis dibangun otomatis oleh GitHub Actions (`.github/workflows/release.yml`) di Linux, macOS, dan Windows.

1. Samakan versi di `package.json`, `src-tauri/tauri.conf.json`, dan `src-tauri/Cargo.toml`, commit.
2. `git tag v0.2.0 && git push --tags`
3. Setelah workflow selesai, buka tab **Releases** di GitHub: ada rilis **draft** berisi `.deb`, `.AppImage`, `.rpm`
   (Linux), `.dmg` (macOS), `.msi` + `-setup.exe` (Windows). Cek, lalu klik **Publish**.

Workflow juga bisa dijalankan manual (Actions → release → Run workflow). Build lokal: `npm run tauri build -- --bundles deb`
→ `src-tauri/target/release/bundle/deb/`. Paket `.deb` otomatis bergantung pada `git`.

**Auto-update belum aktif** karena butuh kunci tanda tangan yang hanya boleh dipegang pemilik repo. Untuk mengaktifkan:

1. `npx tauri signer generate -w ~/.tauri/gitpuake.key` — simpan private key dan password-nya baik-baik (jangan di-commit).
2. Di GitHub → Settings → Secrets → Actions, tambahkan `TAURI_SIGNING_PRIVATE_KEY` (isi file key) dan
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, lalu teruskan keduanya sebagai `env` di langkah `tauri-action` pada `release.yml`.
3. `npm run tauri add updater` (menambah crate `tauri-plugin-updater`, paket `@tauri-apps/plugin-updater`, dan permission).
4. Di `tauri.conf.json`: `"bundle": { "createUpdaterArtifacts": true }` dan
   `"plugins": { "updater": { "pubkey": "<isi file .key.pub>", "endpoints": ["https://github.com/Atma-Dev/gitpuake/releases/latest/download/latest.json"] } }`.
5. Di `release.yml` tambahkan `includeUpdaterJson: true` pada `tauri-action`, lalu panggil `check()` dari
   `@tauri-apps/plugin-updater` di frontend (mis. saat start) dan `downloadAndInstall()` bila ada versi baru.
