use std::io::Write;
use std::process::{Command, Stdio};

// Runs `git <args>` inside `repo`, feeding `input` to stdin (e.g. a patch for `git apply -`).
// Non-zero exit with empty stderr is still Ok, because `git diff --no-index` exits 1 when files differ.
#[tauri::command]
async fn git(repo: String, args: Vec<String>, input: Option<String>) -> Result<String, String> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(&args)
        .env("GIT_TERMINAL_PROMPT", "0") // fail fast instead of hanging on credential prompts
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let (Some(s), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin.write_all(s.as_bytes()).map_err(|e| e.to_string())?;
    } // stdin dropped here so git sees EOF
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() && !stderr.is_empty() {
        return Err(stderr);
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![git])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
