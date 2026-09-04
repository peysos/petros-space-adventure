# Petros Space Adventure

A browser-based, single-file-per-concern arcade shooter. No build step, no dependencies,
no package manager — plain HTML + CSS + a single `<canvas>` game loop in vanilla JS.

## Files

| File | Role |
| --- | --- |
| `index.html` | All DOM: menu, weapons/controls modals, loading screen, HUD, boss intro, victory screen. Loads `main.js?v=15` (bump the query string to bust cache). |
| `main.js` | The entire game: state, render loop, physics, collisions, input, audio, UI wiring. |
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

**Fixed 60Hz timestep.** rAF calls `frame(now)`, not `draw(t)`. `frame` accumulates elapsed
time and runs `draw` only on whole `STEP_MS` (1/60s) boundaries, so the frame-count timers
above mean the same thing on every display. On a faster-than-60Hz screen the spare callbacks
return before clearing the canvas, which leaves the previous frame on screen; on a slower one
it catches up by at most `MAX_CATCHUP_STEPS` (2), so a stall can never spiral. Anything new
that is measured in frames just works — don't reintroduce a bare `requestAnimationFrame(draw)`.

**Backdrop.** `drawStaticStars(t)` fills the whole viewport with pixel-square stars on three parallax layers, drifting downward and wrapping. Density scales with viewport area, capped at `MAX_BACKDROP_STARS` (1000) — a 4K screen otherwise asked for ~3500, each its own `fillStyle` write plus `fillRect`. The field is sorted by tint at init so the draw loop sets `fillStyle` six times per frame instead of once per star, and is respread by `resize()` so it always covers the screen edge to edge.

**HUD is DOM, not canvas.** Score, lives, wave, super meter, charge meter, boss health, and
all overlays are HTML elements. The canvas draws only the play field.

Because the loop touches them every frame, they are **not** re-queried or blindly rewritten:
elements live in the `dom` cache, and writes go through `setText()` / `setWidth()`, which skip
the assignment when the value is unchanged. A redundant `textContent` or `style.width` write
still costs a style invalidation, and at 60fps that was the loop's single biggest expense.
If you write to a cached element directly you must go through the helpers too, or the cache
goes stale and silently swallows the next real write.

## Game flow

1. Menu → pick ship color, weapon, super → `START`.
2. `showLoading(startGame)` plays a fake progress bar, then `startGame()` resets all state.
3. Waves 1–4: `createEnemies()` spawns a 3×8 grid. Clearing all enemies advances the wave.
4. Wave 5 clear → `enterBossArea()` → boss intro card → `startBossFight()` (starts a
   `setInterval` bass loop as boss music).
5. Boss **MERCURY** has 75 HP (`BOSS_MAX_HEALTH`). Enter/Space skip the intro card
   (`tryConfirmScreen`), same as clicking CONTINUE.
6. On defeat: `startBossDeath()` runs a ~175-frame sequence — chained surface blasts,
   then one big detonation at frame 126 that scatters debris — before `finishBossDeath()`
   grants `+1 HP`, sets `wave = 6` and opens `showVictory()`.

### Mercury's animation states

`drawMercury(t)` is driven by four frame counters, all reset by `resetBossAnimation()`:

| Counter | Effect |
| --- | --- |
| `bossChargeAnim` | Wind-up before a shot: inhale (squash), corona reddens, eyes swell, mouth puckers. |
| `bossShootAnim` | Recoil: stretch outward, mouth gapes, muzzle particles. |
| `bossHitFlash` | Damage: white flash, shake, eyes squint, rock chips fly back along the shot. |
| `bossDeathTimer` | Death: shake, glowing cracks, chained explosions, then fade at the final blast. |

`damageBoss(amount, fromX, fromY)` is the single entry point for hurting the boss — it
applies damage, triggers the flash/shake and spawns debris. `bossParticles` (pixel squares)
and `bossExplosions` (expanding rings) are the shared effect pools.

## Weapons and supers

Primary weapon (`selectedWeapon`):
- `blaster` — auto-fires on held arrow keys, `fireCooldown = 10`, 1 damage.
- `charge` — hold an arrow, release to fire. Damage `1–5` scaled by hold time (`/500ms`),
  projectile size `3–9`. Charge state lives in `chargeStartedAt` / `chargeDirection`.
- `cone` — three shots at ±0.16 rad, `fireCooldown = 18`.

Super (`selectedSuper`), fired by a **short** Space tap when `superMeter >= 1`:
- `bomb` — projectile with a 125px blast radius (15 damage to the boss).
- `invincibility` — 300 frames of `playerInvulnerable` + `invincibilitySuperTimer`.
- `void` — meant to pull enemies in; currently pushes a `superBombs` entry flagged
  `void: true` that **nothing reads**, so it behaves as a plain bomb. Costs 40 damage to
  charge instead of 20.

Meter math is in `updateSuperMeter()`: `(superDamage - lastSuperKills) / requiredDamage`,
where `requiredDamage` is 20 (40 for void). `setSelectedSuper()` refunds half on a mid-game swap.

## Input

- `WASD` — move (velocity smoothing toward `maxSpeed`, drag `0.88` when no input).
- Arrow keys — aim + shoot. `currentAimVector()` is the single source of truth: it reads the
  whole held-arrow vector (never per-axis, which used to leak a stale axis into diagonals) and
  falls back to `lastArrowDirection` when nothing is held. Firing happens only in `drawGame`
  off `fireCooldown`; arrow keydown just zeroes the cooldown, so a diagonal is one shot at 45°
  rather than one per axis. Movement input is normalized so diagonals aren't ~41% faster.
- `Space` **hold** (>180ms) — shrink to 0.55 scale: smaller hitbox, 1.4× speed, half damage.
- `Space` **tap** (≤180ms) — fire super. The hold/tap split is `spaceDownAt` vs `performance.now()`.
- `Esc` — pause.
- `blur` — clears all keys so the ship doesn't drift when the tab loses focus.

## Admin codes

Typed into the ADMIN CODE box on the menu (`admin-submit` handler):
- `PETROSADMIN` → `adminInvincible = true` (all damage checks are guarded by it).
- `TEST` → `testMode = true`, a practice room (`drawTestRoom`) with a static target and a
  damage readout. Both flags persist until reload; `startGame()` does not reset them.

## Known rough edges

- The `void` super is UI-only (see above).
- `playerName` is set to `"PLAYER"` in `startGame()` and never entered anywhere, though the
  boss intro and victory screens display it.
- `server.ps1` has a machine-specific hardcoded `$root` and no path-traversal guard — dev only.

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
- Audio is generated on the fly with the WebAudio API via `playSound(freq, duration, type)`;
  the `AudioContext` is created lazily on first START (browser autoplay policy) and every call
  no-ops if it is null.
- Collisions are cheap: axis-aligned `Math.abs` box checks for enemies/bullets,
  `Math.hypot` circles for the boss and blasts.
- **Nothing in the loop allocates.** Projectile lists are pruned with `compact(list, keep)`
  (in-place) rather than `list = list.filter(...)`; `facing`, `chargeDirection`,
  `lastArrowDirection` and `currentAimVector()`'s result are mutated, never replaced. Per-frame
  `filter`/object literals are the main source of GC pauses here.
- **Anything constant is built once**, not per frame: the boss arena grid is stroked into the
  `bossGridLayer` offscreen canvas on resize and blitted; Mercury's body/terminator/mouth
  gradients and the warp starfield's `rgba()` strings are cached; the corona gradient is
  rebuilt only when its radius or colour changes. Creating a gradient or setting a clip every
  frame is expensive — reach for a cache first.
- The canvas context is opaque (`alpha: false`) and always painted edge to edge; don't rely
  on transparency showing the page behind it.
- Colors are hardcoded hex literals per entity (player `playerColor`, enemies `#c77dff`,
  blaster `#ffdc5a`, cone `#63ff91`, charge `#ff8a32`, bombs `#63f7ff`).
- After editing `main.js`, bump the `?v=` in `index.html`'s script tag.
