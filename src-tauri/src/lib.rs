use std::process::Command;

// Runs `git <args>` inside `repo`. Non-zero exit with empty stderr is still Ok,
// because `git diff --no-index` exits 1 when files differ.
#[tauri::command]
async fn git(repo: String, args: Vec<String>) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .args(&args)
        .env("GIT_TERMINAL_PROMPT", "0") // fail fast instead of hanging on credential prompts
        .output()
        .map_err(|e| e.to_string())?;
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
