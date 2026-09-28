import '~/site'

// screenshot switcher under the hero (same segmented control as the app)
const frame = document.querySelector<HTMLElement>('[data-shots]')
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-shot-tabs] button')]
const shots = frame ? [...frame.querySelectorAll<HTMLImageElement>('img')] : []
let current = 0
let userPicked = false

function show(index: number) {
    current = index
    shots.forEach((img, i) => img.classList.toggle('on', i === index))
    tabs.forEach((tab, i) => {
        tab.classList.toggle('on', i === index)
        tab.setAttribute('aria-selected', String(i === index))
    })
}

tabs.forEach((tab, i) => tab.addEventListener('click', () => { userPicked = true; show(i) }))

// cycle through them until someone picks one
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
if (!reduce && shots.length > 1) {
    setInterval(() => {
        if (!userPicked && document.visibilityState === 'visible') show((current + 1) % shots.length)
    }, 5000)
}
