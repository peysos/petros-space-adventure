# Petros Space Adventure

A browser-based, single-file-per-concern arcade shooter. No build step, no dependencies,
no package manager — plain HTML + CSS + a single `<canvas>` game loop in vanilla JS.

## Files

| File | Role |
| --- | --- |
| `index.html` | All DOM: menu, weapons/controls/change-log modals, loading screen, HUD, boss intro, victory screen. Loads the CSS and `main.js` with versioned query strings (bump changed assets to bust cache). |
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
`gameActive`, `bossMode`, `testMode`, `player`, `bullets`, `enemies`, `enemyBullets`,
`bossBullets`, `superBombs`, `score`, `lives`, `wave`, …). There are no classes and no
module system — functions read and write those globals directly.

**One rAF loop.** `draw(t)` runs forever from page load and dispatches by state:

```
draw(t)
├─ !gameActive            → drawStaticStars()      (menu backdrop)
├─ gameOverShown          → drawStars(t)           (warp-speed starfield)
└─ gameActive && !paused  → drawGame()
                             ├─ bossIntro → return (freeze)
                             ├─ bossMode  → drawBossArea()
                             ├─ testMode  → drawTestRoom()
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

**Backdrop.** `drawStaticStars(t)` fills the whole viewport with pixel-square stars on three parallax layers, drifting downward and wrapping. Density scales with viewport area and with `quality.stars`, capped at `MAX_BACKDROP_STARS` (1000) — a 4K screen otherwise asked for ~3500, each its own `fillStyle` write plus `fillRect`. The field is sorted by tint at init so the draw loop sets `fillStyle` six times per frame instead of once per star, and is respread by `resize()` so it always covers the screen edge to edge.

**HUD is DOM, not canvas.** Score, lives, wave, super meter, charge meter, boss health, and
all overlays are HTML elements. The canvas draws only the play field.

Because the loop touches them every frame, they are **not** re-queried or blindly rewritten:
elements live in the `dom` cache, and writes go through `setText()` / `setWidth()`, which skip
the assignment when the value is unchanged. A redundant `textContent` or `style.width` write
still costs a style invalidation, and at 60fps that was the loop's single biggest expense.
If you write to a cached element directly you must go through the helpers too, or the cache
goes stale and silently swallows the next real write.

## Game flow

0. Title card — "DANIEL AND PETROS PRESENT..." holds for `CREDITS_HOLD_MS` (2.6s), or a
   click skips it, then `finishCredits()` reveals the menu.
1. Menu → pick ship color, weapon, super → `START`.
2. `showLoading(startGame)` plays a fake progress bar, then `startGame()` resets all state.
3. Waves 1–4: `createEnemies()` builds the wave from `waveRoster(wave)`. Clearing every
   enemy advances the wave; `showWaveBanner()` announces both the clear and the next wave.
4. Wave 5 clear → `enterBossArea()` → boss intro card → `startBossFight()` (starts a
   `setInterval` bass loop as boss music).
5. Boss **MERCURY** has 75 HP (`BOSS_MAX_HEALTH`). Enter/Space skip the intro card
   (`tryConfirmScreen`), same as clicking CONTINUE.
6. On defeat: `startBossDeath()` runs a ~175-frame sequence — chained surface blasts,
   then one big detonation at frame 126 that scatters debris — before `finishBossDeath()`
   grants `+1 HP`, sets `wave = 6` and opens `showVictory()`.

### Mercury

No rings — the planet is a lit sphere with rotating clipped craters, a terminator shadow, and
**molten fissures** (`BOSS_CRACKS`, drawn in three passes: bloom, hot core, white centre) that
open up as its health drains. Damage knocks chunks off: `spawnBossShards()` adds rock to a
debris swarm that orbits on per-shard inclinations, drawn behind and in front of the body.
The face tracks the ship — pupils follow the player, the body leans toward them, and it blinks
on its own timer.

It also **moves** lower in the arena: `bossDrift` sweeps it laterally with a stronger bias toward
the player's position. `trackedBossAngle()` leads the player's velocity for aimed attacks.
Meteor volleys randomly choose single homing, paired tracking, or three-way predictive shots;
the orb attack chooses a three-shot fan, five-shot fan, or fast pair; radial bursts randomize
their count, phase, and recovery. The ranges keep the variety from becoming a pure fire-rate buff.

### Mercury's animation states

`drawMercury(t)` is driven by four frame counters, all reset by `resetBossAnimation()`:

| Counter | Effect |
| --- | --- |
| `bossChargeAnim` | Wind-up before a shot: inhale (squash), corona reddens, eyes swell, teeth clench. |
| `bossShootAnim` | Recoil: stretch outward, mouth opens with two tooth rows and a muzzle flash. |
| `bossHitFlash` | Damage: white flash, shake, eyes squint, rock chips fly back along the shot. |
| `bossDeathTimer` | Death: shake, glowing cracks, chained explosions, then fade at the final blast. |

`damageBoss(amount, fromX, fromY)` is the single entry point for hurting the boss — it
applies damage, triggers the flash/shake and spawns debris. `bossParticles` (pixel squares)
and `bossExplosions` (expanding rings) are the shared effect pools.

## Enemies

Three types, defined in `ENEMY_TYPES` and driven by `updateEnemy()` / `drawEnemy()`:

| Type | HP | Behaviour |
| --- | --- | --- |
| `grunt` | 1 | Holds formation, bobs. Fires the shared slow **homing** shot on `enemyShotTimer`. |
| `charger` | 2 | `idle → wind → hunt` state machine. Telegraphs with a red ring, then continuously steers into the player until destroyed. It is a pure contact threat and fires no projectiles. |
| `turret` | 3 | Never moves. Barrel tracks the player; fires a three-way **straight** spread. |

`waveRoster(n)` decides the mix (wave 2 introduces chargers, wave 3 turrets, wave 4 both);
`WAVE_INTROS` supplies the banner subtitle that calls out what's new.

**Why the mix matters:** the old game had only grunts firing bullets that homed forever but
only while `y < H`, so a player could park in a corner and never be touched. Chargers come to
you and turret spreads fill space, so no position is safe. `fireHomingShot()` now steers for a
fixed 150-frame budget and then commits, which makes the tracking honest rather than infinite.

## Weapons and supers

Primary weapon (`selectedWeapon`):
- `blaster` — auto-fires on held arrow keys, `fireCooldown = 10`, 1 damage.
- `charge` — hold an arrow, release to fire. It has three discrete tiers: 1 damage below half,
  3 damage at half charge with a three-target cap, and 5 damage at full charge with infinite
  pierce. Charge state lives in `chargeStartedAt` / `chargeDirection`.
- `cone` — three 1-damage shots at ±0.16 rad, `fireCooldown = 18`.

Below full charge, `drawChargeAura()` shows a contracting ring. At full charge the ring clears
and `drawPlayer()` applies only a subtle hull shake; the full-power round keeps its flame trail.

Super (`selectedSuper`), fired by a **short** Space tap when `superMeter >= 1`:
- `bomb` — projectile with a 125px blast radius (15 damage to the boss).
- `invincibility` ("SHIELD") — 300 frames of `playerInvulnerable` + `invincibilitySuperTimer`.
- `lance` ("LANCE OF TECH") — a piercing beam locked to the direction fired but anchored to the ship, so it
  sweeps as you move. Lives `BEAM_FRAMES`, damages everything within `BEAM_HALF_WIDTH` of its
  centre line every `BEAM_TICK` frames. Replaced the old `void` super, which was never
  implemented — it spawned a bomb flagged `void: true` that nothing read.

Meter math is in `updateSuperMeter()`: `(superDamage - lastSuperKills) / requiredDamage`,
with costs in `SUPER_COST` (22, 22, 33 for Lance of Tech). `setSelectedSuper()` refunds half on a
mid-game swap.

When the meter is full, `drawPlayer()` adds a tight, pulsing neon outline directly around the
cached `PLAYER_HULL` path in `playerColor`. The super HUD and every player weapon/super effect use the same theme
colour, so changing the ship keeps the whole loadout visually coherent.

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
- `blur` — clears all keys so the ship doesn't drift when the tab loses focus.
- Outside active gameplay, arrow keys move focus spatially through the menu, audio controls,
  loadout grids, pause screen and victory choices. Enter/Space activates the focused control;
  Escape closes the active audio drawer, controls or weapons panel before resuming from pause.

## Admin codes

Typed into the ADMIN CODE box on the menu (`admin-submit` handler):
- `PETROSADMIN` → `adminInvincible = true` (all damage checks are guarded by it).
- `TEST` → `testMode = true`, a practice room (`drawTestRoom`) with a static target and a
  damage readout. Both flags persist until reload; `startGame()` does not reset them.

## Known rough edges

- `playerName` is set to `"PLAYER"` in `startGame()` and never entered anywhere, though the
  boss intro and victory screens display it.
- `server.ps1` has a machine-specific hardcoded `$root` and no path-traversal guard — dev only.

## Front end

- **Theme.** `setTheme(hex)` writes `--theme` / `--theme-rgb` on the root element; those are the
  only accent tokens the stylesheet reads, so picking a ship colour re-skins the title, buttons,
  banners, pause card and wave banner to match.
- **HUD.** Hearts (`setLives()`, rebuilt only when the count changes so the beat animation
  doesn't restart), wave number centred, score right.
- **Pause.** Escape calls `setPaused()`, which shows `#pause-screen` (RESUME / CONTROLS / AUDIO / MAIN MENU) and
  ducks the music. `returnToMenu()` is the single teardown path shared by the pause card and the
  game-over button.
- **Audio controls.** The menu and pause card each use a centered, text-only AUDIO button for
  synchronized Music and Game SFX sliders
  plus a global mute toggle inside a collapsed drawer. Preferences are stored under `petros-space-adventure-audio`
  in `localStorage` and applied to the WebAudio buses without restarting the active track.
- **Change log.** The bottom-left `CHANGE LOG 0.1` button opens a scrollable version-history panel.
  Add each shipped release as a new retained entry so older notes remain available; do not invent old releases.

## Music

`music` is a self-contained step sequencer (`main.js`). A 25ms timer schedules notes
`SCHEDULE_AHEAD` seconds in advance of the AudioContext clock — plain `setInterval` jitters
audibly. Four tracks (`menu`, `battle`, `boss`, `victory`) are 16-step patterns per bar in MIDI
numbers, played through synthesised voices: filtered saw/square bass with a sub, plucked arp,
doubled lead, and noise-based kick/snare/hat. `victory` is `once: true` and stops itself.

Everything routes through `musicGain` / `sfxGain` and then `masterGain` off one
`ensureAudio()` context. Browsers
block audio before a gesture, so `unlockAudio()` waits for the first click or keypress and then
brings the menu track in.

## Loadout UI

`refreshLoadoutUI()` repaints every selectable control from `selectedWeapon` / `selectedSuper` —
the weapons panel tiles (split into PRIMARY GUN / SUPER ATTACK sections, each showing an
EQUIPPED flag on the active tile), the victory-screen choices, and the loadout readouts on the
menu button and panel footer. Nothing else touches the `.selected` class; go through
`setSelectedWeapon()` / `setSelectedSuper()`.

## Conventions

- Vanilla ES2020+ in the browser; no transpiling, no imports. Keep it that way.
- Canvas state changes are wrapped in `ctx.save()` / `ctx.restore()` around
  `translate`/`rotate`; reset `ctx.shadowBlur = 0` after any glow.
- SFX are generated on the fly via `playSound(freq, duration, type)`; the `AudioContext` is
  created lazily by `ensureAudio()` and every call no-ops if it is null.
- `sparks` is the shared particle pool for every arena (thruster trails, projectile flames, debris);
  `bossParticles` / `bossExplosions` are boss-arena only.
- Collisions are cheap: axis-aligned `Math.abs` box checks for enemies/bullets,
  `Math.hypot` circles for the boss and blasts.
- **Nothing in the loop allocates.** Projectile lists are pruned with `compact(list, keep)`
  (in-place) rather than `list = list.filter(...)`; `facing`, `chargeDirection`,
  `lastArrowDirection` and `currentAimVector()`'s result are mutated, never replaced. Per-frame
  `filter`/object literals are the main source of GC pauses here.
- **Anything constant is built once**, not per frame: the boss arena grid is stroked into the
  `bossGridLayer` offscreen canvas on resize and blitted; the player hull is a cached `Path2D`;
  Mercury's body/terminator gradients and the warp starfield's `rgba()` strings are cached; the corona gradient is
  rebuilt only when its radius or colour changes. Creating a gradient or setting a clip every
  frame is expensive — reach for a cache first.
- The canvas context is opaque (`alpha: false`) and always painted edge to edge; don't rely
  on transparency showing the page behind it.
- **Never use `ctx.shadowBlur`.** It blurs the shape's bounding box in software on every
  draw, every frame, and it was scattered across the bullet and boss paths. Use
  `drawGlow(hexColor, radius, x, y)`, which blits a radial-gradient sprite baked once by
  `glowSprite()` and is skipped entirely on the cheap tiers. It needs a `#rrggbb` literal.
- Don't clear to black before something that repaints every pixel anyway — `draw()` skips the
  clear when `drawBossArea`/`drawTestRoom` is about to fill the screen. A redundant
  full-screen fill is the most expensive kind of no-op there is.
- Enemy and boss colours remain fixed for readability. Every player-owned projectile, charge
  effect, super, loadout preview and HUD accent instead reads from `playerColor` / the CSS
  `--theme` tokens.
- After editing `main.js`, bump the `?v=` in `index.html`'s script tag.
