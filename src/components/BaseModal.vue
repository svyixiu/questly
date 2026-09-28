<script lang="ts">
// Open modals, bottom to top; only the topmost one reacts to Esc.
const stack: number[] = [];
let nextId = 1;
</script>

<script setup lang="ts">
import { useEventListener } from '@vueuse/core';
import { onUnmounted, watch } from 'vue';

const props = withDefaults(defineProps<{
    open: boolean;
    title?: string;
    /** small uppercase label above the title */
    eyebrow?: string;
    subtitle?: string;
    width?: string;
    /** Spotlight-style: sits near the top instead of centered */
    placement?: 'center' | 'top';
    /** hide the header (title + close dot) */
    bare?: boolean;
    /** Esc / backdrop clicks don't close it (for required choices) */
    persistent?: boolean;
}>(), { width: '30rem', placement: 'center', bare: false, persistent: false });

const emit = defineEmits<{ close: [] }>();

const id = nextId++;
function remove() {
    const i = stack.indexOf(id);
    if (i >= 0) stack.splice(i, 1);
}
watch(() => props.open, open => {
    remove();
    if (open) stack.push(id);
}, { immediate: true });
onUnmounted(remove);

function requestClose() {
    if (!props.persistent) emit('close');
}

useEventListener(window, 'keydown', (e: KeyboardEvent) => {
    if (props.open && e.key === 'Escape' && stack[stack.length - 1] === id) {
        e.stopPropagation();
        e.preventDefault();
        requestClose();
    }
}, { capture: true });
</script>

<template>
    <Teleport to="body">
        <Transition name="modal">
            <div v-if="open" class="fixed inset-0 z-[100] flex justify-center p-6"
                :class="placement === 'top' ? 'items-start pt-[12vh]' : 'items-center'">
                <div class="backdrop absolute inset-0" @click="requestClose"></div>
                <div role="dialog" aria-modal="true"
                    class="sheet paper relative w-full overflow-hidden flex flex-col max-h-[84vh] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]"
                    :style="{ maxWidth: width }">
                    <!-- the corner dot doubles as the close button -->
                    <button v-if="!bare && !persistent" class="dot" aria-label="Close" @click="emit('close')">
                        <svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" /></svg>
                    </button>
                    <span v-else-if="!bare" class="dot static" aria-hidden="true"></span>

                    <div v-if="!bare" class="px-7 pt-7 pb-1 pr-12">
                        <div v-if="eyebrow" class="eyebrow mb-2">{{ eyebrow }}</div>
                        <h2 class="display text-[28px] leading-[30px] text-ink">{{ title }}</h2>
                        <p v-if="subtitle" class="text-[15px] text-muted mt-2 leading-snug">{{ subtitle }}</p>
                    </div>
                    <div class="min-h-0 overflow-y-auto" :class="bare ? '' : 'px-7 pb-6 pt-3'">
                        <slot />
                    </div>
                    <div v-if="$slots.footer" class="px-7 pb-6 flex items-center justify-end gap-2">
                        <slot name="footer" />
                    </div>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped>
.backdrop {
    background: color-mix(in srgb, #0c0b0a 62%, transparent);
    backdrop-filter: blur(4px);
}

.dot {
    position: absolute;
    top: 18px;
    right: 18px;
    z-index: 2;
    width: 12px;
    height: 12px;
    border-radius: 999px;
    background: var(--paper-ink);
    display: grid;
    place-items: center;
    transition: width 220ms var(--ease-spring), height 220ms var(--ease-spring), top 220ms var(--ease-spring),
        right 220ms var(--ease-spring);
}

.dot svg {
    width: 10px;
    height: 10px;
    fill: none;
    stroke: var(--paper);
    stroke-width: 1.6;
    stroke-linecap: round;
    opacity: 0;
    transition: opacity 120ms ease;
}

.dot:not(.static):hover {
    width: 24px;
    height: 24px;
    top: 12px;
    right: 12px;
}

.dot:not(.static):hover svg {
    opacity: 1;
}

.modal-enter-active,
.modal-leave-active {
    transition: opacity 220ms ease;
}

.modal-enter-active .sheet {
    transition: transform 560ms var(--ease-quint), opacity 220ms ease;
}

.modal-leave-active .sheet {
    transition: transform 160ms ease, opacity 160ms ease;
}

.modal-enter-from,
.modal-leave-to {
    opacity: 0;
}

.modal-enter-from .sheet {
    transform: translateY(22px) scale(0.97);
    opacity: 0;
}

.modal-leave-to .sheet {
    transform: scale(0.98);
    opacity: 0;
}
</style>
