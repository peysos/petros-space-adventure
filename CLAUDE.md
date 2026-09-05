# Petros Space Adventure

A browser-based, single-file-per-concern arcade shooter. No build step, no dependencies,
no package manager — plain HTML + CSS + a single `<canvas>` game loop in vanilla JS.

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

**Loadout icons in the HUD.** The equipped gun and super sit beside the super meter in
`.hud-loadout`, which is bottom-anchored and given `.super-track`'s own height so the icons
share the **bar's** centre line. Anchoring to the meter's whole box instead puts them about ten
pixels high, because that box also contains the SUPER label above the bar. Each preview draws
different-sized art inside the shared 58×48 box, so every icon gets a `--icon-scale` that lands
it on the same visual height. Hovering or focusing one shows `#hud-loadout-card`, built from
`BOOK_ENTRIES` and `BOOK_STATS` so the card and the FLIGHT ARMORY can never disagree; it is
deliberately quiet and `pointer-events: none`, and it renders on demand rather than per frame.

**Mercury rewards.** `syncMercuryRewardUI()` unlocks the grey ship and Tech.0 everywhere they
appear. The reward screen offers them rather than forcing them: two grey `.reward-equip`
buttons call `setSelectedWeapon("tech0")` and `setPlayerColor(GREY_SHIP_COLOR)` and flip to a
filled EQUIPPED state, kept in sync by `syncRewardEquipButtons()`. `setPlayerColor()` is the
single path that applies a ship colour, so the menu swatches and the reward card can't drift.

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
5. Boss **MERCURY** has 110 HP (`BOSS_MAX_HEALTH`). Enter/Space skip the intro card
   (`tryConfirmScreen`), same as clicking CONTINUE.
6. On defeat: `startBossDeath()` runs a ~175-frame sequence — chained surface blasts,
   then one big detonation at frame 126 that scatters debris — before `finishBossDeath()`
   grants `+1 HP`, sets `wave = 6` and opens `showVictory()`.
7. Continuing enters Venus airspace for waves 6–9. Clearing wave 9 sets `wave = 10` and
   calls `enterBossArea("venus")`.
8. Boss **VENUS** has 210 HP (`VENUS_MAX_HEALTH`). It shares the whole boss shell with
   Mercury — intro card, health bar, debris, `damageBoss()`, the death sequence — and
   differs only in `drawVenus()` and `updateVenusBoss()`. On defeat `finishBossDeath()`
   grants `+1 HP`, sets `wave = 11` and drops straight back into the Venus waves; there is
   no reward screen for it yet.

**Both fights run three phases.** `updateBossPhase()` steps `bossPhase` at 2/3 and 1/3 health,
shared by both planets: it flashes, shakes, throws debris and banners the phase. `phaseRate()`
returns the `PHASE_RATE` multiplier that every attack timer in either fight is scaled by, so
"harder" is one number rather than a dozen scattered constants. A single-phase boss is a damage
race — once you have read its three patterns there is nothing left to learn, which is what made
both fights fall over.

**Mercury's brood.** From phase 2 Mercury throws chips of itself: `bossMinions`, spawned by
`spawnBossMinion()` and run by `updateBossMinions()`. Two health each, they home with a turn
rate that tightens in phase 3, hurt on contact, and are worth score and super meter — so
clearing the brood is a real choice against hitting the planet. `MINION_CAP` bounds them at 7.

**Which planet is in the arena** is `bossKind` (`"mercury"` | `"venus"`). Anything shared
between the two fights reads `bossRadius()`, `bossMaxHealth()` and `bossLabel()` rather than
the Mercury constants — that includes the bomb blast, the beam tick, the health bar and the
player-bullet hit test. `enterBossArea(kind)` is the only place that sets it, and both
`startGame()` and `returnToMenu()` put it back to `"mercury"`.

### Venus

`drawVenus(t)` is all atmosphere and no surface. A cached radial body gradient carries the
sulfur palette; `VENUS_BANDS` lays six cloud decks over it, each an ellipse clipped to the disc,
sliding at its own rate and *breathing* in thickness and alpha so the atmosphere churns instead
of sitting there as six static stripes. `venusCells` drifts five storm cells across the face,
wrapping at the limb, and a hot limb arc gives the sphere an edge instead of letting it fade
out. A double-spiral polar vortex sits over the top pole and winds tighter as an attack builds. Both the decks and the vortex turn **backwards** (`venusSpin` and
`venusVortexSpin` decrement) because Venus is retrograde, and it is the one thing about the
planet everybody knows. Damage reuses `BOSS_CRACKS` as molten fissures showing through the
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
so that loop is no longer Mercury-specific, and `VENUS_ORB_CAP` (130) bounds them: a phase-3
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

`hunter` is the seventh pattern: 3–5 seeker darts fired one at a time (so they arrive strung
out rather than as a wall) that steer for 140–180 frames before committing. It is the only
attack that follows you into a corner.

Phase 3 also never gives a single-pattern breather again — `venusChain` is always at least 1
there — and `venusRestFrames()` drops its floor from 20 to 12.

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

Five types, defined in `ENEMY_TYPES` and driven by `updateEnemy()` / `drawEnemy()`:

| Type | HP | Behaviour |
| --- | --- | --- |
| `grunt` | 1 | Holds formation, bobs. Fires the shared slow **homing** shot on `enemyShotTimer`. |
| `charger` | 2 | `idle → wind → hunt` state machine. Telegraphs with a red ring, then continuously steers into the player until destroyed. It is a pure contact threat and fires no projectiles. |
| `turret` | 3 | Never moves. Barrel tracks the player; fires a three-way **straight** spread. |
| `skimmer` | 2 | Venus Acid Skimmer. Sways across a formation lane, tracks the player, then spits a wobbling sulfur-acid globule. |
| `bloom` | 4 | Venus Furnace Bloom. Opens with a hot pulse and fires a wide radial fan of heat shards. |

`waveRoster(n)` decides the mix (wave 2 introduces chargers, wave 3 turrets, wave 4 both,
and waves 6–9 replace Mercury's forces with increasingly dense Venus formations);
`WAVE_INTROS` supplies the banner subtitle that calls out what's new.

### The Venus sky

`drawVenusEnvironment()` paints every post-Mercury wave. It is a sky, not a set of stripes:
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

## Weapons and supers

Primary weapon (`selectedWeapon`):
- `blaster` — auto-fires on held arrow keys, `fireCooldown = 10`, 1 damage.
- `charge` — hold an arrow, release to fire. It has three discrete tiers: 1 damage below half,
  3 damage at half charge with a three-target cap, and 5 damage at full charge with infinite
  pierce. Each tier is a circular energy ball (5px / 9px / 14px radius) so charge strength is
  visible in flight. Charge state lives in `chargeStartedAt` / `chargeDirection`.
- `cone` — three 1-damage shots at ±0.16 rad, `fireCooldown = 18`. `fireCone()` reserves
  capacity for the entire volley before firing, so the projectile cap can never emit a partial burst.
- `tech0` — a cyan post-Mercury reward with a 40-frame (~0.7-second) firing cycle. The projectile
  flies 1.4× faster than other rounds, deals 3 damage on direct impact, then walks a 1-damage
  chain through as many as five additional living enemies within 260px of each previous target,
  including Mercury's brood in boss fights — enough to drop smaller enemies outright.
  A ready ping and muzzle flash mark each recharged cycle. Multiple projectiles are no
  longer blocked by an active arc.

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

**All six are arena-agnostic.** A wave, a boss fight and the test room are three separate
update loops, so instead of writing each super three times everything hostile is described
through one adapter: `collectSuperTargets()` fills the pooled `SUPER_TARGETS` array with
`{x, y, r, ref, kind}` and `hurtSuperTarget()` / `vaporizeSuperTarget()` route damage back to
whichever system owns the target. `updateSuperEntities(t)` is called once per arena, next to
`updateSuperBeam(t)`, and `clearSuperEntities()` is the single teardown.

Meter math is in `updateSuperMeter()`: `(superDamage - lastSuperKills) / requiredDamage`,
with costs in `SUPER_COST` (40 Bomb, 52 Shield, 48 Technology, 45 Star, 55 Mirror,
40 Drone, 30 Decoy, 55 First-Aid, 25 Radiant Orb). `setSelectedSuper()` refunds half on a
mid-game swap. The bomb's reach and boss damage live in `BOMB_RADIUS` (160) and
`BOMB_BOSS_DAMAGE` (15) so the tiles, the armory stats, both arenas and the test room cannot
drift apart.

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

**Pause.** Escape calls `setPaused()`, which shows `#pause-screen` (RESUME / CONTROLS / AUDIO / MAIN MENU) and
  ducks the music. `returnToMenu()` is the single teardown path shared by the pause card and the
  game-over button.
- **Mobile.** `.touch-capable` is set from coarse-pointer/max-touch detection. Responsive rules cover phones and tablets in portrait and landscape, respect safe-area insets, enlarge coarse-pointer targets, and make every oversized menu/result card independently scrollable.
- **Audio controls.** The menu and pause card each use a centered, text-only AUDIO button for
  synchronized Music and Game SFX sliders
  plus a global mute toggle inside a collapsed drawer. Preferences are stored under `petros-space-adventure-audio`
  in `localStorage` and applied to the WebAudio buses without restarting the active track.
- **Change log.** The bottom-left `CHANGE LOG 0.1` button opens a scrollable version-history panel.
  Add each shipped release as a new retained entry so older notes remain available; do not invent old releases.
- **Mercury defeat.** Losing during `bossMode` opens `#mercury-defeat-screen` with a sinister,
  red-eyed looping laugh portrait, Mercury's quote, and dedicated retry/menu actions instead of
  the generic game-over UI. The defeated-Mercury victory portrait keeps its tongue extended and
  gently retracts it on a short loop, like panting.

## Music

`music` is a self-contained step sequencer (`main.js`). A 25ms timer schedules notes
`SCHEDULE_AHEAD` seconds in advance of the AudioContext clock — plain `setInterval` jitters
audibly. Four tracks (`menu`, `battle`, `boss`, `victory`) are 16-step patterns per bar in MIDI
numbers, played through synthesised voices: filtered saw/square bass with a sub, plucked arp,
doubled lead, and noise-based kick/snare/hat. `victory` loops through reward and victory menus.

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

`setupWeaponBook()` arranges the original weapon buttons into a partially filled shelf.
Each spine selects a weapon and renders its overview on the left and full icon on the right.
Folded-corner navigation switches between primary and super pages with a short page turn.
All four primaries fit in the shelf, replacing the old more-primary drawer; future overflow scrolls.
`BOOK_ENTRIES` supplies descriptions and stats, and `renderWeaponBook()` paints the active page.

Mercury progression is stored under `petros-space-adventure-mercury-rewards`. Before the first
victory, the Grey ship swatch and Tech.0 tiles remain visibly locked and open the Mercury reward
prompt when selected. Mercury victory first opens a standalone reward screen: the lock opens,
Tech.0 and Grey ship illustrations appear, then Continue opens the victory/loadout screen.
Grey remains selectable through the menu ship colors. Both rewards persist across visits.
The armory uses narrow icon-only book spines with embossed binding bands and unused shelf space;
full previews inherit both loadout color tokens so gradient icons remain visible.

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
- Enemy and boss colours remain fixed for readability. Player projectiles and charge effects read
  from `WEAPON_COLORS`; supers, their ready outline and super HUD read from `SUPER_COLORS`; only
  the ship and shared menu chrome read from `playerColor` / the CSS `--theme` tokens.
- After editing `main.js`, bump the `?v=` in `index.html`'s script tag.
