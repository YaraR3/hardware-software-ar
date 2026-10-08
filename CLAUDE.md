# AR Software and Hardware

A browser-based AR classroom activity for Mindscape Academy (ages 7–8, the same Android tablets
that ran Smart City AR). It follows the "Hardware Vs Software" lesson deck and recaps the
condition from the "New Rover" (LEGO WeDo 2.0) session.

It is a rebuild of **Smart City AR** (`../Smart_City_AR_VSCode_2026-09-27/`, repo
`YaraR3/smart-city-ar`, live at https://yarar3.github.io/smart-city-ar/). The AR plumbing was
ported from there. Never push this project to the smart-city repo: the classroom QR codes
point at that site.

## The activity: "Wake up the desk"

The child places a small computer desk in AR. Hardware is solid 3D (monitor, keyboard, mouse,
two speakers, tablet, WeDo rover). Software is six flat glowing app tiles that float above the
monitor. That difference is the lesson's rule made visible: "if I can touch it, it is hardware".

1. **Asleep.** Screens are dark, the apps are hidden inside the monitor. Tapping any part
   opens a Yes/No question: "Can the computer parts work without a program?" Either answer
   leads to waking the desk; the apps fly out.
2. **Six missions**, one per "you need both" pair from the deck. The child taps the hardware
   and the software in either order; two slots in the mission panel fill in. When both are
   found a beam links them and the pair does its job (see the table), then a badge card shows.
3. **Bonus: the condition.** The rover drives along its track with its program blocks above
   it. Question: "IF the sensor sees something, THEN the robot will…" (Stop / Keep going).
   The child tests it by walking the tablet up to the rover (camera AR only) or with the
   "Put a wall" button (all modes). It stops and beeps; step back and it drives again.
4. Trophy card, then free exploration.

| Mission id | Hardware | Software | What plays |
|---|---|---|---|
| `draw` | `mouse` | `draw` | mouse moves, a house is drawn on the monitor |
| `write` | `keyboard` | `write` | keys light up, "Hello, robot!" is typed |
| `watch` | `monitor` | `video` | a looping film on the monitor |
| `listen` | `speaker` | `music` | speaker cones pulse, notes float, a tune plays |
| `photo` | `tablet` | `camera` | flash, then a photo on the tablet |
| `robot` | `robot` | `program` | the rover starts driving |

Wording for the children comes from the deck where possible ("You need both to draw!",
"Hardware is what we touch. Software is a program we use."). Conditions are phrased
positively ("IF the sensor sees something"), never with "if not".

## Files

Static site, no build step, no npm. Open through a local server (`run-local-server.bat`),
never `file://`.

| File | Role |
|---|---|
| `desk.js` | The 3D model. A-Frame component `tech-desk` on `#model`, global `window.TechDesk` |
| `game.js`, `game.css` | Missions, cards, badges. Builds its own panels inside an empty `#gameUI` element. Shared by all three modes. Global `window.DeskGame` |
| `ar.html`, `boot-ar.js`, `markerless.js` | Camera AR (WebXR hit-test + dom-overlay): capability check, lazy loading, surface placement, taps, size/turn/replace controls |
| `preview.html` | 3D backup, drag to look |
| `marker-ar.html`, `marker.html` | AR.js Hiro-marker backup and its printable marker |
| `index.html`, `styles.css` | Landing page |
| `test/` | Phone-free test of the camera AR flow |
| `vendor/`, `assets/` | A-Frame 1.6.0, AR.js 3.4.8, marker files, Montserrat, Mindscape mark, hexagon background |

### `desk.js`

- `items` — the twelve tappable things: `{ id, kind: "hardware" | "software", title, icon }`.
- Scenery is raw three.js merged per material by `Batch` (`b.add(geometry, color, { p, r, s, kind })`),
  so the desk draws in a few dozen calls. Labels, app tiles, screens and the program blocks
  are canvas textures drawn at runtime; there are no image assets in the model.
- `desk.itemEntity(id, x, y, z, ry)` makes the entity for a tappable thing;
  `targetBox(...)` adds its invisible hit box (`a-box.desk-target`, `data-item`).
- `desk.life` — `(t, dt)` animation callbacks run from `tick`, each in try/catch.
- The monitor and tablet are `liveScreen`s: set `.mode` and `.start`, and the life callback
  repaints (about 12 fps while something moves, once otherwise).
- Tapping dispatches `desk-item-select` on `document` (`detail: { id, kind, title, icon, element }`).
  `selectTarget` returns `false` for software while asleep so the tap falls through.
- The rover dispatches `desk-rover-sense` (`detail: { seeing, cause: "wall" | "you" }`).
  "You" is the tablet within about half a metre, only in `ar-mode`, with two distances so it
  does not flicker.
- `TechDesk`: `wake`, `play(missionId)`, `link(hardwareId, softwareId)`, `bounce(id)`,
  `markFound(missionId, icon)`, `setWall(on)`, `roverSeeing()`, `flashTarget`, `sound(name)`.
- Do not name a component method `play`, `pause`, `update`, `remove`, `init` or `tick` unless
  you mean the A-Frame lifecycle hook. A-Frame wraps them and drops the arguments
  (the activity runner is `runActivity` for that reason).
- Sounds are WebAudio beeps, unlocked on the first tap.

### `game.js`

`DeskGame.start({ root, mode: "ar" | "3d" | "marker", onLayout })`. States:
`asleep → missions → question → test → free`. `showCard({ icon, title, badge, message, note, buttons })`:
one button makes a card the whole card continues; two buttons make a question that only the
buttons answer. Desk taps are ignored while a card is open, for 400 ms after, and while a
finished pair is playing. To change missions, edit the `missions` array; ids must match
`items` in `desk.js` and the activities in `runActivity`.

### Camera AR fixes carried over from Smart City — keep them

- `#overlay` has class `a-no-style`, or A-Frame makes the full-screen game layer swallow taps.
- `beforexrselect` is cancelled for taps on `.start-card, .controls, .mission, .card, .back, button, a`.
- Never touch the DOM overlay every XR frame; hit-test dropouts get a 400 ms grace period.
- `tick` errors are caught. Stall watchdog ends a frozen session (`?stall=0` off, `?stall=8000`).
- `exit-vr` resets placement and shows a "Restart camera AR" card.

## Checking changes

- `python test/run_ar_test.py` — headless Chrome with a fake WebXR device. It places the desk,
  wakes it, finds all six pairs, tests the condition with the wall and by "walking up", and
  checks the watchdog. Last line must be `RESULT: PASS`. Run it after changing `ar.html`,
  `markerless.js`, `desk.js` or `game.js`. `drive.js` reads the mission list from `DeskGame`.
- Cache busting: scripts carry `?v=N`. After changing JS or CSS bump it where it is loaded
  (`boot-ar.js` loads `desk.js`, `game.js`, `markerless.js`; `ar.html` loads `boot-ar.js` and
  `game.css`; the backup pages load them directly).

## Look

From the lesson slides: navy `#003370`, cyan `#009fd6`, white with the pale hexagon network,
Montserrat (800 for titles, 300–500 for body), white cards with a 2px navy outline and large
radius, question buttons as side-by-side outlined pills.

## Publishing

Live at https://yarar3.github.io/hardware-software-ar/ from the public repo
`YaraR3/hardware-software-ar` (branch `main`, root). Pushing to `main` redeploys in about a
minute. `qr.html` shows `assets/project-qr.png`, which points at that address.

On this PC: no `gh` CLI (the GitHub API works with the Git Credential Manager token for
`YaraR3` via `git credential fill`); `http.postBuffer` is raised in this repo's git config
because pushes of the vendor files disconnected without it; phones cannot reach a LAN server
here, so tablet testing goes through the published site.

## Not checked yet

Not yet tried on a real tablet. Things to watch there: the half-metre "walk up" distance,
whether the beeps play in AR, whether the app tiles are easy to tap at the default size, and
the marker AR backup (it needs a real camera, so the headless test does not cover it).
