/**
 * Everything that changed in Questly, newest first. Shown in Settings →
 * About → Changelog. Add the new version at the top when you release.
 * Versions before 1.0.0 were preview builds.
 */
export type ChangeKind = 'new' | 'improved' | 'fixed' | 'design' | 'performance' | 'security'

export interface Change {
    kind: ChangeKind;
    text: string;
}

export interface Release {
    version: string;
    /** YYYY-MM-DD */
    date: string;
    title: string;
    preview?: boolean;
    changes: Change[];
}

export const CHANGE_KINDS: { id: ChangeKind; label: string }[] = [
    { id: 'new', label: 'New' },
    { id: 'improved', label: 'Improved' },
    { id: 'fixed', label: 'Fixed' },
    { id: 'design', label: 'Design' },
    { id: 'performance', label: 'Performance' },
    { id: 'security', label: 'Security' },
]

export const CHANGELOG: Release[] = [
    {
        version: '1.3.0',
        date: '2026-09-30',
        title: 'Several at a time, and thousands of games',
        changes: [
            { kind: 'new', text: 'One after another can play 2, 3, 5 or 10 games at a time. Each still waits for Discord and counts down on its own; when one is done, the next in line takes its place.' },
            { kind: 'new', text: 'Only one Questly runs at a time. Opening it again brings the open window forward instead of adding a second window and tray icon. Opening a different Questly.exe, such as a new download, hands over to it so it can update.' },
            { kind: 'new', text: 'The title bar has a button that hides the library: an X folds it away and three lines bring it back. Ctrl+B does the same.' },
            { kind: 'new', text: 'Always on top keeps Questly above every other window. Turn it on with the pin in the title bar or in Settings.' },
            { kind: 'new', text: 'Launch all asks first when it would start more than 25 games, and offers a timed run instead.' },
            { kind: 'fixed', text: "Stop all didn't work while Launch all was still starting games, so games kept appearing. Now it stops the rest from starting too." },
            { kind: 'fixed', text: 'Stopping a timed run while a game was just starting could leave that game running.' },
            { kind: 'fixed', text: 'Dialogs whose content scrolls now show a line where it gets cut, like the title bar does.' },
            { kind: 'fixed', text: "The Activity log stopped following new entries once it held 500 lines." },
            { kind: 'performance', text: 'Switching to the Library tab with hundreds of games no longer stutters. Pages switch without a blur effect, and rows out of view skip drawing.' },
            { kind: 'performance', text: 'Big timed runs start without freezing the app. The run list shows the last few finished games, the ones playing and the next ones in line, not all of them.' },
            { kind: 'performance', text: 'Stop all ends every game in one go, so stopping thousands takes about as long as stopping one.' },
            { kind: 'performance', text: 'Questly starts faster with a big library, and adding games no longer draws the whole list.' },
            { kind: 'performance', text: 'The timed run dialog opens instantly with thousands of games and shows the first 50 in line.' },
        ],
    },
    {
        version: '1.2.2',
        date: '2026-09-29',
        title: 'No more console windows',
        changes: [
            { kind: 'fixed', text: "Stopping a game no longer flashes a console window that takes the focus from what you're doing. Questly now ends games itself instead of starting taskkill." },
            { kind: 'performance', text: 'Stopping games is quicker, since no helper program has to start first.' },
        ],
    },
    {
        version: '1.2.1',
        date: '2026-09-29',
        title: 'Big libraries stay fast',
        changes: [
            { kind: 'performance', text: 'The library draws 100 games at a time. Scrolling near the end brings in the next 100, a few rows per frame, so hundreds of games open and scroll smoothly.' },
            { kind: 'design', text: 'Skeleton rows show where the next games are coming in.' },
            { kind: 'improved', text: 'Moving the focus with the keyboard, or adding games, draws the rows needed to show them right away.' },
        ],
    },
    {
        version: '1.2.0',
        date: '2026-09-29',
        title: 'Random games',
        changes: [
            { kind: 'new', text: 'Spotlight can add 1, 5, 10, 50 or 100 random games at once (Alt+1 to Alt+5). With the search empty they come from every game; with a search, from the games whose name has every word you typed.' },
            { kind: 'new', text: 'Undo takes a random batch back out, in case 100 was a few too many.' },
            { kind: 'improved', text: "Random picks skip games already in your library and games that can't be launched, since those can't count toward a quest." },
        ],
    },
    {
        version: '1.1.1',
        date: '2026-09-29',
        title: 'No more leftover tray icons',
        changes: [
            { kind: 'fixed', text: "Stopping a game, Panic Abort and uninstalling no longer leave the game's icon behind in the notification area." },
            { kind: 'fixed', text: 'Uninstalling Questly also closes games that are still running, so their files can be deleted and their icons go away.' },
            { kind: 'improved', text: "Quitting always takes Questly's own tray icon down first." },
        ],
    },
    {
        version: '1.1.0',
        date: '2026-09-29',
        title: 'Terms, About and this changelog',
        changes: [
            { kind: 'new', text: 'The notice before you start now also asks you to agree to the Terms of Service and Terms of Use, with links to read them and the Privacy Policy.' },
            { kind: 'new', text: 'An About section in Settings shows the version and when it was updated, with links to the website, the source code and the legal pages.' },
            { kind: 'new', text: 'This changelog: every change since the first build, filterable by kind.' },
            { kind: 'improved', text: 'When the Terms change, Questly asks you to agree to the new version before you continue.' },
            { kind: 'improved', text: 'Legitimate Buddy waits until the notice and the current Terms are accepted.' },
        ],
    },
    {
        version: '1.0.0',
        date: '2026-09-29',
        title: 'First public release',
        changes: [
            { kind: 'new', text: 'A website with a live demo that runs the real Questly interface in your browser, on a pretend PC.' },
            { kind: 'new', text: 'Downloads and source code on GitHub, under the MIT License, with credit to the original project.' },
            { kind: 'new', text: 'Privacy Policy, Terms of Service, Terms of Use, Licenses and Credits pages.' },
            { kind: 'fixed', text: 'Discord game ids were rounded because they are too large for JavaScript numbers. Closing a game from its own window now updates Questly, and Buddy\'s "Only set up ones" finds your games.' },
            { kind: 'security', text: 'Game ids are checked to be digits only before they are used as folder names.' },
            { kind: 'improved', text: 'Version numbers start fresh at 1.0.0.' },
        ],
    },
    {
        version: '0.9',
        date: '2026-09-29',
        title: 'Smoother search',
        preview: true,
        changes: [
            { kind: 'performance', text: 'Search runs in the background, so typing never stutters, even across Discord\'s whole list of about 25,000 games.' },
            { kind: 'design', text: 'Search results slide in one after another instead of all at once.' },
            { kind: 'performance', text: 'The library only redraws games that are running or timed, so big libraries stay smooth.' },
            { kind: 'fixed', text: 'Scrolled content is cut exactly at the title bar\'s line, and the library list at the line under the search box.' },
        ],
    },
    {
        version: '0.8',
        date: '2026-09-29',
        title: 'Guard, Panic and Buddy',
        preview: true,
        changes: [
            { kind: 'new', text: 'Performance Guard watches CPU, memory and stutter during timed runs, closes a few games for a while when your PC struggles, and brings them back with their time left. On by default, with a warning before you turn it off.' },
            { kind: 'new', text: 'Panic Abort: a Panic button in the title bar and Ctrl+Shift+X stop every game, the timer and background sessions, then show what was stopped.' },
            { kind: 'new', text: 'Legitimate Buddy plays games from your library while you\'re away, within the idle time, games per day, session length, hours, days and limits you choose. It can check, open and close Discord, and stops when you\'re back.' },
            { kind: 'new', text: 'Launch on startup: Questly starts quietly in the tray when you sign in to Windows.' },
            { kind: 'new', text: 'Custom theme: a color for every part of the app, plus glow strength, glow softness, card solidity and background blur.' },
            { kind: 'new', text: 'The app icon follows your accent color on the taskbar, in the tray and on your shortcuts.' },
            { kind: 'new', text: 'A startup animation: the logo and three breathing dots that turn green as Questly loads.' },
            { kind: 'design', text: 'A separator line under the title bar.' },
        ],
    },
    {
        version: '0.7',
        date: '2026-09-28',
        title: 'Game windows and accents',
        preview: true,
        changes: [
            { kind: 'new', text: 'Each game gets a square window in Questly\'s style with its icon, title and play time, plus Close and Close & delete. Drag it from anywhere.' },
            { kind: 'fixed', text: 'The accent color now re-tints the whole app, including the background glow and text, and stays readable on every theme, custom colors too.' },
            { kind: 'fixed', text: 'The selected theme and accent are clearly marked.' },
            { kind: 'fixed', text: 'The sliding tab highlight no longer bounces past its edges.' },
            { kind: 'design', text: 'New toggle switches: an accent-colored knob when off, an accent track when on.' },
            { kind: 'fixed', text: 'The RPC test showed an unrelated app. It now shows you playing the selected game.' },
        ],
    },
    {
        version: '0.6',
        date: '2026-09-28',
        title: 'One file that installs itself',
        preview: true,
        changes: [
            { kind: 'new', text: 'Questly.exe is both the installer and the app: open it, click Install, accept the notice. Per user, no admin rights, with an Apps & features entry and a clean uninstall.' },
            { kind: 'new', text: 'Your library moved to %APPDATA%\\Questly\\library.json.' },
            { kind: 'new', text: 'Export your library, and import one: keep yours and add the new games, or replace yours.' },
            { kind: 'design', text: 'Letters animate in as you type in text fields.' },
            { kind: 'fixed', text: 'Tooltips were cut off by panels and the window edge.' },
            { kind: 'fixed', text: 'The "running" pill\'s corners now match the pills next to it.' },
            { kind: 'fixed', text: 'The Play icon was off-center.' },
        ],
    },
    {
        version: '0.5',
        date: '2026-09-28',
        title: 'Hello, Questly',
        preview: true,
        changes: [
            { kind: 'new', text: 'A new name: Questly.' },
            { kind: 'design', text: 'A new look: warm dark surfaces, cream feature cards, bold type, pill buttons, and no gradients on controls.' },
            { kind: 'new', text: 'A notice before you start, explaining the risk to your Discord account, that you have to accept.' },
        ],
    },
    {
        version: '0.4',
        date: '2026-09-28',
        title: 'A fresh start',
        preview: true,
        changes: [
            { kind: 'design', text: 'A custom title bar with window buttons, a fixed-size window, a soft glowing background and smooth scrolling.' },
            { kind: 'improved', text: 'Game windows never take focus and open far off-screen.' },
            { kind: 'new', text: 'Timers can wait until Discord reports the game before counting down, so the time matches your quest progress.' },
            { kind: 'new', text: 'One after another can run in a fixed or a random order.' },
            { kind: 'new', text: 'Your games are saved in a library.json file you can open and edit.' },
        ],
    },
    {
        version: '0.3',
        date: '2026-09-27',
        title: 'Seconds and quieter hiding',
        preview: true,
        changes: [
            { kind: 'improved', text: 'Timers can be set in seconds, not just minutes.' },
            { kind: 'improved', text: 'Auto hide also hides the game windows.' },
            { kind: 'design', text: 'A redesign in the style of Discord (replaced later by Questly\'s own look).' },
        ],
    },
    {
        version: '0.2',
        date: '2026-09-27',
        title: 'Timers and themes',
        preview: true,
        changes: [
            { kind: 'new', text: 'A warning before adding a game that has no launchable executable.' },
            { kind: 'new', text: 'Timed runs that stop games by themselves: all at once, or one after another.' },
            { kind: 'new', text: 'Auto hide: the app hides to the tray after launching games.' },
            { kind: 'new', text: 'Themes.' },
        ],
    },
    {
        version: '0.1',
        date: '2026-09-27',
        title: 'The first redesign',
        preview: true,
        changes: [
            { kind: 'new', text: 'Launch all and Stop all.' },
            { kind: 'design', text: 'A redesigned interface with smooth animations.' },
            { kind: 'new', text: 'Checkmarks to pick which games to launch, and a checkmark on games you added.' },
            { kind: 'improved', text: 'Search hides games that are already in your library.' },
            { kind: 'new', text: 'Keyboard shortcuts for everything; press ? to see them.' },
        ],
    },
]

/** Where it all started. */
export const ORIGIN = {
    name: 'Discord Quest Completer',
    author: 'Mark Terence Tiglao',
    text: 'Questly started as a fork of Discord Quest Completer: the original Tauri app that starts a small stand-in program with a game\'s executable name so Discord detects it.',
}

/** A release date for people, e.g. "September 29, 2026". */
export function formatReleaseDate(date: string) {
    const [y, m, d] = date.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}
