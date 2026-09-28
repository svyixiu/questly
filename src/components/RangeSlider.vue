<script setup lang="ts">
import { computed } from 'vue';

const model = defineModel<number>({ required: true });
const props = withDefaults(defineProps<{
    label: string;
    min: number;
    max: number;
    step?: number;
    /** how the value is shown next to the label */
    format?: (value: number) => string;
}>(), { step: 1 });

const fill = computed(() => `${((model.value - props.min) / (props.max - props.min)) * 100}%`);
const shown = computed(() => props.format ? props.format(model.value) : String(model.value));

function onInput(e: Event) {
    model.value = Number((e.target as HTMLInputElement).value);
}
</script>

<template>
    <label class="block">
        <span class="flex items-baseline justify-between gap-3 mb-1.5">
            <span class="text-[12.5px] font-semibold text-ink">{{ label }}</span>
            <span class="text-[11.5px] font-mono text-muted tabular-nums">{{ shown }}</span>
        </span>
        <input type="range" class="range" :min="min" :max="max" :step="step" :value="model" :aria-label="label"
            :style="{ '--fill': fill }" @input="onInput" />
    </label>
</template>

<style scoped>
.range {
    -webkit-appearance: none;
    appearance: none;
    display: block;
    width: 100%;
    height: 18px;
    background: transparent;
    outline: none;
}

.range::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(to right, var(--accent) var(--fill), var(--line-strong) var(--fill));
}

.range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    margin-top: -6px;
    border-radius: 999px;
    background: var(--accent);
    border: 3px solid var(--bg);
    box-shadow: 0 0 0 1px var(--accent);
    transition: transform 220ms var(--ease-spring);
}

.range:active::-webkit-slider-thumb {
    transform: scale(1.2);
}

.range:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 1px var(--accent), 0 0 0 5px var(--accent-soft);
}
</style>
