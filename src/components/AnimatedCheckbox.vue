<script setup lang="ts">
defineProps<{
    checked: boolean;
    indeterminate?: boolean;
    label?: string;
}>();

const emit = defineEmits<{
    toggle: [event: MouseEvent]
}>();
</script>

<template>
    <!-- Round check, filled with the accent gradient; the tick draws itself -->
    <button type="button" role="checkbox" :aria-checked="indeterminate && !checked ? 'mixed' : checked"
        :aria-label="label" class="cb" :class="{ 'is-on': checked || indeterminate }"
        @mousedown.prevent @dblclick.stop @click.stop="emit('toggle', $event)">
        <svg viewBox="0 0 16 16" class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.4"
            stroke-linecap="round" stroke-linejoin="round">
            <path v-if="indeterminate && !checked" d="M4.5 8h7" />
            <path v-else d="M3.8 8.4l2.8 2.8 5.6-6.2" class="check" :class="{ drawn: checked }" />
        </svg>
    </button>
</template>

<style scoped>
.cb {
    display: grid;
    place-items: center;
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    border-radius: 6px;
    border: 1.5px solid var(--line-strong);
    color: var(--on-accent);
    transition: background-color 200ms ease, border-color 200ms ease, transform 300ms var(--ease-spring);
}

.cb:hover {
    border-color: var(--ink-2);
}

.cb:active {
    transform: scale(0.82);
}

.cb.is-on {
    background: var(--accent);
    border-color: var(--accent);
}

.check {
    stroke-dasharray: 16;
    stroke-dashoffset: 16;
    transition: stroke-dashoffset 120ms ease;
}

.check.drawn {
    stroke-dashoffset: 0;
    transition: stroke-dashoffset 320ms var(--ease-quint) 60ms;
}
</style>
