<script setup lang="ts">
import AnimatedCheckbox from './AnimatedCheckbox.vue';
import { LINKS, openLink } from '@/data/legal';

/**
 * The rules & risk text, with the two boxes both needed to continue:
 * understanding the risk (v-model:risk) and agreeing to the Terms (v-model:terms).
 */
const risk = defineModel<boolean>('risk', { required: true });
const terms = defineModel<boolean>('terms', { required: true });
</script>

<template>
    <div>
        <div class="text-[14px] leading-[1.55] text-ink-2 space-y-2.5">
            <p>
                Questly makes Discord believe you're playing games you aren't running. That goes against
                <span class="text-ink font-semibold">Discord's Terms of Service</span>.
            </p>
            <p>Using it can lead to serious consequences for your account, including:</p>
            <ul class="space-y-1 pl-1">
                <li class="flex gap-2.5"><span class="mt-2 w-1.5 h-1.5 rounded-full bg-ink shrink-0"></span>quest rewards being removed or never granted</li>
                <li class="flex gap-2.5"><span class="mt-2 w-1.5 h-1.5 rounded-full bg-ink shrink-0"></span>warnings, or a temporary suspension of your account</li>
                <li class="flex gap-2.5"><span class="mt-2 w-1.5 h-1.5 rounded-full bg-ink shrink-0"></span>a permanent ban, losing your servers, messages, friends and purchases such as Nitro</li>
            </ul>
            <p>
                Questly isn't affiliated with or endorsed by Discord. Its makers accept
                <span class="text-ink font-semibold">no responsibility</span> for what happens to your account.
                You use it entirely at your own risk and are responsible for everything you do with it.
            </p>
        </div>

        <div class="mt-4 space-y-2">
            <label class="agree" :class="{ on: risk }" @click.prevent="risk = !risk">
                <AnimatedCheckbox :checked="risk" label="I understand the risks" class="mt-0.5" @toggle="risk = !risk" />
                <span class="text-sm text-ink leading-snug">
                    I understand that using Questly could get my Discord account suspended or banned, and that I alone am
                    responsible for the consequences.
                </span>
            </label>
            <label class="agree" :class="{ on: terms }" @click.prevent="terms = !terms">
                <AnimatedCheckbox :checked="terms" label="I agree to the Terms of Service and Terms of Use" class="mt-0.5"
                    @toggle="terms = !terms" />
                <span class="text-sm text-ink leading-snug">
                    I agree to the
                    <a class="doc-link" :href="LINKS.terms" @click.stop.prevent="openLink(LINKS.terms)">Terms of Service</a>
                    and the
                    <a class="doc-link" :href="LINKS.termsOfUse" @click.stop.prevent="openLink(LINKS.termsOfUse)">Terms of Use</a>,
                    and I've read the
                    <a class="doc-link" :href="LINKS.privacy" @click.stop.prevent="openLink(LINKS.privacy)">Privacy Policy</a>.
                </span>
            </label>
        </div>
    </div>
</template>

<style scoped>
.agree {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: 16px;
    border: 1px solid var(--line-strong);
    cursor: pointer;
    transition: border-color 150ms ease, background-color 150ms ease;
}

.agree:hover {
    background: var(--glass);
}

.agree.on {
    border-color: var(--ink-2);
}

.doc-link {
    font-weight: 600;
    text-decoration: underline;
    text-decoration-thickness: 1.5px;
    text-underline-offset: 2px;
    cursor: pointer;
}

.doc-link:hover {
    text-decoration-thickness: 2.5px;
}
</style>
