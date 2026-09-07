# Petros Space Adventure

A browser-based, single-file-per-concern arcade shooter. No build step, no dependencies,
no package manager — plain HTML + CSS + a single `<canvas>` game loop in vanilla JS.

## Which copy of this project to edit — READ FIRST

There are two checkouts of this game on disk with the same git history, and Claude Code
sessions frequently launch in the **wrong** one. Edits to the wrong copy are invisible to
the user: the page they are looking at never changes, and the session ends up debugging a
caching problem that does not exist.

| Path | Status |
| --- | --- |
| `~/Developer/experiment-ai-websites/Petros Space Adventure` | **Live.** This is what the local server serves and what other agents edit. |
| `~/Developer/petros-space-adventure-main` | Stale clone. Sessions often launch here. Do not edit. |

**Before the first edit of every session**, confirm the target directory is the one being
served, and never assume the launch directory is it:

```bash
# prints "port -> document root" for every local static server that is listening
lsof -nP -iTCP -sTCP:LISTEN | awk 'NR>1 && $1 ~ /[Pp]ython|node|ruby|php/ {print $2, $9}' |
  sort -u | while read pid port; do
    echo "$port -> $(lsof -a -d cwd -p "$pid" -Fn | tail -1 | cut -c2-)"
  done
```

Edit the files under the document root it prints. If no server is running, ask the user
which copy they are viewing rather than guessing.

Then verify the change actually reached the browser before reporting it done — reading the
file back proves nothing, because the file you read may not be the file being served:

```bash
curl -s http://localhost:<port>/index.html | grep <the thing you changed>
```

Two follow-on rules:

- **Do not mirror edits into both copies.** One live copy, one edit. Copying to the stale
  clone creates divergent history that has to be untangled later. This section, the no-change-log
  rule and the roadmap below it are the one deliberate exception — they live in both copies'
  `CLAUDE.md` because a session launched in the stale clone only ever reads that copy's file.
- **Static assets need a cache bust like scripts do.** `index.html` versions its CSS and JS
  with `?v=` query strings; `favicon.svg` and `apple-touch-icon.png` need the same treatment,
  because browsers cache favicons far more aggressively than any other asset and will keep
  showing the old icon through an ordinary reload.

## There is no change log — READ FIRST

The game no longer tracks releases. The hand-written CHANGE LOG button and its version-history
panel are gone. The build is marked **ALPHA** in two places instead — a chip after SPACE ADVENTURE
in the title (`.dev-tag`) and a static stamp in the bottom-left corner of the menu (`.alpha-tag`) —
and neither needs updating when work lands.

**So: do not write release notes, do not add version entries, and do not reinstate the panel.**
The whole build is alpha, and that is the only thing the player is told. If a session wants to
record what changed, the git history is the place for it.

**The MOON UPDATE badge.** `.moon-promo` announces chapter 1 from the right of the title card.
Its art is **`MOON_ORB_SVG` — the same portrait the LEVELS picker and the ALPHA panel use**,
traced from `drawMoon`'s own coordinates, injected by `main.js` into `#moon-promo-orb`. It was
first built as a stack of CSS gradients and that was the wrong call: a hand-made lookalike drifts
from the real body immediately (wrong eyes, wrong crescent) and reads as a different character to
the one you actually fight. If the Moon needs to appear anywhere else in the DOM, reuse that
constant rather than rebuilding it — and tune the asset itself, not with per-place CSS overrides.

It lives inside `.menu-stage`, a shrink-wrapping flex box around `.title-block`, and is positioned
at `left: 100%` of it — so it always hangs the same ~40-70px off the **card's** edge instead of
being pinned to the viewport, where on a wide monitor it ended up marooned in empty space with the
card nowhere near it. `.menu-stage` exists only for that: the badge cannot live inside
`.title-block`, because that scrolls (`overflow-y: auto`) and would clip anything hanging outside
it. The card stays exactly centred at every width (measured: 0px off centre from 430px to 2000px).
It is inside `.menu-wrap`, so it disappears with the menu when a run starts.

The LIVE NOW pill reads `--theme`, so it re-skins with the ship colour like the rest of the menu
chrome. Under 900px the badge turns into a single-line strip along the top rather than being
dropped — a phone should still be told what shipped — and everything in that strip is `nowrap`,
because it has exactly one line to work in. It is deliberately not a button: it is a sign, not a
control, so it can never eat a click near START.

Two corners of the menu, one shared box: `.alpha-tag` on the left and `.reset-btn` on the right
(the dev reset — see "BUILDER"). They share one CSS rule so they stay the same size as each
other; keep it that way.

Both ALPHA marks are buttons and both call `openAlphaPanel()`, which opens `#alpha-panel` — the
card that tells the player what is being built and asks for patience. It remembers which mark
opened it in `alphaReturnTarget` so Escape, ✕ and GOT IT all hand focus back to the right one.
Update its `.alpha-pips` and `2 OF 11 CHAPTERS PLAYABLE` line when a chapter ships; that meter is
the one player-facing count of progress left in the game.

`#alpha-panel` reuses the shared `.controls-card` shell, so **every rule for it is double-classed
`.controls-card.alpha-card ...`**. `.controls-card p` is written for the CONTROLS key/action list
— pixel font, 16px margins, and a two-column grid under 700px that squeezed the card's prose into
a 42% column. Drop a class from one of those selectors and that styling bleeds straight back in. Both, plus `.dev-tag`, read `--theme` / `--theme-rgb`, so the
build markings re-skin with the ship colour like the rest of the menu chrome. `.dev-tag` sizes
everything in `em` off the subtitle's clamped type — don't give it its own breakpoints.


## Roadmap — the eleven chapters

The game is going from two bosses to eleven: a full run from Earth out to the Sun, built **one
chapter at a time** across many sessions. This section is the agreed plan. Take the order, the
colour and the reward for a chapter from the table rather than inventing them — otherwise each
session picks a clashing swatch or hands out a reward another chapter already owns.

Settled: textbook planet order; Venus keeps its slot and its balance, and the Moon has taken wave 5
(the old Mercury fight went with it, so Mercury is now an unbuilt chapter 2); the Sun is the true final boss; the six currently-free supers become boss rewards and are
locked for everyone; four waves then a boss in every chapter; a launch screen lets a player resume
at any chapter they have cleared.

Line numbers are deliberately absent below — `main.js` is edited often and by more than one agent,
so everything is named by symbol. Grep for the name.

### The sequence

| # | Chapter | Waves | Boss wave | Boss HP | Ship colour | Gear |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | MOON | 1–4 | 5 | 110 | Grey `#b9b9c0` **(built)** | TECH.0 **(built)** |
| 2 | MERCURY | 6–9 | 10 | 150 | Iron `#9a8778` | DECOY |
| 3 | VENUS | 11–14 | 15 | 250 *(unchanged)* | Magma Red `#ff5040` *(exists)* | MAGMA *(exists)* |
| 4 | MARS | 16–19 | 20 | 300 | Rust `#d2613a` | DRONE |
| 5 | THE BELT | 21–24 | 25 | 340 | Ore `#a98f63` | STAR |
| 6 | JUPITER | 26–29 | 30 | 420 | Amber `#f0b667` | RADIANT ORB |
| 7 | SATURN | 31–34 | 35 | 460 | Ring Gold `#cbb583` | MIRROR |
| 8 | URANUS | 36–39 | 40 | 520 | Aqua `#7fe3d0` | FIRST-AID |
| 9 | NEPTUNE | 41–44 | 45 | 580 | Abyss `#3f63d8` | GALE *(new gun)* |
| 10 | PLUTO | 46–49 | 50 | 640 | Ice Violet `#b9a6f0` | STASIS *(new super)* |
| 11 | THE SUN | 51–54 | 55 | 900 | Solar `#fff0c4` | CORONA *(new super)* |

Only three pieces of gear are new. Chapters 1–8 hand out supers that already exist and only need a
lock put on them — that is what makes eleven chapters affordable at all.

### What each chapter is

The reward is the planet's own mechanic, so beating a boss hands you the thing that just beat you.
Build the fight to match:

- **Moon** — **built**; see "The Moon" below for what it actually does. It pays out the Grey Ship
  and Tech.0 it inherited from Mercury, because moving it to DECOY needs super-locking machinery
  that does not exist yet.
- **Mercury** — **not built.** The Moon took over wave 5 and the old Mercury fight went with it, so
  this is a fresh boss on the same shape: the burnt, cratered, molten-seamed rock closest to the Sun.
  `VENUS_CRACKS` is the fissure treatment its body wants.
- **Venus** — as it is today.
- **Mars** — the planet we have only ever visited by sending machines ahead of us; dust storms hide
  the body. Its reward steers a probe.
- **The Belt** — not a planet. Tumbling rock ricocheting off the arena walls, and STAR is the super
  that ricochets off every wall.
- **Jupiter** — the Great Red Spot as an eye: a storm that has been spraying for centuries, which is
  exactly what RADIANT ORB plants.
- **Saturn** — the rings *are* the fight; they deflect what you shoot into them. MIRROR is already
  the slowest super in the game to charge, which suits a chapter-7 prize. (Nothing before it has
  rings — Saturn is where they finally arrive.)
- **Uranus** — tipped 98° on its side, so the arena itself is rotated. The weakest thematic reward
  link of the eleven; its hook is the fight, not the prize.
- **Neptune** — the fastest winds in the solar system. The chapter shoves your ship constantly, and
  the gun you win is that wind.
- **Pluto** — cold, distant, demoted. STASIS freezes every enemy and every bullet for three seconds.
- **The Sun** — the finale, and the last ship colour.

**Colour constraints.** The four free swatches are cyan `#7ef9ff`, green `#63ff91`, yellow `#ffdc5a`
and pink `#ff72c8`. Ship colour drives `--theme` for the whole UI, so a new swatch has to work as a
text accent and not only as a dot — check Bone White and Solar against white type. The pairs to keep
apart are Saturn against the free yellow, and Mars against Jupiter. The swatch row in `index.html`
holds six today and has to become a wrapping grid before it holds fifteen.

### Building one chapter

What a chapter costs, and what to copy for each part:

| Part | Copy from |
| --- | --- |
| Boss body, airless grey rock with a phase terminator and impact scars | `drawMoon` |
| Boss body, molten seams opening with damage | `drawVenus` + `VENUS_CRACKS` |
| Boss body, banded gas giant | `drawVenus` |
| A pattern set | `VENUS_ATTACKS` / `pickVenusAttack` / `startVenusAttack` / `queueVenusShot` |
| Chapter backdrop | `drawVenusEnvironment`, `VENUS_DECKS`, `buildVenusAtmosphere` |
| Ordnance shared by a chapter's mooks *and* its boss | `fireVenusShot` / `drawVenusSeed` / `burstVenusSeed` |
| Enemies | add to `ENEMY_TYPES`, extend `waveRoster` and `WAVE_INTROS` |
| Music | add a `TRACKS` entry — `music.play(name)` is already generic |

Already shared, needing no per-boss work: `drawBossShards`, and the whole phase / `damageBoss` /
`startBossDeath` / `updateBossDeath` / `finishBossDeath` chain.

### The traps

The code was written for exactly two bosses and says so in a dozen places. A session that does not
know this will quietly add a *third* copy of a two-copy pattern:

- **There is no chapter or boss registry.** "Which planet is this" is `bossKind === "venus" ? A : B`,
  repeated at roughly thirty call sites.
- **Wave boundaries are magic numbers** — `wave === 5` and `wave === 9` in the wave-clear check, and
  `wave = 6` / `wave = 11` in `finishBossDeath`.
- **Every reward concern exists twice** — `MOON_UNLOCK_KEY` / `VENUS_UNLOCK_KEY`, two loaders,
  `unlockMoonRewards` / `unlockVenusRewards`, `syncMoonRewardUI` / `syncVenusRewardUI`, two
  `.reward-moon` / `.reward-venus` blocks in `index.html`, four `#reward-equip-*` handlers, and
  `data-moon-locked` / `data-venus-locked` on swatches, weapon tiles and victory choices. Chapter 3
  is where this has to become a table rather than a third copy.
- **`openLockPanel` is still binary** — a `venus ? A : B` on the copy, with three call sites that
  each test two `data-*-locked` attributes.
- **No super has ever been locked.** `setSelectedWeapon` hardcodes its `tech0` / `magma` flag checks;
  `setSelectedSuper` has *no* lock check at all, and its click handlers equip unconditionally. The
  Moon chapter still pays out Tech.0 rather than DECOY for exactly this reason.
- ~~The two bosses are not the same shape.~~ **Done.** Both now have a per-frame driver —
  `updateMoonBoss` and `updateVenusBoss` — and no boss-specific combat is left inlined in
  `drawBossArea`. Copy either shape for a third.
- **Venus bolts on about fifteen flat globals** (`venusSpin`, `venusAttack`, `venusQueue`,
  `venusDive`, …). A third prefix bank is not viable; move per-boss state into one object the first
  time a third boss needs state of its own.
- **Post-boss flow is inconsistent** — the Moon goes reward screen → victory/loadout screen → play,
  Venus goes reward screen → play. Pick one and use it for all eleven; the loadout screen after every
  boss is the better fit now that every boss grants gear.
- ~~Live bug: `updateBossDeath` spawns debris at Mercury's radius.~~ **Fixed** — it calls
  `bossRadius()`, so Venus's 96px body finally scatters at its own scale.

**The standing rule: build chapters one at a time, but never add a third copy of a two-copy pattern.**
When a chapter walks you into one of the traps above, generalise *that one thing* into a table right
then — the piece in your way, not the whole engine.

### Not built yet, and the roadmap needs both

- **Launch screen.** A chapter select gated on bosses beaten, so a player can resume at any chapter
  they have cleared instead of replaying forty waves. Reuses the `.controls-panel` shell, the arrow-key
  spatial focus navigation the menu already has, and the existing `.locked` / padlock CSS. Its rows
  must come from the chapter data — hand-written rows would recreate the duplication above.
- **Progress record.** One `localStorage` record of cleared chapters, replacing the two per-planet
  keys, reading the old keys once so existing unlocks carry over. `loadMoonRewards` already does
  exactly this for the Mercury→Moon rename, via `LEGACY_MERCURY_UNLOCK_KEY` — copy that pattern.
  `resetAllProgress` clears it.

## Files

| File | Role |
| --- | --- |
| `index.html` | All DOM: menu, weapons/controls/change-log modals, loading screen, HUD, boss intro, victory/defeat screens. Loads the CSS and `main.js` with versioned query strings (bump changed assets to bust cache). |
| `main.js` | The entire game: state, render loop, physics, collisions, input, music/SFX synthesis, UI wiring. |
| `style.css` | Retro arcade-cabinet theme: CRT scanline overlay, pixel type, hard-edged chunky controls. Uses Bangers (title) and Press Start 2P (everything else) from Google Fonts. |
| `favicon.svg` | Inline red "P" mark. |
| `server.ps1` | PowerShell static file server on `http://localhost:8000`. `$root` is hardcoded to a Windows path and must be edited per machine. |

## Running it

Any static server works; the game only needs the four files served from one directory.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

On Windows: `powershell -File server.ps1` (edit `$root` first).

## Architecture

Everything is module-level mutable state in `main.js` (globals declared at the top:
`gameActive`, `bossMode`, `player`, `bullets`, `enemies`, `enemyBullets`,
`bossBullets`, `superBombs`, `score`, `lives`, `wave`, …). There are no classes and no
module system — functions read and write those globals directly.

**One rAF loop.** `draw(t)` runs forever from page load and dispatches by state:

```
draw(t)
├─ !gameActive            → drawStaticStars()      (menu backdrop)
├─ gameOverShown          → drawDeathBackdrop(t)   (the sky of the level that killed you)
└─ gameActive && !paused  → drawGame()
                             ├─ wave < 6  → drawStaticStars()  (same field as the menu)
                             ├─ bossIntro → return (freeze)
                             ├─ bossMode  → drawBossArea()  (Moon: stars, Venus: grid)
                             └─ normal wave rendering + collisions
```

Each of these "draw" functions is really update + render fused: it advances positions,
resolves collisions, mutates score/lives, and paints, all in one pass. Timers are frame
counts (`fireCooldown`, `playerInvulnerable = 90`, `enemyShotTimer`) rather than delta time.

**Render scale.** The canvas backing store is *not* the viewport size. `applyRenderScale()`
sizes it to the current quality tier's `maxPixels` budget, stretches it back over the screen
with CSS, and bakes the ratio into the base transform — so every coordinate in the file stays
in CSS pixels and no drawing code knows the difference. On a 4K display this is a 4x cut in
pixels touched per frame, which is the single largest win available: what costs frame time in
this game is fill rate, not op count. `image-rendering: pixelated` makes the upscale both the
cheapest filter available and a deliberate look.

Two consequences to respect: offscreen layers meant to be blitted 1:1 (the boss grid) are baked
in *device* pixels and drawn under `ctx.setTransform(1,0,0,1,0,0)`; and nothing may assume
`canvas.width === window.innerWidth`.

**Adaptive quality.** `QUALITY_TIERS` (high/medium/low/potato) controls the pixel budget, glow
sprites, the CRT overlay, particle counts and backdrop density. `sampleFrameCost()` keeps an
exponential moving average of how long the game's own frame actually takes and steps the tier
down when it exceeds `FRAME_BUDGET_MS`. It only climbs back if it has *never* had to drop —
a machine sitting on the threshold would otherwise oscillate, and visible quality flicker is
worse than staying on the cheaper tier. The tier is stamped on `<html data-quality>` so the CSS
can drop its own expensive bits (the CRT overlay is full-screen and does *not* shrink with the
render scale, so it is switched off below `medium`). `?quality=low` pins a tier and disables
the tuning.

**Fixed 60Hz timestep.** rAF calls `frame(now)`, not `draw(t)`. `frame` accumulates elapsed
time and runs `draw` only on whole `STEP_MS` (1/60s) boundaries, so the frame-count timers
above mean the same thing on every display. On a faster-than-60Hz screen the spare callbacks
return before clearing the canvas, which leaves the previous frame on screen; on a slower one
it catches up by at most `MAX_CATCHUP_STEPS` (2), so a stall can never spiral. Anything new
that is measured in frames just works — don't reintroduce a bare `requestAnimationFrame(draw)`.

**Backdrop.** `drawStaticStars(t)` fills the whole viewport with pixel-square stars on three parallax layers, drifting downward and wrapping. **It is the whole Moon chapter's sky, not just the menu's**: the title card, waves 1-5, the boss intro and the Moon's own arena all draw the same field, so nothing in the first half of the game ever cuts from stars to a black void. Only Venus changes the sky (`drawVenusEnvironment`), and only Venus's arena keeps the grid — its fight happens inside the furnace, not in open space. Death does not move you either: `endGame()` records a `deathScene` before it clears the boss flags, and `drawDeathBackdrop()` replays that same sky behind GAME OVER — stars for the Moon chapter, the live Venus sky for waves 6-9, the Venus arena for its boss (where the opaque defeat card covers it anyway). Density scales with viewport area and with `quality.stars`, capped at `MAX_BACKDROP_STARS` (1000) — a 4K screen otherwise asked for ~3500, each its own `fillStyle` write plus `fillRect`. The field is sorted by tint at init so the draw loop sets `fillStyle` six times per frame instead of once per star, and is respread by `resize()` so it always covers the screen edge to edge.

**Loadout icons in the HUD.** The equipped gun and super sit beside the super meter in
`.hud-loadout`, which is bottom-anchored and given `.super-track`'s own height so the icons
share the **bar's** centre line. Anchoring to the meter's whole box instead puts them about ten
pixels high, because that box also contains the SUPER label above the bar. Each preview draws
different-sized art inside the shared 58×48 box, so every icon gets a `--icon-scale` that lands
it on the same visual height. Hovering or focusing one shows `#hud-loadout-card`, built from
`BOOK_ENTRIES` and `BOOK_STATS` so the card and the FLIGHT ARMORY can never disagree; it is
deliberately quiet and `pointer-events: none`, and it renders on demand rather than per frame.

**Moon and Venus rewards.** `syncMoonRewardUI()` / `syncVenusRewardUI()` unlock the grey
and magma ships and Tech.0 / Magma everywhere they appear. Each reward screen offers its gear
rather than forcing it: grey `.reward-equip` buttons call `setSelectedWeapon(...)` and
`setPlayerColor(GREY_SHIP_COLOR)` / `setPlayerColor(MAGMA_SHIP_COLOR)` and flip to a filled
EQUIPPED state, kept in sync by `syncRewardEquipButtons()`. `setPlayerColor()` is the single
path that applies a ship colour, so the menu swatches and the reward cards can't drift. The
Magma ship reuses the MAGMA weapon's exact hex so beating Venus and equipping both reads as one
matching molten loadout.

**The boss intro is a versus card, drawn with the real assets.** `drawVersusStage()` paints it
on the game canvas: `drawPlayer()` for the ship (turned to face right, engine drawn explicitly
by `drawVersusThruster()` since it is idling rather than flying) and `drawBossPortrait()` for the
planet, scaled up on their marks at 27% and 71% across. A CSS mock-up of either one is a
different ship and a different planet, and it shows — so there is no CSS art on this screen at
all; the DOM card supplies only the names, the HP, the big red VS and the button, anchored to
the same percentages the canvas draws to.

**`versusCardUp`, not `bossIntro`, gates the stage.** `bossIntro` is also raised by the victory
and reward beats to freeze the world, so keying the versus art off it painted the ship, the
planet and the tear straight through those screens. The flag is set in `enterBossArea()` and
cleared by `startBossFight()`, `endGame()`, `startGame()` and `returnToMenu()`.

**The engine belongs to the ship, not to the card.** `drawShipThrust()` is called from inside
`drawPlayer()`'s own transform, so the flame trails the nose at any angle, in the fight and on
the versus card alike, and it lengthens with actual speed rather than burning at a constant
size.

`drawBossPortrait(x, y, scale, t)` is the shared piece: it moves `boss` to a portrait mark,
forces the opening state (full health, phase 1, no hit/charge/shoot/shake left over), draws with
the fight's own `drawMoon()`/`drawVenus()`, then puts every global back — safe to call from a
paused frame. The **defeat card uses it too**, so the planet that beat you is the planet you
fought rather than a CSS lookalike.

`drawVersusTear()` rips the screen between them: a jagged seam of two fixed sines (not random
per frame, or it flickers instead of opening) that tapers to a point at both ends — a seam
running off the top and bottom of the screen reads as a red column, not as something torn open.

**Losing to a boss costs the fight, not the run.** `endGame()` records `retryWave` / `retryBoss`
at the moment of death, and the defeat card's TRY AGAIN calls `startGame(retryWave, retryBoss)` —
which drops straight back into that boss's versus card rather than restarting at wave 1. The
defeat card itself starts at `43dvh`, directly under the canvas portrait, so the planet's line
reads as the planet's line instead of floating at the bottom of the screen.

**The Moon orb SVG is a template, not a constant.** Three copies live in the document at once —
the LEVELS boss tile, the ALPHA progress pip and the promo orb — and `url(#id)` is a
*document-wide* lookup, so sharing gradient and clipPath ids between them made one instance
paint with another's (hidden) definitions and go black. `moonOrbSvg(suffix)` stamps a unique id
set per copy; never inline `MOON_ORB_TEMPLATE` directly. Its terminator is
`MOON_PHASE_LIGHT[0]` — shadow on the right limb (sweep 1, the side `drawMoon` leaves dark),
inner arc bulging left past centre so the lit crescent is about a quarter of the disc, and dark
rather than black: at 34px an opaque shadow reads as a hole punched in the tile.

**The ALPHA panel's progress row is planets, not pips.** The finished one is the LEVELS picker's
own `MOON_ORB_SVG` portrait; the eleven still to come are empty rings with a question mark. If a
chapter ships, swap its ring for its own orb rather than filling a dot.

**Full-screen cards hide the HUD.** `#game-ui` gets `.versus` while the versus card or a boss
defeat card is up, which hides the wave counter, score, hearts, both meters, the boss bar and
the wave banner. They belong to the fight, not to the card announcing or ending it.

**The reward card is a screen in the game, not a modal over it.** `celebrationScene` keeps the
canvas painting behind the paused frame — the Moon's pay-off and the MOON DESTROYED card both
sit in the star field the chapter was flown in, Venus's sits in its arena — so both screens are
scrims rather than opaque slabs. The padlock is animated as a sprite: flat plates, a 3px black
outline, CRT scanlines and every beat cut with `steps(1, end)`, keyed to the same 2.4s timeline
the foley in `openRewardScreen()` is scheduled against (200 / 500 / 800ms strains, 1000ms snap =
8.4% / 20.8% / 33.3% / 41.6%). Move one and the other has to move with it. Reward panels are
translucent on purpose: an opaque panel is lighter than the card behind it, which turns the grid
gap between the two rewards into a black bar.

**The armory is reachable from every screen that offers a loadout.** `openWeaponsPanel(trigger)`
is the single entry point and records `weaponsReturnTarget`, so closing returns focus to the
button that opened it — the menu's WEAPONS, or the FLIGHT ARMORY button on the reward and
victory cards. The panel's z-index sits above both of those screens (21). Every loadout readout
is marked `data-loadout-readout` and repainted together by `refreshLoadoutUI()`.

**No scrollbars anywhere.** `.title-block`, `.weapon-book`, `.controls-card`, `.changelog-card`,
`.reward-screen-card` and `.victory-card` all still scroll on a short viewport, but the OS
scrollbar is hidden — it reads as a web page down the side of an arcade cabinet. That makes
fitting the content a real constraint rather than a nicety: the victory card compresses through
`max-height` media queries, because CONTINUE scrolling off the bottom edge with no visible
affordance is worse than the scrollbar was.
The Venus ship is **one** swatch, the red one, sitting after the Moon grey and locked by
`[data-venus-locked]`. It carries `MAGMA_SHIP_COLOR` rather than the old `#ff4f4f`: plain red and
the magma hex were a point apart, so shipping both put two identical-looking locked swatches in
the row. Menu order is cyan / green / yellow / pink / grey (the Moon) / red (Venus) — exactly two
locks.

**HUD is DOM, not canvas.** Score, lives, wave, super meter, charge meter, boss health, and
all overlays are HTML elements. The canvas draws only the play field.

Because the loop touches them every frame, they are **not** re-queried or blindly rewritten:
elements live in the `dom` cache, and writes go through `setText()` / `setWidth()`, which skip
the assignment when the value is unchanged. A redundant `textContent` or `style.width` write
still costs a style invalidation, and at 60fps that was the loop's single biggest expense.
If you write to a cached element directly you must go through the helpers too, or the cache
goes stale and silently swallows the next real write.

## Game flow

0. Title card — "DANIEL AND PETROS PRESENT..." waits indefinitely (a "CLICK OR PRESS ANY
   KEY" hint fades in) until the player clicks or presses a key; `finishCredits()` then
   reveals the menu. That same gesture unlocks audio, so the `intro` music track starts
   under the title card right as it's dismissed and crossfades into `menu` (see Music).
1. Menu → pick ship color, weapon, super → `START`.
2. START jumps: `beginWarpLaunch(startGame)` runs the hyperspace sequence (below), and
   `startGame()` resets all state on arrival. TRY AGAIN and the defeat card still use
   `showLoading(startGame)`, the fake progress bar.
3. Waves 1–4: `createEnemies()` builds the wave from `waveRoster(wave)`. Clearing every
   enemy advances the wave; `showWaveBanner()` announces both the clear and the next wave.
4. Wave 5 clear → `enterBossArea()` → boss intro card → `startBossFight()` (starts a
   `setInterval` bass loop as boss music).
5. Boss **THE MOON** has 110 HP (`MOON_MAX_HEALTH`). Enter/Space skip the intro card
   (`tryConfirmScreen`), same as clicking CONTINUE.
6. On defeat: `startBossDeath()` runs a ~175-frame sequence — chained surface blasts,
   then one big detonation at frame 126 that scatters debris — before `finishBossDeath()`
   grants `+1 HP`, holds `wave` at 5 and opens `showVictory()`.
7. **The Moon is where the shipped game ends**, over two cards. `#victory-screen` reports the
   fight and nothing else — the beaten Moon, the title, score/waves/bonus, one FLIGHT ARMORY
   button, CONTINUE. The weapon and super pick-lists that used to sit there are gone; the
   armory already does that job, and a wall of twenty buttons buried the moment.
8. CONTINUE hands over to `#thanks-screen`, the run's last beat: "THANKS FOR PLAYING SO FAR",
   where the game stops, and MAIN MENU (`returnToMenu()`). It is deliberately bare — no stats,
   no loadout, one button. Both cards run with `.run-complete` on `#game-ui`, which hides the
   hearts, wave, score, super meter and touch controls: they belong to a live run, and behind
   the end-of-run art they only leak the HUD into it. The arena underneath — the ship, the
   wrecked Moon, the debris — stays, because that is the picture worth keeping.

The victory Moon (`.victory-moon`) is drawn as the real thing: cool highlands, three maria
blotches and a scatter of craters, all stacked `radial-gradient`s on the one element so the
face (X eyes, mouth, the animated tongue) still sits on top untouched. Its `font-size` **is**
its diameter and every part of the face is positioned in `em` of it, so a breakpoint shrinking
the moon moves the whole face with it — with pixel offsets the eyes and tongue slid off the
sphere at the smaller sizes.

**Venus is pulled.** Everything below is still in the file and still works — the waves, the
sky, the boss, the Magma reward — but *nothing routes a player into it*: `LEVEL_PAGES` has one
chapter, and the Moon's victory screen ends the run instead of flying on to wave 6. Bringing it
back is adding its page to `LEVEL_PAGES` and pointing `victory-continue` at wave 6 again; do
not delete the chapter to "clean up". Its rewards (Magma, the Magma ship) stay visible but
locked, and their lock prompt says COMING SOON rather than asking the player to beat a boss
they cannot reach.

8b. *(when Venus returns)* Continuing enters Venus airspace for waves 6–9. Clearing wave 9 sets
   `wave = 10` and calls `enterBossArea("venus")`.
8. Boss **VENUS** has 250 HP (`VENUS_MAX_HEALTH`). It shares the whole boss shell with
   the Moon — intro card, health bar, debris, `damageBoss()`, the death sequence — and
   differs only in `drawVenus()` and `updateVenusBoss()`. Its health bar wears the
   furnace palette via `#boss-health.venus`, toggled by `enterBossArea()`. On defeat
   `finishBossDeath()` grants `+1 HP`, unlocks MAGMA through `showVenusRewards()`
   (a Venus-skinned `#reward-screen` sharing the lock cinematic), and on continue sets
   `wave = 11` and drops back into the Venus waves.

### Levels

`LEVELS` opens `#levels-panel`, a jump-to-any-stage picker: one page per chapter,
`LEVEL_PAGES` the only description of them — and, while Venus is pulled, one page total, so
`renderLevelChrome()` hides the whole `.level-nav` row rather than showing arrows and a single
dot for pages that are not there (`display: flex` beats the UA's `[hidden]`, hence the explicit
`.level-nav[hidden]` rule). Every entry carries the same `wave` the loop runs
on, and a page's boss tile is the fight you would have walked into by clearing that chapter's
last wave, so the picker cannot describe a run the game does not play.

**Two entry points, one panel.** `#levels-btn` on the menu and `#pause-levels-btn` on the pause
card both call `openLevelsPanel(this)`; `levelsReturnTarget` remembers which, so Escape and the x
hand focus back to the button that opened it and a pause-card visit leaves the run paused. The
one thing a jump from pause has to do that a jump from the menu does not is `setPaused(false)` in
`startLevel()` — the pause overlay sits above the canvas, and without it the warp launch plays
behind a PAUSED card. Placement mirrors the menu: LEVELS directly under the primary action.

**The page is the chapter's real sky.** `paintLevelPreviews()` paints each page's canvas from
the same tables the game draws with — `STAR_TINTS` and drifting pixel stars for the Moon,
`VENUS_SKY_STOPS` plus the `VENUS_DECKS` bands and sun gradient for the furnace — repainted
from the one rAF in `draw()` while the panel is open, so the sky in the picker moves like the
sky you are about to fly into. CSS gradients were tried first and looked like a menu
illustration of the place rather than the place. (`ctx`, `W` and `H` are `const`/module state,
so the game's own `drawStaticStars` / `drawVenusEnvironment` cannot be pointed at another
canvas without refactoring the hot path — hence miniatures built from the shared data.)

`paintLevelSpace` / `levelPreviewStars` are a line-for-line miniature of `drawStaticStars` /
`makeBackdropStar`, down to `STAR_LAYERS`, `STAR_DENSITY`, the per-star twinkle rate and phase,
and the ejecta cross on the 3px stars — and they clear to the same `#000000` that `draw()` does.
Not a detail worth relaxing: the first version was one flat field of 1px dots on `#04040a`, and
a faintly blue ground with no parallax reads as a lit sky next to the vacuum it previews.

**Tiles are the menu's buttons.** Same `#101019` plate, 3px `#2f2f45` border, pixel type and
lift-and-tint hover as START / WEAPONS / CONTROLS — a grid of glassy translucent cards read as
a different app. A stage tile is its number and nothing else; the boss tile is the same size
and wears the planet (`.boss-orb`) where the number would go.
No blurbs, and nothing on the sky itself: the planet belongs on its own box.

**A boss orb is the character, not the planet.** The Moon's is `MOON_ORB_SVG`, inline SVG dropped
into the `<i>` by `buildLevelPage`. Everything in it is `drawMoon`'s own geometry scaled by
`50/78` — the viewBox half-width over `MOON_RADIUS` — and re-centred on 50,50: the body ramp
`#fbf8f1`→`#3b3936`, `MOON_MARIA`, craters, the terminator, the angry brows at ±27/-20, the eyes
at ±27/-14 with their `#bfe4ff` glow, the scowl, and the rim light along the lit limb. If the
fight's proportions move, rescale from there; do not eyeball it.

Two traps, both of which cost a pass:

- **It has a face.** The first version got the body ramp and the maria right, left the face off,
  and looked like a different boss entirely. The brows, the two lit eyes and the scowl are the
  character; the grey sphere underneath them is not.
- **Measure the mouth, don't look at it.** `drawMoon` puts the arc's midpoint at viewBox y 60.3,
  *above* its corners at 72.6 — a scowl. Flipped it becomes a broad smile, and at 34px the two
  are genuinely easy to confuse by eye. `path.getPointAtLength(len/2).y` settles it in one line.

The terminator is drawn at ~78% lit rather than one of `MOON_PHASE_LIGHT`'s three: a crescent is
the phase the fight opens on, but at this size it eats the face. Legibility wins in a picker.

The chapter is titled `MOON` in `LEVEL_PAGES`, not "THE MOON"; the prose elsewhere
(`BEAT THE MOON`, `THE MOON WINS`) keeps its article.

**Stages lock until you have earned them.** `clearedWave` — the furthest wave ever *finished*,
persisted under `petros-space-adventure-progress` and reset by the RESET button along with the
reward unlocks — is the only gate. `levelRequires(level)` says what a tile costs: the wave
before it for a normal stage, and for a boss the last wave of its chapter (the Moon opens once
wave 5 is cleared, Venus once wave 9 is), since a boss stands on that wave rather than after
it. `recordWaveCleared()` is the single writer and is monotonic — dying on wave 8 never costs
you the stages you already opened — called from the wave-clear path (before it branches into
either boss entry) and from `finishBossDeath()`, which clears wave 5 or 10 depending on the
planet. A locked tile keeps its number or its planet, faded under the same `--padlock` the ship
swatches and armory spines wear, and is genuinely `disabled` rather than merely styled, so
`MENU_FOCUS_SELECTOR` walks the arrow keys straight past it.

**The flip.** `flipLevelPage()` builds the incoming page, puts it offscreen with a slight turn,
commits that with a forced reflow, then releases both pages in the same frame — the outgoing
one leaves as the incoming one arrives, on one shared cubic-bezier. The first version swung a
single page out, swapped its contents while it was edge-on and swung it back in; that read as a
stutter with a jump in the middle, because the incoming page has to already be travelling when
the outgoing one leaves.

`startGame(startWave, startBoss)` does the launching. Both arguments default to a wave-1 run,
so START is untouched. A stage start sets `wave`, picks the sky (`deathScene`, and with it the
backdrop, follows the stage rather than always opening in the Moon's star field), and either
builds the roster with `createEnemies()` or — for a boss tile — **empties** `enemies` and calls
`enterBossArea(kind)` at the end of the reset. The empty roster is not optional: without it a
boss stage inherits the previous run's enemies, which would be sitting in the arena the moment
the fight ends. Tiles launch through `beginWarpLaunch()`, the same warp the START button flies.

Two things the panel has to join to work like the rest of the UI: `activeMenuRoot()` (or the
arrow keys walk the menu *behind* the open panel) and the Escape chain in
`handleMenuKeydown()`. Opening it focuses the first stage tile rather than
`focusMenuDefault()`'s pick, which would be the close x.

**Both fights run three phases.** `updateBossPhase()` steps `bossPhase` at 2/3 and 1/3 health,
shared by both planets: it flashes, shakes, throws debris and banners the phase. `phaseRate()`
returns the `PHASE_RATE` multiplier that every attack timer in either fight is scaled by, so
"harder" is one number rather than a dozen scattered constants. A single-phase boss is a damage
race — once you have read its three patterns there is nothing left to learn, which is what made
both fights fall over.

**The Moon's ejecta.** From phase 2 the Moon throws chips of itself: `bossMinions`, spawned by
`spawnBossMinion()` and run by `updateBossMinions()`. Two health each, they home with a turn
rate that tightens in phase 3, hurt on contact, and are worth score and super meter — so
clearing the brood is a real choice against hitting the planet. `MINION_CAP` bounds them at 7.

**Which planet is in the arena** is `bossKind` (`"moon"` | `"venus"`). Anything shared
between the two fights reads `bossRadius()`, `bossMaxHealth()` and `bossLabel()` rather than
the Moon constants — that includes the bomb blast, the beam tick, the health bar and the
player-bullet hit test. `enterBossArea(kind)` is the only place that sets it, and both
`startGame()` and `returnToMenu()` put it back to `"moon"`.

### Venus

`drawVenus(t)` is all atmosphere and no surface. A cached radial body gradient carries the
sulfur palette; `VENUS_BANDS` lays six cloud decks over it, each an ellipse clipped to the disc,
sliding at its own rate and *breathing* in thickness and alpha so the atmosphere churns instead
of sitting there as six static stripes. `venusCells` drifts five storm cells across the face,
wrapping at the limb, and a hot limb arc gives the sphere an edge instead of letting it fade
out. A double-spiral polar vortex sits over the top pole and winds tighter as an attack builds. Both the decks and the vortex turn **backwards** (`venusSpin` and
`venusVortexSpin` decrement) because Venus is retrograde, and it is the one thing about the
planet everybody knows. Damage reuses `VENUS_CRACKS` as molten fissures showing through the
deck, and the face is two coals burning through the cloud plus a furnace vent for a mouth.

`updateVenusBoss(t)` picks from `VENUS_ATTACKS` at random with no immediate repeat, rather than
running a fixed cycle — a fixed order is a script, and once you have the script the fight is
over. From phase 2 `venusChain` also runs a second pattern straight onto the end of the first
with no rest, so the combinations keep coming after all six are familiar. Every pattern has a
harder variant at phase 2 and again at phase 3.

| Attack | Shape |
| --- | --- |
| `rain` | Sheets of acid darts fall from the deck, each with a two-lane gap that walks. The gap can double back, so it cannot be pre-walked. |
| `spiral` | Arms of heat orbs winding backwards, matching the planet's own rotation. In phase 3 it reverses direction partway through. |
| `storm` | Warned lightning columns: a thin line, then a wide bolt. The warning shortens each phase, and the last two columns *lead* the ship rather than marking where it already is. |
| `pressure` | A greenhouse ring with one gap opposite the player; later rings move the gap, so standing in the first one is not enough. |
| `sweep` | A narrow fan swung across the arena like a searchlight. There is no gap to find — the answer is to be behind the sweep, which means committing early. |
| `dive` | The planet itself comes down the ship's column and slams, throwing two fronts of orbs along the floor. The only attack that threatens the bottom of the arena, which is where everything else lets you hide. |

The dive runs as its own state machine (`venusDive`, `updateVenusDive()`) because it is
performed with the body rather than with projectiles. Everything else queues through
`queueVenusShot(delay, fn)` into `venusQueue`, drained by `updateVenusQueue()` — spreading a
volley over frames is what keeps the arena dangerous without putting a wall of bullets on screen
at once. `venusBolts` is the separate lightning list, drawn and collision-checked by
`updateVenusBolts()`. Venus orbs live in `bossBullets` and carry their own `r`/`color`/`core`,
so that loop is no longer Moon-specific, and `VENUS_ORB_CAP` (150) bounds them: a phase-3
chain could otherwise stack past two hundred, which stops being difficulty and becomes a wall.

**`VENUS_TELL` is what makes the density fair.** Each pattern lights the corona, the vortex, the
limb and both eyes in its own colour while it winds up (`venusTelegraph` / `venusTelegraphAt`),
and the whole atmosphere visibly spins up with it. It is also most of what makes the planet look
alive between attacks.

### Venus's attack selection

`VENUS_ATTACKS` holds seven patterns; `pickVenusAttack()` no longer rolls flat. It scores each
candidate against the ship first — hugging an edge pulls `sweep` and `pressure`, standing still
pulls `storm` and `hunter`, sitting low pulls `dive`, crowding the planet pulls `pressure` and
`spiral` — then takes a weighted reservoir pick, so the bias is real but nothing is ever
guaranteed. A flat roll was what let a player hold one wall for a whole phase and simply wait
out the patterns that don't reach there. For the same reason `bossDrift` now leans much harder
toward a ship pinned against an edge: the corner closes instead of sheltering you.

`hunter` is the seventh pattern: 4–6 seeker darts fired one at a time (so they arrive strung
out rather than as a wall) that steer for 140–180 frames before committing. It is the only
attack that follows you into a corner.

Phase 3 chains two or three patterns with no breather — `venusChain` is 2 plus up to one
more — and `venusRestFrames()` drops its floor from 16 to 8. From phase 2 the `dive`
may follow inside a chain, and in phase 3 even the `storm` gets no breather. The hit
flash decays in `drawVenus()` itself, next to its shake decay: it used to decay only in
`drawMoon()`, which left Venus whited out for the whole fight after one hit.

### The Moon

Chapter 1's boss, and the only body in the game that has actually watched the war. It is
**airless, tidally locked and cratered**, and it fights with the only three things it owns:
falling rock, its own gravity, and its shadow.

**The phase is the fight.** `MOON_PHASE_LIGHT` gives each boss phase a lit fraction (0.24 /
0.56 / 1) and `moonLit` eases toward it, so the terminator visibly retreats as the health bar
drains: it opens as a CRESCENT, wakes to a HALF MOON, and finishes FULL and blazing. The health
bar is chopped into the same three parts (`.boss-track::after`) and recoloured per phase from
`data-phase`, so the HUD and the sky can never disagree about which phase you are in.
`drawMoonShadow()` draws the terminator as a real lunar phase — the far limb closed off by a
half ellipse whose width is how far past half-lit we are — and it is painted **twice**: once
under the face at full strength, once over it at low alpha. That is what lets the face sit in
its own shadow with only its glowing eyes cutting through.

Being **tidally locked** is drawn, not just described: unlike a spinning planet the crater field
never rotates, and the only motion is `moonLibration`, the slow nod that is the reason we have
ever seen a sliver past the edge. Damage is not lava — the Moon has none. Fresh impacts punch
`MOON_SCARS`, bright ray craters that throw ejecta clear across the face, and `MOON_MARIA` (the
dark seas) sit out toward the limb so they frame the face instead of swallowing it.

### The Moon's attacks

All of its combat lives in `updateMoonBoss(t)`, which has the same shape as `updateVenusBoss(t)`
on purpose — none of it is inlined into `drawBossArea` any more.

| Attack | Phase | What it does |
| --- | --- | --- |
| **Crater fall** | 1+ | The signature. `callCraterVolley()` *calls* strikes a second or more ahead: a closing ring with crosshairs on the floor and a rock visibly falling into it. Every hit is the player's to avoid, which is what a first boss should teach. **One round always leads the ship** (`player.vx * delay * 0.6`), so standing still puts it on your head and running straight puts it in your path; the rest fan out on an evenly-divided ring 195–360px out. `callCraterStrike` refuses to place a marker within `radius * 1.55` of a pending one and the fan re-tries further round rather than dropping the round — the first cut let markers stack, which read as one blob you could side-step. From phase 2 a landing also sprays its rim with rock, so hugging the edge of a marker is not a free out. |
| **Regolith ring** | 1+ | A full ring of dust with one gap, and the gap opens toward the ship. Always survivable, never ignorable; the gap narrows in phase 3. |
| **Boulder spread** | 1+ | Three-, five- or two-shot fans of heavy rock, led onto the ship by `trackedBossAngle()`. |
| **Aimed rock** | 1+ | The bread and butter: single homing, paired tracking, or a three-way predictive volley. |
| **Ejecta** | 2+ | `bossMinions` — chips thrown up *by its own craters*, so the chasers have a visible cause. |
| **Tidal pull → slam** | 2+ | Drags the ship in for ~2.6 seconds, then **lets go**: `fireMoonSlam()` hits everything still inside `MOON_SLAM_R` (262px) and throws a ring of rock outward. The dashed danger ring is drawn for the whole pull and goes gold and strobing in the last 55 frames, so being caught is always something you could see coming. The pull strength is tuned against the ship's *measured* equilibrium, not by feel — see the comment in `updateMoonBoss`; doing nothing drifts you ~1.8px/frame **in** and thrusting away carries you ~2.2px/frame **out**, so there is no third option. The first cut used 0.22 and players correctly reported that it did nothing: at that value the ship simply never got close enough for it to matter. |
| **Eclipse** | 3 | The arena goes dark for ~4 seconds and the Moon becomes a black disc in a white corona. `drawEclipseVeil()` is painted over the body and its debris but **under** everything that can hurt you — losing sight of the wind-up is the attack; losing sight of what is already in the air would just be unfair. In the dark it stops aiming and sweeps **two slow spiral arms** instead, so the eclipse is a pattern to solve rather than a coin toss. The spawn interval is spaced so the arms clear the screen about as fast as they are laid down, and it stops at 90 live rounds. |

### Tuning the Moon — what made it unplayable, and the benchmark

Phases 2 and 3 were overtuned on first release. The cause was not any one attack; it was
**double-scaling**. `moonImpactTimer` and `moonPullTimer` were set from a per-phase base *and*
multiplied by `phaseRate()`, so phase 3 threw a five-marker volley every 1.8s and spent roughly
half the fight inside a tidal pull. **Those two cadences are deliberately not scaled by
`phaseRate()`** — their base numbers already are the per-phase tuning. Do not "fix" that by
reintroducing the multiplier.

The rest of the pass, all for the same reason (too many things stacking at once):

- `PHASE_RATE` softened from `[1, 0.76, 0.56]` to `[1, 0.82, 0.66]`.
- Crater fuses lengthened (100 / 90 / 78 frames) — 66 was barely a second to cross 200px.
- Rim spray on landing is **phase 3 only**. At four or five craters a volley, spraying every one
  of them from phase 2 put twenty extra rounds in the air per volley.
- A landing spawns a chaser only 40% of the time, and `MINION_CAP` is 5, not 7. Seven homing
  chips is a screen you have to clear before you can look at anything else.
- The regolith ring's gap reopened slightly in phase 3 (0.62 rad).
- Phase 3 pull strength eased to 0.86 so escaping keeps a margin.

**The benchmark.** Drive the fight with an idle, invincible ship and count what is actually in
the air — hazards on screen and crater volleys per 12 seconds. A passive player is the worst
case, since a real one clears chasers:

| Phase | Volleys / 12s | Peak hazards on screen |
| --- | --- | --- |
| 1 | 2 | ~21 |
| 2 | 2 | ~34 |
| 3 | 2 | ~63 (mostly the eclipse spiral, which is one readable radial pattern) |

Before the pass phase 3 ran ~6 volleys per 12 seconds. If a change pushes phase 3 much past 65
peak hazards or 3 volleys per 12s, it has gone too far again — re-measure rather than guess.

### The Moon's animation states

`drawMoon(t)` is driven by four frame counters, all reset by `resetBossAnimation()`:

| Counter | Effect |
| --- | --- |
| `bossChargeAnim` | Wind-up: inhale (squash), the halo goes cold and hard, eyes swell, mouth puckers. |
| `bossShootAnim` | Recoil: stretch outward, mouth gapes, pale dust muzzle burst. |
| `bossHitFlash` | Damage: white flash, shake, eyes squint, rock chips fly back along the shot. |
| `bossDeathTimer` | Death: shake, chained explosions, then fade at the final blast. |

`damageBoss(amount, fromX, fromY)` is the single entry point for hurting the boss — it
applies damage, triggers the flash/shake and spawns debris. `bossParticles` (pixel squares)
and `bossExplosions` (expanding rings) are the shared effect pools; the explosion pool checks
`bossKind` so the Moon's blasts are dust rather than Venus's fire.

### The hyperspace launch

`beginWarpLaunch(callback)` owns the screen from the moment START is clicked — `draw()`
checks `warpLaunch` before anything else and returns. Four beats on the usual fixed 60Hz
clock (`WARP_CHARGE` / `WARP_PUNCH` / `WARP_TUNNEL` / `WARP_ARRIVE`, ~1.8s total; the wind-up is timed to the card's 0.45s CSS exit):

| Beat | What happens |
| --- | --- |
| wind-up | `warpSpeedAt()` goes **negative**: the drive pulls space inward, streaks fall into a swelling core in `playerColor` while the cabinet shakes and eight stacked `playSound` blips climb the scale. |
| punch | White flash, three shockwave rings, the music stops, the menu is hidden, and every streak reverses. |
| tunnel | Full hyperspace: streaks stretched to lines, a theme-coloured haze bleeding in, speed breathing near the top. |
| arrival | Deceleration into `warpFlash = 1`, then `callback()`. |

Two things to respect. It **reuses the `stars` pool** rather than building a second one —
`primeWarpStars()` rewrites `w*` fields on the existing objects, so the transition allocates
nothing — and the streaks are drawn grouped by colour, four `strokeStyle` writes per frame
rather than 260. And `warpFlash` is painted by `drawWarpFlash()` at the *end* of `draw()`,
after everything else, so the arrival flash washes over the first frames of wave 1 rather
than being covered by them.

**Why the light is a gradient and not `drawGlow()`.** Both the core and the tunnel haze are
one radial gradient (`buildWarpHaze()`, rebuilt only on a viewport change), painted by
`paintWarpHaze(alpha, scale)` — the core is the same gradient scaled down around the centre.
The first version reached for `drawGlow()`, which bakes an offscreen canvas per colour+radius:
the tunnel's radius asked for a ~2200px sprite on the exact frame the warp is supposed to
peak, and the core's changing radius baked a fresh one every few frames. A gradient fill has
no bake step at all.

**Why the menu's exit animates opacity and transform only.** The card leaving is CSS
(`.menu-wrap.launching`), and it originally brightened and blurred the whole wrap. A filter
forces the browser to re-rasterise that entire subtree — a clamped-`18vw` Bangers title with
text-shadows, a translucent card carrying three box-shadows — on every frame, against a canvas
that is mid-wind-up. Opacity and transform are composited, so the exit costs the main thread
nothing; the layer is promoted on `:hover`/`:focus-within` so it exists before START is
pressed. Measured over a full launch: 16.6ms average frame, 16.8ms worst, no frame over 28ms.

## Enemies

Five types, defined in `ENEMY_TYPES` and driven by `updateEnemy()` / `drawEnemy()`:

| Type | HP | Behaviour |
| --- | --- | --- |
| `grunt` | 1 | Holds formation, bobs. Fires the shared slow **homing** shot on `enemyShotTimer`. |
| `charger` | 2 | `idle → wind → hunt` state machine. Telegraphs with a red ring, then continuously steers into the player until destroyed. It is a pure contact threat and fires no projectiles. |
| `turret` | 3 | Never moves. Barrel tracks the player; fires a three-way **straight** spread. |
| `skimmer` | 2 | Venus Acid Skimmer. Sways across a formation lane, tracks the player, then spits a wobbling sulfur-acid globule. |
| `bloom` | 4 | Venus Furnace Bloom. Opens with a hot pulse and fires a wide radial fan of heat shards. |

`waveRoster(n)` decides the mix (wave 2 introduces chargers, wave 3 turrets, wave 4 both,
and waves 6–9 replace the Moon's forces with increasingly dense Venus formations);
`WAVE_INTROS` supplies the banner subtitle that calls out what's new.

### The Venus sky

`drawVenusEnvironment()` paints every post-Moon wave. It is a sky, not a set of stripes:
a cached vertical gradient (`VENUS_SKY_STOPS`), a sulfur sun burning through the haze
(`venusSunGradient`), four filled cloud decks (`VENUS_DECKS`) whose top edge is a running sum
of two sines and which scroll at their own speeds with a lit rim and two rolling swells each,
a rising ash-and-ember field (`venusMotes`), cloud-to-cloud lightning on `venusFlashTimer`,
and heat shimmer under the lot. Everything constant — gradients and the mote field — is built
once by `buildVenusAtmosphere()` and only rebuilt when the viewport or the quality tier
changes; the swells are the one costly part, so they are skipped below `medium`.

**The Venus formations are deliberately as they were.** An attempt to thin them out —
staggered lanes, one shared firing scheduler and redrawn enemies — was reverted wholesale at
the player's request, and the counts in `waveRoster` have not been touched since. Art and
*behaviour* are a separate matter and were both later reworked on request: the projectiles
were redrawn, and the chapter was made to escalate. Nothing about who spawns where changed.

### How the Venus chapter escalates

`venusPressure()` is the single dial: 0 on wave 6, 1 by wave 9, drifting up to 1.5 in the
post-game waves. Everything that gets harder reads off it rather than checking `wave` itself —
skimmer and bloom fire cadence, crescent speed, how far the skimmers lead the ship, the seed's
fuse and shard count, and whether the skimmers evade at all.

- **Skimmers dodge** from wave 7. `updateDodge()` projects each live player round forward,
  finds the one whose closest approach passes within `DODGE_CLEARANCE` of the enemy, and kicks
  it perpendicular to that round's line. The kick is an *offset* (`dodgeX` / `dodgeY`, capped
  at `DODGE_LIMIT` and decaying) laid on top of the formation position, so lane discipline
  survives — they just stop being free hits. It never writes `enemy.state`; the wind-up tell
  has to stay visible.
- **Skimmers lead.** They aim at where the ship will be, by `10 + pressure * 16` frames, and
  from the middle of the chapter they add a straight third blade so the two curving ones can
  no longer be split down the middle.
- **Blooms walk.** They close the horizontal gap on the ship (each holding its own station off
  the ship's column so two never stack), so the seed starts its run from above you.

### The bloom seed

`venus-seed` was the weakest thing in the chapter: it drifted out of the bloom at 2.1, stalled,
and two seconds later popped a *fixed diagonal cross* wherever it happened to be — which was
never near the player. It now hunts. It steers at the ship at `bullet.turn` for its whole fuse,
arms with a flash and a chirp the moment it comes within `SEED_TRIGGER`, and `burstVenusSeed()`
throws its shards along the player's bearing so one is always aimed straight down it. Fuse,
turn rate, speed and shard count (4, or 6 at full pressure) are all set by the firing bloom.

### Venus ordnance

Every hostile shape is drawn at the origin with its nose along `-Y`, already translated and
rotated by the caller, and shared between the Venus waves and the Venus boss so the two
chapters can never disagree: `drawSulfurRazor()` (the skimmer's swept blade — it replaced a
stroked half-circle that read as a piece of macaroni), `drawAcidDart()`, `drawAcidGlobule()`,
`drawVenusSeed()` (a spiked mine with a visible fuse ring) and `drawHeatShard()`. The rule
for all of them: dark outline shape, coloured body inset inside it, white-hot core, and a
silhouette that points where it is going. `VENUS_TRAILS` gives each kind an ember colour so a
shot leaves a streak of burning air behind it.

**Why the mix matters:** the old game had only grunts firing bullets that homed forever but
only while `y < H`, so a player could park in a corner and never be touched. Chargers come to
you and turret spreads fill space, so no position is safe. `fireHomingShot()` now steers for a
fixed 150-frame budget and then commits, which makes the tracking honest rather than infinite.

Anything living far outside the arena (over 80px past an edge, or a lost non-finite
position) burns up in the storm with a warning in the console instead of stalling the
wave — every enemy update clamps well inside those bounds, so legitimate enemies can
never trip it, and a wave can never softlock on a stray again.

## Weapons and supers

Primary weapon (`selectedWeapon`):
- `blaster` — auto-fires on held arrow keys, `fireCooldown = 10`, 1 damage.
- `charge` — hold an arrow, release to fire. It has three discrete tiers: 1 damage below half,
  3 damage at half charge with a three-target cap, and 5 damage at full charge with infinite
  pierce. Each tier is a circular energy ball (5px / 9px / 14px radius) so charge strength is
  visible in flight. Charge state lives in `chargeStartedAt` / `chargeDirection`.
- `cone` — three 1-damage shots at ±0.16 rad, `fireCooldown = 18`. `fireCone()` reserves
  capacity for the entire volley before firing, so the projectile cap can never emit a partial burst.
- `tech0` — a cyan post-Moon reward with a 40-frame (~0.7-second) firing cycle. The projectile
  flies 1.4× faster than other rounds, deals 3 damage on direct impact, then walks a 1-damage
  chain through as many as five additional living enemies within 260px of each previous target,
  including the Moon's ejecta in boss fights — enough to drop smaller enemies outright.
  A ready ping and muzzle flash mark each recharged cycle. Multiple projectiles are no
  longer blocked by an active arc.
- `magma` — a red post-Venus reward: a heavy molten slug every 30 frames (~0.5s), flying at
  `MAGMA_SPEED` (0.7×) for 3 damage, drawn by `drawMagmaSlug()` as a thrown splat of lava.
  Both the slug and its droplets render through `drawMagmaSplat()`: lobed blobs traced by
  `magmaBlobPath()` from fixed lobe tables (no per-frame allocation), stacked dull rim →
  orange body → white-hot centre, with black crust chips floating on the melt and hot specks
  flung off the edge. `bias` mixes a layer's lobes back toward a circle so the outer heat
  reads as heat instead of a dark star. It deliberately does **not** use `drawGlow()` — a
  radial sprite around the round read as a lens flare, which is what the splat replaced. On any impact `burstMagma()` sprays `MAGMA_DROPS` (5) 1-damage
  `magmaDrop` rounds back and sideways from the hit; each carries `ignore` (the thing it
  splashed off) so the primary target is never double-billed, and `drawMagmaDrop()` decays
  it over `MAGMA_DROP_LIFE` frames. Droplets may overflow `MAX_PLAYER_BULLETS` up to
  `MAGMA_DROP_CAP`. No tracking: it loses to the blaster on a lone dodger and wins on a
  formation. The three impact sites (wave enemies, brood, boss hull) all call
  `burstMagma()` so every arena splashes the same way.

### Player ordnance

**A round in flight must be the shape on its weapon tile.** The tiles are CSS art in
`style.css` (`.blaster-preview`, `.cone-preview`, …) and they are what the player picks from,
so the canvas follows them, not the other way round: blaster and cone are rounded *bars*
(`capsulePath()`), charge is a plain glowing ball, Tech.0 is the icon's lightning glyph, magma
is the irregular molten rock with droplets. Anything invented on the canvas that the icon has
no answer for — a finned dart, a needle-star head, a dashed containment ring — was tried here
and taken back out. Detail belongs *inside* the silhouette, and motion belongs behind it.

Beyond that, player rounds follow the same rule as the Venus ordnance above, in
`drawPlayerBullet()`'s local frame where `-y` is the direction of travel: a rim under the body
(the weapon's own hue at ~25% luminance, in `BULLET_RIM` — black punches a hole in a round this
small), a coloured body inset, a white-hot centre, and an additive bloom stepped in for the
icon's `box-shadow`.

| Gun | `draw…` | Shape |
| --- | --- | --- |
| `blaster` | `drawBlasterBolt()` | The icon's bar, with three shrinking afterimages strung out behind it. Afterimages are what sell a fast round — the shape repeats down its own path instead of smearing into one soft streak — and they cost three fills, which matters on the gun that fires every 10 frames. |
| `cone` | `drawConeShard()` | The icon's three stubby bars: one short capsule per shot, brightness breathing on its own `seed` so a fan of three shimmers instead of looking stamped. |
| `charge` | `drawChargeOrb()` | The icon's ball: two soft additive heat steps, body, highlight up and to the left exactly like the icon's `radial-gradient`, and one orbiting energy arc per damage step so a full-hold shot is visibly busier than a tap. |
| `tech0` | `drawTech0Bolt()` | The icon's lightning glyph. `TECH0_GLYPH` is literally the seven points of its `clip-path`, centred and turned 180° so the long point leads, drawn rim → body → white-hot inner, dragging a crackle tail. |
| `magma` | `drawMagmaSlug()` | See above. |

The tail's zigzag is walked from `TECH_JITTER` indexed by the frame counter: `Math.random()`
per frame strobes, and a fresh array per frame would allocate 60 times a second per round.

**Twin barrels.** The blaster alternates wingtips (`blasterBarrel`, `BLASTER_BARREL_OFFSET`),
so a held trigger has a left-right rhythm instead of rounds falling out of the middle of the
hull. The offset is passed through to the muzzle flash so the flash sits on the barrel that
fired.

**Muzzle flashes.** `spawnMuzzleFlash()` (called from `fireInDirection()`) pins a four-point
star of light to the ship's nose for ~7 frames in the weapon's colour — rounds used to appear
out of nothing at the ship's centre. The pool is `muzzleFlashes`, declared beside `sparks` so
`resize()` can rescale it, drawn by `updateMuzzleFlashes()` right after `updateSparks()` in all
three arenas, and cleared by `startGame()`. A burst weapon firing several rounds in one press
widens the flash it already made instead of stacking copies on the same pixel. It is skipped on
`potato`. A plain wedge was tried first and read as a dull khaki trapezoid — flat colour at low
alpha over the backdrop never looks like a flash; short and bright does.

While charging, `drawChargeAura()` pulls segmented orange energy arcs toward the ship. At full
charge the arcs ignite into a tighter orbit while `drawPlayer()` applies a subtle hull shake;
the full-power round draws a two-layer flame tail and leaves hot ember particles.

Super (`selectedSuper`), fired by a **short** Space tap when `superMeter >= 1`:
- `bomb` — projectile with a 210px blast radius (24 damage to the boss). `bombBlasts` keeps its
  layered shockwaves, spokes, hot core and debris alive after the projectile is consumed.
- `invincibility` ("SHIELD") — 180 frames of `playerInvulnerable` + `invincibilitySuperTimer`.
- `lance` ("TECHNOLOGY") — a piercing beam locked to the direction fired but anchored to the ship, so it
  sweeps as you move. Lives `BEAM_FRAMES`, damages everything within `BEAM_HALF_WIDTH` of its
  centre line every `BEAM_TICK` frames. Replaced the old `void` super, which was never
  implemented — it spawned a bomb flagged `void: true` that nothing read.

Six more come straight off the design sheet, with the sheet's own meter costs:
- `star` (45) — `fireSuperStar()`. A big star thrown along `facing` that ricochets off all four
  walls for `STAR_FRAMES` (6s), dealing `STAR_DAMAGE` on contact with a `STAR_HIT_COOLDOWN`
  between hits so it cannot melt one target in a single pass.
- `mirror` (55) — the most expensive super in the game to charge: `activateMirror()`. For `MIRROR_FRAMES` (5s) a hex shield rides the hull and
  `tryMirrorReflect()` swaps any hostile round inside `MIRROR_RADIUS` for a player-owned one
  that homes at the nearest target. Anything it catches never reaches the hull, which is what
  makes it defensive as well as offensive.
- `drone` (40) — `launchDrone()`. A steerable warhead: while `superDrone` is alive the arrow
  keys turn it instead of firing (one guard in `drawGame`, one in `releaseChargeShot`), and
  `detonateDrone()` ends it with a `DRONE_BLAST` shockwave worth `DRONE_BOSS_DAMAGE`.
- `decoy` (30) — `deployDecoy()`. A 3 HP hologram of the ship. Every hostile aim in the game
  reads `aimTargetX()` / `aimTargetY()` rather than `player` directly, so the decoy takes the
  arena's attention — grunts, chargers, turrets, skimmers, blooms, minions, homing rounds and
  the boss's own lead-aim. `tryDecoyIntercept()` lets it eat projectiles; `popDecoy()`
  detonates it. The sheet gives it no duration, so it also burns down over `DECOY_FRAMES`
  (15s) — a decoy nothing shoots at would otherwise hold aggro forever.
- `firstaid` (55) — `useFirstAid()`. `+AID_HEAL` hearts, capped at `MAX_DRAWN_HEARTS`. It is
  refused (and costs nothing) at full health.
- `orb` (25) — `summonRadiantOrb()`. A small sun that stays where it was cast for `ORB_FRAMES`
  (4s), firing `ORB_SPOKES` rounds every `ORB_FIRE_EVERY` frames and vaporising anything that
  touches it.

**All six are arena-agnostic.** A wave and a boss fight are separate update loops, so instead
of writing each super twice everything hostile is described
through one adapter: `collectSuperTargets()` fills the pooled `SUPER_TARGETS` array with
`{x, y, r, ref, kind}` and `hurtSuperTarget()` / `vaporizeSuperTarget()` route damage back to
whichever system owns the target. `updateSuperEntities(t)` is called once per arena, next to
`updateSuperBeam(t)`, and `clearSuperEntities()` is the single teardown.

**Everything past TECHNOLOGY is locked.** `bomb`, `invincibility` and `lance` are free; the other
six are boss rewards and start locked for everyone. `LOCKED_SUPERS` is the registry, and its value
is *the chapter that grants the super* — every one is `null` today because which boss hands over
which is still undecided. Fill a name in when a chapter claims one; nothing else has to change.
Unlocks live in a `Set` persisted to `petros-space-adventure-supers`, and since no fight grants one
yet the only way in is the BUILDER console's `unlock all`.

`superLocked(name)` is the check, `setSelectedSuper()` refuses a locked super (it had **no** lock
check at all before this), the tile click opens the lock panel instead of equipping, and
`syncSuperLockUI()` also un-equips a locked super that is somehow already selected — a save from
before the lock existed would otherwise keep firing it.

The lock panel now looks its message up in `LOCK_MESSAGES` by `lockReason(trigger)` rather than
picking it with `venus ? A : B`. There are three reasons already (the Moon can actually be beaten,
Venus is still being built, these supers have no chapter yet); **add the fourth to that table, not
as another ternary.**

Meter math is in `updateSuperMeter()`: `(superDamage - lastSuperKills) / requiredDamage`,
with costs in `SUPER_COST` (40 Bomb, 52 Shield, 48 Technology, 45 Star, 55 Mirror,
40 Drone, 30 Decoy, 55 First-Aid, 25 Radiant Orb). `setSelectedSuper()` refunds half on a
mid-game swap. The bomb's reach and boss damage live in `BOMB_RADIUS` (160) and
`BOMB_BOSS_DAMAGE` (15) so the tiles, the armory stats and both arenas cannot drift apart.

When the meter is full, `drawPlayer()` adds a tight, pulsing neon outline directly around the
cached `PLAYER_HULL` path in the selected super's color. `WEAPON_COLORS` and `SUPER_COLORS`
give every player attack a stable palette: yellow Blaster, orange Charge, green Cone, blue Bomb,
yellow Shield, purple Technology, cyan Tech.0, gold Star, ice-blue Mirror, orange Drone, green
Decoy, red First-Aid and amber Radiant Orb. The hull and general menu chrome still use
`playerColor`.

## Input

- `WASD` — move (velocity smoothing toward `maxSpeed`, drag `0.88` when no input).
- Arrow keys — aim + shoot. `currentAimVector()` is the single source of truth: it reads the
  whole held-arrow vector (never per-axis, which used to leak a stale axis into diagonals) and
  falls back to `lastArrowDirection` when nothing is held. Firing happens only in `drawGame`
  off `fireCooldown`; arrow keydown just zeroes the cooldown, so a diagonal is one shot at 45°
  rather than one per axis. Movement input is normalized so diagonals aren't ~41% faster.
- `Space` **hold** (>180ms) — shrink to 0.55 scale: smaller hitbox and 1.4× speed, but primary
  weapons fire at one-third their normal rate. Shot damage is unchanged.
- `Space` **tap** (≤180ms) — fire super. The hold/tap split is `spaceDownAt` vs `performance.now()`.
- `Esc` — pause.
- Touch devices get two analog pads: the left pad drives movement and the right pad aims and fires. Charge begins once the aim pad leaves its dead zone and fires on release. Dedicated buttons activate Super, hold Shrink, and open Pause. The viewport locks scaling, `gesturestart`/playfield `touchmove` guards kill iOS pinch-zoom and pull-to-refresh without breaking menu scrolling, `syncWakeLock()` holds the screen awake only mid-run, and hiding the tab auto-pauses via the existing `visibilitychange` handler.
- The touch deck is kept outside the player's movement bounds so the ship cannot disappear beneath a thumb. `resize()` reflows active actors after rotation or dynamic mobile-browser viewport changes.
- `blur` — clears all keys so the ship doesn't drift when the tab loses focus.
- Outside active gameplay, arrow keys move focus spatially through the menu, audio controls,
  loadout grids, pause screen and victory choices. Enter/Space activates the focused control;
  Escape closes the active audio drawer, controls or weapons panel before resuming from pause.

## BUILDER — the dev console

One code, typed into the ADMIN CODE box: **`BUILDER`**. It builds `#builder`, toggled after
that with the backtick key.

**The console does not exist until that code is entered.** There is no markup for it in
`index.html`; `build()` creates the whole panel and registers its key listeners the first time
`unlock()` runs, and the exported surface is only `{ unlock, paintWatches, isOpen }`. That is
deliberate and it is the second version — the first shipped the panel in the page with a
`hidden` attribute and an `unlocked` flag guarding `open()`. The flag held, but the panel was
still in the document, in the tab order, in the accessibility tree, two of its controls matched
`MENU_FOCUS_SELECTOR`, and deleting one attribute in devtools revealed it. **Gated is not the
same as absent.** If you add to the console, keep it inside `build()`; nothing about it should
be reachable, visible or inspectable before the code. It replaced `PETROSADMIN` (a fixed invincibility flag) and `TEST`
(a practice room with one dummy target); both were a single hardcoded cheat each, and the test
room was ~40 lines of a fourth arena that every super, weapon and impact site had to know about.
`drawTestRoom`, `testMode`, `testDamage` and `TEST_TARGET` are all gone with it.

**How it reaches the game's state.** `builderEval(src)` is a top-level function whose body is a
direct `eval`, so it runs in this script's own lexical scope and can read *and assign* every
top-level `let` in the file — `wave`, `lives`, `boss`, `selectedSuper`, all of it. **It has to
stay at the top level of `main.js`**; move it inside a module, an IIFE or a class and the console
loses its reach and everything but the named commands stops working.

**Completion comes from the file's own source.** Script-scope `let` is not a property of
`window`, so nothing can enumerate those bindings. Instead the console `fetch`es `main.js`
(`BUILDER_SELF_URL`, captured while the script is still evaluating, because `document.currentScript`
is null by unlock time and the `?v=` bust means the bare name can fetch a stale copy) and regexes
the declarations out of it — ~630 symbols, and it cannot drift the way a hand-kept list would.

**Commands** live in `COMMANDS`: `help god lives wave boss bosshp kill clear meter super gun
color unlock speed spawn tp watch unwatch vars`. Anything else is evaluated as JS.

Three things that took a second pass and should not be undone:

- **A command only wins when its arguments look like arguments.** `wave 7` is a command, `wave * 3
  + 1` is an expression that happens to start with one. The dispatcher checks the argument text
  against `/^[\w#.-]+(\s+[\w#.-]+)*$/` before treating the line as a command. `watch` is exempt —
  its argument *is* an expression.
- **No-argument forms report, they do not destroy.** Bare `lives` used to `Number(undefined) || 0`
  and kill you; it prints the current value now. Same for `wave`, `bosshp` and `speed`.
- **`.builder[hidden] { display: none }` is load-bearing.** `.builder` is `display: flex`, and an
  author `display` beats the UA's `[hidden] { display: none }` — the same trap `.level-nav`
  carries a comment about. Without that one line `el.hidden = true` moves the property and
  nothing else, and the key reads as dead. **Assert on `getComputedStyle().display` and a real
  `getBoundingClientRect()`, never on `el.hidden`** — a test that reads the property passes
  cheerfully while the panel sits there on screen.
- **The backtick toggle is conditioned on nothing but `unlocked`.** It first also required the
  panel be hidden *or* its input focused, which killed the key the moment you clicked into the
  game to play — the normal thing to do with a console open — and let the keystroke fall through
  to the menu handler. It matches `event.key === "`"` as well as `code === "Backquote"`, because
  the physical key that produces a backtick is not `Backquote` on every layout.
- **Key capture is a `true` (capture-phase) listener on `window`.** The game's own key handlers are
  on `window` too, bubbling, so capturing there is what stops `god` from walking the ship and
  firing supers as you type. A listener on the input itself is too late.

`speed` scales the accumulator in `frame()` via `devTimeScale`, never `STEP_MS` — the game still
runs whole 1/60s ticks, just more or fewer per second, so every frame-count timer in the file
keeps meaning the same thing. `god` sets `devGodMode`, which every damage check is guarded by.
`resetAllProgress()` clears both.

**RESET** (bottom-right of the menu, mirroring the ALPHA stamp on the left, and themed to match it)
wipes both unlock keys through
`resetAllProgress()` so the locked states can be tested without clearing site data by hand. It is
two-step — the first click arms it (`SURE?`, 4s window), the second wipes and flashes `DONE ✓` for
1.4s — and it leaves the audio mix alone, which is a preference, not progress. Every label change
goes through `setResetState()`, which parks its pending timeout in the single `resetArmTimer` slot;
an untracked second timer used to disarm the button out from under a click made during the flash.
It wears `--theme` at rest, but the armed and done states stay hardcoded red and green: those two
are warnings about destroying progress, not decoration, and have to read the same on every swatch.

## Known rough edges

- `playerName` is set to `"PLAYER"` in `startGame()` and never entered anywhere, though the
  boss intro and victory screens display it.
- `server.ps1` has a machine-specific hardcoded `$root` and no path-traversal guard — dev only.

## Front end

- **Theme.** `setTheme(hex)` writes `--theme` / `--theme-rgb` on the root element; those are the
  ship/menu accent tokens, so picking a ship colour re-skins the title, buttons, banners, pause
  card and wave banner. Loadout tiles use their own `--loadout-color`, while the active weapon and
  super update `--weapon-color` / `--super-color` for the combat HUD.
- **HUD.** Hearts (`setLives()`, rebuilt only when the count changes so the beat animation
  doesn't restart), wave number centred, score right.
- **Death screens never take focus.** `endGame()` shows GAME OVER (or a boss's defeat card)
without calling `focusMenuDefault()`. The player has just died with a movement key held, so a
programmatic `focus()` trips the browser's focus-visible heuristic and paints a highlight ring
on TRY AGAIN that a mouse user never asked for. Focus is adopted on the player's first actual
keyboard input instead: `moveMenuFocus()` already did this for arrow keys, and `adoptMenuFocus()`
does it for Enter and Space — consuming that first press rather than activating, so a mashed
Space at the moment of death cannot restart the run. Every other screen still self-focuses,
because those are all reached by a deliberate click.

**GAME OVER layout.** The message and the two buttons are three independently positioned
elements. They are offset from a shared `top: 50%` by their measured heights so the *stack* is
centred; the old 58%/68% button positions centred only the message and let the group hang low.

**Pause.** Escape calls `setPaused()`, which shows `#pause-screen` (RESUME / LEVELS / CONTROLS / AUDIO / MAIN MENU) and
  ducks the music. `returnToMenu()` is the single teardown path shared by the pause card and the
  game-over button.
- **Mobile.** `.touch-capable` is set from coarse-pointer/max-touch detection. Responsive rules cover phones and tablets in portrait and landscape, respect safe-area insets, enlarge coarse-pointer targets, and make every oversized menu/result card independently scrollable.
- **Audio controls.** The menu and pause card each use a centered, text-only AUDIO button for
  synchronized Music and Game SFX sliders
  plus a global mute toggle inside a collapsed drawer. Preferences are stored under `petros-space-adventure-audio`
  in `localStorage` and applied to the WebAudio buses without restarting the active track.
- **Alpha markings.** A themed `ALPHA` chip follows SPACE ADVENTURE in the title and a matching
  stamp sits in the bottom-left corner. Both are buttons and both open the alpha card. There is
  no change log — see "There is no change log" at the top.
- **Menu buttons carry no subtitle unless it is live state.** `WEAPONS` keeps its `<small>`
  because `refreshLoadoutUI()` writes the current loadout into it. `LEVELS` had a hardcoded
  "JUMP TO ANY STAGE" that never changed, so it was dead weight at double the height of every
  button around it; it is gone. Don't add a static one back.
- **Moon defeat.** Losing during `bossMode` opens `#moon-defeat-screen` with a sinister,
  red-eyed looping laugh portrait, the Moon's quote, and dedicated retry/menu actions instead of
  the generic game-over UI. The defeated-Moon victory portrait keeps its tongue extended and
  gently retracts it on a short loop, like panting.

## Weapon voices

Every primary gun has a synthesised report in `weaponSfx` (`main.js`), one method per gun, called
from the fire path: `blaster` and `tech0`/`magma` from the firing branch in `drawGame`, `cone` from
`fireCone` (**once per volley, not once per round**), `charge` from `releaseChargeShot` with the
damage tier so 1/3/5 sound like three different shots.

They share three ideas: a pitch that *falls* (an arcade shot is a downward sweep, never a steady
tone), `shotEnv`'s couple of milliseconds of attack so nothing clicks, and a `sweepFilter` closing
over the tail so it goes dark instead of fizzy. `shotTone` / `shotNoise` / `weaponOut` are the
primitives; `noiseBuffer` is the same one the drums use, read from a random offset.

**They are deliberately dark and deliberately quiet.** The first pass used squares and saws with
bright noise transients on top and was genuinely unpleasant inside ten seconds of held trigger.
Triangles and sines carry the tone now, the noise layers are gone from every gun except the two
heaviest, and a single lowpass on `weaponBus` caps the whole group — so no future weapon can be
the shrill one. **Brightness, not loudness, is what makes a repeated sound wear out its welcome:**
watch the share of energy above 2kHz before you watch the level.

**Rapid fire is a mixing problem, not a timbre one.** The blaster fires six times a second, and
what makes a shooter exhausting is a sound that is identical, centred and un-ducked at that rate.
Four things fix it, and they matter more than the waveforms:

- every shot is detuned a few cents and re-levelled a few percent, so the ear never locks onto a
  repeating cycle;
- the blaster is panned to the wingtip that fired (`weaponSfx.blaster(blasterBarrel)`, called
  *after* `fireInDirection` because that is what flips the barrel), so a held trigger reads as a
  rhythm across the field instead of one sound stuttering in the middle;
- `shotLevel()` pulls a shot down the more recently the last one went off, so the tenth round of
  a burst is quieter than the first;
- the whole group runs through its own limiter on `weaponBus`, not the shared `sfxGain`, so a held
  trigger sits under the music instead of eating headroom from explosions and UI.

**Latency.** The context is built with `latencyHint: "interactive"` and every shot is scheduled at
`currentTime`. There is no lookahead here and there must not be — the music sequencer schedules
ahead because steady tempo needs it; a trigger pull is the opposite problem.

**Levels.** Measured as exact peak / RMS / share of energy above 2kHz by re-rendering each voice in
an `OfflineAudioContext` (polling an `AnalyserNode` misses these transients and gives numbers that
move run to run). The yardstick is a plain `playSound(660, 0.06, "square")`: peak 0.039, RMS 0.0025,
11.8% above 2kHz, centroid 1068Hz. Every gun sits *under* that on all three counts:

| | blaster | cone | chg 1 | chg 3 | chg 5 | tech0 | magma |
| --- | --- | --- | --- | --- | --- | --- | --- |
| peak | .016 | .021 | .014 | .018 | .034 | .018 | .016 |
| RMS | .0008 | .0011 | .0011 | .0019 | .0044 | .0010 | .0021 |
| >2kHz | 0.5% | 0.3% | 0.2% | 0.1% | 0.1% | 3.1% | 0.1% |

Re-measure against that reference before changing a `shotLevel()` base. Keep the blaster at the
bottom of the ladder, and keep every gun below the reference's brightness — that column is the one
that made the difference between "cool" and "annoying".

Supers still use `playSound`; they fire once per meter fill and cannot wear out their welcome.

## Music

`music` is a self-contained step sequencer (`main.js`). A 25ms timer schedules notes
`SCHEDULE_AHEAD` seconds in advance of the AudioContext clock — plain `setInterval` jitters
audibly. Tracks (`intro`, `menu`, `battle`, `boss`, `victory`, …) are 16-step patterns per bar
in MIDI numbers, played through synthesised voices: filtered saw/square bass with a sub,
plucked arp, doubled lead, and noise-based kick/snare/hat. `intro` is a short, drum-less
fanfare for the title card; `victory` loops through reward and victory menus.

Everything routes through `musicGain` / `sfxGain` and then `masterGain` off one
`ensureAudio()` context. Browsers block audio before a gesture, so `unlockAudio()` waits for
the first click or keypress and then brings in `intro` (or `menu` directly, if the title card
is already gone). `music.play(name, fadeSeconds)` takes an optional crossfade length — used
by `finishCredits()` to hand off from `intro` to `menu` with a slower 1.4s fade instead of the
usual snappy 0.6s track switch — but only once `intro` is confirmed already playing, since
calling `play()` against a still-suspended (pre-gesture) AudioContext would schedule notes
against a frozen clock and burst them out once the context finally resumes.

## Loadout UI

`refreshLoadoutUI()` repaints every selectable control from `selectedWeapon` / `selectedSuper` —
the weapons panel tiles (split into PRIMARY GUN / SUPER ATTACK sections, each showing an
EQUIPPED flag on the active tile), the victory-screen choices, and the loadout readouts on the
menu button and panel footer. Nothing else touches the `.selected` class; go through
`setSelectedWeapon()` / `setSelectedSuper()`.

`setupWeaponBook()` arranges the original weapon buttons into a partially filled shelf.
Each spine selects a weapon and renders its overview on the left and full icon on the right.
Folded-corner navigation switches between primary and super pages with a short page turn.
All five primaries fit in the shelf, replacing the old more-primary drawer; future overflow scrolls.
`BOOK_ENTRIES` supplies descriptions and stats, and `renderWeaponBook()` paints the active page.

**How a lock looks.** A locked reward keeps its own colour, faded, with a padlock stamped on
it — never a grey wash, which told you something was locked but not *what*, since every locked
reward then looked identical. The padlock is one inline-SVG data URI in the `--padlock` custom
property (outline, shackle and keyhole in correct proportion at any size), used by the menu
ship swatches (`.color-choice.locked`) and the armory spines, whose silhouette is lifted clear
of it. The fade on a swatch is an inset `box-shadow`, not `filter` or `opacity`: those two
would drag the padlock down with the colour, while an inset shadow paints over the background
and under the pseudo-elements. Building the lock from two bordered pseudo-elements was tried
first and read as a briefcase — the shackle disappeared behind the body's outline.

Moon progression is stored under `petros-space-adventure-moon-rewards`. Before the first
victory, the Grey ship swatch and Tech.0 tiles remain visibly locked and open the Moon reward
prompt when selected. The Moon's victory first opens a standalone reward screen: the lock opens,
Tech.0 and Grey ship illustrations appear, then Continue opens the victory/loadout screen.
Grey remains selectable through the menu ship colors. Both rewards persist across visits.
Venus progression mirrors it under `petros-space-adventure-venus-rewards`: the Magma tile and
the Magma ship swatch stay locked (opening the same lock prompt with Venus text) until
`showVenusRewards()` pays both out on its own Venus-skinned reward screen. `setSelectedWeapon()`
refuses both locked primaries, so a locked weapon can never be fired.
The armory uses narrow icon-only book spines with embossed binding bands and unused shelf space;
full previews inherit both loadout color tokens so gradient icons remain visible.

## Conventions

- Vanilla ES2020+ in the browser; no transpiling, no imports. Keep it that way.
- Canvas state changes are wrapped in `ctx.save()` / `ctx.restore()` around
  `translate`/`rotate`; reset `ctx.shadowBlur = 0` after any glow.
- SFX are generated on the fly via `playSound(freq, duration, type)`; the `AudioContext` is
  created lazily by `ensureAudio()` and every call no-ops if it is null. Gun fire is the one
  exception — it goes through `weaponSfx`, see "Weapon voices".
- **Weapon voices are the one place the loop is allowed to allocate.** WebAudio nodes are
  single-use: an `OscillatorNode` cannot be restarted, so a shot must build its graph. It is a
  handful of nodes at most six times a second, freed on the audio thread, and there is no pooled
  alternative. Do not "fix" it.
- `sparks` is the shared particle pool for every arena (thruster trails, projectile flames, debris);
  `bossParticles` / `bossExplosions` are boss-arena only.
- Collisions are cheap: axis-aligned `Math.abs` box checks for enemies/bullets,
  `Math.hypot` circles for the boss and blasts.
- **Nothing in the loop allocates.** Projectile lists are pruned with `compact(list, keep)`
  (in-place) rather than `list = list.filter(...)`; `facing`, `chargeDirection`,
  `lastArrowDirection` and `currentAimVector()`'s result are mutated, never replaced. Per-frame
  `filter`/object literals are the main source of GC pauses here.
- **Anything constant is built once**, not per frame: the Venus arena grid is stroked into the
  `bossGridLayer` offscreen canvas on resize and blitted; the player hull is a cached `Path2D`;
  the Moon's body/terminator gradients and the warp starfield's `rgba()` strings are cached; the corona gradient is
  rebuilt only when its radius or colour changes. Creating a gradient or setting a clip every
  frame is expensive — reach for a cache first.
- The canvas context is opaque (`alpha: false`) and always painted edge to edge; don't rely
  on transparency showing the page behind it.
- **Never use `ctx.shadowBlur`.** It blurs the shape's bounding box in software on every
  draw, every frame, and it was scattered across the bullet and boss paths. Use
  `drawGlow(hexColor, radius, x, y)`, which blits a radial-gradient sprite baked once by
  `glowSprite()` and is skipped entirely on the cheap tiers. It needs a `#rrggbb` literal.
- Don't clear to black before something that repaints every pixel anyway — `draw()` skips the
  clear when `drawBossArea` is about to fill the screen. A redundant
  full-screen fill is the most expensive kind of no-op there is.
- Enemy and boss colours remain fixed for readability. Player projectiles and charge effects read
  from `WEAPON_COLORS`; supers, their ready outline and super HUD read from `SUPER_COLORS`; only
  the ship and shared menu chrome read from `playerColor` / the CSS `--theme` tokens.
- After editing `main.js`, bump the `?v=` in `index.html`'s script tag.
- There is no change log to update — see "There is no change log" at the top.
