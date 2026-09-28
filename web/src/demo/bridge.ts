// Messages between the demo app (in an iframe) and the pretend desktop around it (try.html).

export type Sim = { discord: boolean; heavy: boolean; away: boolean }

export type ToHost =
    | { q: 'stage'; n: number }
    | { q: 'finish' }
    | { q: 'game:start'; appId: string; exe: string; name: string; icon: string | null; colors: string | null; mode: string }
    | { q: 'game:stop'; exe: string }
    | { q: 'games:visible'; visible: boolean }
    | { q: 'games:killAll' }
    | { q: 'window'; action: 'minimize' | 'hide' | 'show' | 'quit' }
    | { q: 'drag:start'; x: number; y: number }
    | { q: 'icon'; fill: string; glyph: string }
    | { q: 'sim'; sim: Partial<Sim> }
    | { q: 'ready' }

export type ToApp =
    | { q: 'sim'; sim: Sim }
    | { q: 'game:closed'; exe: string; appId: string; code: number }
    | { q: 'tray:stopAll' }

export const inFrame = window.parent !== window

export function toHost(message: ToHost) {
    if (inFrame) window.parent.postMessage({ questly: true, ...message }, location.origin)
}

export function onHost(handler: (message: ToApp) => void) {
    window.addEventListener('message', e => {
        if (e.origin === location.origin && e.source === window.parent && e.data?.questly) handler(e.data as ToApp)
    })
}

export function toApp(frame: HTMLIFrameElement, message: ToApp) {
    frame.contentWindow?.postMessage({ questly: true, ...message }, location.origin)
}

export function onApp(frame: HTMLIFrameElement, handler: (message: ToHost) => void) {
    window.addEventListener('message', e => {
        if (e.origin === location.origin && e.source === frame.contentWindow && e.data?.questly) handler(e.data as ToHost)
    })
}
