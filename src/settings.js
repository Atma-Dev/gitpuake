import { reactive, watch } from 'vue'

// App settings, persisted as one JSON blob. Read anywhere: `settings.avatars`.
const DEFAULTS = {
  fetchMinutes: 5, // 0 = auto-fetch off
  diffMode: localStorage.getItem('diffMode') || 'split', // older builds kept this under its own key
  avatars: false, // Gravatar: sends a hash of each author email to gravatar.com
  treeView: false, // file lists grouped by folder
  profiles: [], // [{ label, name, email, signingkey }]
}
let saved = {}
try {
  saved = JSON.parse(localStorage.getItem('settings') || '{}')
} catch {}
export const settings = reactive({ ...DEFAULTS, ...saved })
watch(settings, s => localStorage.setItem('settings', JSON.stringify(s)), { deep: true })
