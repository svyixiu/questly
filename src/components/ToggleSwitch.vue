<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
defineProps<{ label?: string; disabled?: boolean }>();
</script>

<template>
    <!-- Off: outlined track, accent-colored knob. On: accent track, dark knob. -->
    <button type="button" role="switch" :aria-checked="model" :aria-label="label" :disabled="disabled" class="switch"
        :class="{ on: model }" @click="model = !model">
        <span class="knob"></span>
    </button>
</template>

<style scoped>
.switch {
    position: relative;
    width: 2.75rem;
    height: 1.625rem;
    flex-shrink: 0;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    background: transparent;
    transition: background-color 250ms ease, border-color 250ms ease;
}

.switch:focus-visible {
    outline-offset: 3px;
}

.switch.on {
    background: var(--accent);
    border-color: var(--accent);
}

.switch:disabled {
    opacity: 0.4;
}

.knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 1.125rem;
    height: 1.125rem;
    border-radius: 999px;
    background: var(--accent);
    transition: transform 380ms var(--ease-quint), width 200ms ease, background-color 250ms ease;
}

.switch.on .knob {
    transform: translateX(1.125rem);
    background: var(--on-accent);
}

.switch:active:not(:disabled) .knob {
    width: 1.375rem;
}

.switch.on:active:not(:disabled) .knob {
    transform: translateX(0.875rem);
}
</style>
