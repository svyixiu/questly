// The live demo's pretend desktop: startup splash, the app window (the real
// app in an iframe), taskbar, tray, game windows and the simulation switches.
import '~/site'
import './host.css'
import { onApp, toApp, type Sim, type ToHost } from '~/demo/bridge'

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!

const desktop = $('[data-desktop]')
const win = $('[data-win]')
const frame = $<HTMLIFrameElement>('[data-frame]')
const splash = $('[data-splash]')
const cardsLayer = $('[data-cards]')
const taskApp = $('[data-task-app]')
const trayIcon = $('[data-tray]')
const trayGames = $('[data-tray-games]')
const trayNote = $('[data-tray-note]')
const trayMenu = $('[data-tray-menu]')
const deskIcon = $('[data-desk-icon]')
const deskHint = $('[data-desk-hint]')
const tips = $('[data-tips]')
const clock = $('[data-clock]')

const store = {
    get(key: string) { try { return localStorage.getItem(key) } catch { return null } },
    set(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* private mode */ } },
}

// ----- window placement: the app is 1120×720, scaled down to fit -----
const W = 1120
const H = 720
let scale = 1
let pos: { x: number; y: number } | null = null // null = centered

function layout() {
    const box = desktop.getBoundingClientRect()
    scale = Math.min(1, (box.width - 40) / W, (box.height - 40) / H)
    const w = W * scale
    const h = H * scale
    win.style.width = `${w}px`
    win.style.height = `${h}px`
    frame.style.transform = `scale(${scale})`
    const x = pos ? Math.min(Math.max(pos.x, -w + 120), box.width - 120) : (box.width - w) / 2
    const y = pos ? Math.min(Math.max(pos.y, 0), box.height - 40) : (box.height - h) / 2
    win.style.left = `${x}px`
    win.style.top = `${y}px`
}
window.addEventListener('resize', layout)
layout()

// ----- window states -----
type WinState = 'loading' | 'open' | 'minimized' | 'hidden' | 'closed'
let state: WinState = 'loading'

function setState(next: WinState) {
    state = next
    win.classList.toggle('open', next === 'open')
    win.classList.toggle('minimized', next === 'minimized')
    const running = next !== 'closed'
    // like Windows: the splash has no taskbar button, a window hidden to the tray neither
    taskApp.hidden = !(next === 'open' || next === 'minimized')
    taskApp.classList.toggle('active', next === 'open')
    trayIcon.hidden = !running
    deskIcon.hidden = running
    deskHint.hidden = running
    // tips would sit on top of the desktop icon
    if (!running) tips.hidden = true
    trayMenu.hidden = true
    if (next === 'open') setTimeout(() => frame.contentWindow?.focus(), 80)
}

let noteTimer: ReturnType<typeof setTimeout> | undefined
function showTrayNote() {
    trayNote.hidden = false
    clearTimeout(noteTimer)
    noteTimer = setTimeout(() => { trayNote.hidden = true }, 4200)
}

taskApp.addEventListener('click', () => setState(state === 'open' ? 'minimized' : 'open'))
trayIcon.addEventListener('click', () => {
    trayNote.hidden = true
    setState(state === 'open' ? 'hidden' : 'open')
})
trayIcon.addEventListener('contextmenu', e => {
    e.preventDefault()
    trayNote.hidden = true
    trayMenu.hidden = !trayMenu.hidden
})
document.addEventListener('click', e => {
    if (!trayMenu.hidden && !trayMenu.contains(e.target as Node) && e.target !== trayIcon) trayMenu.hidden = true
})
trayMenu.addEventListener('click', e => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-menu]')?.dataset.menu
    trayMenu.hidden = true
    if (action === 'show') setState('open')
    else if (action === 'stop') toApp(frame, { q: 'tray:stopAll' })
    else if (action === 'hide-games') setCardsVisible(false)
    else if (action === 'show-games') setCardsVisible(true)
    else if (action === 'quit') quit()
})

function quit() {
    setState('closed')
    // like the desktop app: quitting Questly leaves the game programs running
    setTimeout(() => { if (state === 'closed') frame.src = 'about:blank' }, 300)
}

deskIcon.addEventListener('click', relaunch)
function relaunch() {
    if (state !== 'closed') return
    resetSplash()
    setState('loading')
    frame.src = '/app.html'
}

// ----- splash: dots turn green as the app reports its loading stages -----
const dots = [...splash.querySelectorAll<HTMLElement>('.splash-dot')]
let reported = 0
let shown = 0
let openedAt = performance.now()
let lastShownAt = 0
let pumpTimer: ReturnType<typeof setTimeout> | null = null

function resetSplash() {
    reported = 0
    shown = 0
    openedAt = performance.now()
    dots.forEach(d => d.classList.remove('done'))
    splash.classList.remove('leaving', 'gone')
}

function pump() {
    pumpTimer = null
    if (shown >= reported || shown >= dots.length) return
    const now = performance.now()
    const earliest = shown === 0 ? openedAt + 450 : lastShownAt + 320
    if (now < earliest) {
        pumpTimer = setTimeout(pump, earliest - now)
        return
    }
    dots[shown++].classList.add('done')
    lastShownAt = now
    if (shown === dots.length) setTimeout(finishSplash, 700)
    else pump()
}

function finishSplash() {
    if (splash.classList.contains('gone')) return
    splash.classList.add('leaving')
    setTimeout(() => {
        splash.classList.add('gone')
        setState('open')
    }, 260)
}

// ----- game windows (the square cards the desktop app shows per game) -----
interface Card { el: HTMLElement; exe: string; appId: string; startedAt: number; timeEl: HTMLElement }
const cards = new Map<string, Card>()
let cardsVisible = true

function parseColors(colors: string | null) {
    const names = ['bg', 'ink', 'muted', 'line', 'btn', 'btn-ink', 'accent', 'danger']
    const parts = (colors ?? '').split(',')
    return Object.fromEntries(names.map((n, i) => [`--g-${n}`, /^[0-9a-f]{6}$/i.test(parts[i] ?? '') ? `#${parts[i]}` : '']))
}

function placeCards() {
    const list = [...cards.values()].filter(c => !c.el.hidden)
    list.forEach((card, i) => {
        if (card.el.dataset.moved) return
        card.el.style.right = `${24 + i * 26}px`
        card.el.style.bottom = `${20 + i * 26}px`
        card.el.style.left = ''
        card.el.style.top = ''
    })
    const offscreen = [...cards.values()].filter(c => c.el.hidden).length
    trayGames.hidden = offscreen === 0
    trayGames.textContent = `${offscreen} game window${offscreen === 1 ? '' : 's'} off-screen`
}

function addCard(m: Extract<ToHost, { q: 'game:start' }>) {
    removeCard(m.exe, true)
    const el = document.createElement('div')
    el.className = 'game-card'
    for (const [k, v] of Object.entries(parseColors(m.colors))) if (v) el.style.setProperty(k, v)
    const icon = m.icon
        ? `<img class="g-icon" src="${m.icon}" alt="" draggable="false" />`
        : `<div class="g-icon">${(m.name[0] ?? '?').toUpperCase()}</div>`
    el.innerHTML = `
        <div class="g-eyebrow"><i></i>NOW PLAYING</div>
        ${icon}
        <div class="g-title"></div>
        <div class="g-time">Playing · 0:00</div>
        <div class="g-actions"><button class="g-close" type="button">Close</button><button class="g-delete" type="button">Close &amp; delete</button></div>`
    el.querySelector('.g-title')!.textContent = m.name
    const card: Card = { el, exe: m.exe.toLowerCase(), appId: m.appId, startedAt: Date.now(), timeEl: el.querySelector('.g-time')! }
    el.hidden = m.mode !== 'visible' || !cardsVisible
    el.querySelector('.g-close')!.addEventListener('click', () => closeCard(card, 0))
    el.querySelector('.g-delete')!.addEventListener('click', () => closeCard(card, 2))
    makeDraggable(el)
    cards.set(card.exe, card)
    cardsLayer.appendChild(el)
    placeCards()
}

function closeCard(card: Card, code: number) {
    toApp(frame, { q: 'game:closed', exe: card.exe, appId: card.appId, code })
    removeCard(card.exe)
}

function removeCard(exe: string, instant = false) {
    const card = cards.get(exe.toLowerCase())
    if (!card) return
    cards.delete(card.exe)
    if (instant || card.el.hidden) card.el.remove()
    else {
        card.el.classList.add('leaving')
        setTimeout(() => card.el.remove(), 220)
    }
    placeCards()
}

function setCardsVisible(visible: boolean) {
    cardsVisible = visible
    for (const card of cards.values()) card.el.hidden = !visible
    placeCards()
}

function makeDraggable(el: HTMLElement) {
    el.addEventListener('pointerdown', e => {
        if ((e.target as HTMLElement).closest('button')) return
        const box = desktop.getBoundingClientRect()
        const rect = el.getBoundingClientRect()
        const dx = e.clientX - rect.left
        const dy = e.clientY - rect.top
        el.setPointerCapture(e.pointerId)
        const move = (ev: PointerEvent) => {
            el.dataset.moved = '1'
            el.style.right = ''
            el.style.bottom = ''
            el.style.left = `${ev.clientX - box.left - dx}px`
            el.style.top = `${ev.clientY - box.top - dy}px`
        }
        const up = () => {
            el.removeEventListener('pointermove', move)
            el.removeEventListener('pointerup', up)
        }
        el.addEventListener('pointermove', move)
        el.addEventListener('pointerup', up)
    })
}

setInterval(() => {
    for (const card of cards.values()) {
        const s = Math.floor((Date.now() - card.startedAt) / 1000)
        card.timeEl.textContent = `Playing · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    }
    clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}, 1000)
clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

// ----- dragging the app window by its title bar -----
let drag: { startX: number; startY: number; x: number; y: number } | null = null
function startDrag(screenX: number, screenY: number) {
    const box = desktop.getBoundingClientRect()
    const rect = win.getBoundingClientRect()
    drag = { startX: screenX, startY: screenY, x: rect.left - box.left, y: rect.top - box.top }
    win.classList.add('dragging')
}
window.addEventListener('mousemove', e => {
    if (!drag) return
    if (e.buttons === 0) return endDrag()
    pos = { x: drag.x + (e.screenX - drag.startX), y: drag.y + (e.screenY - drag.startY) }
    layout()
})
window.addEventListener('mouseup', () => endDrag())
function endDrag() {
    if (!drag) return
    drag = null
    win.classList.remove('dragging')
}

// ----- simulation switches -----
const sim: Sim = { discord: true, heavy: false, away: false }
const simButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-sim]')]
function renderSim() {
    for (const b of simButtons) b.setAttribute('aria-pressed', String(sim[b.dataset.sim as keyof Sim]))
}
for (const b of simButtons) {
    b.addEventListener('click', () => {
        const key = b.dataset.sim as keyof Sim
        sim[key] = !sim[key]
        renderSim()
        toApp(frame, { q: 'sim', sim })
    })
}
renderSim()

// ----- icon: the taskbar/tray icon and this tab follow the app's accent -----
function setIcon(fill: string, glyph: string) {
    document.documentElement.style.setProperty('--icon-fill', fill)
    document.documentElement.style.setProperty('--icon-glyph', glyph)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="7" fill="${fill}"/><circle cx="11.2" cy="11.2" r="4.9" fill="none" stroke="${glyph}" stroke-width="2.7"/><path d="M14.6 14.6 17.6 17.6" stroke="${glyph}" stroke-width="2.7" stroke-linecap="round"/></svg>`
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link) link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
}

// ----- messages from the app -----
onApp(frame, m => {
    switch (m.q) {
        case 'ready':
            toApp(frame, { q: 'sim', sim })
            break
        case 'stage':
            reported = Math.max(reported, Math.min(dots.length, m.n))
            if (!pumpTimer) pump()
            break
        case 'finish':
            finishSplash()
            break
        case 'game:start':
            addCard(m)
            break
        case 'game:stop':
            removeCard(m.exe)
            break
        case 'games:visible':
            setCardsVisible(m.visible)
            break
        case 'games:killAll':
            for (const exe of [...cards.keys()]) removeCard(exe)
            break
        case 'window':
            if (m.action === 'minimize') setState('minimized')
            else if (m.action === 'hide') { setState('hidden'); showTrayNote() }
            else if (m.action === 'show') setState('open')
            else if (m.action === 'quit') quit()
            break
        case 'drag:start':
            startDrag(m.x, m.y)
            break
        case 'icon':
            setIcon(m.fill, m.glyph)
            break
        case 'sim':
            Object.assign(sim, m.sim)
            renderSim()
            break
    }
})

// ----- tips, reset, small screens -----
if (store.get('questly.demo.tipsHidden') !== '1') tips.hidden = false
$('[data-tips-close]').addEventListener('click', () => {
    tips.hidden = true
    store.set('questly.demo.tipsHidden', '1')
})

$('[data-reset]').addEventListener('click', () => {
    try {
        for (const key of Object.keys(localStorage)) {
            if (key.startsWith('dqc.') || key.startsWith('questly.demo') || key.startsWith('questly.buddy') || key === 'questly.shortcutIcon') {
                localStorage.removeItem(key)
            }
        }
    } catch { /* private mode */ }
    location.reload()
})

const small = $('[data-small]')
if (window.innerWidth < 760) small.hidden = false
$('[data-small-continue]').addEventListener('click', () => { small.hidden = true })

setState('loading')
