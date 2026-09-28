import { invoke } from '@tauri-apps/api/core'
import { APPEARANCE_EVENT, tokenHex } from './themes'

/**
 * The app icon follows the accent color: the logo is drawn here in the
 * current accent and handed to Windows for the taskbar/Alt+Tab icon, the
 * tray icon and (installed copy only) the Desktop/Start/pinned shortcuts.
 * Same geometry as LogoMark.vue.
 */
export function drawLogo(ctx: CanvasRenderingContext2D, size: number, fill: string, glyph: string) {
    ctx.clearRect(0, 0, size, size)
    ctx.save()
    ctx.scale(size / 24, size / 24)
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.roundRect(1, 1, 22, 22, 7)
    ctx.fill()
    ctx.strokeStyle = glyph
    ctx.lineWidth = 2.7
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.arc(11.2, 11.2, 4.9, 0, Math.PI * 2)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(14.6, 14.6)
    ctx.lineTo(17.6, 17.6)
    ctx.stroke()
    ctx.restore()
}

function render(size: number, fill: string, glyph: string) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    drawLogo(ctx, size, fill, glyph)
    return { canvas, pixels: ctx.getImageData(0, 0, size, size).data }
}

/** A classic 32-bit icon entry (BGRA, bottom-up, plus an empty AND mask). */
function dibEntry(size: number, rgba: Uint8ClampedArray) {
    const maskRow = Math.ceil(size / 32) * 4
    const out = new Uint8Array(40 + size * size * 4 + maskRow * size)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, 40, true) // BITMAPINFOHEADER
    dv.setInt32(4, size, true)
    dv.setInt32(8, size * 2, true) // color + mask
    dv.setUint16(12, 1, true)
    dv.setUint16(14, 32, true)
    dv.setUint32(20, size * size * 4 + maskRow * size, true)
    let o = 40
    for (let y = size - 1; y >= 0; y--) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4
            out[o++] = rgba[i + 2]
            out[o++] = rgba[i + 1]
            out[o++] = rgba[i]
            out[o++] = rgba[i + 3]
        }
    }
    return out
}

async function pngEntry(canvas: HTMLCanvasElement) {
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    return new Uint8Array(await blob!.arrayBuffer())
}

/** A multi-size .ico, so Windows can pick a sharp size for every place. */
export async function buildIco(fill: string, glyph: string) {
    const sizes = [16, 20, 24, 32, 40, 48, 64, 256]
    const images: { size: number; data: Uint8Array }[] = []
    for (const size of sizes) {
        const { canvas, pixels } = render(size, fill, glyph)
        images.push({ size, data: size >= 256 ? await pngEntry(canvas) : dibEntry(size, pixels) })
    }
    const header = 6 + 16 * images.length
    const out = new Uint8Array(header + images.reduce((n, i) => n + i.data.length, 0))
    const dv = new DataView(out.buffer)
    dv.setUint16(2, 1, true) // type: icon
    dv.setUint16(4, images.length, true)
    let offset = header
    images.forEach((img, i) => {
        const e = 6 + 16 * i
        out[e] = img.size >= 256 ? 0 : img.size
        out[e + 1] = img.size >= 256 ? 0 : img.size
        dv.setUint16(e + 4, 1, true) // planes
        dv.setUint16(e + 6, 32, true) // bits per pixel
        dv.setUint32(e + 8, img.data.length, true)
        dv.setUint32(e + 12, offset, true)
        out.set(img.data, offset)
        offset += img.data.length
    })
    return out
}

const SHORTCUT_KEY = 'questly.shortcutIcon'

/**
 * Keeps the app icon in the accent color. `updateShortcuts` says whether the
 * installed shortcuts should follow too. Resolves after the first update.
 */
export function useBrandIcon(updateShortcuts: () => boolean) {
    let lastKey = ''
    let debounce: ReturnType<typeof setTimeout> | undefined
    let shortcutTimer: ReturnType<typeof setTimeout> | undefined

    async function update() {
        const fill = tokenHex('--logo-fill')
        const glyph = tokenHex('--logo-glyph')
        // bump the "q1" prefix when the drawing changes, so shortcuts refresh
        const key = `q1${fill.slice(1)}${glyph.slice(1)}`
        if (key === lastKey) return
        lastKey = key
        try {
            const ico = await buildIco(fill, glyph)
            const traySize = Math.max(16, Math.min(64, Math.round(16 * (window.devicePixelRatio || 1))))
            const tray = render(traySize, fill, glyph).pixels
            const path = await invoke<string>('set_brand_icon', {
                ico: Array.from(ico),
                trayRgba: Array.from(tray),
                traySize,
                key,
            })
            // shortcuts: only once the color has settled, and only when it changed
            clearTimeout(shortcutTimer)
            shortcutTimer = setTimeout(() => {
                let applied: string | null = null
                try { applied = localStorage.getItem(SHORTCUT_KEY) } catch { /* ignore */ }
                if (!updateShortcuts() || applied === key) return
                invoke('set_shortcut_icon', { path })
                    .then(() => { try { localStorage.setItem(SHORTCUT_KEY, key) } catch { /* ignore */ } })
                    .catch(() => {})
            }, 2500)
        } catch {
            // not inside the desktop app
        }
    }

    window.addEventListener(APPEARANCE_EVENT, () => {
        clearTimeout(debounce)
        debounce = setTimeout(update, 180)
    })
    return update()
}
