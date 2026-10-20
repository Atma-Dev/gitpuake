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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![git, gh, read_file, write_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::repo_file;

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
