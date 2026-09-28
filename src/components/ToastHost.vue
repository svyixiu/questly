<script setup lang="ts">
import { useToasts } from '@/composables/toasts';

const { toasts, dismiss } = useToasts();

const tone: Record<string, string> = {
    success: 'var(--accent)',
    error: 'var(--danger)',
    warning: 'var(--warn)',
    info: 'var(--ink-2)',
};
</script>

<template>
    <Teleport to="body">
        <!-- Notification banners, sliding in at the top right -->
        <div class="fixed top-16 right-4 z-[110] flex flex-col items-end gap-2 pointer-events-none w-[21rem]">
            <TransitionGroup name="toast">
                <div v-for="t in toasts" :key="t.id"
                    class="toast pointer-events-auto w-full flex items-start gap-3 rounded-2xl px-4 py-3"
                    role="status" @click="dismiss(t.id)">
                    <span class="w-2 h-2 rounded-full mt-1.5 shrink-0" :style="{ background: tone[t.kind] }"></span>
                    <div class="min-w-0">
                        <div class="text-sm font-semibold text-ink">{{ t.title }}</div>
                        <div v-if="t.detail" class="text-[13px] text-muted mt-0.5 break-words selectable leading-snug">{{ t.detail }}</div>
                    </div>
                </div>
            </TransitionGroup>
        </div>
    </Teleport>
</template>

<style scoped>
.toast {
    background: var(--glass-2);
    border: 1px solid var(--line-strong);
    box-shadow: 0 18px 40px -20px rgba(0, 0, 0, 0.7);
}

.toast-move,
.toast-enter-active {
    transition: transform 620ms var(--ease-quint), opacity 250ms ease;
}

.toast-leave-active {
    transition: transform 260ms ease, opacity 200ms ease;
    position: absolute;
}

.toast-enter-from {
    opacity: 0;
    transform: translateX(110%);
}

.toast-leave-to {
    opacity: 0;
    transform: translateX(40%);
}
</style>
