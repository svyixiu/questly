export type ThemeId =
    | 'system'
    | 'espresso'
    | 'midnight'
    | 'moss'
    | 'clay'
    | 'mono'
    | 'paper'
    | 'custom'

export interface ThemeInfo {
    id: ThemeId;
    name: string;
    /** swatch for the picker: canvas, card, accent */
    swatch: [string, string, string];
}

// The full palettes live in style.css under [data-theme="..."].
// 'custom' is built from the user's own colors (CustomTheme).
export const THEMES: ThemeInfo[] = [
    { id: 'espresso', name: 'Espresso', swatch: ['#1a1916', '#efe7d7', '#cfdd7a'] },
    { id: 'midnight', name: 'Midnight', swatch: ['#111419', '#dfe7f2', '#8ecbff'] },
    { id: 'moss', name: 'Moss', swatch: ['#141813', '#e4ebd2', '#b5d86a'] },
    { id: 'clay', name: 'Clay', swatch: ['#1c1613', '#f1dfcf', '#f29e6d'] },
    { id: 'mono', name: 'Mono', swatch: ['#131313', '#ececec', '#f0f0f0'] },
    { id: 'paper', name: 'Paper', swatch: ['#ebe3d2', '#1a1916', '#5e6b1f'] },
    { id: 'system', name: 'Auto', swatch: ['#1a1916', '#ebe3d2', '#cfdd7a'] },
    { id: 'custom', name: 'Custom', swatch: ['#1a1916', '#efe7d7', '#cfdd7a'] },
]

export const ACCENTS = ['#cfdd7a', '#f2c46d', '#f29e6d', '#f07c6c', '#e7a6c9', '#b9a6f2', '#8ecbff', '#7fd6b5', '#efe7d7']

/** Settings > Appearance > Custom: one color per part of the app. */
export interface CustomTheme {
    /** window background */
    bg: string;
    /** cards and panels */
    surface: string;
    /** hairline borders */
    line: string;
    text: string;
    /** secondary text */
    muted: string;
    /** the highlighted "paper" cards and their text */
    paper: string;
    paperText: string;
    /** highlights: selections, live dots, the logo */
    accent: string;
    /** primary buttons, active tab */
    button: string;
    buttonText: string;
    /** the four blurred background glows */
    glow: [string, string, string, string];
    /** 0..1 */
    glowOpacity: number;
    /** px */
    glowBlur: number;
    /** background blur behind cards, px */
    glassBlur: number;
    /** 0.4..1: how solid cards are */
    glassOpacity: number;
}

const lightQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null
let current: { theme: ThemeId; accent: string | null; reduceMotion: boolean; custom: CustomTheme | null } | null = null

// ----- color math -----

function hexToRgb(hex: string) {
    const n = parseInt(hex.replace('#', ''), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex(r: number, g: number, b: number) {
    return '#' + [r, g, b].map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')
}

function hexToHsl(hex: string): [number, number, number] {
    const [r, g, b] = hexToRgb(hex).map(c => c / 255)
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const l = (max + min) / 2
    if (max === min) return [0, 0, l]
    const d = max - min
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    return [h * 60, s, l]
}

function hslToHex(h: number, s: number, l: number) {
    h = ((h % 360) + 360) % 360
    s = Math.max(0, Math.min(1, s))
    l = Math.max(0, Math.min(1, l))
    const k = (n: number) => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255)
}

function luminance(hex: string) {
    const [r, g, b] = hexToRgb(hex).map(c => {
        const v = c / 255
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
}

/** Nudges a color's lightness until it stands out from `against`. */
function readableOn(hex: string, against: string, min = 3) {
    const [h, s, l0] = hexToHsl(hex)
    const lighten = luminance(against) < 0.4
    let l = l0
    let out = hex
    for (let i = 0; i < 60 && contrast(out, against) < min; i++) {
        l += lighten ? 0.015 : -0.015
        out = hslToHex(h, s, l)
    }
    return out
}

/** Text that sits on top of a filled accent. */
function inkOn(fill: string, dark: string, light: string) {
    return contrast(fill, dark) >= contrast(fill, light) ? dark : light
}

function rgba(hex: string, alpha: number) {
    const [r, g, b] = hexToRgb(hex)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/** `a` moved `t` of the way towards `b`. */
function mix(a: string, b: string, t: number) {
    const [r1, g1, b1] = hexToRgb(a)
    const [r2, g2, b2] = hexToRgb(b)
    return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

function hoverOf(c: string) {
    const [h, s, l] = hexToHsl(c)
    return hslToHex(h, s, l + (luminance(c) > 0.5 ? -0.06 : 0.06))
}

export function isHexColor(value: unknown): value is string {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

let probe: CanvasRenderingContext2D | null = null
/** Any CSS color (hex, rgb(), rgba()) as #rrggbb; alpha is dropped. */
export function cssColorToHex(value: string) {
    probe ??= document.createElement('canvas').getContext('2d')
    if (!probe) return '#000000'
    probe.fillStyle = '#000000'
    probe.fillStyle = value.trim()
    const c = String(probe.fillStyle)
    if (c.startsWith('#')) return c
    const m = c.match(/\d+(\.\d+)?/g)
    return m ? '#' + m.slice(0, 3).map(n => Math.round(+n).toString(16).padStart(2, '0')).join('') : '#000000'
}

/** Semantic colors that read well on a light or a dark canvas. */
const SEMANTIC = {
    dark: {
        '--ok': '#a8d68a', '--ok-soft': 'rgba(168, 214, 138, 0.14)',
        '--danger': '#f07c6c', '--danger-soft': 'rgba(240, 124, 108, 0.14)',
        '--warn': '#f2c46d', '--warn-soft': 'rgba(242, 196, 109, 0.14)',
        '--shadow': '0 18px 40px -24px rgba(0, 0, 0, 0.7)',
    },
    light: {
        '--ok': '#3f7d2a', '--ok-soft': 'rgba(63, 125, 42, 0.12)',
        '--danger': '#b93b2a', '--danger-soft': 'rgba(185, 59, 42, 0.1)',
        '--warn': '#9a6a0c', '--warn-soft': 'rgba(154, 106, 12, 0.12)',
        '--shadow': '0 18px 40px -26px rgba(60, 45, 20, 0.35)',
    },
}

/** Every token of the app, derived from the handful of colors the user picked. */
function customPalette(c: CustomTheme): Record<string, string> {
    const light = luminance(c.bg) > 0.35
    const paperLight = luminance(c.paper) > 0.35
    const p: Record<string, string> = {
        '--bg': c.bg,
        '--glass': c.surface,
        '--glass-2': mix(c.surface, c.text, 0.06),
        '--glass-3': mix(c.surface, c.text, 0.12),
        '--line': c.line,
        '--line-strong': mix(c.line, c.text, 0.18),
        '--ink': c.text,
        '--ink-2': mix(c.text, c.bg, 0.2),
        '--muted': c.muted,
        '--faint': mix(c.muted, c.bg, 0.35),
        '--paper': c.paper,
        '--paper-ink': c.paperText,
        '--paper-ink-2': mix(c.paperText, c.paper, 0.2),
        '--paper-muted': mix(c.paperText, c.paper, 0.35),
        '--paper-faint': mix(c.paperText, c.paper, 0.5),
        '--paper-fill': rgba(c.paperText, 0.06),
        '--paper-fill-2': rgba(c.paperText, 0.1),
        '--paper-line': rgba(c.paperText, 0.14),
        '--paper-line-strong': rgba(c.paperText, 0.28),
        '--paper-ok': paperLight ? SEMANTIC.light['--ok'] : SEMANTIC.dark['--ok'],
        '--paper-warn': paperLight ? SEMANTIC.light['--warn'] : SEMANTIC.dark['--warn'],
        '--paper-danger': paperLight ? SEMANTIC.light['--danger'] : SEMANTIC.dark['--danger'],
        '--accent': c.accent,
        '--accent-2': c.accent,
        '--accent-soft': rgba(c.accent, 0.14),
        '--on-accent': inkOn(c.accent, c.bg, c.text),
        '--btn': c.button,
        '--btn-hover': hoverOf(c.button),
        '--btn-ink': c.buttonText,
        '--blob-1': c.glow[0],
        '--blob-2': c.glow[1],
        '--blob-3': c.glow[2],
        '--blob-4': c.glow[3],
        '--blob-opacity': String(Math.max(0, Math.min(1, c.glowOpacity))),
        '--glow-blur': `${Math.max(0, Math.round(c.glowBlur))}px`,
        '--glass-blur': `${Math.max(0, Math.round(c.glassBlur))}px`,
        '--glass-alpha': `${Math.round(Math.max(0.3, Math.min(1, c.glassOpacity)) * 100)}%`,
        ...SEMANTIC[light ? 'light' : 'dark'],
    }
    return p
}

/** A complete, valid CustomTheme (missing or broken fields fall back to `base`). */
export function normalizeCustomTheme(value: unknown, base: CustomTheme): CustomTheme {
    const v = (value && typeof value === 'object' ? value : {}) as Partial<CustomTheme>
    const color = (key: keyof CustomTheme) => (isHexColor(v[key]) ? v[key] : base[key]) as string
    const num = (key: keyof CustomTheme, min: number, max: number) => {
        const n = Number(v[key])
        return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : base[key] as number
    }
    const glow = Array.isArray(v.glow) ? v.glow : []
    return {
        bg: color('bg'), surface: color('surface'), line: color('line'),
        text: color('text'), muted: color('muted'),
        paper: color('paper'), paperText: color('paperText'),
        accent: color('accent'), button: color('button'), buttonText: color('buttonText'),
        glow: [0, 1, 2, 3].map(i => (isHexColor(glow[i]) ? glow[i] : base.glow[i])) as CustomTheme['glow'],
        glowOpacity: num('glowOpacity', 0, 1),
        glowBlur: num('glowBlur', 0, 200),
        glassBlur: num('glassBlur', 0, 60),
        glassOpacity: num('glassOpacity', 0.3, 1),
    }
}

/**
 * A full palette tinted by the accent's hue: canvas, surfaces, lines, text,
 * the cream "paper" cards and the background glow. `light` builds the light
 * variant (Paper theme), where the paper cards turn dark.
 */
function paletteFromAccent(accent: string, light: boolean): Record<string, string> {
    const [h, s] = hexToHsl(accent)
    // neutrals only borrow some of the accent's saturation
    const t = Math.min(s, 0.75)
    const n = (sat: number, l: number) => hslToHex(h, t * sat, l)

    const p: Record<string, string> = light
        ? {
            '--bg': n(0.4, 0.9), '--glass': n(0.45, 0.945), '--glass-2': n(0.4, 0.875), '--glass-3': n(0.35, 0.82),
            '--line': n(0.3, 0.82), '--line-strong': n(0.25, 0.72),
            '--ink': n(0.35, 0.1), '--ink-2': n(0.25, 0.24), '--muted': n(0.18, 0.4), '--faint': n(0.14, 0.58),
            '--paper': n(0.35, 0.1), '--paper-ink': n(0.45, 0.92), '--paper-ink-2': n(0.25, 0.78),
            '--paper-muted': n(0.18, 0.6), '--paper-faint': n(0.14, 0.44),
        }
        : {
            '--bg': n(0.35, 0.085), '--glass': n(0.3, 0.115), '--glass-2': n(0.28, 0.15), '--glass-3': n(0.26, 0.185),
            '--line': n(0.22, 0.185), '--line-strong': n(0.2, 0.28),
            '--ink': n(0.4, 0.93), '--ink-2': n(0.22, 0.78), '--muted': n(0.15, 0.6), '--faint': n(0.12, 0.43),
            '--paper': n(0.6, 0.905), '--paper-ink': n(0.35, 0.1), '--paper-ink-2': n(0.25, 0.22),
            '--paper-muted': n(0.18, 0.33), '--paper-faint': n(0.12, 0.5),
        }
    p['--paper-fill'] = rgba(p['--paper-ink'], 0.06)
    p['--paper-fill-2'] = rgba(p['--paper-ink'], 0.1)
    p['--paper-line'] = rgba(p['--paper-ink'], 0.14)
    p['--paper-line-strong'] = rgba(p['--paper-ink'], 0.28)

    // the accent, adjusted so it always stands out on dark surfaces and on paper
    const onCanvas = readableOn(accent, p['--glass'])
    const onPaper = readableOn(accent, p['--paper'])
    const hover = (c: string) => { const [hh, ss, ll] = hexToHsl(c); return hslToHex(hh, ss, ll + (luminance(c) > 0.5 ? -0.06 : 0.06)) }
    p['--user-accent'] = onCanvas
    p['--user-accent-hover'] = hover(onCanvas)
    p['--user-accent-soft'] = rgba(onCanvas, 0.16)
    p['--user-on-accent'] = inkOn(onCanvas, p[light ? '--ink' : '--bg'], p[light ? '--glass' : '--ink'])
    p['--user-accent-paper'] = onPaper
    p['--user-accent-paper-hover'] = hover(onPaper)
    p['--user-accent-paper-soft'] = rgba(onPaper, 0.14)
    p['--user-on-accent-paper'] = inkOn(onPaper, p['--paper-ink'], p['--paper'])

    // background glow in the accent's family
    p['--blob-1'] = hslToHex(h, Math.max(s, 0.35), 0.62)
    p['--blob-2'] = hslToHex(h + 32, Math.max(s * 0.8, 0.3), 0.55)
    p['--blob-3'] = hslToHex(h - 38, Math.max(s * 0.7, 0.25), 0.45)
    p['--blob-4'] = hslToHex(h + 12, Math.max(s * 0.6, 0.2), 0.36)
    return p
}

let appliedVars: string[] = []

/** Fired on window after every change, e.g. to redraw the app icon. */
export const APPEARANCE_EVENT = 'questly:appearance'

export function applyAppearance(theme: ThemeId, accent: string | null, reduceMotion: boolean, custom: CustomTheme | null = null) {
    current = { theme, accent, reduceMotion, custom }
    const root = document.documentElement
    const useCustom = theme === 'custom' && custom !== null
    const resolved = theme === 'system' ? (lightQuery?.matches ? 'paper' : 'espresso') : theme === 'custom' && !custom ? 'espresso' : theme
    root.dataset.theme = resolved
    root.classList.toggle('reduce-motion', reduceMotion)

    // Colors are set inline, so they beat the theme blocks in style.css.
    for (const v of appliedVars) root.style.removeProperty(v)
    appliedVars = []
    let palette: Record<string, string> | null = null
    if (useCustom) {
        // the custom theme has its own accent; the accent picker doesn't apply
        palette = customPalette(custom)
        root.classList.remove('custom-accent')
    } else if (accent) {
        // A chosen accent re-tints the whole theme; style.css routes --user-*
        // into the accent and primary button colors on dark surfaces and on paper cards.
        palette = paletteFromAccent(accent, resolved === 'paper')
        root.classList.add('custom-accent')
    } else {
        root.classList.remove('custom-accent')
    }
    if (palette) {
        for (const [name, value] of Object.entries(palette)) root.style.setProperty(name, value)
        appliedVars = Object.keys(palette)
    }
    root.style.colorScheme = useCustom ? (luminance(custom.bg) > 0.35 ? 'light' : 'dark') : ''
    window.dispatchEvent(new Event(APPEARANCE_EVENT))
}

/** A resolved color token of the app (e.g. '--accent') as #rrggbb. */
export function tokenHex(name: string) {
    return cssColorToHex(getComputedStyle(document.documentElement).getPropertyValue(name))
}

/** What's on screen right now, as a CustomTheme (to start editing from). */
export function snapshotAppearance(): CustomTheme {
    const style = getComputedStyle(document.documentElement)
    const hex = (name: string) => cssColorToHex(style.getPropertyValue(name))
    const px = (name: string, fallback: number) => parseFloat(style.getPropertyValue(name)) || fallback
    const alpha = parseFloat(style.getPropertyValue('--glass-alpha'))
    return {
        bg: hex('--bg'), surface: hex('--glass'), line: hex('--line'),
        text: hex('--ink'), muted: hex('--muted'),
        paper: hex('--paper'), paperText: hex('--paper-ink'),
        accent: hex('--accent'), button: hex('--btn'), buttonText: hex('--btn-ink'),
        glow: [hex('--blob-1'), hex('--blob-2'), hex('--blob-3'), hex('--blob-4')],
        glowOpacity: parseFloat(style.getPropertyValue('--blob-opacity')) || 0.2,
        glowBlur: px('--glow-blur', 90),
        glassBlur: px('--glass-blur', 24),
        glassOpacity: Number.isFinite(alpha) ? alpha / 100 : 0.9,
    }
}

/** A built-in theme (plus an optional accent) as a CustomTheme. */
export function presetAsCustom(theme: ThemeId, accent: string | null): CustomTheme {
    const saved = current
    applyAppearance(theme, accent, saved?.reduceMotion ?? false)
    const snapshot = snapshotAppearance()
    if (saved) applyAppearance(saved.theme, saved.accent, saved.reduceMotion, saved.custom)
    return snapshot
}

/**
 * The current theme as "bg,ink,muted,line,btn,btnInk,accent,danger" hex
 * colors, so game windows can match the app.
 */
export function themeColorsForGameWindow() {
    return ['--bg', '--ink', '--muted', '--line-strong', '--btn', '--btn-ink', '--accent', '--danger']
        .map(v => tokenHex(v).slice(1))
        .join(',')
}

lightQuery?.addEventListener('change', () => {
    if (current?.theme === 'system') applyAppearance(current.theme, current.accent, current.reduceMotion, current.custom)
})
