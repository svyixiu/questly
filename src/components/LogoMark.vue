<template>
    <!-- Questly mark: a rounded tile with a "Q" cut out of it, in the accent
         color (the taskbar and tray icon are drawn the same way, brand-icon.ts) -->
    <svg viewBox="0 0 24 24" aria-hidden="true" class="logo-mark">
        <rect x="1" y="1" width="22" height="22" rx="7" fill="var(--logo-fill, var(--accent))" />
        <circle cx="11.2" cy="11.2" r="4.9" fill="none" stroke="var(--logo-glyph, var(--on-accent))" stroke-width="2.7" />
        <path d="M14.6 14.6 17.6 17.6" stroke="var(--logo-glyph, var(--on-accent))" stroke-width="2.7" stroke-linecap="round" />
    </svg>
</template>
