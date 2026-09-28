import type { Directive } from 'vue'

/**
 * Smooth wheel scrolling with an ease-out-quint curve.
 *
 * Usage: `import { vSmooth } from '@/directives/smooth-scroll'`, then
 * `<div v-smooth class="overflow-y-auto">`. Wheel ticks add to a target
 * position and the element glides there; new ticks re-aim the same glide.
 * `smoothScrollTo(el, top)` uses the same engine (e.g. for keyboard nav).
 */

const DURATION = 700
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5)

interface State {
    target: number;
    from: number;
    startTime: number;
    frame: number;
}

const states = new WeakMap<HTMLElement, State>()

function reducedMotion() {
    return document.documentElement.classList.contains('reduce-motion')
        || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function state(el: HTMLElement): State {
    let s = states.get(el)
    if (!s) {
        s = { target: el.scrollTop, from: el.scrollTop, startTime: 0, frame: 0 }
        states.set(el, s)
    }
    return s
}

function animate(el: HTMLElement, s: State) {
    const step = (now: number) => {
        const t = Math.min(1, (now - s.startTime) / DURATION)
        el.scrollTop = s.from + (s.target - s.from) * easeOutQuint(t)
        s.frame = t < 1 ? requestAnimationFrame(step) : 0
    }
    if (!s.frame) s.frame = requestAnimationFrame(step)
}

export function smoothScrollTo(el: HTMLElement, top: number) {
    const max = el.scrollHeight - el.clientHeight
    const target = Math.max(0, Math.min(max, top))
    if (reducedMotion()) {
        el.scrollTop = target
        return
    }
    const s = state(el)
    if (!s.frame) s.target = el.scrollTop
    s.from = el.scrollTop
    s.target = target
    s.startTime = performance.now()
    animate(el, s)
}

/** Glides a child into view within its scroll container (like scrollIntoView "nearest"). */
export function smoothScrollIntoView(container: HTMLElement, child: HTMLElement, margin = 8) {
    const c = container.getBoundingClientRect()
    const r = child.getBoundingClientRect()
    const s = state(container)
    const base = s.frame ? s.target : container.scrollTop
    if (r.top < c.top + margin) smoothScrollTo(container, base - (c.top - r.top) - margin)
    else if (r.bottom > c.bottom - margin) smoothScrollTo(container, base + (r.bottom - c.bottom) + margin)
}

function onWheel(this: HTMLElement, e: WheelEvent) {
    const el = this
    // pinch-zoom, horizontal gestures and already-handled events pass through
    if (e.ctrlKey || (e as WheelEvent & { _smooth?: boolean })._smooth) return
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    const max = el.scrollHeight - el.clientHeight
    if (max <= 0) return

    const s = state(el)
    const base = s.frame ? s.target : el.scrollTop
    const delta = e.deltaY * (e.deltaMode === 1 ? 36 : e.deltaMode === 2 ? el.clientHeight : 1)
    // at an edge: let an outer scroller take the wheel
    if ((delta < 0 && base <= 0) || (delta > 0 && base >= max)) return

    e.preventDefault()
    ;(e as WheelEvent & { _smooth?: boolean })._smooth = true
    smoothScrollTo(el, base + delta)
}

export const vSmooth: Directive<HTMLElement> = {
    mounted(el) {
        el.addEventListener('wheel', onWheel, { passive: false })
    },
    unmounted(el) {
        el.removeEventListener('wheel', onWheel)
        const s = states.get(el)
        if (s?.frame) cancelAnimationFrame(s.frame)
        states.delete(el)
    },
}
