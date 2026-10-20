use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

// Runs `program <args>` with `repo` as working directory, feeding `input` to stdin
// (e.g. a patch for `git apply -`). Non-zero exit with empty stderr is still Ok,
// because `git diff --no-index` exits 1 when files differ.
fn exec(program: &str, repo: &str, args: &[String], input: Option<String>) -> Result<String, String> {
    let mut child = Command::new(program)
        .current_dir(repo)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0") // fail fast instead of hanging on credential prompts
        .env("GH_PROMPT_DISABLED", "1")
        .env("NO_PROMPT", "1") // glab
        .env("NO_COLOR", "1")
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{program}: {e}"))?;
    if let (Some(s), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin.write_all(s.as_bytes()).map_err(|e| e.to_string())?;
    } // stdin dropped here so the program sees EOF
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() && !stderr.is_empty() {
        return Err(stderr);
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[tauri::command]
async fn git(repo: String, args: Vec<String>, input: Option<String>) -> Result<String, String> {
    exec("git", &repo, &args, input)
}

// GitHub CLI, for pull requests; it uses the user's own `gh auth login`.
#[tauri::command]
async fn gh(repo: String, args: Vec<String>) -> Result<String, String> {
    exec("gh", &repo, &args, None)
}

// GitLab CLI, for merge requests and issues; it uses the user's own `glab auth login`.
#[tauri::command]
async fn glab(repo: String, args: Vec<String>) -> Result<String, String> {
    exec("glab", &repo, &args, None)
}

fn is_web_url(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("http://")) && !url.chars().any(|c| c.is_whitespace() || c.is_control())
}

// Opens an http(s) URL in the system browser (e.g. a Bitbucket pull request page).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !is_web_url(&url) {
        return Err(format!("{url}: bukan URL http(s)"));
    }
    let (program, pre): (&str, &[&str]) = if cfg!(windows) {
        ("rundll32", &["url.dll,FileProtocolHandler"])
    } else if cfg!(target_os = "macos") {
        ("open", &[])
    } else {
        ("xdg-open", &[])
    };
    let mut child = Command::new(program).args(pre).arg(&url).spawn().map_err(|e| format!("{program}: {e}"))?;
    std::thread::spawn(move || child.wait()); // reap it so no zombie is left behind
    Ok(())
}

// Resolves `path` (relative to `repo`) to an existing file inside the repository,
// refusing absolute paths, `..` and symlinks that lead outside it.
fn repo_file(repo: &str, path: &str) -> Result<PathBuf, String> {
    let rel = Path::new(path);
    if rel.is_absolute() || rel.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("{path}: path di luar repository"));
    }
    let root = std::fs::canonicalize(repo).map_err(|e| e.to_string())?;
    let real = std::fs::canonicalize(root.join(rel)).map_err(|e| format!("{path}: {e}"))?;
    if !real.starts_with(&root) {
        return Err(format!("{path}: path di luar repository"));
    }
    Ok(real)
}

#[tauri::command]
fn read_file(repo: String, path: String) -> Result<String, String> {
    std::fs::read_to_string(repo_file(&repo, &path)?).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(repo: String, path: String, content: String) -> Result<(), String> {
    std::fs::write(repo_file(&repo, &path)?, content).map_err(|e| e.to_string())
}

const MAX_IMAGE: usize = 10 * 1024 * 1024;

// Base64 of file bytes for the image diff, refusing anything over MAX_IMAGE.
fn encode_capped(bytes: &[u8]) -> Result<String, String> {
    use base64::Engine;
    if bytes.len() > MAX_IMAGE {
        return Err(format!("Gambar terlalu besar ({} MB, maks 10 MB)", bytes.len() / 1024 / 1024));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

// `<rev>:<path>` for `git cat-file`; an empty rev means the index (`:<path>`).
fn blob_spec(rev: &str, path: &str) -> Result<String, String> {
    if rev.starts_with('-') {
        return Err(format!("{rev}: revisi tidak valid"));
    }
    Ok(format!("{rev}:{path}"))
}

// File bytes as base64: from git (`rev` given, "" = index) or from the working tree.
// ponytail: blobs are read whole before the size check; check `cat-file -s` first if huge blobs matter
#[tauri::command]
async fn file_base64(repo: String, path: String, rev: Option<String>) -> Result<String, String> {
    let Some(rev) = rev else {
        return encode_capped(&std::fs::read(repo_file(&repo, &path)?).map_err(|e| e.to_string())?);
    };
    let out = Command::new("git")
        .current_dir(&repo)
        .args(["cat-file", "blob", &blob_spec(&rev, &path)?])
        .output()
        .map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    encode_capped(&out.stdout)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![git, gh, glab, open_url, read_file, write_file, file_base64])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{MAX_IMAGE, blob_spec, encode_capped, is_web_url, repo_file};

    #[test]
    fn image_bytes_are_capped_and_encoded() {
        assert_eq!(encode_capped(b"\x89PNG").unwrap(), "iVBORw==");
        assert!(encode_capped(&vec![0; MAX_IMAGE + 1]).is_err());
        assert_eq!(blob_spec("", "a.png").unwrap(), ":a.png");
        assert_eq!(blob_spec("HEAD~1", "a.png").unwrap(), "HEAD~1:a.png");
        assert!(blob_spec("--output=x", "a.png").is_err());
    }

    #[test]
    fn open_url_only_takes_web_urls() {
        assert!(is_web_url("https://bitbucket.org/ws/repo/pull-requests/new?source=a%2Fb"));
        assert!(!is_web_url("file:///etc/passwd"));
        assert!(!is_web_url("javascript:alert(1)"));
        assert!(!is_web_url("https://x.org/a b"));
    }

    #[test]
    fn repo_file_stays_inside_repo() {
        let base = std::env::temp_dir().join(format!("gitpuake-test-{}", std::process::id()));
        let repo = base.join("repo");
        std::fs::create_dir_all(repo.join("src")).unwrap();
        std::fs::write(repo.join("src/a.txt"), "ok").unwrap();
        std::fs::write(base.join("secret.txt"), "no").unwrap();
        std::os::unix::fs::symlink(base.join("secret.txt"), repo.join("link.txt")).unwrap();
        let r = repo.to_str().unwrap();

        assert!(repo_file(r, "src/a.txt").is_ok());
        assert!(repo_file(r, "../secret.txt").is_err());
        assert!(repo_file(r, "src/../../secret.txt").is_err());
        assert!(repo_file(r, base.join("secret.txt").to_str().unwrap()).is_err());
        assert!(repo_file(r, "link.txt").is_err()); // symlink pointing outside
        std::fs::remove_dir_all(&base).unwrap();
    }
}
