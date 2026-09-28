// The startup splash (its own small window, see src-tauri/src/brand.rs).
// The main app reports loading stages 1..3; each turns one dot green. Once
// all three are green the splash fades out and the main window appears.
import '@fontsource-variable/archivo'
import '@/theme/style.css'
import '@/theme/splash.css'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { applyAppearance, tokenHex } from '@/theme/themes'
import { readSavedAppearance } from '@/composables/settings'

const saved = readSavedAppearance()
applyAppearance(saved.theme, saved.accent, saved.reduceMotion, saved.custom)
// a green that reads well on this theme's background
const bg = tokenHex('--bg')
const light = parseInt(bg.slice(1, 3), 16) * 0.3 + parseInt(bg.slice(3, 5), 16) * 0.59 + parseInt(bg.slice(5, 7), 16) * 0.11 > 150
document.body.classList.toggle('splash-light', light)

const dots = [...document.querySelectorAll<HTMLElement>('.splash-dot')]
const bar = document.querySelector('.splash-dots')
const openedAt = performance.now()

/** keeps each step visible for a moment, even when loading is instant */
const FIRST_AFTER = 450
const STEP_GAP = 320
/** long enough for the last dot's green to fully show */
const HOLD_AT_END = 700

let reported = 0
let shown = 0
let lastShownAt = 0
let timer: ReturnType<typeof setTimeout> | null = null
let finishing = false

function pump() {
    timer = null
    if (shown >= reported || shown >= dots.length) return
    const now = performance.now()
    const earliest = shown === 0 ? openedAt + FIRST_AFTER : lastShownAt + STEP_GAP
    if (now < earliest) {
        timer = setTimeout(pump, earliest - now)
        return
    }
    dots[shown].classList.add('done')
    shown++
    lastShownAt = now
    bar?.setAttribute('aria-valuenow', String(shown))
    if (shown === dots.length) setTimeout(finish, HOLD_AT_END)
    else pump()
}

function report(stage: number) {
    reported = Math.max(reported, Math.min(dots.length, stage))
    if (!timer) pump()
}

function finish() {
    if (finishing) return
    finishing = true
    document.body.classList.add('leaving')
    setTimeout(() => { invoke('finish_splash').catch(() => {}) }, 260)
}

listen<number>('splash_stage', e => report(e.payload)).catch(() => {})
// stages reported before this page finished loading
invoke<number>('get_splash_stage').then(report).catch(() => {})
