import { createGlobalState, useStorage } from '@vueuse/core'
import { watch, type Ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { applyAppearance, normalizeCustomTheme, THEMES, type CustomTheme, type ThemeId } from '@/theme/themes'
import { TERMS_VERSION } from '@/data/legal'

export const SETTINGS_KEY = 'dqc.settings.v1'

export type GuardSensitivity = 'relaxed' | 'balanced' | 'strict'

export interface GuardSettings {
    /** watch the PC during timed runs and cap how many games stay open */
    enabled: boolean;
    sensitivity: GuardSensitivity;
}

export interface BuddySettings {
    /** play games on its own while you're away (needs Launch on startup) */
    enabled: boolean;
    /** start after this many minutes without keyboard/mouse input */
    idleMinutes: number;
    /** a random number of games per day, between these two */
    gamesPerDayMin: number;
    gamesPerDayMax: number;
    /** 'library': any game in your library; 'installed': only games already set up on this PC */
    source: 'library' | 'installed';
    /** each game stays open a random time between these (minutes) */
    sessionMinMinutes: number;
    sessionMaxMinutes: number;
    /** at most this many at the same time */
    maxConcurrent: number;
    /** only between these hours (0-24, local time) */
    fromHour: number;
    toHour: number;
    /** and on these days (0 = Sunday) */
    days: number[];
    /** stop its games as soon as you're back at the PC */
    stopWhenBack: boolean;
    /** only play while Discord is running */
    requireDiscord: boolean;
    /** start Discord if it isn't running */
    openDiscord: boolean;
    /** close Discord again afterwards (only if Buddy opened it) */
    closeDiscordAfter: boolean;
    /** a game's time only counts once Discord has detected it */
    waitForDiscord: boolean;
}

export interface AppSettings {
    theme: ThemeId;
    /** hex color, or null to use the theme's own accent */
    accent: string | null;
    /** colors of the Custom theme (null until it's first picked) */
    customTheme: CustomTheme | null;
    reduceMotion: boolean;
    /** hide the app and the game windows after launching games */
    autoHide: boolean;
    /** the window's close button hides to the tray instead of quitting */
    closeToTray: boolean;
    /** bring the window back when a timed run finishes */
    showOnTimerEnd: boolean;
    /** last used timed-run settings */
    timerSeconds: number;
    timerMode: 'parallel' | 'sequential';
    timerOrder: 'fixed' | 'random';
    /** only start a game's countdown once Discord reports it as detected */
    timerWaitForDiscord: boolean;
    /** give up waiting for Discord after this long and start the countdown anyway */
    detectTimeoutSec: number;
    /** when the user accepted the risk notice (null = not yet) */
    riskAcceptedAt: number | null;
    /** when the user agreed to the Terms of Service and Terms of Use, and which version */
    termsAcceptedAt: number | null;
    termsVersion: string | null;
    /** how a launched game's window appears (Auto hide always hides it) */
    gameWindowMode: 'hidden' | 'parked' | 'visible';
    perfGuard: GuardSettings;
    buddy: BuddySettings;
}

/** Earlier versions stored the timer in whole minutes. */
function initialTimerSeconds() {
    try {
        const old = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
        if (typeof old.timerMinutes === 'number' && typeof old.timerSeconds !== 'number') return old.timerMinutes * 60
    } catch {
        // ignore unreadable storage
    }
    return 15 * 60
}

export const DEFAULT_BUDDY: BuddySettings = {
    enabled: false,
    idleMinutes: 30,
    gamesPerDayMin: 1,
    gamesPerDayMax: 5,
    source: 'library',
    sessionMinMinutes: 15,
    sessionMaxMinutes: 45,
    maxConcurrent: 2,
    fromHour: 9,
    toHour: 23,
    days: [0, 1, 2, 3, 4, 5, 6],
    stopWhenBack: true,
    requireDiscord: true,
    openDiscord: false,
    closeDiscordAfter: false,
    waitForDiscord: true,
}

const DEFAULTS: AppSettings = {
    theme: 'espresso',
    accent: null,
    customTheme: null,
    reduceMotion: false,
    autoHide: false,
    closeToTray: false,
    showOnTimerEnd: true,
    timerSeconds: 15 * 60,
    timerMode: 'parallel',
    timerOrder: 'fixed',
    timerWaitForDiscord: true,
    detectTimeoutSec: 120,
    riskAcceptedAt: null,
    termsAcceptedAt: null,
    termsVersion: null,
    gameWindowMode: 'parked',
    perfGuard: { enabled: true, sensitivity: 'balanced' },
    buddy: DEFAULT_BUDDY,
}

/** Themes from earlier designs map onto the closest current one. */
const LEGACY_THEMES: Record<string, ThemeId> = {
    aurora: 'espresso', dark: 'espresso', ash: 'mono', onyx: 'mono', amoled: 'mono', dracula: 'espresso',
    sunset: 'clay', rose: 'clay', ocean: 'midnight', nord: 'midnight', forest: 'moss',
    daylight: 'paper', light: 'paper',
}

/** Also used by the splash window, which starts before the app. */
export function readSavedAppearance() {
    try {
        const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<AppSettings>
        const theme = THEMES.some(t => t.id === s.theme) ? s.theme! : LEGACY_THEMES[String(s.theme)] ?? DEFAULTS.theme
        const custom = s.customTheme ? normalizeCustomTheme(s.customTheme, s.customTheme as CustomTheme) : null
        return { theme, accent: s.accent ?? null, reduceMotion: !!s.reduceMotion, custom }
    } catch {
        return { theme: DEFAULTS.theme, accent: null, reduceMotion: false, custom: null }
    }
}

export const useSettings = createGlobalState(() => {
    const settings = useStorage<AppSettings>(SETTINGS_KEY, { ...DEFAULTS, timerSeconds: initialTimerSeconds() }, undefined, {
        // nested groups get new fields from later versions too
        mergeDefaults: (stored, defaults) => ({
            ...defaults,
            ...stored,
            perfGuard: { ...defaults.perfGuard, ...stored?.perfGuard },
            buddy: { ...defaults.buddy, ...stored?.buddy },
        }),
    })

    const theme = settings.value.theme as string
    if (!THEMES.some(t => t.id === theme)) settings.value.theme = LEGACY_THEMES[theme] ?? DEFAULTS.theme

    watch(
        () => [settings.value.theme, settings.value.accent, settings.value.reduceMotion, settings.value.customTheme] as const,
        ([theme, accent, reduceMotion, custom]) => applyAppearance(theme, accent, reduceMotion, custom),
        { immediate: true, deep: true },
    )

    watch(
        () => settings.value.closeToTray,
        enabled => { invoke('set_close_to_tray', { enabled }).catch(() => {}) },
        { immediate: true },
    )

    return { settings, defaults: DEFAULTS }
})

/** The user accepted the risk notice and agreed to the current Terms. */
export function recordAgreement(settings: Ref<AppSettings>) {
    const now = Date.now()
    settings.value.riskAcceptedAt = now
    settings.value.termsAcceptedAt = now
    settings.value.termsVersion = TERMS_VERSION
}

export function hideWindow() {
    return invoke('hide_window').catch(() => {})
}

export function showWindow() {
    return invoke('show_window').catch(() => {})
}

/** Hides/shows the windows and tray icons of all running dummy games. */
export function setGameWindowsVisible(visible: boolean) {
    return invoke<number>('set_game_windows_visible', { visible }).catch(() => 0)
}
