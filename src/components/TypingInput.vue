<script setup lang="ts">
import { computed, ref, useAttrs, useTemplateRef } from 'vue';

/**
 * A text input where every character you type animates in.
 *
 * The real <input> sits on top with transparent text (so selection, caret,
 * IME and shortcuts all behave normally); a mirror underneath draws the same
 * characters, each one animating when it appears. Kerning and ligatures are
 * off in both so every glyph lines up with the caret.
 *
 * Classes/styles go on the wrapper; every other attribute goes to the input.
 */
defineOptions({ inheritAttrs: false });

const model = defineModel<string>({ default: '' });
const attrs: Record<string, unknown> = useAttrs();
const inputRef = useTemplateRef<HTMLInputElement>('input');
const scrollX = ref(0);

const inputAttrs = computed(() => {
    const { class: _c, style: _s, ...rest } = attrs;
    return rest;
});

const chars = computed(() => [...(model.value ?? '')]);

function syncScroll() {
    requestAnimationFrame(() => { scrollX.value = inputRef.value?.scrollLeft ?? 0; });
}

function onInput(e: Event) {
    model.value = (e.target as HTMLInputElement).value;
    syncScroll();
}

defineExpose({
    focus: () => inputRef.value?.focus(),
    select: () => inputRef.value?.select(),
    blur: () => inputRef.value?.blur(),
});
</script>

<template>
    <span class="ti" :class="attrs.class as any" :style="attrs.style as any">
        <span class="ti-mirror" aria-hidden="true">
            <span class="ti-track" :style="{ transform: `translateX(${-scrollX}px)` }">
                <span v-for="(ch, i) in chars" :key="`${i}:${ch}`" class="ti-ch">{{ ch }}</span>
            </span>
        </span>
        <input ref="input" v-bind="inputAttrs" :value="model" class="ti-input" @input="onInput" @scroll="syncScroll"
            @keyup="syncScroll" @click="syncScroll" />
    </span>
</template>

<style scoped>
.ti {
    position: relative;
    display: block;
    min-width: 0;
}

.ti-input,
.ti-mirror {
    font: inherit;
    letter-spacing: inherit;
    font-kerning: none;
    font-variant-ligatures: none;
}

.ti-input {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: transparent;
    caret-color: var(--accent);
    text-align: inherit;
    outline: none;
}

.ti-input::placeholder {
    color: var(--faint);
}

.ti-input::selection {
    background: var(--accent-soft);
    color: transparent;
}

.ti-mirror {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: var(--ti-justify, flex-start);
    overflow: hidden;
    white-space: pre;
    pointer-events: none;
    color: inherit;
}

.ti-track {
    display: inline-block;
    white-space: pre;
}

.ti-ch {
    display: inline-block;
    white-space: pre;
    animation: ti-in 320ms var(--ease-quint) both;
}

@keyframes ti-in {
    from {
        opacity: 0;
        transform: translateY(0.4em) scale(0.85);
        filter: blur(3px);
    }
    to {
        opacity: 1;
        transform: none;
        filter: none;
    }
}
</style>
