// Shared behavior for every page of the website.
import '@fontsource-variable/archivo'
import './site.css'
import { ACCENTS, applyAppearance } from '@/theme/themes'

const ACCENT_KEY = 'questly.site.accent'
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ----- accent: re-tints the site exactly like the app's accent setting -----
function readAccent() {
    try { return localStorage.getItem(ACCENT_KEY) } catch { return null }
}

function setAccent(accent: string | null) {
    applyAppearance('espresso', accent, false)
    try {
        if (accent) localStorage.setItem(ACCENT_KEY, accent)
        else localStorage.removeItem(ACCENT_KEY)
    } catch { /* private mode */ }
    document.querySelectorAll<HTMLButtonElement>('[data-accent-swatches] button').forEach(b => {
        b.classList.toggle('on', (b.dataset.accent || null) === accent)
    })
    updateFavicon()
}

/** The tab icon is the logo in the current accent, like the app's taskbar icon. */
function updateFavicon() {
    const style = getComputedStyle(document.documentElement)
    const fill = style.getPropertyValue('--logo-fill').trim() || '#cfdd7a'
    const glyph = style.getPropertyValue('--logo-glyph').trim() || '#1a1916'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="7" fill="${fill}"/><circle cx="11.2" cy="11.2" r="4.9" fill="none" stroke="${glyph}" stroke-width="2.7"/><path d="M14.6 14.6 17.6 17.6" stroke="${glyph}" stroke-width="2.7" stroke-linecap="round"/></svg>`
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
    }
    link.type = 'image/svg+xml'
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
}

function setupAccentPicker() {
    const toggle = document.querySelector<HTMLButtonElement>('[data-accent-toggle]')
    const pop = document.querySelector<HTMLElement>('.accent-pop')
    const swatches = document.querySelector<HTMLElement>('[data-accent-swatches]')
    if (!toggle || !pop || !swatches) return

    const reset = document.createElement('button')
    reset.type = 'button'
    reset.className = 'reset'
    reset.textContent = 'Default'
    reset.dataset.accent = ''
    reset.addEventListener('click', () => setAccent(null))
    swatches.appendChild(reset)
    for (const color of ACCENTS) {
        const b = document.createElement('button')
        b.type = 'button'
        b.style.background = color
        b.dataset.accent = color
        b.setAttribute('aria-label', `Accent ${color}`)
        b.addEventListener('click', () => setAccent(color))
        swatches.appendChild(b)
    }

    const close = () => { pop.hidden = true; toggle.setAttribute('aria-expanded', 'false') }
    toggle.addEventListener('click', e => {
        e.stopPropagation()
        pop.hidden = !pop.hidden
        toggle.setAttribute('aria-expanded', String(!pop.hidden))
    })
    document.addEventListener('click', e => { if (!pop.contains(e.target as Node)) close() })
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close() })
}

// ----- header tabs: the solid pill slides to the section you're in -----
function setupTabs() {
    const nav = document.querySelector<HTMLElement>('.tabs')
    const indicator = nav?.querySelector<HTMLElement>('.indicator')
    if (!nav || !indicator) return
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[data-nav]')]

    function moveTo(link: HTMLAnchorElement | null) {
        links.forEach(l => l.classList.toggle('active', l === link))
        if (!link) { indicator!.style.opacity = '0'; return }
        indicator!.style.opacity = '1'
        indicator!.style.width = `${link.offsetWidth}px`
        indicator!.style.transform = `translateX(${link.offsetLeft}px)`
    }

    const page = document.body.dataset.page
    if (page === 'try') return moveTo(links.find(l => l.dataset.nav === 'try') ?? null)
    if (page !== 'home') return moveTo(null)

    const sections = links
        .map(link => ({ link, el: document.getElementById(link.dataset.nav!) }))
        .filter((s): s is { link: HTMLAnchorElement; el: HTMLElement } => !!s.el)
    const onScroll = () => {
        const y = window.scrollY + window.innerHeight * 0.35
        let current: HTMLAnchorElement | null = null
        for (const s of sections) if (s.el.offsetTop <= y) current = s.link
        moveTo(current)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()
}

// ----- sections ease in as you scroll to them -----
function setupReveal() {
    const items = document.querySelectorAll<HTMLElement>('.reveal')
    if (reduceMotion || !('IntersectionObserver' in window)) {
        items.forEach(el => el.classList.add('in'))
        return
    }
    const io = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (entry.isIntersecting) {
                entry.target.classList.add('in')
                io.unobserve(entry.target)
            }
        }
    }, { rootMargin: '0px 0px -8% 0px' })
    items.forEach(el => io.observe(el))
}

// ----- small things -----
function setupCopyButtons() {
    document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(button => {
        button.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(button.dataset.copy!)
                const label = button.textContent
                button.textContent = 'Copied'
                setTimeout(() => { button.textContent = label }, 1400)
            } catch { /* clipboard blocked */ }
        })
    })
}

setAccent(readAccent())
setupAccentPicker()
setupTabs()
setupReveal()
setupCopyButtons()
document.querySelectorAll('[data-year]').forEach(el => { el.textContent = String(new Date().getFullYear()) })

export { reduceMotion }
