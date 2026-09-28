<template>
    <!-- Slowly drifting, heavily blurred color blobs behind the glass panels -->
    <div class="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
        <div class="blob b1"></div>
        <div class="blob b2"></div>
        <div class="blob b3"></div>
        <div class="blob b4"></div>
        <div class="grain"></div>
        <div class="vignette"></div>
    </div>
</template>

<style scoped>
.blob {
    position: absolute;
    border-radius: 999px;
    opacity: var(--blob-opacity);
    filter: blur(var(--glow-blur, 90px));
    will-change: transform;
    transition: background 800ms ease;
}

.b1 {
    width: 620px;
    height: 620px;
    left: -160px;
    top: -220px;
    background: radial-gradient(circle, var(--blob-1) 0%, transparent 68%);
    animation: drift-1 26s ease-in-out infinite alternate;
}

.b2 {
    width: 560px;
    height: 560px;
    right: -180px;
    top: -120px;
    background: radial-gradient(circle, var(--blob-2) 0%, transparent 68%);
    animation: drift-2 30s ease-in-out infinite alternate;
}

.b3 {
    width: 600px;
    height: 600px;
    left: 20%;
    bottom: -320px;
    background: radial-gradient(circle, var(--blob-3) 0%, transparent 68%);
    animation: drift-3 34s ease-in-out infinite alternate;
}

.b4 {
    width: 480px;
    height: 480px;
    right: 8%;
    bottom: -200px;
    background: radial-gradient(circle, var(--blob-4) 0%, transparent 68%);
    animation: drift-4 28s ease-in-out infinite alternate;
}

@keyframes drift-1 {
    to {
        transform: translate(180px, 120px) scale(1.15);
    }
}

@keyframes drift-2 {
    to {
        transform: translate(-220px, 160px) scale(0.9);
    }
}

@keyframes drift-3 {
    to {
        transform: translate(160px, -140px) scale(1.1);
    }
}

@keyframes drift-4 {
    to {
        transform: translate(-120px, -180px) scale(1.2);
    }
}

/* fine film grain keeps the gradients from banding */
.grain {
    position: absolute;
    inset: 0;
    opacity: 0.06;
    mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>");
}

.vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at center, transparent 55%, color-mix(in srgb, var(--bg) 70%, transparent) 100%);
}
</style>
