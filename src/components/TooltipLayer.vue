<script setup lang="ts">
import { nextTick, ref, useTemplateRef } from 'vue';
import { useEventListener } from '@vueuse/core';

/**
 * One tooltip for the whole app. Any element with data-tip="…" gets it on
 * hover (data-tip-pos="bottom" to prefer below). Drawn on top of everything
 * and clamped inside the window, so panels with overflow:hidden or the
 * window edge never cut it off.
 */
const MARGIN = 8;
const GAP = 8;

const bubble = useTemplateRef<HTMLElement>('bubble');
const tip = ref<{ text: string; left: number; top: number; place: 'top' | 'bottom' } | null>(null);
let anchor: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function hide() {
    if (timer) clearTimeout(timer);
    timer = null;
    anchor = null;
    tip.value = null;
}

async function show(el: HTMLElement) {
    const text = el.dataset.tip;
    if (!text || !el.isConnected) return;
    const r = el.getBoundingClientRect();
    let place: 'top' | 'bottom' = el.dataset.tipPos === 'bottom' ? 'bottom' : 'top';
    if (place === 'top' && r.top < 44) place = 'bottom';
    if (place === 'bottom' && r.bottom > window.innerHeight - 44) place = 'top';
    tip.value = { text, left: r.left + r.width / 2, top: place === 'top' ? r.top - GAP : r.bottom + GAP, place };
    await nextTick();
    // center on the anchor, then keep the whole bubble inside the window
    const w = bubble.value?.offsetWidth ?? 0;
    const centered = r.left + r.width / 2 - w / 2;
    if (tip.value) tip.value.left = Math.max(MARGIN, Math.min(window.innerWidth - w - MARGIN, centered));
}

useEventListener(document, 'pointerover', (e: PointerEvent) => {
    const el = (e.target as Element | null)?.closest?.('[data-tip]') as HTMLElement | null;
    if (el === anchor) return;
    hide();
    if (!el) return;
    anchor = el;
    timer = setTimeout(() => { if (anchor === el) show(el); }, 350);
});
useEventListener(document, 'pointerdown', hide, { capture: true });
useEventListener(document, 'keydown', hide, { capture: true });
useEventListener(document, 'wheel', hide, { capture: true, passive: true });
useEventListener(window, 'blur', hide);
</script>

<template>
    <Teleport to="body">
        <Transition name="tip">
            <div v-if="tip" ref="bubble" class="bubble" :class="tip.place" role="tooltip"
                :style="{ left: `${tip.left}px`, top: `${tip.top}px` }">
                {{ tip.text }}
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.bubble {
    position: fixed;
    z-index: 400;
    max-width: min(22rem, calc(100vw - 16px));
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--paper);
    color: var(--paper-ink);
    font-family: var(--font-sans);
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    box-shadow: 0 10px 30px -12px rgba(0, 0, 0, 0.6);
}

.bubble.top {
    transform: translateY(-100%);
}

.tip-enter-active {
    transition: opacity 140ms ease, translate 220ms var(--ease-out);
}

.tip-leave-active {
    transition: opacity 80ms ease;
}

.tip-enter-from {
    opacity: 0;
    translate: 0 4px;
}

.tip-leave-to {
    opacity: 0;
}
</style>
