import { reactive, watch } from 'vue'
import { getCurrentWebview } from '@tauri-apps/api/webview'

// App settings, persisted as one JSON blob. Read anywhere: `settings.avatars`.
const DEFAULTS = {
  fetchMinutes: 5, // 0 = auto-fetch off
  diffMode: localStorage.getItem('diffMode') || 'split', // older builds kept this under its own key
  avatars: false, // Gravatar: sends a hash of each author email to gravatar.com
  zoom: 100, // percent, applied to the whole webview
  showAuthor: true, // graph columns
  showDate: true,
  theme: 'dark', // dark | light | auto (follow the system)
  treeView: false, // file lists grouped by folder
  profiles: [], // [{ label, name, email, signingkey }]
}
let saved = {}
try {
  saved = JSON.parse(localStorage.getItem('settings') || '{}')
} catch {}
export const settings = reactive({ ...DEFAULTS, ...saved })
watch(settings, s => localStorage.setItem('settings', JSON.stringify(s)), { deep: true })

const dark = matchMedia('(prefers-color-scheme: dark)')
const applyTheme = () => (document.documentElement.dataset.theme = settings.theme === 'auto' ? (dark.matches ? 'dark' : 'light') : settings.theme)
watch(() => settings.theme, applyTheme, { immediate: true })
dark.addEventListener('change', applyTheme)

export const ZOOMS = [70, 80, 90, 100, 110, 125, 150, 175, 200]
export const stepZoom = d => {
  const i = ZOOMS.findIndex(z => z >= settings.zoom)
  settings.zoom = ZOOMS[Math.min(Math.max((i < 0 ? ZOOMS.length - 1 : i) + d, 0), ZOOMS.length - 1)]
}
// native webview zoom keeps vh units and scrolling right; outside Tauri (browser) it's a no-op
watch(
  () => settings.zoom,
  async z => {
    try {
      await getCurrentWebview().setZoom(z / 100)
    } catch {}
  },
  { immediate: true },
)
