// The dev server sends no cache headers, so a browser will happily keep an old
// `index.html` — and with it an old `?v=` — through an ordinary reload. Bumping
// the query string busts main.js but nothing busts the page that points at it.
// Stamping the build here makes "am I actually looking at my change?" a glance
// at the console instead of an afternoon.
console.log("Petros Space Adventure —", (document.currentScript && document.currentScript.src || "").split("/").pop() || "main.js");

const canvas = document.getElementById("space-bg");
// alpha:false lets the compositor skip blending the canvas against the page.
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

// Reused for the ship fill and its super-ready outline. Keeping this as one
// cached path also avoids rebuilding the same hull geometry every frame.
const PLAYER_HULL = new Path2D();
PLAYER_HULL.moveTo(0, -20);
PLAYER_HULL.lineTo(-18, 16);
PLAYER_HULL.lineTo(0, 9);
PLAYER_HULL.lineTo(18, 16);
PLAYER_HULL.closePath();

// W/H are always CSS pixels — every coordinate in this file is a CSS pixel, and
// nothing below needs to know about the render scale.
let W, H;
let centerX, centerY;

// ---------------------------------------------------------------------------
// Quality tiers
//
// What costs frame time here is not JavaScript, it is how many pixels get
// touched. A full-screen canvas on a 4K display is 8.3M pixels cleared, drawn
// and composited 60 times a second, and a weak integrated GPU cannot do that at
// any op count. So the canvas renders into a smaller backing store and the
// browser scales it up — the cheapest possible win, and on a pixel-art game it
// reads as intentional. `maxPixels` is the render budget for each tier.
// ---------------------------------------------------------------------------
const QUALITY_TIERS = [
  { name: "high",   maxPixels: 2073600, glow: true,  crt: true,  particles: 1,    stars: 1    },
  { name: "medium", maxPixels: 1310720, glow: true,  crt: true,  particles: 0.6,  stars: 0.6  },
  { name: "low",    maxPixels: 921600,  glow: false, crt: false, particles: 0.35, stars: 0.4  },
  { name: "potato", maxPixels: 480000,  glow: false, crt: false, particles: 0.15, stars: 0.2  },
];
let qualityIndex = 0;
let quality = QUALITY_TIERS[0];
let renderScale = 1;

// The boss arena grid is identical every frame, so it is stroked once into an
// offscreen layer (at device resolution) and blitted with a single drawImage
// instead of re-pathing ~100 lines per frame.
const bossGridLayer = document.createElement("canvas");
const bossGridCtx = bossGridLayer.getContext("2d");

let resizePending = false;

// Sizes the backing store to the tier's pixel budget while CSS keeps the canvas
// full-screen, then bakes the scale into the base transform so all the drawing
// code below can keep working in CSS pixels.
function applyRenderScale() {
  renderScale = Math.min(1, Math.sqrt(quality.maxPixels / Math.max(1, W * H)));
  renderScale = Math.max(0.25, renderScale);
  canvas.width = Math.max(1, Math.round(W * renderScale));
  canvas.height = Math.max(1, Math.round(H * renderScale));
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  ctx.setTransform(renderScale, 0, 0, renderScale, 0, 0);
  // nearest-neighbour is both the cheapest upscale filter and the right look
  ctx.imageSmoothingEnabled = false;
}

// Called from the init block at the bottom, once every declaration below exists.
function resize() {
  const previousW = W;
  const previousH = H;
  W = window.innerWidth;
  H = window.innerHeight;
  centerX = W / 2;
  centerY = H / 2;
  reflowGameForViewport(previousW, previousH);
  applyRenderScale();
  bossGridLayer.width = canvas.width;
  bossGridLayer.height = canvas.height;
  bakeBossGrid();
  // the backdrop is viewport-sized, so respread it to keep full coverage
  initStaticStars();
}
function scheduleResize() {
  // Each resize reallocates two canvas backing stores; coalesce a drag into one.
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(function () { resizePending = false; resize(); });
}
window.addEventListener("resize", scheduleResize);
window.addEventListener("orientationchange", scheduleResize);
if (window.visualViewport) window.visualViewport.addEventListener("resize", scheduleResize);

function setQuality(index) {
  const next = Math.max(0, Math.min(QUALITY_TIERS.length - 1, index));
  if (next === qualityIndex) return;
  qualityIndex = next;
  quality = QUALITY_TIERS[next];
  document.documentElement.dataset.quality = quality.name;
  venusAtmosphereW = 0;   // mote density follows the tier, so respread it
  resize();
}

// Baked in device pixels and blitted under the identity transform, so the grid
// costs one drawImage however big the window is.
function bakeBossGrid() {
  const step = 50 * renderScale;
  const gw = bossGridLayer.width;
  const gh = bossGridLayer.height;
  bossGridCtx.clearRect(0, 0, gw, gh);
  bossGridCtx.strokeStyle = "rgba(180, 80, 255, 0.16)";
  bossGridCtx.lineWidth = 1;
  bossGridCtx.beginPath();
  for (let x = 0; x < gw; x += step) { bossGridCtx.moveTo(x, 0); bossGridCtx.lineTo(x, gh); }
  for (let y = 0; y < gh; y += step) { bossGridCtx.moveTo(0, y); bossGridCtx.lineTo(gw, y); }
  bossGridCtx.stroke();
}

// ---------------------------------------------------------------------------
// Glow sprites
//
// `ctx.shadowBlur` is by far the most expensive call in the 2D API: it blurs the
// shape's bounding box in software, every shape, every frame. These bake the
// same look into a small radial-gradient bitmap once, so a glowing bullet costs
// one drawImage instead of a blur pass.
// ---------------------------------------------------------------------------
const glowSprites = new Map();

function rgbaFromHex(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function glowSprite(color, radius) {
  const key = color + "|" + radius;
  let sprite = glowSprites.get(key);
  if (sprite) return sprite;
  const size = Math.max(8, Math.ceil(radius * 4));
  sprite = document.createElement("canvas");
  sprite.width = size;
  sprite.height = size;
  const half = size / 2;
  const g = sprite.getContext("2d");
  const gradient = g.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, rgbaFromHex(color, 0.85));
  gradient.addColorStop(0.35, rgbaFromHex(color, 0.35));
  gradient.addColorStop(1, rgbaFromHex(color, 0));
  g.fillStyle = gradient;
  g.fillRect(0, 0, size, size);
  glowSprites.set(key, sprite);
  return sprite;
}

function drawGlow(color, radius, x, y) {
  if (!quality.glow) return;
  const sprite = glowSprite(color, radius);
  const half = sprite.width / 2;
  ctx.drawImage(sprite, x - half, y - half);
}

const STAR_COUNT = 260;
// backdrop star density, in stars per screen pixel — scaled to the viewport so
// the field fills the whole background instead of clustering in the middle
const STAR_DENSITY = 1 / 2400;
const MIN_BACKDROP_STARS = 260;
// A 4K viewport asked for ~3500 drifting stars, each one its own fillStyle write
// plus a fillRect. The field reads as full long before that, so cap the budget.
const MAX_BACKDROP_STARS = 1000;
const STAR_LAYERS = [
  { size: 1, speed: 0.05, alpha: 0.42 },
  { size: 2, speed: 0.12, alpha: 0.68 },
  { size: 3, speed: 0.24, alpha: 0.95 },
];
const STAR_TINTS = ["#ffffff", "#ffffff", "#cfe6ff", "#ffe9b0", "#ffc7e6", "#b9ffe8"];

// Every `rgba(...)` template literal is a string allocation plus a colour parse.
// The warp starfield spent 260 stars x 2 styles x 60fps on them, so bucket the
// alpha and build the strings once, up front.
const WARP_COLORS = ["255, 255, 255", "255, 220, 90", "190, 125, 255", "18, 18, 24"];
const DARK_STAR_INDEX = 3;
const ALPHA_STEPS = 32;
const warpColorCache = WARP_COLORS.map((color) =>
  Array.from({ length: ALPHA_STEPS + 1 }, (unused, i) => `rgba(${color}, ${(i / ALPHA_STEPS).toFixed(3)})`)
);
const darkStarStrokeCache = Array.from(
  { length: ALPHA_STEPS + 1 },
  (unused, i) => `rgba(95, 95, 110, ${(i / ALPHA_STEPS).toFixed(3)})`
);
function alphaBucket(alpha) {
  const index = (alpha * ALPHA_STEPS) | 0;
  return index < 0 ? 0 : index > ALPHA_STEPS ? ALPHA_STEPS : index;
}
function warpColor(colorIndex, alpha) {
  return warpColorCache[colorIndex][alphaBucket(alpha)];
}

let stars = [];
let staticStars = [];
let gameActive = false;
let gamePaused = false;
let gameOverShown = false;
// Which sky the run ended under, so the game-over screen can hold it. Set in
// endGame() before the boss flags are cleared, read only while gameOverShown.
let deathScene = "space";
// Set while a reward or victory card is up, so the paused canvas behind it keeps
// painting that chapter's sky instead of going black.
let celebrationScene = null;
// True while a boss's defeat card is up, so the canvas paints the real planet.
let defeatPortrait = false;
let retryBoss = null;
let retryWave = 1;
// Set only by the BUILDER console's `god` command. Every damage check in the
// file is guarded by it, so it stays a single flag rather than a set of them.
let devGodMode = false;
let bossMode = false;
let bossIntro = false;
let playerName = "PLAYER";
let playerColor = "#7ef9ff";
const GREY_SHIP_COLOR = "#b9b9c0";
// Same hex as the MAGMA weapon's projectiles, so beating Venus and equipping
// both reads as one matching molten loadout rather than two unrelated drops.
const MAGMA_SHIP_COLOR = "#ff5040";
// What to fall back to when a reward is un-equipped from the reward screen.
let rewardPreviousWeapon = "blaster";
let rewardPreviousColor = "#7ef9ff";
const WEAPON_COLORS = { blaster: "#ffdc5a", charge: "#ff8a32", cone: "#63ff91", tech0: "#63f7ff", magma: "#ff5040" };
// Magma tuning: a heavy molten slug that splashes. Slow in the air and no
// tracking, so it loses to the blaster on a lone dodging target — it wins on a
// formation, because every impact sprays droplets over the neighbours.
const MAGMA_CYCLE = 30;
const MAGMA_SHRUNK_CYCLE = 90;
const MAGMA_SPEED = 0.7;        // fraction of the standard 10px/frame round
const MAGMA_DAMAGE = 3;
const MAGMA_DROPS = 5;
const MAGMA_DROP_LIFE = 30;
const MAGMA_DROP_SPEED = 5;
const MAGMA_DROP_CAP = 24;      // droplets may overflow the normal bullet cap
// Tech.0 tuning in one place so waves, bosses and the test room agree. It is
// the crowd weapon: modest single-target damage, but the arc pays out against
// packed formations and Mercury's brood.
const TECH0_CYCLE = 40;
const TECH0_SHRUNK_CYCLE = 120;
const TECH0_HOPS = 5;
const TECH0_CHAIN_DAMAGE = 1;
const TECH0_CHAIN_RANGE = 260;
const TECH0_CHAIN_LIFE = 24;
const SUPER_COLORS = {
  bomb: "#4d9dff", invincibility: "#ffe36a", lance: "#9d7bff",
  star: "#ffd54a", mirror: "#8de8ff", drone: "#ff6f3c",
  decoy: "#5cf0a0", firstaid: "#ff5f7e", orb: "#ffab2e",
};
let selectedWeapon = "blaster";
let selectedSuper = "bomb";
// Everything below TECHNOLOGY is a boss reward. Which boss hands over which
// super is still undecided, so the value here is the chapter that grants it and
// `null` means "not assigned yet" — the lock panel says so rather than sending
// the player off to beat a fight that cannot award it. Fill a name in when a
// chapter claims one; nothing else has to change.
const LOCKED_SUPERS = {
  star: null, mirror: null, drone: null, decoy: null, firstaid: null, orb: null,
};
const SUPER_UNLOCK_KEY = "petros-space-adventure-supers";
let unlockedSupers = loadUnlockedSupers();

function loadUnlockedSupers() {
  try {
    const saved = JSON.parse(localStorage.getItem(SUPER_UNLOCK_KEY));
    return new Set(Array.isArray(saved) ? saved.filter((n) => n in LOCKED_SUPERS) : []);
  } catch (error) {
    return new Set();
  }
}

function persistUnlockedSupers() {
  try {
    localStorage.setItem(SUPER_UNLOCK_KEY, JSON.stringify(Array.from(unlockedSupers)));
  } catch (error) {
    // Private mode: the unlock still stands for this session.
  }
}

function superLocked(name) {
  return name in LOCKED_SUPERS && !unlockedSupers.has(name);
}

function unlockSuper(name) {
  if (!(name in LOCKED_SUPERS) || unlockedSupers.has(name)) return false;
  unlockedSupers.add(name);
  persistUnlockedSupers();
  syncSuperLockUI();
  return true;
}

function syncSuperLockUI() {
  document.querySelectorAll("[data-super-locked]").forEach((item) => {
    const locked = superLocked(item.dataset.super);
    item.classList.toggle("locked", locked);
    item.setAttribute("aria-disabled", String(locked));
  });
  // A super that was equipped before it was locked (or before this table
  // existed) would otherwise stay equipped and firing.
  if (superLocked(selectedSuper)) {
    selectedSuper = "bomb";
    refreshLoadoutUI();
    updateSuperMeter();
  }
}
let chargeStartedAt = 0;
let chargeDirection = { x: 0, y: -1 };
let lastArrowDirection = { x: 0, y: -1 };
let boss = { x: 0, y: 230, health: 75 };
let bossShotTimer = 64;
let bossDefeated = false;
let bossAttackTimer = 150;
let bossBullets = [];
let bossHitFlash = 0;
let bossShootAnim = 0;
let bossChargeAnim = 0;
let bossShakeTimer = 0;
let bossParticles = [];
let bossExplosions = [];
let bossDying = false;
let bossDeathTimer = 0;
let bossSpin = 0;
let bossShards = [];
let bossDamageStage = 0;
let bossBlink = 0;
let bossBlinkTimer = 200;
let bossDrift = 0;
let bossBurstTimer = 480;
// Which planet is in the arena. Everything shared between the two fights —
// health bar, debris, death sequence, bomb and beam damage — reads this rather
// than assuming Mercury.
let bossKind = "moon";
// Both fights run three phases, stepped at 2/3 and 1/3 health. The phase drives
// every timer in the fight, so "harder" is one number rather than a dozen
// scattered constants.
let bossPhase = 1;
let bossPhaseFlash = 0;
let bossMinions = [];

// --- THE MOON's own fight state -------------------------------------------
// Impacts are the spine of the fight, so they are a list rather than a timer:
// each entry is a strike that has been *called* and is still falling, which is
// what lets the arena be read a second and a half before it is dangerous.
let moonImpacts = [];
let moonImpactTimer = 150;
let moonPull = 0;          // frames of tidal pull left
let moonPullTimer = 620;
let moonEclipse = 0;       // frames of eclipse left
let moonEclipseTimer = 0;
let moonLit = 0.26;        // lit fraction, eased toward the phase target
let moonLibration = 0;
let moonSpiral = 0;        // eclipse spiral arm angle
let bossMinionTimer = 0;
let venusSpin = 0;
let venusVortexSpin = 0;
let venusAttack = "rest";
let venusAttackTimer = 0;
let venusStep = 0;
let venusRotation = 0;
let venusQueue = [];
let venusBolts = [];
let venusDive = null;
let venusBandPhase = 0;
let venusCells = [];
let score = 0;
let lives = 3;
let wave = 1;
let player = { x: 0, y: 0, vx: 0, vy: 0, speed: 0.23, maxSpeed: 5.5 };
let bullets = [];
let enemyBullets = [];
let enemies = [];
let fireCooldown = 0;
// Tracks whether Tech.0's ready ping has fired for the current cycle, so the
// long reload gets exactly one readable clock tick instead of a per-frame hum.
let tech0Primed = true;
let playerInvulnerable = 0;
let invincibilitySuperTimer = 0;
let screenShakeFrames = 0;
let screenShakeStrength = 0;
let enemyShotTimer = 60;
let kills = 0;
let superDamage = 0;
let superMeter = 0;
let lastSuperKills = 0;
let facing = { x: 0, y: -1 };
let superBombs = [];
let bombBlasts = [];
let superBeam = null;
let techChains = [];
let sparks = [];
// Which wingtip the blaster fires from next, flipped on every shot.
let blasterBarrel = 1;
const BLASTER_BARREL_OFFSET = 7;
// Muzzle flashes are declared with the other pools so `resize()` (which rescales
// every live pool) can reach them at load time.
const muzzleFlashes = [];
const MAX_MUZZLE_FLASHES = 12;
let audioContext = null;
let spaceDownAt = 0;
let suppressSpaceRelease = false;
const keys = {};
const touchCapable = navigator.maxTouchPoints > 0
  || window.matchMedia("(pointer: coarse)").matches;
const touchControls = {
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: -1,
  aimHeld: false,
  chargeActive: false,
  shrinkHeld: false,
  movePointer: null,
  aimPointer: null,
};
document.documentElement.classList.toggle("touch-capable", touchCapable);

const AUDIO_STORAGE_KEY = "petros-space-adventure-audio";
// Chapter 1's key. It was written when the first boss was Mercury; the old
// name is still read once so a player who beat it before the Moon existed keeps
// the Grey Ship and Tech.0 they already earned.
const MOON_UNLOCK_KEY = "petros-space-adventure-moon-rewards";
const LEGACY_MERCURY_UNLOCK_KEY = "petros-space-adventure-mercury-rewards";
const VENUS_UNLOCK_KEY = "petros-space-adventure-venus-rewards";
// The furthest wave ever *cleared*, which is what the LEVELS picker unlocks
// from. Reaching a wave is not beating it, so this is only ever written when a
// wave is actually finished — see `recordWaveCleared()`.
const PROGRESS_KEY = "petros-space-adventure-progress";
const audioSettings = loadAudioSettings();
let moonRewardsUnlocked = loadMoonRewards();
let venusRewardsUnlocked = loadVenusRewards();
let clearedWave = loadClearedWave();

function loadClearedWave() {
  try {
    const saved = Number(localStorage.getItem(PROGRESS_KEY));
    return Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 0;
  } catch (error) {
    return 0;
  }
}

// Called from every path that finishes a wave. Monotonic: dying on wave 8 never
// costs you the levels you already opened.
function recordWaveCleared(number) {
  if (!Number.isFinite(number) || number <= clearedWave) return;
  clearedWave = Math.floor(number);
  try {
    localStorage.setItem(PROGRESS_KEY, String(clearedWave));
  } catch (error) {
    // Private mode: the unlock still stands for this session.
  }
  if (dom.levelsPanel && dom.levelsPanel.classList.contains("visible")) showLevelPage(levelPageIndex);
}

function loadVenusRewards() {
  try {
    return localStorage.getItem(VENUS_UNLOCK_KEY) === "unlocked";
  } catch (error) {
    return false;
  }
}

function loadMoonRewards() {
  try {
    return localStorage.getItem(MOON_UNLOCK_KEY) === "unlocked"
      || localStorage.getItem(LEGACY_MERCURY_UNLOCK_KEY) === "unlocked";
  } catch (error) {
    return false;
  }
}

function loadAudioSettings() {
  const defaults = { music: 1, sfx: 0.9, muted: false };
  try {
    const saved = JSON.parse(localStorage.getItem(AUDIO_STORAGE_KEY));
    if (!saved || typeof saved !== "object") return defaults;
    const musicLevel = Number(saved.music);
    const sfxLevel = Number(saved.sfx);
    return {
      music: Number.isFinite(musicLevel) ? Math.max(0, Math.min(1, musicLevel)) : defaults.music,
      sfx: Number.isFinite(sfxLevel) ? Math.max(0, Math.min(1, sfxLevel)) : defaults.sfx,
      muted: Boolean(saved.muted),
    };
  } catch (error) {
    return defaults;
  }
}

const ARROW_VECTORS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// This script runs at the end of <body>, so every element already exists.
// Resolving them once removes thousands of getElementById calls per second.
const dom = {
  score: document.getElementById("score"),
  hearts: document.getElementById("lives-hearts"),
  waveNumber: document.getElementById("wave-number"),
  superMeter: document.querySelector(".super-meter"),
  waveBanner: document.getElementById("wave-banner"),
  waveBannerMain: document.getElementById("wave-banner-main"),
  waveBannerSub: document.getElementById("wave-banner-sub"),
  pauseScreen: document.getElementById("pause-screen"),
  gameMessage: document.getElementById("game-message"),
  superFill: document.getElementById("super-fill"),
  chargeMeter: document.getElementById("charge-meter"),
  chargeFill: document.getElementById("charge-fill"),
  bossFill: document.getElementById("boss-fill"),
  bossHealth: document.getElementById("boss-health"),
  damageFlash: document.getElementById("damage-flash"),
  menu: document.getElementById("menu-wrap"),
  controlsPanel: document.getElementById("controls-panel"),
  alphaPanel: document.getElementById("alpha-panel"),
  weaponsPanel: document.getElementById("weapons-panel"),
  thanksScreen: document.getElementById("thanks-screen"),
  levelsPanel: document.getElementById("levels-panel"),
  levelBook: document.getElementById("level-book"),
  levelDots: document.getElementById("level-dots"),
  moonLockPanel: document.getElementById("moon-lock-panel"),
  bossIntro: document.getElementById("boss-intro"),
  victoryScreen: document.getElementById("victory-screen"),
  moonDefeatScreen: document.getElementById("moon-defeat-screen"),
  gameUi: document.getElementById("game-ui"),
  mobileControls: document.getElementById("mobile-controls"),
  mobilePause: document.getElementById("mobile-pause-btn"),
  mobileSuper: document.getElementById("mobile-super-btn"),
  mobileShrink: document.getElementById("mobile-shrink-btn"),
};

// Touching the DOM is the loop's most expensive act: an assignment invalidates
// style even when the value is unchanged. These skip the writes that do nothing.
function setText(el, value) {
  if (el && el.lastText !== value) {
    el.lastText = value;
    el.textContent = value;
  }
}
function setWidth(el, percent) {
  const rounded = Math.round(percent * 10) / 10;
  if (el && el.lastWidth !== rounded) {
    el.lastWidth = rounded;
    el.style.width = rounded + "%";
  }
}

// `filter` allocates a fresh array every frame for every projectile list. This
// compacts the survivors in place and keeps the collector out of the loop.
function compact(list, keep) {
  let next = 0;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (keep(item)) list[next++] = item;
  }
  list.length = next;
}

// Touch controls occupy the lower edge of a phone or tablet. Keeping the ship
// just above that deck means it never disappears under the player's thumbs.
function mobileControlInset() {
  if (!touchCapable) return 28;
  if (H <= 520 && W > H) return 120;
  if (H <= 700) return 175;
  return 205;
}

function playableBottomY() {
  return Math.max(90, H - mobileControlInset());
}

function playerStartY() {
  return Math.max(62, playableBottomY() - (touchCapable ? 44 : 52));
}

function bossSpawnY() {
  if (touchCapable && H <= 520) return Math.max(98, Math.min(135, H * 0.3));
  return Math.max(215, Math.min(250, H * 0.35));
}

// Rotation and mobile browser chrome can change the viewport mid-wave. Reflow
// live actors instead of leaving them stranded outside the new canvas.
function reflowGameForViewport(previousW, previousH) {
  if (!gameActive || !previousW || !previousH || previousW === W && previousH === H) return;
  const scaleX = W / previousW;
  const scaleY = H / previousH;
  const scalePoint = (item) => {
    if (!item) return;
    if (Number.isFinite(item.x)) item.x *= scaleX;
    if (Number.isFinite(item.y)) item.y *= scaleY;
  };
  scalePoint(player);
  player.x = Math.max(24, Math.min(W - 24, player.x));
  player.y = Math.max(28, Math.min(playableBottomY(), player.y));
  for (const enemy of enemies) {
    scalePoint(enemy);
    if (Number.isFinite(enemy.homeX)) enemy.homeX *= scaleX;
    if (Number.isFinite(enemy.homeY)) enemy.homeY *= scaleY;
  }
  [bullets, enemyBullets, bossBullets, superBombs, bombBlasts, sparks, bossParticles, bossExplosions, muzzleFlashes]
    .forEach((items) => items.forEach(scalePoint));
  scalePoint(boss);
  if (bossMode || bossIntro) boss.y = bossSpawnY();
}

function resetTouchControls() {
  touchControls.moveX = 0;
  touchControls.moveY = 0;
  touchControls.aimX = 0;
  touchControls.aimY = -1;
  touchControls.aimHeld = false;
  touchControls.chargeActive = false;
  touchControls.shrinkHeld = false;
  touchControls.movePointer = null;
  touchControls.aimPointer = null;
  chargeStartedAt = 0;
  if (dom.mobileShrink) dom.mobileShrink.classList.remove("pressed");
  document.querySelectorAll("[data-touch-stick]").forEach((stick) => {
    stick.classList.remove("active");
    stick.style.setProperty("--stick-x", "0px");
    stick.style.setProperty("--stick-y", "0px");
  });
}

function syncMobileControls() {
  if (!touchCapable || !dom.mobileControls || !dom.mobilePause) return;
  const hidden = !gameActive || gamePaused || bossIntro || gameOverShown;
  dom.mobileControls.classList.toggle("touch-hidden", hidden);
  dom.mobilePause.classList.toggle("touch-hidden", hidden);
  dom.mobileControls.setAttribute("aria-hidden", String(hidden));
  dom.mobilePause.setAttribute("aria-hidden", String(hidden));
  if (hidden) resetTouchControls();
}

// Reused by currentAimVector() so the per-frame aim read allocates nothing.
const aimVector = { x: 0, y: 0, held: false };

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function isConfirmKey(code) {
  return code === "Enter" || code === "NumpadEnter" || code === "Space";
}

// Enter/Space are shortcuts for the CONTINUE button on the boss intro and the
// victory screen. Returns true when the key was consumed by one of them.
function tryConfirmScreen(code) {
  const bossIntroVisible = document.getElementById("boss-intro").classList.contains("visible");
  const victoryVisible = document.getElementById("victory-screen").classList.contains("visible");
  if (!bossIntroVisible && !victoryVisible) return false;
  if (code === "Space") suppressSpaceRelease = true;
  if (bossIntroVisible) startBossFight();
  else document.getElementById("victory-continue").click();
  return true;
}

// ---------------------------------------------------------------------------
// Keyboard menu navigation
//
// Directional focus is based on the controls' on-screen positions, so the same
// code works for vertical menus, the 3x2 loadout grids and the victory screen.
// Range inputs keep Left/Right for fine volume adjustment.
// ---------------------------------------------------------------------------
const MENU_FOCUS_SELECTOR = "button:not([disabled]), input:not([disabled])";

function isVisibleControl(element) {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

function activeMenuRoot() {
  const rewards = document.getElementById("reward-screen");
  if (rewards.classList.contains("visible")) return rewards;
  if (dom.moonLockPanel.classList.contains("visible")) return dom.moonLockPanel;
  if (dom.levelsPanel.classList.contains("visible")) return dom.levelsPanel;
  if (dom.weaponsPanel.classList.contains("visible")) return dom.weaponsPanel;
  if (dom.moonDefeatScreen.classList.contains("visible")) return dom.moonDefeatScreen;
  if (dom.thanksScreen.classList.contains("visible")) return dom.thanksScreen;
  if (dom.victoryScreen.classList.contains("visible")) return dom.victoryScreen;
  if (dom.bossIntro.classList.contains("visible")) return dom.bossIntro;
  if (dom.weaponsPanel.classList.contains("visible")) return dom.weaponsPanel;
  if (dom.controlsPanel.classList.contains("visible")) return dom.controlsPanel;
  if (dom.alphaPanel.classList.contains("visible")) return dom.alphaPanel;
  if (dom.pauseScreen.classList.contains("visible")) return dom.pauseScreen;
  if (gameOverShown && dom.gameUi.classList.contains("active")) return dom.gameUi;
  if (!dom.menu.classList.contains("hidden")) return dom.menu;
  return null;
}

function menuFocusables(root) {
  return Array.from(root.querySelectorAll(MENU_FOCUS_SELECTOR)).filter(isVisibleControl);
}

// Death screens deliberately do NOT take focus when they appear. The player has
// just died with a movement key held, so the browser's focus-visible heuristic
// treats a programmatic focus() as keyboard-driven and paints a highlight ring
// on TRY AGAIN that nobody asked for. Leaving focus alone means the ring shows
// only once the player actually reaches for the keyboard: `moveMenuFocus()`
// already adopts the default on the first arrow key, and `adoptMenuFocus()`
// below does the same for Enter and Space. Mouse users never see a ring.
function adoptMenuFocus(root) {
  if (!root) return false;
  if (root.contains(document.activeElement) && document.activeElement.matches(MENU_FOCUS_SELECTOR)) return false;
  focusMenuDefault(root);
  return true;
}

function focusMenuDefault(root) {
  if (!root) return;
  const preferred = root === dom.menu
    ? document.getElementById("start-btn")
    : root.querySelector(".selected, #resume-btn, #try-again-btn, #defeat-retry, #continue-boss, #victory-continue, #alpha-dismiss");
  const target = preferred && isVisibleControl(preferred) ? preferred : menuFocusables(root)[0];
  if (target) target.focus();
}

function closeMenuPanel(panel, trigger) {
  panel.classList.remove("visible");
  panel.setAttribute("aria-hidden", "true");
  if (trigger) trigger.focus();
}

let controlsReturnTarget = null;
let moonLockReturnTarget = null;
// Two ALPHA marks open the same card -- the chip on the title and the corner
// stamp -- so remember which one did it and hand focus back there on close.
let alphaReturnTarget = null;

function openAlphaPanel(trigger) {
  alphaReturnTarget = trigger;
  dom.alphaPanel.classList.add("visible");
  dom.alphaPanel.setAttribute("aria-hidden", "false");
  focusMenuDefault(dom.alphaPanel);
  // GOT IT is the default target, and focusing it scrolls a card that had to
  // become scrollable on a short screen straight past its own heading.
  const card = dom.alphaPanel.querySelector(".alpha-card");
  if (card) card.scrollTop = 0;
}

function openControlsPanel(trigger) {
  controlsReturnTarget = trigger;
  dom.controlsPanel.classList.add("visible");
  dom.controlsPanel.setAttribute("aria-hidden", "false");
  focusMenuDefault(dom.controlsPanel);
}

// Three reasons a reward can be locked now, so the message is looked up rather
// than picked by a boolean: the Moon can actually be beaten, Venus is still
// being built, and the supers below TECHNOLOGY have no chapter assigned yet.
// Add the fourth here, not as another ternary.
function lockReason(trigger) {
  if (!trigger || !trigger.matches) return "moon";
  if (trigger.matches("[data-super-locked]")) return "super";
  if (trigger.matches("[data-venus-locked]")) return "venus";
  return "moon";
}

const LOCK_MESSAGES = {
  moon: { title: "BEAT THE MOON", sub: "Defeat the Moon once to unlock<br />the Grey Ship and Tech.0." },
  venus: { title: "COMING SOON", sub: "Venus is still being built.<br />The Magma Ship and Magma arrive with it." },
  super: { title: "COMING SOON", sub: "Every super past TECHNOLOGY is a boss reward.<br />Which boss hands over which one is still being decided." },
};

function openLockPanel(trigger) {
  moonLockReturnTarget = trigger;
  const reason = lockReason(trigger);
  const message = LOCK_MESSAGES[reason];
  setText(document.getElementById("lock-title"), message.title);
  document.getElementById("lock-sub").innerHTML = message.sub;
  dom.moonLockPanel.querySelector(".unlock-card").classList.toggle("venus", reason !== "moon");
  dom.moonLockPanel.classList.add("visible");
  dom.moonLockPanel.setAttribute("aria-hidden", "false");
  focusMenuDefault(dom.moonLockPanel);
}

function setAudioDrawer(section, expanded) {
  const toggle = section && section.querySelector("[data-audio-toggle]");
  const drawer = section && section.querySelector(".audio-drawer");
  if (!toggle || !drawer) return;
  section.classList.toggle("expanded", expanded);
  toggle.setAttribute("aria-expanded", String(expanded));
  drawer.hidden = !expanded;
  syncAudioControls();
}

function collapseAudioDrawers(root) {
  if (!root) return;
  root.querySelectorAll(".audio-controls.expanded").forEach((section) => setAudioDrawer(section, false));
}

function setPrimaryGunsExpanded(expanded) {
  const toggle = document.getElementById("primary-more-toggle");
  const extra = document.getElementById("extra-primary-guns");
  if (!toggle || !extra) return;
  toggle.setAttribute("aria-expanded", String(expanded));
  extra.hidden = !expanded;
}

function moveMenuFocus(root, code) {
  const controls = menuFocusables(root);
  if (!controls.length) return;
  const active = document.activeElement;
  if (!controls.includes(active)) {
    focusMenuDefault(root);
    return;
  }

  const current = active.getBoundingClientRect();
  const cx = current.left + current.width / 2;
  const cy = current.top + current.height / 2;
  const horizontal = code === "ArrowLeft" || code === "ArrowRight";
  const sign = code === "ArrowLeft" || code === "ArrowUp" ? -1 : 1;
  let best = null;
  let bestScore = Infinity;

  for (const candidate of controls) {
    if (candidate === active) continue;
    const rect = candidate.getBoundingClientRect();
    const dx = rect.left + rect.width / 2 - cx;
    const dy = rect.top + rect.height / 2 - cy;
    const forward = (horizontal ? dx : dy) * sign;
    if (forward <= 2) continue;
    const cross = Math.abs(horizontal ? dy : dx);
    const score = forward + cross * 2.25;
    if (score < bestScore) { best = candidate; bestScore = score; }
  }

  // Wrap to the opposite edge when a row or column ends.
  if (!best) {
    for (const candidate of controls) {
      if (candidate === active) continue;
      const rect = candidate.getBoundingClientRect();
      const dx = rect.left + rect.width / 2 - cx;
      const dy = rect.top + rect.height / 2 - cy;
      const axis = horizontal ? dx : dy;
      const cross = Math.abs(horizontal ? dy : dx);
      const score = axis * sign + cross * 2.25;
      if (score < bestScore) { best = candidate; bestScore = score; }
    }
  }
  if (best) best.focus();
}

function handleMenuKeydown(event) {
  if (!creditsDone) {
    finishCredits();
    if (event.code.startsWith("Arrow") || event.code === "Escape") event.preventDefault();
    setTimeout(() => focusMenuDefault(dom.menu), 0);
    return true;
  }

  if (event.code === "Escape") {
    if (dom.moonLockPanel.classList.contains("visible")) {
      event.preventDefault();
      closeMenuPanel(dom.moonLockPanel, moonLockReturnTarget);
      return true;
    }
    if (dom.levelsPanel.classList.contains("visible")) {
      event.preventDefault();
      closeMenuPanel(dom.levelsPanel, levelsReturnTarget || document.getElementById("levels-btn"));
      return true;
    }
    if (dom.weaponsPanel.classList.contains("visible")) {
      event.preventDefault();
      closeMenuPanel(dom.weaponsPanel, weaponsReturnTarget || document.getElementById("weapons-btn"));
      return true;
    }
    if (dom.controlsPanel.classList.contains("visible")) {
      event.preventDefault();
      closeMenuPanel(dom.controlsPanel, controlsReturnTarget || document.getElementById("controls-btn"));
      return true;
    }
    if (dom.alphaPanel.classList.contains("visible")) {
      event.preventDefault();
      closeMenuPanel(dom.alphaPanel, alphaReturnTarget || document.getElementById("alpha-btn"));
      return true;
    }
    const root = activeMenuRoot();
    const openAudio = root && root.querySelector(".audio-controls.expanded");
    if (openAudio) {
      event.preventDefault();
      const toggle = openAudio.querySelector("[data-audio-toggle]");
      setAudioDrawer(openAudio, false);
      if (toggle) toggle.focus();
      return true;
    }
    if (dom.pauseScreen.classList.contains("visible")) {
      event.preventDefault();
      setPaused(false);
      return true;
    }
    if (root && !gameActive && document.activeElement !== document.body) {
      event.preventDefault();
      document.activeElement.blur();
      return true;
    }
    return false;
  }

  const root = activeMenuRoot();
  if (!root) return false;
  let active = document.activeElement;
  if (isConfirmKey(event.code)) {
    // First confirm key on a screen that never took focus: adopt the default and
    // stop there, so a mashed Space at the moment of death cannot restart the run.
    if (adoptMenuFocus(root)) {
      event.preventDefault();
      return true;
    }
    active = document.activeElement;
  }
  if (isConfirmKey(event.code) && root.contains(active) && active.matches("button, input")) {
    if (active.id === "admin-code" && event.code !== "Space") {
      event.preventDefault();
      document.getElementById("admin-submit").click();
    }
    return true;
  }
  if (!event.code.startsWith("Arrow")) return false;
  if (active.matches("input[type='range']") && (event.code === "ArrowLeft" || event.code === "ArrowRight")) return true;
  if (active.matches("input[type='text']") && (event.code === "ArrowLeft" || event.code === "ArrowRight")) return true;
  event.preventDefault();
  moveMenuFocus(root, event.code);
  return true;
}

function initStars() {
  stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const star = {};
    resetStarOutward(star);
    stars.push(star);
  }
}

function initStaticStars() {
  staticStars = [];
  const scaled = Math.round(W * H * STAR_DENSITY * quality.stars);
  const count = Math.min(MAX_BACKDROP_STARS, Math.max(60, Math.round(MIN_BACKDROP_STARS * quality.stars), scaled));
  for (let i = 0; i < count; i++) staticStars.push(makeBackdropStar(Math.random() * H));
  // Sorted by tint so the draw loop writes fillStyle six times per frame instead
  // of once per star. Stars are interchangeable, so the ordering costs nothing.
  staticStars.sort((a, b) => a.colorIndex - b.colorIndex);
}

function makeBackdropStar(y) {
  const layer = STAR_LAYERS[Math.floor(Math.random() * STAR_LAYERS.length)];
  return {
    x: Math.floor(Math.random() * W),
    y,
    size: layer.size,
    speed: layer.speed * rand(0.75, 1.3),
    alpha: layer.alpha * rand(0.6, 1),
    twinkle: rand(0.6, 2.4),
    phase: rand(0, Math.PI * 2),
    colorIndex: Math.floor(Math.random() * STAR_TINTS.length),
    sparkle: layer.size === 3 && Math.random() < 0.22,
  };
}

// Pixel-square stars drifting down the full viewport: retro, and edge to edge.
function drawStaticStars(t) {
  const wobble = t * 0.004;
  let tint = -1;
  for (let i = 0; i < staticStars.length; i++) {
    const star = staticStars[i];
    star.y += star.speed;
    if (star.y > H + 4) {
      star.y = -4;
      star.x = Math.floor(Math.random() * W);
    }
    if (star.colorIndex !== tint) {
      tint = star.colorIndex;
      ctx.fillStyle = STAR_TINTS[tint];
    }
    const twinkle = 0.55 + 0.45 * Math.sin(wobble * star.twinkle + star.phase);
    const alpha = Math.min(1, star.alpha * twinkle);
    ctx.globalAlpha = alpha;
    const x = Math.floor(star.x);
    const y = Math.floor(star.y);
    ctx.fillRect(x, y, star.size, star.size);
    if (star.sparkle) {
      ctx.globalAlpha = alpha * 0.5;
      ctx.fillRect(x - star.size, y + 1, star.size * 3, 1);
      ctx.fillRect(x + 1, y - star.size, 1, star.size * 3);
    }
  }
  ctx.globalAlpha = 1;
}

// Mirrors the arena the run ended in. Venus's sky redraws itself from wave and
// the boss flags, which endGame() leaves intact; everything in the Mercury
// chapter is the same star field the menu uses.
// The pre-fight card, drawn with the real assets: `drawPlayer()` and the boss's
// own `drawMoon()`/`drawVenus()`, scaled up on the same canvas the fight uses.
// A CSS mock-up of either one is a different ship and a different planet, and it
// shows — this is the actual art, at portrait size, with the DOM card supplying
// only the names and the button.
//
// Both are drawn by temporarily moving `player` and `boss` to their portrait
// marks and putting them back afterwards, so nothing outside this function ever
// sees the change.
let bossIntroFrame = 0;
let versusCardUp = false;

// Draws the boss exactly as the fight draws it, at a portrait mark and size, in
// its opening state: full health, phase 1, no damage or recoil animation left
// over from whatever was happening when this screen appeared. Every global it
// touches is put back, so this is safe to call from a paused frame.
function drawBossPortrait(x, y, scale, t) {
  const keep = {
    x: boss.x, y: boss.y, health: boss.health, phase: bossPhase, lit: moonLit,
    shake: bossShakeTimer, hit: bossHitFlash, charge: bossChargeAnim, shoot: bossShootAnim,
    eclipse: moonEclipse,
  };
  boss.x = x;
  boss.y = y;
  boss.health = bossMaxHealth();
  bossPhase = 1;
  moonLit = MOON_PHASE_LIGHT[0];
  bossShakeTimer = 0;
  bossHitFlash = 0;
  bossChargeAnim = 0;
  bossShootAnim = 0;
  moonEclipse = 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.translate(-x, -y);
  if (bossKind === "venus") drawVenus(t); else drawMoon(t);
  ctx.restore();
  boss.x = keep.x; boss.y = keep.y; boss.health = keep.health;
  bossPhase = keep.phase; moonLit = keep.lit; bossShakeTimer = keep.shake;
  bossHitFlash = keep.hit; bossChargeAnim = keep.charge; bossShootAnim = keep.shoot;
  moonEclipse = keep.eclipse;
}

function drawVersusStage(t) {
  bossIntroFrame++;
  const midX = W / 2;
  const y = H * 0.42;
  const moonScale = Math.max(1.3, Math.min(3, Math.min(W, H) / 400));
  const shipScale = moonScale * 1.55;
  const moonX = W * 0.71;
  const shipX = W * 0.27;
  // Both fighters slide in from their own edge over the first ~26 frames.
  const enter = Math.min(1, bossIntroFrame / 26);
  const ease = 1 - Math.pow(1 - enter, 3);
  const offset = (1 - ease) * W * 0.3;

  const keepBoss = { x: boss.x, y: boss.y };
  const keepPlayer = { x: player.x, y: player.y, shrunk: player.shrunk };
  const keepFacing = { x: facing.x, y: facing.y };

  // The boss, at its phase-1 look: full health, no damage state, and its face
  // tracking the ship it is about to fight rather than the ship's real position.
  player.x = shipX - offset;
  player.y = y;
  drawBossPortrait(moonX + offset, y, moonScale, t);

  // The ship, turned to face the boss.
  ctx.save();
  ctx.translate(shipX - offset, y);
  ctx.scale(shipScale, shipScale);
  ctx.translate(-(shipX - offset), -y);
  player.shrunk = false;
  facing.x = 1;
  facing.y = 0;
  drawPlayer();
  ctx.restore();

  boss.x = keepBoss.x; boss.y = keepBoss.y;
  player.x = keepPlayer.x; player.y = keepPlayer.y; player.shrunk = keepPlayer.shrunk;
  facing.x = keepFacing.x; facing.y = keepFacing.y;

  drawVersusTear(t, midX);
}

// The rip between them: a jagged seam that splits open down the middle, white
// hot at the core and bleeding red at the edges. The zigzag is a fixed pair of
// sines rather than random per frame, so it opens instead of flickering.
function drawVersusTear(t, midX) {
  const open = Math.max(0, Math.min(1, (bossIntroFrame - 14) / 30));
  if (open <= 0) return;
  // Pointed at both ends: a seam that runs off the top and bottom of the screen
  // reads as a red column, not as something torn open.
  const gap = 22 * open;
  const top = -20;
  const bottom = H + 20;
  const taper = (py) => Math.pow(Math.sin(Math.PI * Math.max(0, Math.min(1, (py - top) / (bottom - top)))), 0.65);
  const flicker = 0.86 + Math.sin(t * 0.02) * 0.14;
  const step = 24;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (let py = top; py <= bottom; py += step) {
    const x = midX + Math.sin(py * 0.055) * 13 + Math.sin(py * 0.019 + 1.7) * 8;
    if (py === top) ctx.moveTo(x - gap * taper(py), py); else ctx.lineTo(x - gap * taper(py), py);
  }
  for (let py = bottom; py >= top; py -= step) {
    const x = midX + Math.sin(py * 0.055) * 13 + Math.sin(py * 0.019 + 1.7) * 8;
    ctx.lineTo(x + gap * taper(py), py);
  }
  ctx.closePath();

  const glow = ctx.createLinearGradient(midX - gap * 2, 0, midX + gap * 2, 0);
  glow.addColorStop(0, "rgba(255, 42, 68, 0)");
  glow.addColorStop(0.3, "rgba(255, 42, 68, " + (0.42 * flicker).toFixed(3) + ")");
  glow.addColorStop(0.5, "rgba(255, 240, 236, " + (0.92 * flicker).toFixed(3) + ")");
  glow.addColorStop(0.7, "rgba(255, 42, 68, " + (0.42 * flicker).toFixed(3) + ")");
  glow.addColorStop(1, "rgba(255, 42, 68, 0)");
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 90, 110, " + (0.75 * flicker).toFixed(3) + ")";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Embers riding the seam, seeded off the frame so they crawl upward.
  ctx.fillStyle = "rgba(255, 220, 210, " + (0.8 * flicker).toFixed(3) + ")";
  for (let i = 0; i < 9; i++) {
    const py = (H + 60) * (((i * 0.137 + bossIntroFrame * 0.004) % 1)) - 30;
    const x = midX + Math.sin(py * 0.055) * 13 + Math.sin(py * 0.019 + 1.7) * 8;
    const side = i % 2 ? 1 : -1;
    ctx.fillRect(Math.round(x + side * gap * (0.5 + (i % 3) * 0.25)), Math.round(py), 3, 3);
  }
  ctx.restore();
}

function drawDeathBackdrop(t) {
  drawSceneBackdrop(deathScene, t);
}

// The reward and victory cards are moments in a place, not a cut away from it:
// Mercury's pay-off keeps the star field its whole chapter flew through, and
// Venus's keeps the furnace.
function drawSceneBackdrop(scene, t) {
  if (scene === "venus-sky") { drawVenusEnvironment(t); return; }
  if (scene === "venus-arena") {
    ctx.fillStyle = "#2a0d05";
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bossGridLayer, 0, 0);
    ctx.restore();
    return;
  }
  drawStaticStars(t);
}

// ---------------------------------------------------------------------------
// Hyperspace launch
//
// START does not fade into a fake progress bar any more — the ship jumps. Four
// beats on the same fixed 60Hz clock as everything else:
//
//   wind-up  the drive pulls space inwards, streaks fall toward a growing core
//   punch    the core detonates: white flash, shockwave rings, everything reverses
//   tunnel   full hyperspace, streaks stretched to lines, the field breathing
//   arrival  deceleration into a white flash that hands over to startGame()
//
// It reuses the `stars` pool rather than building a second one, so the whole
// transition allocates nothing: `primeWarpStars()` just rewrites the fields.
// ---------------------------------------------------------------------------
const WARP_CHARGE = 30;
const WARP_PUNCH = 6;
const WARP_TUNNEL = 54;
const WARP_ARRIVE = 18;
const WARP_PUNCH_AT = WARP_CHARGE;
const WARP_TUNNEL_AT = WARP_CHARGE + WARP_PUNCH;
const WARP_ARRIVE_AT = WARP_TUNNEL_AT + WARP_TUNNEL;
const WARP_TOTAL = WARP_ARRIVE_AT + WARP_ARRIVE;
// White, warm and violet — plus one slot rewritten to the ship's own colour at
// launch, so the jump is lit by the hull you picked.
const warpStreakColors = ["#ffffff", "#ffd8a0", "#c88bff", "#ffffff"];
let warpLaunch = null;
let warpFlash = 0;
// The jump's light is ONE radial gradient, built per launch and reused for both
// the core and the tunnel haze (scaled around the centre for the core). It used
// to go through drawGlow(), which bakes an offscreen canvas per colour+radius:
// the tunnel's radius alone asked for a ~2700px sprite mid-sequence, which is a
// guaranteed hitch on the very frame the warp is supposed to peak.
let warpHaze = null;
let warpHazeR = 0;
let warpHazeW = 0;
let warpHazeH = 0;

function buildWarpHaze() {
  const cx = W / 2;
  const cy = H / 2;
  warpHazeR = Math.max(80, Math.round(Math.hypot(W, H) * 0.5));
  warpHazeW = W;
  warpHazeH = H;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, warpHazeR);
  gradient.addColorStop(0, rgbaFromHex(playerColor, 0.6));
  gradient.addColorStop(0.22, rgbaFromHex(playerColor, 0.26));
  gradient.addColorStop(0.6, rgbaFromHex(playerColor, 0.07));
  gradient.addColorStop(1, rgbaFromHex(playerColor, 0));
  warpHaze = gradient;
}

// scale 1 covers the whole viewport; anything smaller is the core.
function paintWarpHaze(alpha, scale) {
  if (warpHazeW !== W || warpHazeH !== H) buildWarpHaze();
  const cx = W / 2;
  const cy = H / 2;
  ctx.save();
  if (scale !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = warpHaze;
  ctx.fillRect(cx - warpHazeR, cy - warpHazeR, warpHazeR * 2, warpHazeR * 2);
  ctx.restore();
  ctx.globalAlpha = 1;
}

function primeWarpStars() {
  const reach = Math.hypot(W, H) * 0.5;
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i];
    const angle = rand(0, Math.PI * 2);
    s.wcos = Math.cos(angle);
    s.wsin = Math.sin(angle);
    s.wd = rand(30, reach);
    s.ws = rand(0.55, 1.5);
    s.wc = i & 3;
    s.ww = rand(0.8, 2.3);
  }
  warpStreakColors[3] = playerColor;
}

function beginWarpLaunch(callback) {
  if (warpLaunch) return;
  ensureAudio();
  if (audioContext && audioContext.state === "suspended") audioContext.resume();
  primeWarpStars();
  buildWarpHaze();
  warpFlash = 0;
  warpLaunch = { frame: 0, callback };
  dom.menu.classList.add("launching");
  // display:none the moment the card's own animation ends, so a full-screen DOM
  // layer is not still being composited over the tunnel.
  setTimeout(() => dom.menu.classList.add("hidden"), 460);
  // playSound is one fixed pitch per call, so the drive's rising whine is eight
  // of them stacked up the scale rather than a single ramp.
  for (let i = 0; i < 8; i++) {
    setTimeout(() => playSound(150 + i * 165, 0.2, "sawtooth"), i * 72);
  }
}

function warpSpeedAt(f) {
  if (f <= WARP_PUNCH_AT) {
    // Wind-up: space is pulled *in*, harder every frame.
    const k = f / WARP_CHARGE;
    return -(0.8 + k * k * 5.5);
  }
  if (f <= WARP_TUNNEL_AT) return 4 + (f - WARP_PUNCH_AT) * 5.5;
  if (f <= WARP_ARRIVE_AT) {
    const k = (f - WARP_TUNNEL_AT) / WARP_TUNNEL;
    // Held near the top, breathing, easing off toward the exit.
    return 30 - k * 7 + Math.sin(k * 17) * 1.8;
  }
  const k = (f - WARP_ARRIVE_AT) / WARP_ARRIVE;
  return 23 * (1 - k) * (1 - k);
}

function drawWarpLaunch(t) {
  const f = ++warpLaunch.frame;
  const cx = W / 2;
  const cy = H / 2;
  const reach = Math.hypot(W, H) * 0.5 + 60;
  const speed = warpSpeedAt(f);
  const charging = f <= WARP_PUNCH_AT;
  const chargeK = charging ? f / WARP_CHARGE : 1;

  if (f === WARP_PUNCH_AT + 1) {
    warpFlash = 0.85;
    music.stop();
    playSound(55, 0.7, "sawtooth");
    playSound(120, 0.45, "triangle");
    playSound(1400, 0.25, "square");
  }

  // The cabinet shakes hardest while the drive is winding up.
  const shake = charging ? chargeK * chargeK * 7 : Math.max(0, 5 - (f - WARP_PUNCH_AT) * 0.4);
  ctx.save();
  if (shake > 0.2) ctx.translate(Math.sin(f * 1.9) * shake, Math.cos(f * 2.3) * shake * 0.7);

  ctx.lineCap = "round";
  const fade = charging ? 0.35 + chargeK * 0.65 : 1;
  // Grouped by colour so the whole field is four strokeStyle writes, not 260.
  for (let c = 0; c < warpStreakColors.length; c++) {
    ctx.strokeStyle = warpStreakColors[c];
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      if (s.wc !== c) continue;
      const prev = s.wd;
      if (speed < 0) s.wd += speed * s.ws * 1.9;
      else s.wd = s.wd * (1 + 0.014 * speed) + speed * s.ws * 0.9;
      const x1 = cx + s.wcos * prev;
      const y1 = cy + s.wsin * prev;
      const x2 = cx + s.wcos * s.wd;
      const y2 = cy + s.wsin * s.wd;
      // Streaks thicken and brighten as they come at you; distance does the
      // perspective, so nothing needs a separate depth term.
      const near = Math.min(1, s.wd / reach);
      ctx.globalAlpha = Math.min(1, (0.25 + near * 0.9) * fade);
      ctx.lineWidth = Math.max(0.6, s.ww * (0.4 + near * 1.5));
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      // Recycled at whichever end it left through: outward past the corner, or
      // inward into the drive.
      if (s.wd > reach) {
        const angle = rand(0, Math.PI * 2);
        s.wcos = Math.cos(angle);
        s.wsin = Math.sin(angle);
        s.wd = rand(4, 40);
      } else if (s.wd < 6) {
        const angle = rand(0, Math.PI * 2);
        s.wcos = Math.cos(angle);
        s.wsin = Math.sin(angle);
        s.wd = reach * rand(0.75, 1);
      }
    }
  }
  ctx.globalAlpha = 1;

  // The jump point: a core that swells through the wind-up and blows out.
  if (charging) {
    const coreR = 3 + chargeK * chargeK * 34;
    paintWarpHaze(0.35 + chargeK * 0.5, Math.max(0.05, coreR * 3 / warpHazeR));
    ctx.globalAlpha = 0.35 + chargeK * 0.65;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cy, coreR * (0.45 + Math.sin(f * 0.5) * 0.05), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Three shockwave rings chasing each other out of the punch.
  if (f > WARP_PUNCH_AT && f < WARP_PUNCH_AT + 46) {
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      const age = f - WARP_PUNCH_AT - i * 7;
      if (age <= 0) continue;
      const alpha = 0.6 - age * 0.022;
      if (alpha <= 0) continue;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = i === 1 ? playerColor : "#ffffff";
      ctx.beginPath();
      ctx.arc(cx, cy, age * 30, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Tunnel walls: the theme colour bleeding in from the edges of the screen.
  if (f > WARP_TUNNEL_AT) {
    const bleed = 0.1 + Math.sin(f * 0.22) * 0.03;
    ctx.globalAlpha = bleed;
    ctx.fillStyle = playerColor;
    ctx.fillRect(0, 0, W, 3);
    ctx.fillRect(0, H - 3, W, 3);
    ctx.globalAlpha = 1;
    paintWarpHaze(0.5, 1);
  }
  ctx.restore();

  if (f >= WARP_TOTAL) {
    const callback = warpLaunch.callback;
    warpLaunch = null;
    // Arrive through white: the flash outlives the sequence by a few frames and
    // is painted over the first frames of the wave itself.
    warpFlash = 1;
    dom.menu.classList.remove("launching");
    callback();
  }
}

function resetStarOutward(s) {
  const angle = rand(0, Math.PI * 2);
  s.spawnDistance = rand(8, 60);
  s.x = Math.cos(angle) * s.spawnDistance;
  s.y = Math.sin(angle) * s.spawnDistance;
  s.depth = rand(0.03, 0.3);
  s.speed = rand(0.009, 0.017);
  s.brightness = rand(0.7, 1);
  s.twinkle = rand(0.5, 2);
  s.phase = rand(0, Math.PI * 2);
  s.size = rand(0.45, 1.15);
  s.colorIndex = Math.floor(Math.random() * WARP_COLORS.length);
}

function drawStars(t) {
  for (const s of stars) {
    const previousX = centerX + s.x * s.depth;
    const previousY = centerY + s.y * s.depth;

    const twinkle = 0.55 + 0.45 * Math.sin(t * 0.005 * s.twinkle + s.phase);
    s.depth += s.speed;

    const x = centerX + s.x * s.depth;
    const y = centerY + s.y * s.depth;
    const radius = Math.max(0.55, s.size * s.depth * 2.2);
    const alpha = Math.min(1, s.brightness * twinkle * (0.2 + s.depth * 1.1));

    ctx.strokeStyle = warpColor(s.colorIndex, alpha * 0.28);
    ctx.lineWidth = Math.max(0.4, radius * 0.6);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(previousX, previousY);
    ctx.lineTo(x, y);
    ctx.stroke();

    const isDarkStar = s.colorIndex === DARK_STAR_INDEX;
    ctx.fillStyle = warpColor(s.colorIndex, alpha);
    if (isDarkStar) {
      ctx.strokeStyle = darkStarStrokeCache[alphaBucket(alpha * 0.45)];
      ctx.lineWidth = 0.45;
    }
    ctx.beginPath();
    ctx.moveTo(x, y - radius * 2.4);
    ctx.lineTo(x + radius * 0.65, y - radius * 0.65);
    ctx.lineTo(x + radius * 2.4, y);
    ctx.lineTo(x + radius * 0.65, y + radius * 0.65);
    ctx.lineTo(x, y + radius * 2.4);
    ctx.lineTo(x - radius * 0.65, y + radius * 0.65);
    ctx.lineTo(x - radius * 2.4, y);
    ctx.lineTo(x - radius * 0.65, y - radius * 0.65);
    ctx.closePath();
    ctx.fill();
    if (isDarkStar) ctx.stroke();

    if (s.depth > 1.12 || x < -radius || x > W + radius || y < -radius || y > H + radius) {
      resetStarOutward(s);
    }
  }
}

const STEP_MS = 1000 / 60;
// 1 unless the BUILDER console changes it. Scaling the accumulator rather than
// STEP_MS keeps every frame-count timer in the file meaning the same thing;
// the game still runs whole 1/60s ticks, just more or fewer of them per second.
let devTimeScale = 1;
const MAX_CATCHUP_STEPS = 2;
let lastFrameTime = 0;
let stepAccumulator = 0;

// Every timer in this game is counted in frames, so the logic has to tick at a
// fixed 60Hz: driven straight off rAF it ran ~2.4x too fast on a 144Hz display
// and crawled on a slow one. When the display outruns 60Hz the spare callbacks
// return before clearing, so the canvas simply keeps the frame it already has.
// --- adaptive quality -------------------------------------------------------
// A fixed set of effects can't suit both a gaming desktop and a school laptop,
// so the game measures how long its own frame actually takes and steps the tier
// down when it can't keep up. It only climbs back if it never had to drop:
// otherwise a machine sitting near the threshold would oscillate, and a visible
// quality flicker is worse than simply staying on the cheaper tier.
const FRAME_BUDGET_MS = 9;
const FRAME_COMFORT_MS = 3.5;
const QUALITY_WINDOW = 150;
let frameCostAvg = 0;
let qualitySamples = 0;
let qualityDropped = false;
let qualityPinned = false;

function sampleFrameCost(ms) {
  if (qualityPinned) return;
  // exponential moving average, so one slow frame can't retune the whole game
  frameCostAvg = frameCostAvg === 0 ? ms : frameCostAvg + (ms - frameCostAvg) * 0.05;
  if (++qualitySamples < QUALITY_WINDOW) return;
  qualitySamples = 0;
  if (frameCostAvg > FRAME_BUDGET_MS && qualityIndex < QUALITY_TIERS.length - 1) {
    qualityDropped = true;
    setQuality(qualityIndex + 1);
    frameCostAvg = 0;
  } else if (!qualityDropped && frameCostAvg < FRAME_COMFORT_MS && qualityIndex > 0) {
    setQuality(qualityIndex - 1);
    frameCostAvg = 0;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  if (!lastFrameTime) lastFrameTime = now;
  // Clamped so a backgrounded tab doesn't come back and replay a minute of ticks.
  stepAccumulator += Math.min(now - lastFrameTime, STEP_MS * MAX_CATCHUP_STEPS) * devTimeScale;
  lastFrameTime = now;
  if (stepAccumulator < STEP_MS) return;
  let steps = 0;
  while (stepAccumulator >= STEP_MS && steps < MAX_CATCHUP_STEPS) {
    stepAccumulator -= STEP_MS;
    steps++;
  }
  const startedAt = performance.now();
  for (let i = 0; i < steps; i++) draw(now);
  sampleFrameCost((performance.now() - startedAt) / steps);
}

function draw(t) {
  if (builder.isOpen()) builder.paintWatches();
  // drawBossArea fills every pixel itself, so clearing to black first is a
  // second full-screen fill for nothing — the priciest kind of no-op.
  const arenaRepaints = gameActive && !gamePaused && !bossIntro && bossMode;
  if (!arenaRepaints) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);
  } else if (screenShakeFrames > 0) {
    // Prepaint the arena colour so a translated hit frame never exposes stale
    // pixels along the viewport edge.
    ctx.fillStyle = bossMode ? (bossKind === "venus" ? "#2a0d05" : "#000000") : "#07131a";
    ctx.fillRect(0, 0, W, H);
  }
  centerX = W / 2;
  centerY = H / 2;
  if (warpLaunch) { drawWarpLaunch(t); drawWarpFlash(); return; }
  if (celebrationScene) drawSceneBackdrop(celebrationScene, t);
  // `bossIntro` is also raised by the victory and reward beats to freeze the
  // world, so the stage keys off the card actually being on screen — otherwise
  // the ship, the planet and the tear paint straight through those screens.
  if (gameActive && versusCardUp && !bossMode) drawVersusStage(t);
  // Dying does not change where you are: the game-over screen holds the sky of
  // the level that killed you instead of cutting to the menu's field.
  if (!gameActive) {
    if (gameOverShown) drawDeathBackdrop(t);
    else drawStaticStars(t);
    // A boss defeat card gets the boss itself, drawn the way the fight draws it,
    // rather than a CSS lookalike that is a different planet.
    if (defeatPortrait) drawBossPortrait(W / 2, H * 0.27, Math.max(1, Math.min(2.1, Math.min(W, H) / 520)), t);
    // The LEVELS previews ride the same rAF rather than opening a loop of their
    // own, and only while the panel is actually on screen.
    if (dom.levelsPanel.classList.contains("visible")) paintLevelPreviews(t);
  }
  // The regular star field remains; no oversized warp sparkles behind GAME OVER.
  if (gameActive && !gamePaused) {
    if (screenShakeFrames > 0) {
      // Two decaying sine waves feel forceful without the noisy, strobing look
      // of choosing a new random offset every frame. HUD stays fixed and legible.
      const progress = screenShakeFrames / 14;
      const power = screenShakeStrength * progress * progress;
      const shakeX = Math.sin(t * 0.073) * power;
      const shakeY = Math.cos(t * 0.097) * power * 0.62;
      ctx.save();
      ctx.translate(shakeX, shakeY);
      drawGame(t);
      ctx.restore();
      screenShakeFrames--;
    } else {
      drawGame(t);
    }
  }
  drawWarpFlash();
  updateChargeMeter();
  setText(dom.waveNumber, String(wave));
}

// Painted last, over whatever else the frame drew, so the arrival flash can
// wash out the first frames of the wave it just dropped you into.
function drawWarpFlash() {
  if (warpFlash <= 0.02) { warpFlash = 0; return; }
  ctx.globalAlpha = Math.min(1, warpFlash);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  warpFlash *= 0.82;
}

// Waves after Mercury enter Venus's dense upper atmosphere.
//
// The old backdrop was five fat bezier strokes over a flat fill, which read as
// stripes rather than as weather. This is a proper sky: a cached vertical
// gradient, a sulfur sun burning through the haze, four filled cloud decks that
// scroll at different speeds with lit rims, ash and embers rising through them,
// and the occasional sheet of cloud-to-cloud lightning. Everything constant is
// built once — the gradient, the sun's corona and the mote field are only
// rebuilt when the viewport height changes.
// ---------------------------------------------------------------------------
const VENUS_SKY_STOPS = [
  [0, "#120302"], [0.24, "#2b0a06"], [0.5, "#4e1a08"],
  [0.74, "#7d3510"], [0.9, "#a1521a"], [1, "#bd7126"],
];
// height / offset / drift speed / wave amplitude / body / lit rim
const VENUS_DECKS = [
  { y: 0.10, h: 0.26, speed: 0.000040, amp: 30, wave: 0.0032, body: "#3b1308", rim: "#8d3d14", alpha: 0.8 },
  { y: 0.30, h: 0.24, speed: 0.000068, amp: 24, wave: 0.0045, body: "#54200b", rim: "#b55a1d", alpha: 0.76 },
  { y: 0.52, h: 0.22, speed: 0.000105, amp: 19, wave: 0.0061, body: "#6d2e0d", rim: "#dd8a2e", alpha: 0.72 },
  { y: 0.74, h: 0.30, speed: 0.000155, amp: 14, wave: 0.0083, body: "#8a4412", rim: "#ffc061", alpha: 0.66 },
];
const VENUS_DECK_STEP = 90;        // px between sampled points along a deck edge
const VENUS_MOTE_CAP = 190;
const venusMotes = [];
let venusSkyGradient = null;
let venusSunGradient = null;
let venusAtmosphereH = 0;
let venusAtmosphereW = 0;
let venusFlash = 0;
let venusFlashTimer = 170;
let venusFlashX = 0;

function buildVenusAtmosphere() {
  venusSkyGradient = ctx.createLinearGradient(0, 0, 0, H);
  for (const [stop, color] of VENUS_SKY_STOPS) venusSkyGradient.addColorStop(stop, color);
  const sunR = Math.max(W, H) * 0.42;
  venusSunGradient = ctx.createRadialGradient(W * 0.72, H * 0.14, 0, W * 0.72, H * 0.14, sunR);
  venusSunGradient.addColorStop(0, "rgba(255, 233, 176, 0.55)");
  venusSunGradient.addColorStop(0.16, "rgba(255, 175, 74, 0.32)");
  venusSunGradient.addColorStop(0.45, "rgba(198, 84, 22, 0.16)");
  venusSunGradient.addColorStop(1, "rgba(120, 40, 10, 0)");
  venusMotes.length = 0;
  const count = Math.min(VENUS_MOTE_CAP, Math.round(W * H / 12000 * quality.stars));
  for (let i = 0; i < count; i++) {
    venusMotes.push({
      x: rand(0, W), y: rand(0, H),
      rise: rand(0.25, 1.1), sway: rand(0.2, 0.9), phase: rand(0, Math.PI * 2),
      size: Math.random() < 0.18 ? 3 : Math.random() < 0.5 ? 2 : 1,
      ember: Math.random() < 0.34,
    });
  }
  venusAtmosphereH = H;
  venusAtmosphereW = W;
}

// One deck: a filled band whose top edge is a running sum of two sines, with a
// hot rim stroked along that same edge so the cloud looks lit from above.
function drawVenusDeck(deck, t) {
  const drift = t * deck.speed * W;
  const top = H * deck.y;
  const bottom = top + H * deck.h;
  ctx.beginPath();
  ctx.moveTo(-40, bottom + 20);
  for (let x = -40; x <= W + 40; x += VENUS_DECK_STEP) {
    const s = (x + drift) * deck.wave;
    ctx.lineTo(x, top + Math.sin(s) * deck.amp + Math.sin(s * 0.41 + 1.7) * deck.amp * 0.55);
  }
  ctx.lineTo(W + 40, bottom + 20);
  ctx.closePath();
  ctx.globalAlpha = deck.alpha;
  ctx.fillStyle = deck.body;
  ctx.fill();
  ctx.globalAlpha = deck.alpha * 0.85;
  ctx.strokeStyle = deck.rim;
  ctx.lineWidth = 3;
  ctx.stroke();
  // Lit swells rolling through the deck. Two per band is enough to break the
  // flat fill up; they are the only expensive thing here, so the cheap tiers
  // (which also drop the glow sprites) skip them.
  if (!quality.glow) return;
  ctx.globalAlpha = deck.alpha * 0.16;
  ctx.fillStyle = deck.rim;
  for (let i = 0; i < 2; i++) {
    const wx = ((drift * 1.3 + i * W * 0.57) % (W + 340)) - 170;
    const wy = top + H * deck.h * (0.34 + i * 0.26);
    ctx.beginPath();
    ctx.ellipse(wx, wy, W * 0.13, H * deck.h * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawVenusEnvironment(t) {
  if (wave < 6 || bossMode) return;
  if (venusAtmosphereH !== H || venusAtmosphereW !== W) buildVenusAtmosphere();

  ctx.fillStyle = venusSkyGradient;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = venusSunGradient;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Cloud-to-cloud lightning. Rare, short, and it lights the whole deck for a
  // couple of frames — the flash is what sells the pressure of the place.
  if (--venusFlashTimer <= 0) {
    venusFlash = 9;
    venusFlashX = rand(W * 0.12, W * 0.88);
    venusFlashTimer = Math.round(rand(150, 420));
    // The sky keeps flashing behind GAME OVER; the thunder would not read as
    // ambience there, just as a stray hit.
    if (gameActive) playSound(48, 0.34, "sawtooth");
  }

  ctx.save();
  ctx.lineJoin = "round";
  for (const deck of VENUS_DECKS) drawVenusDeck(deck, t);
  ctx.globalAlpha = 1;
  ctx.restore();

  if (venusFlash > 0) {
    const fade = venusFlash / 9;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.16 * fade;
    ctx.fillStyle = "#ffd9a0";
    ctx.fillRect(0, 0, W, H * 0.72);
    ctx.globalAlpha = 0.85 * fade;
    ctx.strokeStyle = "#fff2cf";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    let bx = venusFlashX;
    ctx.moveTo(bx, H * 0.08);
    for (let y = H * 0.08; y < H * 0.55; y += H * 0.09) {
      bx += rand(-34, 34);
      ctx.lineTo(bx, y + H * 0.09);
    }
    ctx.stroke();
    ctx.restore();
    venusFlash--;
  }

  // Ash and embers climbing the thermals. Embers are additive so they glow
  // against the deck they are passing in front of; ash just drifts.
  if (quality.particles >= 0.35) {
    ctx.save();
    let lastColor = "";
    for (const mote of venusMotes) {
      mote.phase += 0.02;
      mote.y -= mote.rise;
      mote.x += Math.sin(mote.phase) * mote.sway * 0.5;
      if (mote.y < -6) { mote.y = H + rand(0, 40); mote.x = rand(0, W); }
      if (mote.x < -6) mote.x = W + 4; else if (mote.x > W + 6) mote.x = -4;
      const color = mote.ember ? "#ffc46a" : "#7d4426";
      if (color !== lastColor) { lastColor = color; ctx.fillStyle = color; }
      ctx.globalAlpha = mote.ember ? 0.85 : 0.5;
      ctx.fillRect(Math.round(mote.x), Math.round(mote.y), mote.size, mote.size);
    }
    ctx.restore();
  }

  // Heat shimmer: thin bright lanes sliding under the decks.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "#ffbb63";
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const y = (i + 1) * H / 7 + Math.sin(t * 0.0016 + i * 1.3) * 10;
    ctx.globalAlpha = 0.06 + Math.abs(Math.sin(t * 0.0009 + i)) * 0.07;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(W * 0.3, y + Math.sin(t * 0.0011 + i) * 16, W * 0.7, y - Math.sin(t * 0.0013 + i) * 16, W, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Enemies
//
// Five kinds, split across the Mercury and Venus chapters:
//   grunt   — holds formation, fires the slow homing shot
//   charger — winds up, then relentlessly homes into the player until destroyed
//   turret  — armoured, never moves, fires a wide non-homing spread
//   skimmer — Venus lane-flier that spits wobbling sulfur acid
//   bloom   — Venus radial heat-burst emplacement
// Chargers and turrets are what close the old "stand in this corner and never
// get hit" gap: one comes to you, the other fills space you aren't standing in.
// ---------------------------------------------------------------------------
const ENEMY_TYPES = {
  grunt:   { w: 22, h: 16, health: 1, score: 100, color: "#c77dff" },
  charger: { w: 20, h: 20, health: 2, score: 175, color: "#ff7a4f" },
  turret:  { w: 26, h: 22, health: 3, score: 250, color: "#5ad1c0" },
  skimmer: { w: 24, h: 17, health: 2, score: 225, color: "#d8d94f" },
  bloom:   { w: 27, h: 25, health: 4, score: 350, color: "#ff8a3d" },
};

function makeEnemy(type, x, y, phase) {
  const spec = ENEMY_TYPES[type];
  return {
    type,
    x, y,
    homeX: x,
    homeY: y,
    w: spec.w,
    h: spec.h,
    alive: true,
    health: spec.health,
    maxHealth: spec.health,
    phase,
    hitFlash: 0,
    state: "idle",
    timer: Math.round(rand(90, 260)),
    vx: 0,
    vy: 0,
    aimX: 0,
    aimY: 1,
    spin: rand(0, Math.PI * 2),
    // evasion state, only ever used by the Venus skimmers
    dodgeX: 0,
    dodgeY: 0,
    dodgeVX: 0,
    dodgeVY: 0,
    dodgeCool: 0,
  };
}

// Per-wave roster. Mercury's forces occupy 1–5; Venus formations begin at 6.
// How hard the Venus chapter is leaning on the player right now: 0 on the first
// Venus wave, 1 by wave 9, and it keeps climbing a little into the post-game
// waves. Timers, shot speeds, seed fuses and whether the skimmers dodge at all
// are all read off this one number so the chapter escalates as one thing.
function venusPressure() {
  if (wave < 6) return 0;
  return Math.min(1.5, (wave - 6) / 3);
}

function waveRoster(number) {
  if (number === 1) return { rows: 3, cols: 8, chargers: 0, turrets: 0 };
  if (number === 2) return { rows: 2, cols: 8, chargers: 2, turrets: 0 };
  if (number === 3) return { rows: 2, cols: 8, chargers: 1, turrets: 2 };
  if (number === 4) return { rows: 2, cols: 7, chargers: 3, turrets: 2 };
  if (number === 5) return { rows: 3, cols: 8, chargers: 3, turrets: 2 };
  if (number === 6) return { rows: 0, cols: 0, chargers: 0, turrets: 0, skimmers: 8, blooms: 1 };
  if (number === 7) return { rows: 0, cols: 0, chargers: 0, turrets: 0, skimmers: 10, blooms: 2 };
  if (number === 8) return { rows: 0, cols: 0, chargers: 0, turrets: 0, skimmers: 12, blooms: 2 };
  if (number === 9) return { rows: 0, cols: 0, chargers: 0, turrets: 0, skimmers: 14, blooms: 3 };
  const past = number - 5;
  return {
    rows: 0,
    cols: 0,
    chargers: 0,
    turrets: 0,
    skimmers: Math.min(16, 12 + past),
    blooms: Math.min(4, 2 + Math.floor(past / 2)),
  };
}

const WAVE_INTROS = {
  2: "CHARGERS INBOUND",
  3: "TURRETS DEPLOYED",
  4: "MIXED ASSAULT",
  5: "FINAL WAVE BEFORE THE MOON",
  6: "ENTERING VENUS AIRSPACE",
  7: "ACID SKIMMERS INBOUND",
  8: "FURNACE BLOOMS OPENING",
  9: "SULFUR STORM RISING",
  10: "VENUS AWAITS",
  11: "PAST THE FURNACE",
};

function createEnemies() {
  enemies = [];
  const roster = waveRoster(wave);
  const spacing = Math.min(80, (W - 64) / Math.max(1, roster.cols - 1));
  const rowWidth = spacing * (roster.cols - 1);
  for (let row = 0; row < roster.rows; row++) {
    for (let col = 0; col < roster.cols; col++) {
      enemies.push(makeEnemy("grunt", W / 2 - rowWidth / 2 + col * spacing, 120 + row * 62, col * 0.4 + row));
    }
  }
  for (let i = 0; i < roster.turrets; i++) {
    const spread = roster.turrets === 1 ? 0 : (i / (roster.turrets - 1) - 0.5) * 2;
    enemies.push(makeEnemy("turret", W / 2 + spread * Math.min(360, W * 0.34), 84, i * 1.3));
  }
  for (let i = 0; i < roster.chargers; i++) {
    const spread = roster.chargers === 1 ? 0 : (i / (roster.chargers - 1) - 0.5) * 2;
    enemies.push(makeEnemy("charger", W / 2 + spread * Math.min(300, W * 0.3), 120 + roster.rows * 62 + 10, i * 0.9));
  }
  const mobileColumns = Math.max(3, Math.floor((W - 50) / 92));
  const skimmerCount = Math.min(roster.skimmers || 0, mobileColumns * Math.max(1, Math.floor((playerStartY() - 145) / 84)));
  const skimmerCols = Math.min(7, skimmerCount, Math.max(3, Math.floor((W - 50) / 92)));
  const skimmerSpacing = Math.min(128, (W - 80) / Math.max(1, skimmerCols - 1));
  for (let i = 0; i < skimmerCount; i++) {
    const row = Math.floor(i / skimmerCols);
    const col = i % skimmerCols;
    const inRow = Math.min(skimmerCols, skimmerCount - row * skimmerCols);
    const rowWidth = skimmerSpacing * Math.max(0, inRow - 1);
    enemies.push(makeEnemy("skimmer", W / 2 - rowWidth / 2 + col * skimmerSpacing, 150 + row * 84, i * 0.73));
  }
  const bloomCount = roster.blooms || 0;
  for (let i = 0; i < bloomCount; i++) {
    const spread = bloomCount === 1 ? 0 : (i / (bloomCount - 1) - 0.5) * 2;
    enemies.push(makeEnemy("bloom", W / 2 + spread * Math.min(330, W * 0.34), 78, i * 1.9));
  }
}

// ---------------------------------------------------------------------------
// Sparks
//
// A single pooled particle list shared by every arena — thruster trails, charge
// flames, enemy debris, beam scatter. Squares, because they cost one fillRect
// and read as pixels.
// ---------------------------------------------------------------------------
const MAX_SPARKS = 260;

function spawnSparks(x, y, count, color, options) {
  const opts = options || {};
  const budget = Math.max(1, Math.round(count * quality.particles));
  for (let i = 0; i < budget && sparks.length < MAX_SPARKS; i++) {
    const angle = opts.angle === undefined ? rand(0, Math.PI * 2) : opts.angle + rand(-(opts.spread || 0.6), opts.spread || 0.6);
    const speed = rand(opts.minSpeed || 0.4, opts.maxSpeed || 2.6);
    const life = Math.round(rand((opts.life || 24) * 0.55, opts.life || 24));
    sparks.push({
      x: x + rand(-3, 3),
      y: y + rand(-3, 3),
      vx: Math.cos(angle) * speed + (opts.driftX || 0),
      vy: Math.sin(angle) * speed + (opts.driftY || 0),
      life,
      maxLife: life,
      size: Math.round(rand(opts.minSize || 1, opts.maxSize || 3)),
      color,
      drag: opts.drag === undefined ? 0.94 : opts.drag,
      gravity: opts.gravity || 0,
    });
  }
}

function updateSparks() {
  let lastColor = "";
  for (const s of sparks) {
    s.x += s.vx;
    s.y += s.vy;
    s.vx *= s.drag;
    s.vy = s.vy * s.drag + s.gravity;
    s.life--;
    ctx.globalAlpha = Math.max(0, s.life / s.maxLife);
    if (s.color !== lastColor) { lastColor = s.color; ctx.fillStyle = s.color; }
    ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
  }
  ctx.globalAlpha = 1;
  compact(sparks, (s) => s.life > 0);
}

// ---------------------------------------------------------------------------
// Bomb detonations persist after the projectile is consumed. Layered rings,
// energy spokes, a hot core and debris make the super read like a real blast
// without changing its damage radius.
// ---------------------------------------------------------------------------
function startBombBlast(x, y, radius, color = superColor("bomb")) {
  const rays = [];
  for (let i = 0; i < 14; i++) {
    rays.push({ angle: rand(0, Math.PI * 2), reach: rand(0.72, 1.08), width: rand(1.5, 4) });
  }
  bombBlasts.push({ x, y, radius, color, life: 30, maxLife: 30, rays });
  spawnSparks(x, y, 28, color, { minSpeed: 2, maxSpeed: 9, life: 34, minSize: 2, maxSize: 5, drag: 0.95 });
  spawnSparks(x, y, 18, "#a8dcff", { minSpeed: 1, maxSpeed: 7, life: 26, minSize: 2, maxSize: 4 });
  spawnSparks(x, y, 10, "#ffffff", { minSpeed: 1, maxSpeed: 5, life: 18, minSize: 1, maxSize: 3 });
  screenShakeFrames = Math.max(screenShakeFrames, 12);
  screenShakeStrength = Math.max(screenShakeStrength, 6);
  playSound(90, 0.42, "sawtooth");
  playSound(230, 0.18, "square");
}

function updateBombBlasts() {
  for (const blast of bombBlasts) {
    const progress = 1 - blast.life / blast.maxLife;
    const fade = Math.max(0, 1 - progress);
    const eased = 1 - Math.pow(1 - progress, 3);
    const radius = blast.radius * eased;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.55 * fade;
    drawGlow(blast.color, 48, blast.x, blast.y);
    ctx.fillStyle = blast.color;
    ctx.globalAlpha = 0.16 * fade;
    ctx.beginPath(); ctx.arc(blast.x, blast.y, radius * 0.72, 0, Math.PI * 2); ctx.fill();
    for (const ray of blast.rays) {
      const inner = radius * 0.2;
      const outer = radius * ray.reach;
      ctx.globalAlpha = 0.5 * fade;
      ctx.strokeStyle = progress < 0.35 ? "#ffffff" : blast.color;
      ctx.lineWidth = ray.width * fade;
      ctx.beginPath();
      ctx.moveTo(blast.x + Math.cos(ray.angle) * inner, blast.y + Math.sin(ray.angle) * inner);
      ctx.lineTo(blast.x + Math.cos(ray.angle) * outer, blast.y + Math.sin(ray.angle) * outer);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.95 * fade;
    ctx.strokeStyle = blast.color;
    ctx.lineWidth = Math.max(2, 8 * fade);
    ctx.beginPath(); ctx.arc(blast.x, blast.y, radius, 0, Math.PI * 2); ctx.stroke();
    if (progress > 0.12) {
      const secondRadius = blast.radius * Math.min(1, (progress - 0.12) * 1.35);
      ctx.globalAlpha = 0.72 * fade;
      ctx.strokeStyle = "#c4e6ff";
      ctx.lineWidth = Math.max(1, 4 * fade);
      ctx.beginPath(); ctx.arc(blast.x, blast.y, secondRadius, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(blast.x, blast.y, Math.max(0, 18 * (1 - progress * 1.5)), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    blast.life--;
  }
  compact(bombBlasts, (blast) => blast.life > 0);
}

// ---------------------------------------------------------------------------
// TECHNOLOGY — a piercing beam locked to the direction it was fired
//
// A beam locked to the direction you fired it, anchored to the ship so it sweeps
// as you move. It pierces everything, which is what the other two supers don't
// do: BOMB is a point blast, SHIELD is defensive, TECHNOLOGY is a line.
// ---------------------------------------------------------------------------
const BEAM_FRAMES = 52;
const BEAM_HALF_WIDTH = 17;
const BEAM_TICK = 8;

function fireLance() {
  superBeam = { angle: Math.atan2(facing.y, facing.x), life: BEAM_FRAMES, color: superColor("lance") };
  playSound(1200, 0.25, "sawtooth");
  playSound(300, 0.5, "square");
  spawnSparks(player.x, player.y, 26, superBeam.color, {
    angle: superBeam.angle, spread: 0.5, minSpeed: 2, maxSpeed: 7, life: 26, maxSize: 4,
  });
}

// Perpendicular distance from the beam's centre line, or Infinity behind the ship.
function beamDistance(px, py) {
  const dx = px - player.x;
  const dy = py - player.y;
  const cos = Math.cos(superBeam.angle);
  const sin = Math.sin(superBeam.angle);
  if (dx * cos + dy * sin < 0) return Infinity;
  return Math.abs(-dx * sin + dy * cos);
}

function damageAlongBeam(enemy, ey) {
  if (superBeam.life % BEAM_TICK !== 0) return;
  if (beamDistance(enemy.x, ey) < BEAM_HALF_WIDTH + enemy.w * 0.6) {
    damageEnemy(enemy, 2);
    spawnSparks(enemy.x, ey, 5, superBeam.color, { life: 16 });
  }
}

function updateSuperBeam(t) {
  if (!superBeam) return;
  const color = superBeam.color || superColor("lance");
  const progress = 1 - superBeam.life / BEAM_FRAMES;
  // snaps open, holds, then collapses
  const width = progress < 0.12
    ? (progress / 0.12) * BEAM_HALF_WIDTH
    : BEAM_HALF_WIDTH * (1 - Math.max(0, (progress - 0.7) / 0.3));
  const length = W + H;
  const flicker = 0.85 + Math.sin(t * 0.08) * 0.15;

  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(superBeam.angle);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.22 * flicker;
  ctx.fillStyle = color;
  ctx.fillRect(0, -width * 2.1, length, width * 4.2);
  ctx.globalAlpha = 0.5 * flicker;
  ctx.fillRect(0, -width, length, width * 2);
  ctx.globalAlpha = flicker;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, -width * 0.42, length, width * 0.84);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();

  drawGlow(color, 30, player.x, player.y);
  if (superBeam.life % 3 === 0) {
    spawnSparks(player.x, player.y, 2, color, {
      angle: superBeam.angle, spread: 1.1, minSpeed: 1, maxSpeed: 4, life: 18,
    });
  }
  superBeam.life--;
  if (superBeam.life <= 0) superBeam = null;
}

// ---------------------------------------------------------------------------
// Charge weapon: segmented energy arcs tighten around the ship as power builds.
// At full charge they ignite into a fast orbit while the hull vibrates.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// SUPERS FROM THE DESIGN SHEET
//
// Six new supers, straight off Petros's page: STAR, MIRROR, DRONE, DECOY,
// FIRST-AID and RADIANT ORB. Every one of them is an *arena-agnostic* entity —
// it has to behave the same in a wave, in a boss fight and in the test room,
// and those are three separate update loops that know nothing about each other.
//
// Rather than write each super three times, everything hostile is described
// through one adapter: `collectSuperTargets()` fills a reused array of
// {x, y, r, ref, kind} and `hurtSuperTarget()` routes damage back to whichever
// system owns it. The slots are pooled objects, so a super sweeping a full
// formation still allocates nothing per frame.
// ---------------------------------------------------------------------------
let superStar = null;
let mirrorTimer = 0;
let superDrone = null;
let decoy = null;
let radiantOrb = null;
let healPulse = 0;

const SUPER_TARGETS = [];
let superTargetCount = 0;

function pushSuperTarget(x, y, r, ref, kind) {
  let slot = SUPER_TARGETS[superTargetCount];
  if (!slot) SUPER_TARGETS[superTargetCount] = slot = { x: 0, y: 0, r: 0, ref: null, kind: "" };
  slot.x = x; slot.y = y; slot.r = r; slot.ref = ref; slot.kind = kind;
  superTargetCount++;
}

function collectSuperTargets() {
  superTargetCount = 0;
  if (bossMode) {
    if (!bossDying) pushSuperTarget(boss.x, boss.y, bossRadius(), null, "boss");
    for (const m of bossMinions) if (m.health > 0) pushSuperTarget(m.x, m.y, 13, m, "minion");
  } else {
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const ey = enemy.renderY === undefined ? enemy.y : enemy.renderY;
      pushSuperTarget(enemy.x, ey, Math.max(enemy.w, enemy.h), enemy, "enemy");
    }
  }
  return superTargetCount;
}

function hurtSuperTarget(slot, amount, fromX, fromY) {
  if (slot.kind === "enemy") {
    if (slot.ref.alive) damageEnemy(slot.ref, amount);
  } else if (slot.kind === "minion") {
    slot.ref.health -= amount;
    slot.ref.hitFlash = 6;
    superDamage += amount;
    updateSuperMeter();
  } else if (slot.kind === "boss") {
    if (bossDying) return;
    damageBoss(amount, fromX, fromY);
    superDamage += amount;
    updateSuperMeter();
  }
}

// Outright removal, for the two supers whose sheet entry says the target is
// simply gone: the drone's detonation and anything that walks into the orb.
function vaporizeSuperTarget(slot, bossDamage) {
  if (slot.kind === "enemy") {
    if (slot.ref.alive) damageEnemy(slot.ref, slot.ref.health);
  } else if (slot.kind === "minion") {
    slot.ref.health = 0;
  } else {
    hurtSuperTarget(slot, bossDamage, slot.x, slot.y);
  }
}

// DECOY changes who the arena is shooting at, so every hostile aim goes through
// these two instead of reading `player` directly.
function aimTargetX() { return decoy ? decoy.x : player.x; }
function aimTargetY() { return decoy ? decoy.y : player.y; }

// ---------------------------------------------------------------------------
// STAR — "a big star that ricochets around the whole map lasting 3.5 seconds"
// ---------------------------------------------------------------------------
const STAR_FRAMES = 360;   // 6 seconds
const STAR_SPEED = 9.5;
const STAR_RADIUS = 24;
const STAR_DAMAGE = 3;
const STAR_HIT_COOLDOWN = 7;

function fireSuperStar() {
  superStar = {
    x: player.x, y: player.y,
    vx: facing.x * STAR_SPEED, vy: facing.y * STAR_SPEED,
    life: STAR_FRAMES, spin: 0, cool: 0,
  };
  playSound(760, 0.18, "triangle");
  playSound(1180, 0.12, "square");
}

function bounceStar(star) {
  screenShakeFrames = Math.max(screenShakeFrames, 4);
  screenShakeStrength = Math.max(screenShakeStrength, 3);
  spawnSparks(star.x, star.y, 8, SUPER_COLORS.star, { minSpeed: 1, maxSpeed: 4, life: 20 });
  playSound(980, 0.06, "square");
}

function updateSuperStar() {
  const star = superStar;
  star.life--;
  star.spin += 0.21;
  star.x += star.vx;
  star.y += star.vy;
  if (star.x < STAR_RADIUS && star.vx < 0) { star.x = STAR_RADIUS; star.vx = -star.vx; bounceStar(star); }
  if (star.x > W - STAR_RADIUS && star.vx > 0) { star.x = W - STAR_RADIUS; star.vx = -star.vx; bounceStar(star); }
  if (star.y < STAR_RADIUS + 20 && star.vy < 0) { star.y = STAR_RADIUS + 20; star.vy = -star.vy; bounceStar(star); }
  if (star.y > H - STAR_RADIUS && star.vy > 0) { star.y = H - STAR_RADIUS; star.vy = -star.vy; bounceStar(star); }
  if (star.cool > 0) star.cool--;

  const count = collectSuperTargets();
  for (let i = 0; i < count && star.cool === 0; i++) {
    const slot = SUPER_TARGETS[i];
    if (Math.hypot(slot.x - star.x, slot.y - star.y) > STAR_RADIUS + slot.r) continue;
    hurtSuperTarget(slot, STAR_DAMAGE, star.x, star.y);
    star.cool = STAR_HIT_COOLDOWN;
    spawnSparks(star.x, star.y, 10, SUPER_COLORS.star, { minSpeed: 1, maxSpeed: 5, life: 22 });
    playSound(620, 0.07, "square");
  }

  spawnSparks(star.x - star.vx, star.y - star.vy, 2, Math.random() < 0.4 ? "#ffffff" : SUPER_COLORS.star,
    { minSpeed: 0.2, maxSpeed: 1.4, life: 22, maxSize: 3 });
  drawSuperStar(star);
  if (star.life <= 0) {
    spawnSparks(star.x, star.y, 22, SUPER_COLORS.star, { minSpeed: 1, maxSpeed: 6, life: 28 });
    superStar = null;
  }
}

function starPath(outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const r = i % 2 ? inner : outer;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

function drawSuperStar(star) {
  const fade = star.life < 26 ? star.life / 26 : 1;
  const pulse = 1 + Math.sin(star.spin * 2) * 0.07;
  ctx.save();
  ctx.translate(star.x, star.y);
  ctx.globalAlpha = fade;
  drawGlow(SUPER_COLORS.star, 46, 0, 0);
  ctx.rotate(star.spin);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = "#7a4a05";
  starPath(STAR_RADIUS + 3, (STAR_RADIUS + 3) * 0.44);
  ctx.fill();
  ctx.fillStyle = SUPER_COLORS.star;
  starPath(STAR_RADIUS, STAR_RADIUS * 0.44);
  ctx.fill();
  ctx.fillStyle = "#fff6cf";
  starPath(STAR_RADIUS * 0.62, STAR_RADIUS * 0.26);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(0, 0, STAR_RADIUS * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// MIRROR — "enemy projectiles now bounce off the player and home into other
// enemies for 5 seconds"
//
// The reflect is a hard swap: the hostile round is consumed at the shield's
// edge and a player-owned one is born in its place, already steering at the
// nearest target. That is also what makes MIRROR defensive — anything it
// catches never reaches the hull.
// ---------------------------------------------------------------------------
const MIRROR_FRAMES = 300;
const MIRROR_RADIUS = 48;
const MIRROR_DAMAGE = 2;
const MIRROR_SPEED = 9;
const MIRROR_TURN = 0.11;

function activateMirror() {
  mirrorTimer = MIRROR_FRAMES;
  playSound(1320, 0.2, "triangle");
  playSound(660, 0.3, "sine");
}

// Called from every hostile-projectile loop. Returns true when the round was
// taken, and the caller is then responsible for retiring it.
function tryMirrorReflect(bx, by, radius) {
  if (mirrorTimer <= 0) return false;
  const dx = bx - player.x;
  const dy = by - player.y;
  const reach = MIRROR_RADIUS + (radius || 6);
  if (dx * dx + dy * dy > reach * reach) return false;
  const count = collectSuperTargets();
  let bestX = 0, bestY = 0, bestDistance = Infinity;
  for (let i = 0; i < count; i++) {
    const slot = SUPER_TARGETS[i];
    const distance = Math.hypot(slot.x - bx, slot.y - by);
    if (distance < bestDistance) { bestDistance = distance; bestX = slot.x; bestY = slot.y; }
  }
  let angle;
  if (bestDistance < Infinity) {
    angle = Math.atan2(bestY - by, bestX - bx);
  } else {
    const length = Math.hypot(dx, dy) || 1;
    angle = Math.atan2(dy / length, dx / length);
  }
  bullets.push({
    x: bx, y: by,
    vx: Math.cos(angle) * MIRROR_SPEED, vy: Math.sin(angle) * MIRROR_SPEED,
    damage: MIRROR_DAMAGE, type: "mirror", size: 5, pierceRemaining: 1,
    color: SUPER_COLORS.mirror, mirror: true,
  });
  spawnSparks(bx, by, 9, SUPER_COLORS.mirror, { minSpeed: 1, maxSpeed: 4, life: 18 });
  playSound(1500, 0.05, "square");
  return true;
}

// Reflected rounds keep tracking. This runs from `drawPlayerBullet`, which is
// the one place every arena's bullet loop already funnels through.
function steerMirrorBullet(bullet) {
  const count = collectSuperTargets();
  if (!count) return;
  let bestX = 0, bestY = 0, bestDistance = Infinity;
  for (let i = 0; i < count; i++) {
    const slot = SUPER_TARGETS[i];
    const distance = Math.hypot(slot.x - bullet.x, slot.y - bullet.y);
    if (distance < bestDistance) { bestDistance = distance; bestX = slot.x; bestY = slot.y; }
  }
  const current = Math.atan2(bullet.vy, bullet.vx);
  let diff = Math.atan2(bestY - bullet.y, bestX - bullet.x) - current;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const next = current + Math.max(-MIRROR_TURN, Math.min(MIRROR_TURN, diff));
  bullet.vx = Math.cos(next) * MIRROR_SPEED;
  bullet.vy = Math.sin(next) * MIRROR_SPEED;
}

function drawMirrorShield(t) {
  const fade = mirrorTimer < 40 ? mirrorTimer / 40 : 1;
  const spin = t * 0.0016;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.5 * fade;
  drawGlow(SUPER_COLORS.mirror, 60, 0, 0);
  for (let ring = 0; ring < 2; ring++) {
    const r = MIRROR_RADIUS - ring * 9;
    ctx.save();
    ctx.rotate(spin * (ring ? -1.5 : 1));
    ctx.globalAlpha = (ring ? 0.5 : 0.85) * fade;
    ctx.strokeStyle = ring ? "#ffffff" : SUPER_COLORS.mirror;
    ctx.lineWidth = ring ? 1.5 : 3;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.stroke();
    // mirrored facets: a bright chord across every other edge
    ctx.globalAlpha = 0.2 * fade;
    ctx.fillStyle = SUPER_COLORS.mirror;
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// DRONE — "goes straight forward, but the arrow keys redirect it; on impact it
// explodes for massive damage and the arrow keys go back to shooting"
// ---------------------------------------------------------------------------
const DRONE_FRAMES = 330;
const DRONE_SPEED = 6.4;
const DRONE_TURN = 0.09;
const DRONE_RADIUS = 15;
const DRONE_BLAST = 190;
const DRONE_BOSS_DAMAGE = 30;

function launchDrone() {
  superDrone = {
    x: player.x + facing.x * 26, y: player.y + facing.y * 26,
    vx: facing.x * DRONE_SPEED, vy: facing.y * DRONE_SPEED,
    life: DRONE_FRAMES, spin: 0, blink: 0,
  };
  chargeStartedAt = 0;   // the arrow keys belong to the drone now
  playSound(420, 0.14, "square");
  playSound(210, 0.22, "sawtooth");
}

function updateDrone() {
  const drone = superDrone;
  drone.life--;
  drone.spin += 0.3;
  drone.blink++;
  const aim = currentAimVector();
  if (aim.held) {
    const current = Math.atan2(drone.vy, drone.vx);
    let diff = Math.atan2(aim.y, aim.x) - current;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const next = current + Math.max(-DRONE_TURN, Math.min(DRONE_TURN, diff));
    drone.vx = Math.cos(next) * DRONE_SPEED;
    drone.vy = Math.sin(next) * DRONE_SPEED;
  }
  drone.x += drone.vx;
  drone.y += drone.vy;
  spawnSparks(drone.x - drone.vx * 1.6, drone.y - drone.vy * 1.6, 2,
    Math.random() < 0.5 ? "#ffd9a0" : SUPER_COLORS.drone,
    { minSpeed: 0.2, maxSpeed: 1.3, life: 20, maxSize: 3 });
  drawDrone(drone);

  const count = collectSuperTargets();
  for (let i = 0; i < count; i++) {
    const slot = SUPER_TARGETS[i];
    if (Math.hypot(slot.x - drone.x, slot.y - drone.y) < DRONE_RADIUS + slot.r) { detonateDrone(); return; }
  }
  if (drone.life <= 0 || drone.x < 6 || drone.x > W - 6 || drone.y < 6 || drone.y > H - 6) detonateDrone();
}

function detonateDrone() {
  const drone = superDrone;
  superDrone = null;
  if (!drone) return;
  startBombBlast(drone.x, drone.y, DRONE_BLAST, SUPER_COLORS.drone);
  if (bossMode) bossExplosions.push({ x: drone.x, y: drone.y, r: 0, max: 150, life: 22, maxLife: 22 });
  screenShakeFrames = Math.max(screenShakeFrames, 18);
  screenShakeStrength = Math.max(screenShakeStrength, 9);
  const count = collectSuperTargets();
  for (let i = 0; i < count; i++) {
    const slot = SUPER_TARGETS[i];
    if (Math.hypot(slot.x - drone.x, slot.y - drone.y) > DRONE_BLAST + slot.r) continue;
    vaporizeSuperTarget(slot, DRONE_BOSS_DAMAGE);
  }
  playSound(60, 0.5, "sawtooth");
}

function drawDrone(drone) {
  const angle = Math.atan2(drone.vy, drone.vx);
  const warn = drone.life < 60 && drone.blink % 12 < 6;
  ctx.save();
  ctx.translate(drone.x, drone.y);
  drawGlow(SUPER_COLORS.drone, 40, 0, 0);
  ctx.rotate(angle + Math.PI / 2);
  // dark hull edge first: on a sulfur sky an orange machine needs an outline
  ctx.fillStyle = warn ? "#ffffff" : "#2a0c02";
  ctx.beginPath();
  ctx.moveTo(0, -21); ctx.lineTo(11, -2); ctx.lineTo(7.5, 13); ctx.lineTo(-7.5, 13); ctx.lineTo(-11, -2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = warn ? "#fff0d8" : SUPER_COLORS.drone;
  ctx.beginPath();
  ctx.moveTo(0, -17); ctx.lineTo(8, -1.5); ctx.lineTo(5.4, 10); ctx.lineTo(-5.4, 10); ctx.lineTo(-8, -1.5);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ffd9a0";
  ctx.beginPath();
  ctx.moveTo(0, -13); ctx.lineTo(4.4, -1); ctx.lineTo(0, 3); ctx.lineTo(-4.4, -1);
  ctx.closePath(); ctx.fill();
  // warhead eye
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(0, -5, 3.6, 0, Math.PI * 2); ctx.fill();
  // spinning rotor ring, so it reads as a machine and not a bullet
  ctx.rotate(drone.spin);
  ctx.strokeStyle = "#ffd9a0";
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    ctx.moveTo(Math.cos(a) * 10, Math.sin(a) * 10);
    ctx.lineTo(Math.cos(a) * 18, Math.sin(a) * 18);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ---------------------------------------------------------------------------
// DECOY — "a decoy ship that stays put with 3HP; all enemies target it instead
// of the player, and it explodes when it runs out"
//
// The sheet gives it no duration. Left literal, a decoy nothing happens to
// would hold the arena's attention forever, so it also burns down over 15
// seconds and detonates on its own — the aggro swap is always temporary.
// ---------------------------------------------------------------------------
const DECOY_FRAMES = 900;
const DECOY_HP = 3;
const DECOY_BLAST = 150;
const DECOY_BOSS_DAMAGE = 12;
const DECOY_HALF_W = 20;
const DECOY_HALF_H = 22;

function deployDecoy() {
  decoy = { x: player.x, y: player.y, hp: DECOY_HP, life: DECOY_FRAMES, flash: 0, phase: 0 };
  spawnSparks(player.x, player.y, 18, SUPER_COLORS.decoy, { minSpeed: 1, maxSpeed: 4, life: 24 });
  playSound(300, 0.14, "square");
  playSound(600, 0.1, "triangle");
}

function damageDecoy(amount) {
  if (!decoy) return;
  decoy.hp -= amount;
  decoy.flash = 8;
  spawnSparks(decoy.x, decoy.y, 10, SUPER_COLORS.decoy, { minSpeed: 1, maxSpeed: 4, life: 20 });
  playSound(220, 0.08, "square");
  if (decoy.hp <= 0) popDecoy();
}

// Absorb hook for the hostile-projectile loops, same contract as the mirror's.
function tryDecoyIntercept(bx, by, radius) {
  if (!decoy) return false;
  const pad = radius || 6;
  if (Math.abs(bx - decoy.x) > DECOY_HALF_W + pad || Math.abs(by - decoy.y) > DECOY_HALF_H + pad) return false;
  damageDecoy(1);
  return true;
}

function popDecoy() {
  const dead = decoy;
  decoy = null;
  if (!dead) return;
  startBombBlast(dead.x, dead.y, DECOY_BLAST, SUPER_COLORS.decoy);
  const count = collectSuperTargets();
  for (let i = 0; i < count; i++) {
    const slot = SUPER_TARGETS[i];
    if (Math.hypot(slot.x - dead.x, slot.y - dead.y) > DECOY_BLAST + slot.r) continue;
    vaporizeSuperTarget(slot, DECOY_BOSS_DAMAGE);
  }
}

function updateDecoy(t) {
  decoy.life--;
  decoy.phase += 0.12;
  if (decoy.flash > 0) decoy.flash--;
  // contact damage: a charger that rams the hologram spends itself on it
  if (!bossMode) {
    for (const enemy of enemies) {
      if (!enemy.alive || enemy.type !== "charger") continue;
      if (Math.abs(enemy.x - decoy.x) < DECOY_HALF_W + enemy.w && Math.abs(enemy.y - decoy.y) < DECOY_HALF_H + enemy.h) {
        damageEnemy(enemy, 1);
        damageDecoy(1);
        if (!decoy) return;
      }
    }
  }
  drawDecoy(t);
  if (decoy.life <= 0) popDecoy();
}

function drawDecoy(t) {
  const dying = decoy.life < 90;
  const flicker = dying && Math.floor(t * 0.02) % 2 === 0 ? 0.35 : 1;
  ctx.save();
  ctx.translate(decoy.x, decoy.y);
  ctx.globalAlpha = (decoy.flash > 0 ? 1 : 0.72) * flicker;
  drawGlow(SUPER_COLORS.decoy, 34, 0, 0);
  ctx.fillStyle = decoy.flash > 0 ? "#ffffff" : SUPER_COLORS.decoy;
  ctx.fill(PLAYER_HULL);
  ctx.globalAlpha = 0.9 * flicker;
  ctx.strokeStyle = "#eafff2";
  ctx.lineWidth = 1.5;
  ctx.stroke(PLAYER_HULL);
  // holographic scan lines across the hull
  ctx.globalAlpha = 0.35 * flicker;
  ctx.fillStyle = "#06110b";
  for (let y = -20 + (decoy.phase * 6 % 4); y < 20; y += 4) ctx.fillRect(-16, y, 32, 1.5);
  ctx.restore();
  // HP pips
  ctx.globalAlpha = flicker;
  for (let i = 0; i < DECOY_HP; i++) {
    ctx.fillStyle = i < decoy.hp ? SUPER_COLORS.decoy : "#20342a";
    ctx.fillRect(decoy.x - 13 + i * 10, decoy.y + 24, 7, 4);
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// FIRST-AID — "heals the player for 4 HP"
// ---------------------------------------------------------------------------
const AID_HEAL = 4;

function useFirstAid() {
  const before = lives;
  lives = Math.min(MAX_DRAWN_HEARTS, lives + AID_HEAL);
  setLives(lives, lives > before);
  healPulse = 46;
  playerInvulnerable = Math.max(playerInvulnerable, 40);
  spawnSparks(player.x, player.y, 26, SUPER_COLORS.firstaid, { minSpeed: 1, maxSpeed: 4, life: 34, gravity: -0.05 });
  playSound(520, 0.18, "sine");
  playSound(780, 0.22, "sine");
  playSound(1040, 0.26, "sine");
}

function drawHealPulse() {
  const progress = 1 - healPulse / 46;
  const fade = 1 - progress;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.globalCompositeOperation = "lighter";
  for (let ring = 0; ring < 2; ring++) {
    const r = 20 + (progress + ring * 0.28) * 78;
    ctx.globalAlpha = 0.55 * fade * (ring ? 0.6 : 1);
    ctx.strokeStyle = ring ? "#ffffff" : SUPER_COLORS.firstaid;
    ctx.lineWidth = 4 * fade + 1;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
  }
  // the cross itself, rising and fading
  const lift = progress * 34;
  ctx.globalAlpha = fade;
  ctx.fillStyle = SUPER_COLORS.firstaid;
  ctx.fillRect(-4, -30 - lift, 8, 22);
  ctx.fillRect(-11, -23 - lift, 22, 8);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-1.6, -27 - lift, 3.2, 16);
  ctx.fillRect(-8, -21.4 - lift, 16, 3.2);
  ctx.restore();
  ctx.globalAlpha = 1;
  healPulse--;
}

// ---------------------------------------------------------------------------
// RADIANT ORB — "a small sun spawns and stays in place for 4 seconds, rapid
// firing projectiles in all directions; any enemy to touch it is vaporised"
// ---------------------------------------------------------------------------
const ORB_FRAMES = 240;
const ORB_RADIUS = 30;
const ORB_SPOKES = 6;
const ORB_FIRE_EVERY = 7;
const ORB_BULLET_CAP = 44;
const ORB_BOSS_CONTACT = 0.5;

function summonRadiantOrb() {
  radiantOrb = { x: player.x, y: player.y, life: ORB_FRAMES, spin: 0, fire: 0, flare: 0 };
  playSound(880, 0.3, "sine");
  playSound(1320, 0.2, "triangle");
  spawnSparks(player.x, player.y, 24, SUPER_COLORS.orb, { minSpeed: 1, maxSpeed: 5, life: 30 });
}

function updateRadiantOrb(t) {
  const orb = radiantOrb;
  orb.life--;
  orb.spin += 0.035;
  orb.flare += 0.11;
  if (--orb.fire <= 0) {
    orb.fire = ORB_FIRE_EVERY;
    for (let i = 0; i < ORB_SPOKES; i++) {
      if (bullets.length >= ORB_BULLET_CAP) break;
      const angle = orb.spin * 3 + i * Math.PI * 2 / ORB_SPOKES;
      bullets.push({
        x: orb.x + Math.cos(angle) * ORB_RADIUS, y: orb.y + Math.sin(angle) * ORB_RADIUS,
        vx: Math.cos(angle) * 7.5, vy: Math.sin(angle) * 7.5,
        damage: 1, type: "radiant", size: 4, pierceRemaining: 1, color: SUPER_COLORS.orb,
      });
    }
    playSound(1500, 0.04, "square");
  }
  const count = collectSuperTargets();
  for (let i = 0; i < count; i++) {
    const slot = SUPER_TARGETS[i];
    if (Math.hypot(slot.x - orb.x, slot.y - orb.y) > ORB_RADIUS + slot.r) continue;
    vaporizeSuperTarget(slot, ORB_BOSS_CONTACT);
    spawnSparks(slot.x, slot.y, 6, "#ffffff", { minSpeed: 1, maxSpeed: 4, life: 18 });
  }
  drawRadiantOrb(orb);
  if (orb.life <= 0) {
    spawnSparks(orb.x, orb.y, 26, SUPER_COLORS.orb, { minSpeed: 1, maxSpeed: 6, life: 30 });
    radiantOrb = null;
  }
}

function drawRadiantOrb(orb) {
  const fade = orb.life < 30 ? orb.life / 30 : 1;
  const breathe = 1 + Math.sin(orb.flare) * 0.08;
  ctx.save();
  ctx.translate(orb.x, orb.y);
  ctx.globalAlpha = fade;
  drawGlow(SUPER_COLORS.orb, 78, 0, 0);
  ctx.globalCompositeOperation = "lighter";
  // corona spikes
  ctx.save();
  ctx.rotate(orb.spin);
  ctx.fillStyle = "#ff7a1e";
  ctx.globalAlpha = 0.55 * fade;
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    const reach = ORB_RADIUS * (1.5 + Math.sin(orb.flare * 1.6 + i) * 0.28);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a - 0.12) * ORB_RADIUS * 0.9, Math.sin(a - 0.12) * ORB_RADIUS * 0.9);
    ctx.lineTo(Math.cos(a) * reach, Math.sin(a) * reach);
    ctx.lineTo(Math.cos(a + 0.12) * ORB_RADIUS * 0.9, Math.sin(a + 0.12) * ORB_RADIUS * 0.9);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  ctx.globalAlpha = fade;
  ctx.scale(breathe, breathe);
  ctx.fillStyle = "#ff8c1a";
  ctx.beginPath(); ctx.arc(0, 0, ORB_RADIUS, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = SUPER_COLORS.orb;
  ctx.beginPath(); ctx.arc(0, 0, ORB_RADIUS * 0.74, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff3c4";
  ctx.beginPath(); ctx.arc(0, 0, ORB_RADIUS * 0.44, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(0, 0, ORB_RADIUS * 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.globalAlpha = 1;
  if (Math.random() < 0.5) {
    const a = rand(0, Math.PI * 2);
    spawnSparks(orb.x + Math.cos(a) * ORB_RADIUS, orb.y + Math.sin(a) * ORB_RADIUS, 1, "#ffd98a",
      { minSpeed: 0.4, maxSpeed: 1.8, life: 26, maxSize: 2 });
  }
}

// ---------------------------------------------------------------------------
// One update call, shared by the wave loop, the boss arena and the test room.
// ---------------------------------------------------------------------------
function updateSuperEntities(t) {
  if (mirrorTimer > 0) { mirrorTimer--; drawMirrorShield(t); }
  if (decoy) updateDecoy(t);
  if (radiantOrb) updateRadiantOrb(t);
  if (superDrone) updateDrone();
  if (superStar) updateSuperStar();
  if (healPulse > 0) drawHealPulse();
}

function clearSuperEntities() {
  superStar = null;
  superDrone = null;
  decoy = null;
  radiantOrb = null;
  mirrorTimer = 0;
  healPulse = 0;
}

const CHARGE_FULL_MS = 2500;

function chargeRatio() {
  if (!chargeStartedAt) return 0;
  return Math.min(1, (performance.now() - chargeStartedAt) / CHARGE_FULL_MS);
}

function drawChargeAura(t) {
  const ratio = chargeRatio();
  if (ratio <= 0) return;
  const baseRadius = player.shrunk ? 24 : 36;
  const full = ratio >= 1;
  const radius = full
    ? baseRadius + Math.sin(t * 0.018) * 1.5
    : baseRadius * (1.5 - ratio * 0.42) + Math.sin(t * 0.012) * 1.2;
  const spin = t * (full ? 0.008 : 0.0025 + ratio * 0.0025);
  const color = weaponColor("charge");
  const arcCount = full ? 4 : 3;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = full ? 3.5 : 1.8 + ratio * 1.7;
  for (let i = 0; i < arcCount; i++) {
    const start = spin + i * Math.PI * 2 / arcCount;
    const length = full ? 0.82 : 0.48 + ratio * 0.42;
    ctx.globalAlpha = full ? 0.9 : 0.32 + ratio * 0.58;
    ctx.beginPath(); ctx.arc(0, 0, radius + (i % 2) * 3, start, start + length); ctx.stroke();
    const tip = start + length;
    ctx.fillStyle = i % 2 ? "#fff1b0" : color;
    ctx.beginPath(); ctx.arc(Math.cos(tip) * radius, Math.sin(tip) * radius, full ? 3.2 : 1.7 + ratio, 0, Math.PI * 2); ctx.fill();
  }
  if (full) {
    ctx.globalAlpha = 0.52;
    ctx.strokeStyle = "#ffdc5a";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 7]);
    ctx.lineDashOffset = -t * 0.03;
    ctx.beginPath(); ctx.arc(0, 0, radius - 6, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    for (let i = 0; i < 5; i++) {
      const angle = -spin * 0.72 + i * Math.PI * 0.4;
      const inner = radius - 4;
      const outer = radius + 8 + Math.sin(t * 0.021 + i) * 3;
      ctx.globalAlpha = 0.58;
      ctx.fillStyle = i % 2 ? "#ffdc5a" : color;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle - 0.07) * inner, Math.sin(angle - 0.07) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.lineTo(Math.cos(angle + 0.07) * inner, Math.sin(angle + 0.07) * inner);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

// A slow shot that steers toward the player for a limited window and then
// commits. The old version homed forever but only while `y < H`, which is what
// let a player park in a corner and watch shots curve harmlessly past.
function fireHomingShot(x, y, speed) {
  const angle = Math.atan2(aimTargetY() - y, aimTargetX() - x);
  enemyBullets.push({
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    speed,
    turnRate: 0.05,
    homing: 150,
    kind: "homing",
  });
}

// Dumb-fire: aimed once, then straight forever. Turrets use these, so there is
// always something on screen that cannot be walked away from.
function fireStraightShot(x, y, angle, speed) {
  enemyBullets.push({
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    speed,
    turnRate: 0,
    homing: 0,
    kind: "straight",
  });
}

// Venus ordnance
//
// Every shape below is drawn at the origin with its *nose pointing along -Y*;
// the caller has already translated to the bullet and rotated by
// `angle + PI/2`. They are shared by the Venus waves and the Venus boss fight,
// so the two chapters can never end up with different-looking acid on screen.
//
// The rule for all of them: a dark outline shape first, then the coloured body
// inset inside it, then a white-hot core. The silhouette is what the player
// reads at speed, so every one is a pointed, unmistakably *directional* form —
// no soft blobs and no bare stroked arcs.
// ---------------------------------------------------------------------------

// Ember colour left behind by each kind of Venus round, so a shot reads as a
// streak of burning air rather than as a shape sliding across the sky.
const VENUS_TRAILS = {
  "venus-crescent": "#b6d43a",
  "venus-acid": "#9dbe33",
  "venus-heat": "#ff7a2a",
  "venus-dart": "#b6d43a",
  "venus-seed": "#ffb456",
};

// Acid dart — a barbed sulfur needle.
function drawAcidDart() {
  drawGlow("#c9e34a", 11, 0, 0);
  ctx.fillStyle = "#1d2405";
  ctx.beginPath();
  ctx.moveTo(0, -14); ctx.lineTo(5, 0); ctx.lineTo(3, 3); ctx.lineTo(4, 12);
  ctx.lineTo(0, 7); ctx.lineTo(-4, 12); ctx.lineTo(-3, 3); ctx.lineTo(-5, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#d9f24e";
  ctx.beginPath();
  ctx.moveTo(0, -11.5); ctx.lineTo(3.4, 0); ctx.lineTo(2.6, 9.5);
  ctx.lineTo(0, 6); ctx.lineTo(-2.6, 9.5); ctx.lineTo(-3.4, 0);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fbffdc";
  ctx.beginPath();
  ctx.moveTo(0, -8.5); ctx.lineTo(1.3, 0); ctx.lineTo(0, 4.5); ctx.lineTo(-1.3, 0);
  ctx.closePath(); ctx.fill();
}

// Sulfur razor — the skimmer's swept blade. Replaces the stroked half-circle
// that read as a piece of macaroni tumbling across the screen.
function drawSulfurRazor(age) {
  const flutter = Math.sin(age * 0.22) * 0.9;
  drawGlow("#dfff65", 11, 0, 0);
  ctx.fillStyle = "#232d04";
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(9 + flutter, 2); ctx.lineTo(4, 1); ctx.lineTo(6, 11);
  ctx.lineTo(0, 5.5);
  ctx.lineTo(-6, 11); ctx.lineTo(-4, 1); ctx.lineTo(-9 - flutter, 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#dfff65";
  ctx.beginPath();
  ctx.moveTo(0, -10.5);
  ctx.lineTo(6.2, 1.6); ctx.lineTo(2.6, 0.8); ctx.lineTo(4, 8);
  ctx.lineTo(0, 4);
  ctx.lineTo(-4, 8); ctx.lineTo(-2.6, 0.8); ctx.lineTo(-6.2, 1.6);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fbffe0";
  ctx.beginPath();
  ctx.moveTo(0, -8); ctx.lineTo(1.5, 0.5); ctx.lineTo(0, 2.5); ctx.lineTo(-1.5, 0.5);
  ctx.closePath(); ctx.fill();
}

// Acid globule — a falling teardrop with a lit shoulder and a thin tail, so it
// still reads as a direction rather than as a dot.
function drawAcidGlobule(phase) {
  const squash = 1 + Math.sin(phase) * 0.12;
  drawGlow("#dfff65", 11, 0, 0);
  ctx.save();
  ctx.scale(1 / squash, squash);
  ctx.fillStyle = "#243003";
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.bezierCurveTo(4.5, -4, 7.5, 2, 0, 9);
  ctx.bezierCurveTo(-7.5, 2, -4.5, -4, 0, -11);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#dfff65";
  ctx.beginPath();
  ctx.moveTo(0, -8.5);
  ctx.bezierCurveTo(3.4, -3, 5.7, 1.6, 0, 7);
  ctx.bezierCurveTo(-5.7, 1.6, -3.4, -3, 0, -8.5);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fbffe0";
  ctx.beginPath(); ctx.ellipse(-1.6, 0.4, 1.5, 2.6, -0.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Bloom seed — a spiked mine with a visible fuse ring, so the four-way burst it
// turns into is always telegraphed.
function drawVenusSeed(age, ratio, armed) {
  const progress = Math.min(1, ratio);
  const arming = armed > 0;
  const pulse = 8.5 + Math.sin(age * (arming ? 0.6 : 0.2)) * (arming ? 3 : 1.4) + progress * 2;
  drawGlow(arming ? "#ffffff" : "#ffac48", arming ? 30 : 22, 0, 0);
  ctx.save();
  ctx.rotate(age * 0.05);
  ctx.fillStyle = "#4a1c05";
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    const r = i % 2 ? pulse * 1.75 : pulse;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ffc76c";
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    ctx.lineTo(Math.cos(a) * pulse * 0.86, Math.sin(a) * pulse * 0.86);
  }
  ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.fillStyle = arming || progress > 0.78 ? "#ffffff" : "#fff1b0";
  const core = 3 + Math.sin(age * (arming ? 0.9 : 0.4)) * (arming || progress > 0.78 ? 1.8 : 0.5);
  ctx.beginPath(); ctx.arc(0, 0, core, 0, Math.PI * 2); ctx.fill();
  // fuse ring
  ctx.strokeStyle = "#ffe6a0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, pulse * 1.95, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  ctx.stroke();
}

// Heat shard — a sharp chevron with a bright spine and a cooling tail.
function drawHeatShard() {
  drawGlow("#ff8738", 11, 0, 0);
  ctx.fillStyle = "#5c1c02";
  ctx.beginPath();
  ctx.moveTo(0, -10); ctx.lineTo(5.5, 3); ctx.lineTo(0, 0.5); ctx.lineTo(-5.5, 3);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ff8738";
  ctx.beginPath();
  ctx.moveTo(0, -8.5); ctx.lineTo(4, 2.4); ctx.lineTo(0, 0.4); ctx.lineTo(-4, 2.4);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff0a8";
  ctx.beginPath();
  ctx.moveTo(0, -6.5); ctx.lineTo(1.4, 1.4); ctx.lineTo(0, 0.6); ctx.lineTo(-1.4, 1.4);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#ff9c46";
  ctx.fillRect(-1, 3, 2, 6);
  ctx.globalAlpha = 1;
}

// The bloom's seed: how close it lets the ship get before arming, how long the
// arming flash lasts, and how fast the shards leave.
const SEED_TRIGGER = 130;
const SEED_ARM_FRAMES = 16;
const SEED_SHARD_SPEED = 4.1;

function burstVenusSeed(bullet) {
  // One shard is aimed straight down the player's bearing and the rest are
  // spaced evenly off it, so the cross is always oriented at the ship.
  const aim = Math.atan2(aimTargetY() - bullet.y, aimTargetX() - bullet.x);
  const shards = bullet.shards || 4;
  for (let i = 0; i < shards; i++) {
    fireVenusShot(bullet.x, bullet.y, aim + i * Math.PI * 2 / shards, SEED_SHARD_SPEED, "venus-heat");
  }
  spawnSparks(bullet.x, bullet.y, 18, "#ffb456", { minSpeed: 1.2, maxSpeed: 5, life: 26 });
  screenShakeFrames = Math.max(screenShakeFrames, 5);
  screenShakeStrength = Math.max(screenShakeStrength, 3);
  playSound(150, 0.22, "sawtooth");
  bullet.y = H + 200;
}

function fireVenusShot(x, y, angle, speed, kind) {
  enemyBullets.push({
    x, y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    speed,
    turnRate: 0,
    homing: 0,
    kind,
    age: 0,
    phase: rand(0, Math.PI * 2),
    fuse: 84,
    armed: 0,
    turn: 0.05,
    shards: 4,
  });
}

function updateEnemyBullets() {
  for (const bullet of enemyBullets) {
    if (bullet.kind === "venus-crescent") {
      bullet.age++;
      const angle = Math.atan2(bullet.vy, bullet.vx) + (bullet.age < 65 ? bullet.curve : 0);
      bullet.vx = Math.cos(angle) * bullet.speed;
      bullet.vy = Math.sin(angle) * bullet.speed;
    }
    if (bullet.kind === "venus-seed") {
      bullet.age++;
      // The seed hunts. It used to drift out of the bloom, stall in open space
      // and pop a fixed diagonal cross two seconds later — which meant it never
      // burst anywhere near the ship. Now it steers at you for its whole fuse,
      // arms the moment it gets close, and throws its shards *along your angle*.
      if (bullet.age < bullet.fuse - 8 && bullet.armed === 0) {
        const targetAngle = Math.atan2(aimTargetY() - bullet.y, aimTargetX() - bullet.x);
        const current = Math.atan2(bullet.vy, bullet.vx);
        let diff = targetAngle - current;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        const next = current + Math.max(-bullet.turn, Math.min(bullet.turn, diff));
        bullet.vx = Math.cos(next) * bullet.speed;
        bullet.vy = Math.sin(next) * bullet.speed;
      }
      if (bullet.armed === 0 && bullet.age > 18
        && Math.hypot(aimTargetX() - bullet.x, aimTargetY() - bullet.y) < SEED_TRIGGER) {
        // a short, loud arming window: the burst is fair only if you can see it coming
        bullet.armed = SEED_ARM_FRAMES;
        playSound(900, 0.07, "square");
      }
      if (bullet.armed > 0 && --bullet.armed === 0) bullet.age = bullet.fuse;
      if (bullet.age >= bullet.fuse) { burstVenusSeed(bullet); continue; }
    }
    let nextAngle = Math.atan2(bullet.vy, bullet.vx);
    if (bullet.homing > 0) {
      bullet.homing--;
      const targetAngle = Math.atan2(aimTargetY() - bullet.y, aimTargetX() - bullet.x);
      let angleDiff = targetAngle - nextAngle;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      nextAngle += Math.max(-bullet.turnRate, Math.min(bullet.turnRate, angleDiff));
      bullet.vx = Math.cos(nextAngle) * bullet.speed;
      bullet.vy = Math.sin(nextAngle) * bullet.speed;
    }
    if (bullet.kind === "venus-acid") {
      bullet.phase += 0.17;
      bullet.x += bullet.vx + Math.sin(bullet.phase) * 0.75;
    } else {
      bullet.x += bullet.vx;
    }
    bullet.y += bullet.vy;
    // MIRROR turns the round around; DECOY eats it. Either way it is spent
    // before it can reach the hull.
    if (tryMirrorReflect(bullet.x, bullet.y, 8) || tryDecoyIntercept(bullet.x, bullet.y, 8)) {
      bullet.y = H + 200;
      continue;
    }
    if (VENUS_TRAILS[bullet.kind] && Math.random() < 0.35) {
      spawnSparks(bullet.x - bullet.vx, bullet.y - bullet.vy, 1, VENUS_TRAILS[bullet.kind],
        { minSpeed: 0.1, maxSpeed: 0.8, life: 18, maxSize: 2 });
    }
    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    ctx.rotate(nextAngle + Math.PI / 2);
    if (bullet.kind === "venus-seed") {
      drawVenusSeed(bullet.age, bullet.age / bullet.fuse, bullet.armed);
    } else if (bullet.kind === "venus-crescent") {
      drawSulfurRazor(bullet.age);
    } else if (bullet.kind === "venus-acid") {
      drawAcidGlobule(bullet.phase);
    } else if (bullet.kind === "venus-heat") {
      drawHeatShard();
    } else if (bullet.kind === "straight") {
      ctx.fillStyle = "#ffb03a";
      ctx.fillRect(-3, -5, 6, 10);
      ctx.fillStyle = "#fff2c9";
      ctx.fillRect(-1, -5, 2, 10);
    } else {
      ctx.fillStyle = "#ff6b8a";
      ctx.fillRect(-2, -6, 4, 12);
      ctx.fillStyle = "#ffd0dc";
      ctx.fillRect(-1, -6, 2, 5);
    }
    ctx.restore();
    const hitWidth = player.shrunk ? 13 : 22;
    const hitHeight = player.shrunk ? 14 : 24;
    if (!devGodMode && playerInvulnerable === 0 && Math.abs(bullet.x - player.x) < hitWidth && Math.abs(bullet.y - player.y) < hitHeight) {
      hurtPlayer();
      bullet.y = H + 200;
      if (!gameActive) return;
    }
  }
  compact(enemyBullets, (b) => b.y < H + 30 && b.y > -60 && b.x > -60 && b.x < W + 60);
}

// One place to lose a heart, so the flash, the i-frames and the HUD can never
// disagree with each other.
function hurtPlayer() {
  lives--;
  flashDamage();
  screenShakeFrames = 14;
  screenShakeStrength = 8;
  playerInvulnerable = 90;
  setLives(lives);
  playSound(120, 0.25, "sawtooth");
  if (lives <= 0) endGame();
}

function drawGame(t) {
  const left = keys.KeyA;
  const right = keys.KeyD;
  const up = keys.KeyW;
  const down = keys.KeyS;
  const shrunk = touchControls.shrinkHeld || keys.Space && performance.now() - spaceDownAt > 180;
  player.shrunk = Boolean(shrunk);
  const targetX = Math.max(-1, Math.min(1, (right ? 1 : 0) - (left ? 1 : 0) + touchControls.moveX));
  const targetY = Math.max(-1, Math.min(1, (down ? 1 : 0) - (up ? 1 : 0) + touchControls.moveY));
  // Preserve the touch stick's analog travel, while still capping keyboard
  // diagonals so they are not ~41% faster.
  const rawLength = Math.hypot(targetX, targetY);
  const inputLength = rawLength || 1;
  const inputStrength = Math.min(1, rawLength);
  const moveX = targetX / inputLength * inputStrength;
  const moveY = targetY / inputLength * inputStrength;
  const movementSpeed = player.shrunk ? player.maxSpeed * 1.4 : player.maxSpeed;
  player.vx += (moveX * movementSpeed - player.vx) * player.speed;
  player.vy += (moveY * movementSpeed - player.vy) * player.speed;
  player.x += player.vx;
  player.y += player.vy;
  if (!targetX) player.vx *= 0.88;
  if (!targetY) player.vy *= 0.88;
  player.x = Math.max(24, Math.min(W - 24, player.x));
  const bottomBound = playableBottomY();
  player.y = Math.max(28, Math.min(bottomBound, player.y));
  if ((player.x <= 24 && player.vx < 0) || (player.x >= W - 24 && player.vx > 0)) player.vx = 0;
  if ((player.y <= 28 && player.vy < 0) || (player.y >= bottomBound && player.vy > 0)) player.vy = 0;

  if (fireCooldown > 0) fireCooldown--;
  // Tech.0's cycle is long enough to play around, so it gets a ready ping and
  // a muzzle kiss the moment it comes back — a pro weapon needs a readable clock.
  if (selectedWeapon === "tech0" && gameActive && !bossIntro && fireCooldown <= 0 && !tech0Primed) {
    tech0Primed = true;
    playSound(1174, 0.06, "sine");
    spawnSparks(player.x, player.y - 24, 4, WEAPON_COLORS.tech0, { minSpeed: 0.3, maxSpeed: 1.4, life: 16, maxSize: 3 });
  }
  // Aim off the *whole* arrow vector. Falling back per-axis (the old
  // `activeAimX || lastArrowDirection.x`) leaked a stale axis into the aim, so
  // holding Up alone after a Right press shot diagonally.
  const aim = currentAimVector();
  const aimX = aim.x;
  const aimY = aim.y;
  if (aimX || aimY) {
    const aimLength = Math.hypot(aimX, aimY);
    facing.x = aimX / aimLength;
    facing.y = aimY / aimLength;
  }
  // While a DRONE is in the air the arrow keys steer it instead of shooting;
  // they revert the instant it detonates.
  if (fireCooldown <= 0 && aim.held && !superDrone) {
    if (selectedWeapon === "cone") {
      if (fireCone(aimX, aimY)) fireCooldown = player.shrunk ? 54 : 18;
    } else if (selectedWeapon === "blaster") {
      fireInDirection(aimX, aimY);
      // After the shot: fireInDirection is what flips the wingtip, and the
      // sound is panned to the tip that actually fired.
      weaponSfx.blaster(blasterBarrel);
      fireCooldown = player.shrunk ? 30 : 10;
    } else if (selectedWeapon === "tech0") {
      if (fireInDirection(aimX, aimY, 3, "tech0", 5)) {
        fireCooldown = player.shrunk ? TECH0_SHRUNK_CYCLE : TECH0_CYCLE;
        tech0Primed = false;
        // Lightning should feel instant: outrun every other round so the hit
        // lands ~30% sooner instead of floating uprange.
        const shot = bullets[bullets.length - 1];
        shot.vx *= 1.4;
        shot.vy *= 1.4;
        weaponSfx.tech0();
        spawnSparks(player.x + facing.x * 22, player.y + facing.y * 22, 6, WEAPON_COLORS.tech0,
          { minSpeed: 1, maxSpeed: 3.4, life: 16, maxSize: 3 });
      }
    } else if (selectedWeapon === "magma") {
      if (fireInDirection(aimX, aimY, MAGMA_DAMAGE, "magma", 12)) {
        fireCooldown = player.shrunk ? MAGMA_SHRUNK_CYCLE : MAGMA_CYCLE;
        // Heavy round: slower than everything else, and it tumbles.
        const shot = bullets[bullets.length - 1];
        shot.vx *= MAGMA_SPEED;
        shot.vy *= MAGMA_SPEED;
        shot.spin = Math.random() * Math.PI * 2;
        shot.tick = 0;
        weaponSfx.magma();
        spawnSparks(player.x + facing.x * 22, player.y + facing.y * 22, 6, "#ffb03a",
          { minSpeed: 1, maxSpeed: 3, life: 16, maxSize: 3, angle: Math.atan2(facing.y, facing.x), spread: 0.9 });
      }
    }
  }

  // Mercury chapter backdrop. Waves 1-5 and the boss intro card share the menu's
  // drifting star field, so nothing in the chapter ever cuts from a sky full of
  // stars to a black void. The boss arena repaints itself in drawBossArea, and
  // Venus keeps its own sky (drawVenusEnvironment).
  if (bossIntro ? bossKind !== "venus" : !bossMode && wave < 6) drawStaticStars(t);
  if (bossIntro) return;
  if (playerInvulnerable > 0) playerInvulnerable--;
  if (invincibilitySuperTimer > 0) invincibilitySuperTimer--;
  if (bossMode) { drawBossArea(t); return; }
  drawVenusEnvironment(t);

  for (const bomb of superBombs) {
    bomb.x += bomb.vx;
    bomb.y += bomb.vy;
    bomb.life--;
    for (const enemy of enemies) {
      if (enemy.alive && Math.hypot(enemy.x - bomb.x, enemy.y - bomb.y) < 26) {
        bomb.explode = true;
        break;
      }
    }
    const color = bomb.color || superColor("bomb");
    drawGlow(color, 18, bomb.x, bomb.y);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff3d6";
    ctx.beginPath(); ctx.arc(bomb.x - 2, bomb.y - 2, 3, 0, Math.PI * 2); ctx.fill();
    if (bomb.life <= 0 || bomb.x < 0 || bomb.x > W || bomb.y < 0 || bomb.y > H) bomb.explode = true;
  }
  for (const bomb of superBombs) {
    if (!bomb.explode) continue;
    const blastRadius = BOMB_RADIUS;
    startBombBlast(bomb.x, bomb.y, blastRadius, bomb.color);
    for (const enemy of enemies) {
      if (enemy.alive && Math.hypot(enemy.x - bomb.x, enemy.y - bomb.y) < blastRadius) {
        enemy.alive = false; score += ENEMY_TYPES[enemy.type].score; kills++;
      }
    }
  }
  compact(superBombs, (b) => !b.explode);
  updateBombBlasts();
  updateSuperMeter();
  updateSuperBeam(t);
  updateSuperEntities(t);
  if (!gameActive) return;
  drawChargeAura(t);
  drawPlayer();

  for (const bullet of bullets) {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    drawPlayerBullet(bullet);
  }
  compact(bullets, (b) => b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20);
  updateSparks();
  updateMuzzleFlashes();

  enemyShotTimer--;
  if (enemyShotTimer <= 0) {
    // Only grunts use the shared homing shot; turrets fire on their own timers
    // and chargers are now pure contact threats. Counting first avoids a list.
    let livingCount = 0;
    for (const enemy of enemies) if (enemy.alive && enemy.type === "grunt") livingCount++;
    if (livingCount) {
      let pick = Math.floor(Math.random() * livingCount);
      let shooter = null;
      for (const enemy of enemies) {
        if (enemy.alive && enemy.type === "grunt" && pick-- === 0) { shooter = enemy; break; }
      }
      fireHomingShot(shooter.x, shooter.y + 18, 2.8);
    }
    // later waves shoot a little more often, but never faster than ~0.5s
    const pressure = Math.min(18, wave * 3);
    enemyShotTimer = Math.max(30, 45 - pressure) + Math.floor(Math.random() * 45);
  }
  updateEnemyBullets();
  if (!gameActive) return;

  const time = t * 0.001;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (enemy.hitFlash > 0) enemy.hitFlash--;
    const ey = updateEnemy(enemy, time);
    enemy.renderY = ey;
    drawEnemy(enemy, ey, time);

    const playerHitbox = player.shrunk ? 8 : 16;
    if (!devGodMode && playerInvulnerable === 0 && Math.abs(player.x - enemy.x) < enemy.w + playerHitbox && Math.abs(player.y - ey) < enemy.h + playerHitbox) {
      hurtPlayer();
      if (!gameActive) return;
    }

    for (const bullet of bullets) {
      if (bullet.ignore === enemy) continue;
      if (Math.abs(bullet.x - enemy.x) < enemy.w + 4 && Math.abs(bullet.y - ey) < enemy.h + 6) {
        const hitX = enemy.x;
        const hitY = ey;
        damageEnemy(enemy, bullet.damage || 1);
        if (bullet.type === "tech0") {
          bullet.y = -100;
          startTechChain(enemy, hitX, hitY);
        } else {
          if (bullet.type === "magma") burstMagma(bullet, hitX, hitY, enemy);
          if (bullet.pierceRemaining !== Infinity) {
            bullet.pierceRemaining--;
            if (bullet.pierceRemaining <= 0) bullet.y = -100;
          }
        }
        break;
      }
    }
    if (superBeam) damageAlongBeam(enemy, ey);
  }
  updateTechChains(t);
  // Failsafe: anything still living far outside the arena burns up in the
  // storm instead of stalling the wave. Every enemy update clamps well inside
  // these bounds, so this only ever catches strays the player could neither
  // see nor hit — the wave can never softlock on one again.
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const strayY = enemy.renderY === undefined ? enemy.y : enemy.renderY;
    const lost = !Number.isFinite(enemy.x) || !Number.isFinite(strayY);
    if (lost || enemy.x < -80 || enemy.x > W + 80 || strayY < -80 || strayY > H + 80) {
      enemy.alive = false;
      enemy.health = 0;
      const sparkX = Number.isFinite(enemy.x) ? Math.max(0, Math.min(W, enemy.x)) : W / 2;
      const sparkY = Number.isFinite(strayY) ? Math.max(0, Math.min(H, strayY)) : H / 2;
      spawnSparks(sparkX, sparkY, 10, "#ff8a3d", { minSpeed: 0.5, maxSpeed: 3, life: 24 });
      console.warn("Retired stray " + enemy.type + (lost ? " (position lost)" : " at " + Math.round(enemy.x) + "," + Math.round(strayY)));
    }
  }
  let anyAlive = false;
  for (const enemy of enemies) if (enemy.alive) { anyAlive = true; break; }
  if (!anyAlive) {
    bullets = [];
    techChains = [];
    enemyBullets = [];
    recordWaveCleared(wave);
    if (wave === 5) { enterBossArea("moon"); return; }
    if (wave === 9) { wave = 10; setText(dom.waveNumber, "10"); enterBossArea("venus"); return; }
    // A cleared wave ends every timed effect: duration supers (shield, beam,
    // star, mirror, drone, decoy, orb), bombs still in flight and their blasts
    // all die with the wave instead of leaking into the next one. Boss entries
    // return above and tear down in enterBossArea instead.
    clearSuperEntities();
    superBeam = null;
    superBombs = [];
    bombBlasts = [];
    playerInvulnerable = 0;
    invincibilitySuperTimer = 0;
    player.x = W / 2;
    player.y = playerStartY();
    player.vx = 0;
    player.vy = 0;
    showWaveBanner(`WAVE ${wave} CLEARED`, "");
    wave++;
    createEnemies();
    announceWave(wave, 1250);
  }
}

// Tech.0 jumps onward from the impact point through as many as four nearby
// survivors. Each hop searches from the previous target, producing a readable
// lightning path through a clustered formation rather than four disconnected hits.
function startTechChain(source, x, y) {
  spawnSparks(x, y, 14, WEAPON_COLORS.tech0, { minSpeed: 1, maxSpeed: 5, life: 20, maxSize: 4 });
  spawnSparks(x, y, 6, "#ffffff", { minSpeed: 0.5, maxSpeed: 2.5, life: 12, maxSize: 2 });
  playSound(180, 0.1, "square");
  const visited = new Set([source]);
  let fromX = x;
  let fromY = y;
  for (let hop = 0; hop < TECH0_HOPS; hop++) {
    let target = null;
    let nearest = TECH0_CHAIN_RANGE;
    for (const enemy of enemies) {
      if (!enemy.alive || visited.has(enemy)) continue;
      const targetY = enemy.renderY === undefined ? enemy.y : enemy.renderY;
      const distance = Math.hypot(enemy.x - fromX, targetY - fromY);
      if (distance < nearest) {
        target = enemy;
        nearest = distance;
      }
    }
    if (!target) break;
    visited.add(target);
    const targetY = target.renderY === undefined ? target.y : target.renderY;
    damageEnemy(target, TECH0_CHAIN_DAMAGE);
    spawnSparks(target.x, targetY, 12, WEAPON_COLORS.tech0,
      { minSpeed: 0.4, maxSpeed: 2.8, life: 22, maxSize: 3 });
    techChains.push({
      x1: fromX, y1: fromY, x2: target.x, y2: targetY,
      life: TECH0_CHAIN_LIFE, maxLife: TECH0_CHAIN_LIFE, seed: Math.random() * 1000 + hop * 31,
    });
    fromX = target.x;
    fromY = targetY;
  }
  if (techChains.length) playSound(860, 0.08, "sawtooth");
}

// Same arc, but aimed at Mercury's brood: a Tech.0 round that tags the planet
// (or a chip) keeps travelling through nearby chips. Kills are still scored by
// updateBossMinions, which sweeps minion health every frame.
function startTechChainBoss(fromX, fromY, exclude) {
  const visited = new Set([exclude]);
  let arcX = fromX;
  let arcY = fromY;
  let chained = false;
  for (let hop = 0; hop < TECH0_HOPS; hop++) {
    let target = null;
    let nearest = TECH0_CHAIN_RANGE;
    for (const m of bossMinions) {
      if (m.health <= 0 || visited.has(m)) continue;
      const distance = Math.hypot(m.x - arcX, m.y - arcY);
      if (distance < nearest) {
        target = m;
        nearest = distance;
      }
    }
    if (!target) break;
    visited.add(target);
    target.health -= TECH0_CHAIN_DAMAGE;
    target.hitFlash = 6;
    superDamage += TECH0_CHAIN_DAMAGE;
    updateSuperMeter();
    spawnSparks(target.x, target.y, 12, WEAPON_COLORS.tech0,
      { minSpeed: 0.4, maxSpeed: 2.8, life: 22, maxSize: 3 });
    techChains.push({
      x1: arcX, y1: arcY, x2: target.x, y2: target.y,
      life: TECH0_CHAIN_LIFE, maxLife: TECH0_CHAIN_LIFE, seed: Math.random() * 1000 + hop * 31,
    });
    arcX = target.x;
    arcY = target.y;
    chained = true;
  }
  if (chained) playSound(860, 0.08, "sawtooth");
}

function updateTechChains(t) {
  if (!techChains.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "bevel";
  for (const chain of techChains) {
    chain.life--;
    const fade = Math.max(0, chain.life / chain.maxLife);
    const dx = chain.x2 - chain.x1;
    const dy = chain.y2 - chain.y1;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const segments = 7;
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? "#eaffff" : WEAPON_COLORS.tech0;
      ctx.globalAlpha = fade * (pass ? 0.95 : 0.55);
      ctx.lineWidth = pass ? 2.5 : 8;
      ctx.beginPath();
      ctx.moveTo(chain.x1, chain.y1);
      for (let i = 1; i < segments; i++) {
        const progress = i / segments;
        const jitter = Math.sin(chain.seed + i * 13.7 + t * 0.08) * (pass ? 7 : 9);
        ctx.lineTo(chain.x1 + dx * progress + nx * jitter, chain.y1 + dy * progress + ny * jitter);
      }
      ctx.lineTo(chain.x2, chain.y2);
      ctx.stroke();
    }
    ctx.globalAlpha = fade * 0.8;
    drawGlow(WEAPON_COLORS.tech0, 10, chain.x2, chain.y2);
  }
  ctx.restore();
  compact(techChains, (chain) => chain.life > 0);
}

function damageEnemy(enemy, amount) {
  enemy.health -= amount;
  enemy.hitFlash = 6;
  superDamage += amount;
  if (enemy.health > 0) {
    playSound(300, 0.05, "square");
    return;
  }
  enemy.alive = false;
  score += ENEMY_TYPES[enemy.type].score;
  kills++;
  playSound(520, 0.08, "square");
  spawnSparks(enemy.x, enemy.y, 10, ENEMY_TYPES[enemy.type].color);
  setText(dom.score, String(score).padStart(6, "0"));
}

let waveAnnounceTimer = null;
function announceWave(number, delay) {
  clearTimeout(waveAnnounceTimer);
  waveAnnounceTimer = setTimeout(() => {
    if (!gameActive || bossMode || bossIntro) return;
    showWaveBanner(`WAVE ${number}`, WAVE_INTROS[number] || "");
  }, delay);
}

// Returns the y to draw and collide against: grunts and turrets bob around a
// fixed home, chargers actually move, so for them it is just enemy.y.
// ---------------------------------------------------------------------------
// Evasion
//
// From wave 7 the skimmers stop being targets that sit still. Every few frames
// each one projects the player's live rounds forward, finds the one that will
// actually pass through it, and kicks itself sideways out of that line. The kick
// is an *offset* on top of the formation position, not a new position — the lane
// discipline that makes a Venus wave readable is preserved, they just refuse to
// be free hits.
// ---------------------------------------------------------------------------
const DODGE_WINDOW = 46;       // frames of lookahead
const DODGE_CLEARANCE = 30;    // how close the round has to pass to count
const DODGE_KICK = 3.6;
const DODGE_LIMIT = 62;        // how far out of formation it will ever slide

function updateDodge(enemy, ey) {
  if (enemy.dodgeCool > 0) enemy.dodgeCool--;
  if (!enemy.dodgeCool && bullets.length) {
    for (const b of bullets) {
      const speed2 = b.vx * b.vx + b.vy * b.vy;
      if (speed2 < 1) continue;
      const rx = enemy.x + enemy.dodgeX - b.x;
      const ry = ey + enemy.dodgeY - b.y;
      const tc = (rx * b.vx + ry * b.vy) / speed2;
      if (tc < 0 || tc > DODGE_WINDOW) continue;
      const cx = rx - b.vx * tc;
      const cy = ry - b.vy * tc;
      if (cx * cx + cy * cy > DODGE_CLEARANCE * DODGE_CLEARANCE) continue;
      const speed = Math.sqrt(speed2);
      const nx = -b.vy / speed;
      const ny = b.vx / speed;
      // push out along whichever side of the round's line it is already on
      const side = rx * nx + ry * ny >= 0 ? 1 : -1;
      enemy.dodgeVX += nx * side * DODGE_KICK;
      enemy.dodgeVY += ny * side * DODGE_KICK;
      enemy.dodgeCool = 26;
      break;   // never touches `state`: the wind-up tell must stay visible
    }
  }
  enemy.dodgeX += enemy.dodgeVX;
  enemy.dodgeY += enemy.dodgeVY;
  enemy.dodgeVX *= 0.86;
  enemy.dodgeVY *= 0.86;
  enemy.dodgeX = Math.max(-DODGE_LIMIT, Math.min(DODGE_LIMIT, enemy.dodgeX)) * 0.965;
  enemy.dodgeY = Math.max(-DODGE_LIMIT * 0.5, Math.min(DODGE_LIMIT * 0.5, enemy.dodgeY)) * 0.965;
}

function updateEnemy(enemy, time) {
  if (enemy.type === "grunt") return enemy.y + Math.sin(time * 2 + enemy.phase) * 5;

  if (enemy.type === "skimmer") {
    const pressure = venusPressure();
    enemy.timer--;
    const sway = Math.min(12, W * 0.018) * (1 + pressure * 0.5);
    const baseX = enemy.homeX + Math.sin(time * (0.95 + pressure * 0.35) + enemy.phase) * sway;
    const baseY = enemy.homeY + Math.sin(time * 2.5 + enemy.phase) * 10;
    if (pressure > 0) updateDodge(enemy, baseY);
    enemy.x = Math.max(26, Math.min(W - 26, baseX + enemy.dodgeX));
    const ey = Math.max(60, Math.min(playableBottomY() - 40, baseY + enemy.dodgeY));
    // Lead the ship instead of shooting where it was: the further into the
    // chapter, the further ahead the skimmers aim.
    const lead = 10 + pressure * 16;
    const aim = Math.atan2(aimTargetY() + (decoy ? 0 : player.vy * lead) - ey,
      aimTargetX() + (decoy ? 0 : player.vx * lead) - enemy.x);
    enemy.aimX = Math.cos(aim);
    enemy.aimY = Math.sin(aim);
    if (enemy.timer === 24) enemy.state = "wind";
    if (enemy.timer <= 0) {
      const speed = 2.5 + pressure * 0.75;
      for (const side of [-1, 1]) {
        fireVenusShot(enemy.x + side * 12, ey + 12, aim + side * .55, speed, "venus-crescent");
        enemyBullets[enemyBullets.length - 1].curve = -side * .012;
      }
      // past the midpoint of the chapter they add a straight third blade down
      // the middle, so the two curving ones can no longer be split
      if (pressure >= 0.66) fireVenusShot(enemy.x, ey + 12, aim, speed + 0.4, "venus-crescent");
      enemy.state = "idle";
      enemy.timer = Math.round(150 - pressure * 52) + Math.floor(Math.random() * Math.round(80 - pressure * 30));
      playSound(260, 0.09, "triangle");
    }
    return ey;
  }

  if (enemy.type === "bloom") {
    const pressure = venusPressure();
    enemy.timer--;
    enemy.spin += 0.018 + pressure * 0.01;
    // Blooms walk. They are the slowest thing on the field, but they close the
    // horizontal gap on the ship, so the seed starts its run from above you
    // rather than from wherever the formation happened to put it.
    const drift = 0.28 + pressure * 0.5;
    // each bloom keeps its own station off the ship's column, so two of them
    // never stack on the same spot
    const wanted = Math.max(70, Math.min(W - 70, aimTargetX() + Math.sin(enemy.phase) * 150));
    enemy.homeX += Math.max(-drift, Math.min(drift, wanted - enemy.homeX));
    enemy.x = enemy.homeX;
    const ey = enemy.homeY + Math.sin(time * 1.35 + enemy.phase) * 5;
    if (enemy.timer === 34) enemy.state = "wind";
    if (enemy.timer <= 0) {
      const aim = Math.atan2(aimTargetY() - ey, aimTargetX() - enemy.x);
      fireVenusShot(enemy.x, ey + 20, aim, 3.05 + pressure * 0.35, "venus-seed");
      const seed = enemyBullets[enemyBullets.length - 1];
      seed.fuse = Math.round(84 - pressure * 22);
      seed.turn = 0.042 + pressure * 0.022;
      seed.shards = pressure >= 1 ? 6 : 4;
      enemy.state = "idle";
      enemy.timer = Math.round(150 - pressure * 48) + Math.floor(Math.random() * Math.round(85 - pressure * 35));
      playSound(115, 0.16, "sawtooth");
    }
    return ey;
  }

  if (enemy.type === "turret") {
    enemy.spin += 0.01;
    // barrel tracks the player, and the spread is fired along it
    const aim = Math.atan2(aimTargetY() - enemy.y, aimTargetX() - enemy.x);
    enemy.aimX = Math.cos(aim);
    enemy.aimY = Math.sin(aim);
    enemy.timer--;
    if (enemy.timer === 26) enemy.state = "wind";
    if (enemy.timer <= 0) {
      enemy.state = "idle";
      for (const offset of [-0.34, 0, 0.34]) {
        fireStraightShot(enemy.x, enemy.y + 14, aim + offset, 3.4);
      }
      playSound(180, 0.1, "square");
      enemy.timer = 140 + Math.floor(Math.random() * 90);
    }
    return enemy.y + Math.sin(time * 1.2 + enemy.phase) * 2;
  }

  // --- charger ------------------------------------------------------------
  // One readable wind-up, then continuous pursuit. It never fires and never
  // retreats to formation; the player has to destroy it or keep evading it.
  enemy.timer--;
  if (enemy.state === "idle") {
    enemy.x += (enemy.homeX - enemy.x) * 0.03;
    enemy.y += (enemy.homeY - enemy.y) * 0.03 + Math.sin(time * 2.4 + enemy.phase) * 0.3;
    if (enemy.timer <= 0) {
      enemy.state = "wind";
      enemy.timer = 42;
      playSound(90, 0.18, "sawtooth");
    }
  } else if (enemy.state === "wind") {
    const aim = Math.atan2(aimTargetY() - enemy.y, aimTargetX() - enemy.x);
    enemy.aimX = Math.cos(aim);
    enemy.aimY = Math.sin(aim);
    enemy.x -= enemy.aimX * 0.7;   // rears back before the lunge
    enemy.y -= enemy.aimY * 0.7;
    if (enemy.timer <= 0) {
      enemy.state = "hunt";
      enemy.vx = enemy.aimX * 4.6;
      enemy.vy = enemy.aimY * 4.6;
      playSound(240, 0.14, "sawtooth");
    }
  } else {
    const targetAngle = Math.atan2(aimTargetY() - enemy.y, aimTargetX() - enemy.x);
    const currentAngle = Math.atan2(enemy.vy, enemy.vx);
    let angleDiff = targetAngle - currentAngle;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    const nextAngle = currentAngle + Math.max(-0.047, Math.min(0.047, angleDiff));
    const speed = 4.6;
    enemy.aimX = Math.cos(nextAngle);
    enemy.aimY = Math.sin(nextAngle);
    enemy.vx = enemy.aimX * speed;
    enemy.vy = enemy.aimY * speed;
    enemy.x += enemy.vx;
    enemy.y += enemy.vy;
    // Keep the whole target visible at the arena edge while its steering turns
    // it back toward the ship; hard bounces made pursuit look erratic.
    enemy.x = Math.max(20, Math.min(W - 20, enemy.x));
    enemy.y = Math.max(40, Math.min(H - 30, enemy.y));
    if (Math.random() < 0.42) spawnSparks(enemy.x - enemy.vx * 2, enemy.y - enemy.vy * 2, 1, "#ff9f5a");
  }
  return enemy.y;
}

function drawEnemy(enemy, ey, time) {
  const flash = enemy.hitFlash > 0;
  if (enemy.type === "grunt") {
    ctx.fillStyle = flash ? "#ffffff" : "#c77dff";
    ctx.beginPath();
    ctx.moveTo(enemy.x, ey - enemy.h);
    ctx.lineTo(enemy.x - enemy.w, ey + 7);
    ctx.lineTo(enemy.x - 7, ey + 3);
    ctx.lineTo(enemy.x, ey + enemy.h);
    ctx.lineTo(enemy.x + 7, ey + 3);
    ctx.lineTo(enemy.x + enemy.w, ey + 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = flash ? "#c77dff" : "#2a0f3d";
    ctx.fillRect(enemy.x - 6, ey - 4, 12, 5);
    return;
  }

  if (enemy.type === "skimmer") {
    const winding = enemy.state === "wind";
    ctx.save();
    ctx.translate(enemy.x, ey);
    if (winding) drawGlow("#dfff65", 22, 0, 0);
    ctx.strokeStyle = winding ? "#f1ffab" : "#959c45";
    ctx.lineWidth = 2;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 12, 5);
      ctx.quadraticCurveTo(side * 31, -14 + Math.sin(time * 4 + enemy.phase) * 4, side * 24, -23);
      ctx.stroke();
    }
    ctx.fillStyle = flash ? "#ffffff" : winding ? "#f0ff8e" : "#d8d94f";
    ctx.beginPath();
    ctx.moveTo(0, -enemy.h);
    ctx.quadraticCurveTo(-13, -10, -enemy.w, 2);
    ctx.quadraticCurveTo(-11, 8, 0, enemy.h);
    ctx.quadraticCurveTo(11, 8, enemy.w, 2);
    ctx.quadraticCurveTo(13, -10, 0, -enemy.h);
    ctx.fill();
    ctx.fillStyle = "#4b3810";
    ctx.beginPath(); ctx.ellipse(0, 1, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff39a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-19, 1); ctx.quadraticCurveTo(-10, -8, 0, -5); ctx.quadraticCurveTo(10, -8, 19, 1); ctx.stroke();
    ctx.fillStyle = winding ? "#ffffff" : "#b9ff67";
    ctx.beginPath(); ctx.arc(0, 1, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }

  if (enemy.type === "bloom") {
    const winding = enemy.state === "wind";
    const pulse = winding ? 1.12 + Math.sin(time * 26) * 0.08 : 1;
    ctx.save();
    ctx.translate(enemy.x, ey);
    ctx.rotate(enemy.spin);
    ctx.scale(pulse, pulse);
    if (winding) drawGlow("#ff9d42", 29, 0, 0);
    ctx.fillStyle = flash ? "#ffffff" : winding ? "#ffc36e" : "#ff8a3d";
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4);
      ctx.beginPath();
      ctx.ellipse(0, winding ? -23 : -18, winding ? 6 : 8, 14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = flash ? "#ff8a3d" : "#5b1d12";
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = winding ? "#fff2a6" : "#ffce58";
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ffe68d";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    return;
  }

  if (enemy.type === "turret") {
    const winding = enemy.state === "wind";
    ctx.save();
    ctx.translate(enemy.x, ey);
    // barrel
    ctx.rotate(Math.atan2(enemy.aimY, enemy.aimX) - Math.PI / 2);
    ctx.fillStyle = winding ? "#fff2c9" : "#3f7f76";
    ctx.fillRect(-5, 4, 10, 22);
    ctx.restore();
    ctx.save();
    ctx.translate(enemy.x, ey);
    if (winding) drawGlow("#ffdc5a", 20, 0, 0);
    // armoured hex shell
    ctx.fillStyle = flash ? "#ffffff" : winding ? "#8fffe9" : "#5ad1c0";
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = enemy.spin + (i / 6) * Math.PI * 2;
      const px = Math.cos(a) * enemy.w;
      const py = Math.sin(a) * enemy.h;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0d2b2a";
    ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = winding ? "#ffdc5a" : "#b6fff3";
    ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, Math.PI * 2); ctx.fill();
    // damage pips
    ctx.fillStyle = "#0d2b2a";
    for (let i = 0; i < enemy.maxHealth - enemy.health; i++) ctx.fillRect(-9 + i * 7, -enemy.h - 6, 5, 3);
    ctx.restore();
    return;
  }

  // charger: an arrowhead that always points where it is about to go
  const winding = enemy.state === "wind";
  const hunting = enemy.state === "hunt";
  const angle = hunting
    ? Math.atan2(enemy.vy, enemy.vx)
    : Math.atan2(enemy.aimY || 1, enemy.aimX || 0);
  ctx.save();
  ctx.translate(enemy.x, ey);
  ctx.rotate(angle + Math.PI / 2);
  if (hunting) {
    ctx.fillStyle = "rgba(255, 150, 60, 0.55)";
    ctx.beginPath();
    ctx.moveTo(-7, 6); ctx.lineTo(0, 26 + Math.sin(time * 40) * 6); ctx.lineTo(7, 6);
    ctx.closePath(); ctx.fill();
  }
  if (winding) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 30);
    drawGlow("#ff4747", 22, 0, 0);
    ctx.globalAlpha = 0.35 + pulse * 0.4;
    ctx.strokeStyle = "#ff4747";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 22 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = flash ? "#ffffff" : winding ? "#ffd0a0" : "#ff7a4f";
  ctx.beginPath();
  ctx.moveTo(0, -enemy.h - 4);
  ctx.lineTo(enemy.w, enemy.h);
  ctx.lineTo(0, enemy.h * 0.45);
  ctx.lineTo(-enemy.w, enemy.h);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = enemy.health < enemy.maxHealth ? "#ffdc5a" : "#4a1200";
  ctx.beginPath(); ctx.arc(0, -2, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function enterBossArea(kind = "moon") {
  bossKind = kind;
  bossMode = false;
  bossIntro = true;
  bossDefeated = false;
  boss = { x: W / 2, y: bossSpawnY(), health: bossMaxHealth() };
  resetBossAnimation();
  setText(document.getElementById("boss-health-name"), bossLabel());
  setText(document.getElementById("boss-intro-name"), bossLabel());
  setText(document.getElementById("boss-intro-hp"), bossMaxHealth() + " HP");
  bossShotTimer = 64;
  bossAttackTimer = 150;
  bossBullets = [];
  techChains = [];
  document.getElementById("boss-health").classList.add("visible");
  document.getElementById("boss-health").classList.toggle("venus", kind === "venus");
  // through setWidth, so the change-detection cache doesn't go stale and skip
  // the first real write of the next fight
  setWidth(dom.bossFill, 0);
  const bossHealth = document.getElementById("boss-health");
  bossHealth.classList.remove("filling");
  void bossHealth.offsetWidth;
  bossHealth.classList.add("filling");
  setTimeout(() => bossHealth.classList.remove("filling"), 1600);
  player.x = W / 2; player.y = playerStartY(); player.vx = 0; player.vy = 0;
  document.getElementById("boss-player-name").textContent = playerName;
  const intro = document.getElementById("boss-intro");
  // The portrait is the defeat screen's laughing planet, so it repaints for
  // whichever boss is being announced.
  intro.classList.toggle("venus", kind === "venus");
  // Restart the entrance: the card is reused for every boss in a run.
  intro.classList.remove("visible");
  void intro.offsetWidth;
  intro.classList.add("visible");
  bossIntroFrame = 0;
  versusCardUp = true;
  // Nothing but the two fighters: the wave counter, score, hearts, super meter
  // and the boss bar all belong to the fight, not to the card announcing it.
  dom.gameUi.classList.add("versus");
  syncMobileControls();
  focusMenuDefault(dom.bossIntro);
}

function resetBossAnimation() {
  bossHitFlash = 0;
  bossShootAnim = 0;
  bossChargeAnim = 0;
  bossShakeTimer = 0;
  bossParticles = [];
  bossExplosions = [];
  bossDying = false;
  bossDeathTimer = 0;
  bossSpin = 0;
  bossShards = [];
  bossDamageStage = 0;
  bossBlink = 0;
  bossBlinkTimer = 200;
  bossDrift = 0;
  bossBurstTimer = Math.round(rand(450, 600));
  venusSpin = 0;
  venusVortexSpin = 0;
  venusAttack = "rest";
  venusAttackTimer = 150;
  venusStep = 0;
  venusRotation = 0;
  venusQueue = [];
  venusBolts = [];
  venusDive = null;
  venusLastAttack = "";
  venusChain = 0;
  venusTelegraph = "";
  venusTelegraphAt = 0;
  venusBandPhase = 0;
  venusCells = [];
  bossPhase = 1;
  bossPhaseFlash = 0;
  bossMinions = [];
  bossMinionTimer = 260;
  moonImpacts = [];
  moonImpactTimer = 150;
  moonPull = 0;
  moonPullTimer = 620;
  moonEclipse = 0;
  moonEclipseTimer = 0;
  moonLit = MOON_PHASE_LIGHT[0];
  moonLibration = 0;
  clearSuperEntities();
}

// ---------------------------------------------------------------------------
// Boss phases and Mercury's brood
//
// A single-phase boss is a damage race: once you have read its three patterns
// there is nothing left to learn, which is what made both fights fall over. Each
// third of the health bar now speeds every timer up and adds something new, and
// Mercury's addition is the one thing a planet can plausibly throw — pieces of
// itself. `bossMinions` are chips of rock that home in and have to be shot down
// or dodged, so late in the fight the arena is never empty.
// ---------------------------------------------------------------------------
const PHASE_RATE = [1, 0.82, 0.66];        // timer multiplier per phase
// Five, not seven. Seven homing chips is a screen the player has to clear
// before they can look at anything else, and phase 2 sat on the cap.
const MINION_CAP = 5;

function phaseFor(health, max) {
  const ratio = Math.max(0, health) / max;
  return ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
}

function phaseRate() { return PHASE_RATE[bossPhase - 1]; }

// Called every frame of either fight; returns true on the frame it steps up.
function updateBossPhase() {
  if (bossPhaseFlash > 0) bossPhaseFlash--;
  const next = phaseFor(boss.health, bossMaxHealth());
  if (next <= bossPhase) return false;
  bossPhase = next;
  bossPhaseFlash = 42;
  bossShakeTimer = Math.max(bossShakeTimer, 26);
  screenShakeFrames = Math.max(screenShakeFrames, 16);
  screenShakeStrength = Math.max(screenShakeStrength, 7);
  bossExplosions.push({ x: boss.x, y: boss.y, r: 0, max: bossRadius() * 3.4, life: 34, maxLife: 34 });
  spawnBossShards(4);
  spawnBossParticles(40, {
    x: boss.x, y: boss.y, minSpeed: 1.5, maxSpeed: 7, minSize: 2, maxSize: 6, life: 44,
    colors: bossKind === "venus"
      ? ["#fff2c8", "#ffab4a", "#c96b23", "#7a3f18"]
      : ["#ffffff", "#e9e6dc", "#a5a29b", "#5c5a56"],
    gravity: 0.04, drag: 0.98,
  });
  bossHitFlash = BOSS_HIT_FRAMES;
  playSound(58, 0.9, "sawtooth");
  playSound(190, 0.3, "square");
  // The Moon's phases have names of their own, and the terminator is already
  // moving to match — the banner is only telling you what you can see.
  showWaveBanner(bossLabel(), bossKind === "moon"
    ? MOON_PHASE_NAME[bossPhase - 1]
    : bossPhase === 3 ? "FINAL PHASE" : `PHASE ${bossPhase}`);
  if (bossKind === "moon") {
    // the crust breaking is what throws the first ejecta out, and it opens the
    // new phase with a strike so the step-up is never a free second
    for (let i = 0; i < bossPhase; i++) spawnBossMinion(rand(0, Math.PI * 2));
    bossMinionTimer = 90;
    moonImpactTimer = 40;
  }
  return true;
}

function spawnBossMinion(angle) {
  if (bossMinions.length >= MINION_CAP) return;
  const dist = MOON_RADIUS * 0.9;
  bossMinions.push({
    x: boss.x + Math.cos(angle) * dist,
    y: boss.y + Math.sin(angle) * dist,
    vx: Math.cos(angle) * 3.2,
    vy: Math.sin(angle) * 3.2,
    health: 2,
    hitFlash: 0,
    spin: rand(0, Math.PI * 2),
    spinSpeed: rand(-0.06, 0.06),
    wobble: rand(0, Math.PI * 2),
    life: 1100,
  });
  spawnBossParticles(8, {
    x: boss.x + Math.cos(angle) * dist, y: boss.y + Math.sin(angle) * dist,
    angle, spread: 0.7, minSpeed: 1, maxSpeed: 4, minSize: 2, maxSize: 4, life: 22,
    colors: ["#e8e8e8", "#9a9a9a", "#ffdc5a"],
  });
  playSound(300, 0.1, "square");
}

// Chips of Mercury: slow but relentless, and they never stop turning. Two hits
// each, so a stray shot chips one rather than clearing it, and they are worth
// super meter — clearing the brood is a real choice against hitting the planet.
function updateBossMinions() {
  // steering tightens with the phase, but the speed cap stays low enough that
  // outrunning one is always possible; the pressure is that there are several
  const turn = bossPhase >= 3 ? 0.055 : 0.038;
  const speed = bossPhase >= 3 ? 3.4 : 2.9;
  for (const m of bossMinions) {
    m.life--;
    if (m.hitFlash > 0) m.hitFlash--;
    m.wobble += 0.09;
    m.spin += m.spinSpeed;
    const targetAngle = Math.atan2(aimTargetY() - m.y, aimTargetX() - m.x);
    const currentAngle = Math.atan2(m.vy, m.vx);
    let diff = targetAngle - currentAngle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const next = currentAngle + Math.max(-turn, Math.min(turn, diff));
    m.vx = Math.cos(next) * speed;
    m.vy = Math.sin(next) * speed;
    m.x += m.vx;
    m.y += m.vy;
    m.x = Math.max(16, Math.min(W - 16, m.x));
    m.y = Math.max(24, Math.min(H - 20, m.y));

    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.spin);
    const r = 13 + Math.sin(m.wobble) * 0.8;
    if (m.hitFlash > 0) drawGlow("#ffffff", 26, 0, 0);
    ctx.fillStyle = m.hitFlash > 0 ? "#ffffff" : m.health > 1 ? "#8f8b84" : "#6b6862";
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.lineTo(r * 0.85, -r * 0.4);
    ctx.lineTo(r * 0.7, r * 0.7);
    ctx.lineTo(-r * 0.2, r);
    ctx.lineTo(-r * 0.9, r * 0.3);
    ctx.lineTo(-r * 0.75, -r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255, 248, 226, 0.2)";
    ctx.beginPath(); ctx.arc(-r * 0.3, -r * 0.35, r * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // eyes stay upright and track the ship, so the chip reads as alive
    const look = Math.max(-1, Math.min(1, (player.x - m.x) / 90));
    const lookY = Math.max(-1, Math.min(1, (player.y - m.y) / 90));
    ctx.fillStyle = m.hitFlash > 0 ? "#ff4747" : "#241f1a";
    ctx.fillRect(m.x - 6, m.y - 3, 4, 4);
    ctx.fillRect(m.x + 2, m.y - 3, 4, 4);
    ctx.fillStyle = "#ffdc5a";
    ctx.fillRect(m.x - 5.5 + look, m.y - 2.5 + lookY, 2, 2);
    ctx.fillRect(m.x + 2.5 + look, m.y - 2.5 + lookY, 2, 2);

    const hitWidth = player.shrunk ? 12 : 20;
    const hitHeight = player.shrunk ? 13 : 22;
    if (!devGodMode && playerInvulnerable === 0 && Math.abs(m.x - player.x) < hitWidth && Math.abs(m.y - player.y) < hitHeight) {
      hurtPlayer();
      m.health = 0;
      if (!gameActive) return;
    }
    for (const bullet of bullets) {
      if (bullet.y < -50 || bullet.ignore === m) continue;
      if (Math.abs(bullet.x - m.x) < 16 && Math.abs(bullet.y - m.y) < 16) {
        m.health -= bullet.damage || 1;
        m.hitFlash = 6;
        superDamage += bullet.damage || 1;
        updateSuperMeter();
        if (bullet.type === "tech0") startTechChainBoss(m.x, m.y, m);
        if (bullet.type === "magma") burstMagma(bullet, m.x, m.y, m);
        if (bullet.pierceRemaining !== Infinity) {
          bullet.pierceRemaining--;
          if (bullet.pierceRemaining <= 0) bullet.y = -100;
        }
        break;
      }
    }
    if (superBeam && superBeam.life % BEAM_TICK === 0 && beamDistance(m.x, m.y) < BEAM_HALF_WIDTH + 13) {
      m.health -= 1;
      m.hitFlash = 6;
    }
    if (m.health <= 0) {
      score += 90;
      spawnBossParticles(12, {
        x: m.x, y: m.y, minSpeed: 1, maxSpeed: 4.5, minSize: 2, maxSize: 4, life: 26,
        colors: ["#e8e8e8", "#b0b0b0", "#ffdc5a", "#6f6f6f"], gravity: 0.06,
      });
      playSound(210, 0.09, "square");
    }
  }
  compact(bossMinions, (m) => m.health > 0 && m.life > 0);
}

// Rock knocked loose by damage, kept in orbit around the planet. Each shard has
// its own inclination, so the swarm reads as debris rather than a tidy ring.
function spawnBossShards(count) {
  for (let i = 0; i < count; i++) {
    bossShards.push({
      angle: rand(0, Math.PI * 2),
      speed: rand(0.004, 0.011) * (Math.random() < 0.5 ? -1 : 1),
      dist: MOON_RADIUS * rand(1.12, 1.5),
      flatten: rand(0.2, 0.85),
      size: rand(4, 11),
      spin: rand(0, Math.PI * 2),
      spinSpeed: rand(-0.05, 0.05),
      shade: Math.random() < 0.5 ? "#8d8880" : "#6a6660",
    });
  }
}

function drawBossShards(front) {
  for (const shard of bossShards) {
    const depth = Math.sin(shard.angle);
    if ((depth >= 0) !== front) continue;
    const x = Math.cos(shard.angle) * shard.dist;
    const y = Math.sin(shard.angle) * shard.dist * shard.flatten;
    const scale = 0.7 + (depth + 1) * 0.25;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(shard.spin);
    ctx.scale(scale, scale);
    ctx.fillStyle = shard.shade;
    ctx.beginPath();
    ctx.moveTo(-shard.size, -shard.size * 0.5);
    ctx.lineTo(0, -shard.size);
    ctx.lineTo(shard.size, -shard.size * 0.3);
    ctx.lineTo(shard.size * 0.6, shard.size * 0.8);
    ctx.lineTo(-shard.size * 0.7, shard.size * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255, 246, 220, 0.22)";
    ctx.fillRect(-shard.size * 0.6, -shard.size * 0.5, shard.size * 0.7, shard.size * 0.3);
    ctx.restore();
  }
}

function startBossFight() {
  bossIntro = false; bossMode = true;
  versusCardUp = false;
  dom.gameUi.classList.remove("versus");
  document.getElementById("boss-intro").classList.remove("visible");
  syncMobileControls();
  music.play(bossKind === "venus" ? "venusBoss" : "boss");
  showWaveBanner(bossLabel(), bossKind === "venus" ? "SURVIVE THE FURNACE" : "DESTROY THE PLANET");
}

const MOON_MAX_HEALTH = 110;
const MOON_RADIUS = 78;
// The lit fraction of the disc in each phase, and what the banner calls it: the
// boss phase *is* the lunar phase, opening as a crescent and finishing full.
const MOON_PHASE_LIGHT = [0.24, 0.56, 1];
const MOON_PHASE_NAME = ["CRESCENT", "HALF MOON", "FULL MOON"];
// Venus is the second boss: bigger, tougher, and with attacks that cover the
// arena instead of aiming a line at the ship.
const VENUS_MAX_HEALTH = 250;
const VENUS_RADIUS = 96;

function bossRadius() { return bossKind === "venus" ? VENUS_RADIUS : MOON_RADIUS; }
function bossMaxHealth() { return bossKind === "venus" ? VENUS_MAX_HEALTH : MOON_MAX_HEALTH; }
function bossLabel() { return bossKind === "venus" ? "VENUS" : "THE MOON"; }
const BOSS_HIT_FRAMES = 12;
const BOSS_SHOOT_FRAMES = 20;
const BOSS_CHARGE_FRAMES = 26;
const BOSS_DEATH_FRAMES = 175;
const BROW_SIDES = [-1, 1];

// The Moon's gradients: the body is fixed in the planet's local space, the
// corona varies only with its radius and colour.
let bodyGradient = null;
let shadeGradient = null;
let auraGradient = null;
let auraGradientRadius = 0;
let auraGradientColor = "";

// Fixed surface features. The Moon is tidally locked — it has shown the Earth
// the same face for four billion years — so unlike a spinning planet this field
// never rotates. It is the same rock in the same place every frame, which is
// exactly why the damage scars read as damage.
const MOON_CRATERS = [
  { a: 0.4, d: 0.42, r: 13 }, { a: 1.7, d: 0.62, r: 9 }, { a: 2.6, d: 0.3, r: 16 },
  { a: 3.5, d: 0.7, r: 7 }, { a: 4.3, d: 0.5, r: 11 }, { a: 5.2, d: 0.28, r: 8 },
  { a: 5.9, d: 0.68, r: 12 }, { a: 2.1, d: 0.85, r: 6 }, { a: 4.9, d: 0.86, r: 5 },
  { a: 0.95, d: 0.78, r: 7 }, { a: 3.05, d: 0.88, r: 5 }, { a: 5.55, d: 0.82, r: 6 },
];
// The dark seas. Kept out toward the limb so they frame the face instead of
// swallowing it.
const MOON_MARIA = [
  { x: -0.46, y: -0.44, rx: 0.28, ry: 0.20, a: 0.5 },
  { x: 0.44, y: -0.40, rx: 0.22, ry: 0.16, a: -0.4 },
  { x: 0.58, y: 0.30, rx: 0.24, ry: 0.19, a: 0.9 },
  { x: -0.58, y: 0.34, rx: 0.22, ry: 0.16, a: -0.7 },
  { x: 0.0, y: -0.72, rx: 0.26, ry: 0.13, a: 0.1 },
];
// Fresh craters punched by the player, revealed as the health bar drains. On an
// airless world a new impact throws bright rays of ejecta clear across the face,
// which is what makes these read as damage rather than more scenery.
const MOON_SCARS = [
  { x: -0.30, y: -0.60, r: 0.085, seed: 0.3 },
  { x: 0.62, y: -0.14, r: 0.075, seed: 1.1 },
  { x: 0.34, y: 0.62, r: 0.09, seed: 2.4 },
  { x: -0.64, y: 0.16, r: 0.07, seed: 3.6 },
  { x: -0.12, y: 0.80, r: 0.08, seed: 4.9 },
];

function spawnBossParticles(count, options) {
  const budget = Math.max(1, Math.round(count * quality.particles));
  for (let i = 0; i < budget; i++) {
    const angle = options.angle === undefined
      ? rand(0, Math.PI * 2)
      : options.angle + rand(-options.spread, options.spread);
    const speed = rand(options.minSpeed, options.maxSpeed);
    const life = Math.round(rand(options.life * 0.6, options.life));
    bossParticles.push({
      x: options.x + rand(-4, 4),
      y: options.y + rand(-4, 4),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life,
      maxLife: life,
      size: Math.round(rand(options.minSize, options.maxSize)),
      color: options.colors[Math.floor(Math.random() * options.colors.length)],
      drag: options.drag === undefined ? 0.96 : options.drag,
      gravity: options.gravity || 0,
    });
  }
}

function updateBossParticles() {
  let lastColor = "";
  for (const p of bossParticles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= p.drag;
    p.vy = p.vy * p.drag + p.gravity;
    p.life--;
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    if (p.color !== lastColor) {
      lastColor = p.color;
      ctx.fillStyle = p.color;
    }
    ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
  }
  ctx.globalAlpha = 1;
  compact(bossParticles, (p) => p.life > 0);
}

function updateBossExplosions() {
  for (const boom of bossExplosions) {
    boom.life--;
    const progress = 1 - boom.life / boom.maxLife;
    const radius = boom.max * (0.25 + progress * 0.75);
    const fade = Math.max(0, 1 - progress);
    // Venus burns; the Moon has nothing to burn, so its blasts are the dust
    // they actually kick up.
    const cold = bossKind === "moon";
    ctx.globalAlpha = fade * 0.55;
    ctx.fillStyle = progress < 0.4 ? (cold ? "#fdfbf5" : "#fff3c4") : (cold ? "#a8a49c" : "#ff8a32");
    ctx.beginPath(); ctx.arc(boom.x, boom.y, radius * 0.72, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = cold ? "#e9e6dc" : "#ffdc5a";
    ctx.lineWidth = 4 * fade + 1;
    ctx.beginPath(); ctx.arc(boom.x, boom.y, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  compact(bossExplosions, (boom) => boom.life > 0);
}

// The boss takes a hit: flash, recoil, and spit rock chips back along the shot.
function damageBoss(amount, fromX, fromY) {
  if (bossDying) return;
  boss.health -= amount;
  // each quarter of health knocks a few chunks off the planet, for good
  const stage = Math.floor((1 - Math.max(0, boss.health) / bossMaxHealth()) * 4);
  if (stage > bossDamageStage) {
    bossDamageStage = stage;
    spawnBossShards(3);
    bossShakeTimer = Math.max(bossShakeTimer, 12);
  }
  bossHitFlash = BOSS_HIT_FRAMES;
  bossShakeTimer = Math.max(bossShakeTimer, 6);
  const angle = Math.atan2(boss.y - fromY, boss.x - fromX) + Math.PI;
  spawnBossParticles(Math.min(14, 4 + Math.round(amount * 2)), {
    x: boss.x + Math.cos(angle + Math.PI) * bossRadius() * 0.8,
    y: boss.y + Math.sin(angle + Math.PI) * bossRadius() * 0.8,
    angle,
    spread: 0.9,
    minSpeed: 1.4,
    maxSpeed: 4.6,
    minSize: 2,
    maxSize: 4,
    life: 26,
    colors: bossKind === "venus"
      ? ["#ffe6a8", "#ffab4a", "#c96b23", "#6f3a17"]
      : ["#e8e8e8", "#b0b0b0", "#ffdc5a", "#7d7d7d"],
    gravity: 0.06,
  });
  playSound(140 + Math.random() * 60, 0.06, "square");
}

function startBossDeath() {
  bossDying = true;
  bossDeathTimer = BOSS_DEATH_FRAMES;
  bossShootAnim = 0;
  bossChargeAnim = 0;
  boss.health = 0;
  bullets = [];
  bossBullets = [];
  enemyBullets = [];
  superBombs = [];
  techChains = [];
  venusQueue = [];
  venusBolts = [];
  bossMinions = [];
  clearSuperEntities();
  music.stop();
  setWidth(dom.bossFill, 0);
  playSound(70, 0.9, "sawtooth");
}

function updateBossDeath() {
  bossDeathTimer--;
  bossShakeTimer = 2;
  const elapsed = BOSS_DEATH_FRAMES - bossDeathTimer;

  // stage 1: rupture — chained blasts crawling over the surface
  if (elapsed < 120 && elapsed % 8 === 0) {
    const angle = rand(0, Math.PI * 2);
    const dist = rand(0, bossRadius() * 0.85);
    const x = boss.x + Math.cos(angle) * dist;
    const y = boss.y + Math.sin(angle) * dist;
    bossExplosions.push({ x, y, r: 0, max: rand(26, 58), life: 16, maxLife: 16 });
    spawnBossParticles(8, {
      x, y, minSpeed: 0.6, maxSpeed: 3.4, minSize: 2, maxSize: 5, life: 34,
      colors: ["#ffdc5a", "#ff8a32", "#d8d8d8", "#8a8a8a"], gravity: 0.05,
    });
    playSound(rand(90, 190), 0.14, "sawtooth");
  }

  // stage 2: the planet goes up
  if (elapsed === 126) {
    bossExplosions.push({ x: boss.x, y: boss.y, r: 0, max: 260, life: 34, maxLife: 34 });
    bossExplosions.push({ x: boss.x, y: boss.y, r: 0, max: 150, life: 22, maxLife: 22 });
    spawnBossParticles(90, {
      x: boss.x, y: boss.y, minSpeed: 2, maxSpeed: 11, minSize: 2, maxSize: 7, life: 55,
      colors: ["#ffffff", "#ffdc5a", "#ff8a32", "#c9c9c9", "#6f6f6f"], gravity: 0.09, drag: 0.985,
    });
    flashDamage();
    playSound(55, 1.2, "sawtooth");
  }

  if (bossDeathTimer <= 0) finishBossDeath();
}

function finishBossDeath() {
  // Mercury stands on wave 5 and Venus on wave 10; beating one clears its wave,
  // which is what opens the next chapter's first stage in LEVELS.
  recordWaveCleared(bossKind === "venus" ? 10 : 5);
  bossDying = false;
  bossMode = false;
  document.getElementById("boss-health").classList.remove("visible");
  document.getElementById("boss-health").classList.remove("venus");
  bullets = [];
  bossBullets = [];
  enemyBullets = [];
  venusBolts = [];
  bossMinions = [];
  clearSuperEntities();
  lives++;
  setLives(lives, true);
  if (bossKind === "venus") {
    // Venus pays out Magma on its own reward screen, then the run carries on
    // past the furnace with the extra heart already granted.
    bossKind = "moon";
    bossDefeated = true;
    wave = 11;
    player.x = W / 2; player.y = playerStartY(); player.vx = 0; player.vy = 0;
    showVenusRewards();
    return;
  }
  // The run ends here while Venus is out, so the HUD stays on the wave that was
  // actually played instead of announcing a chapter that is not in the game.
  wave = 5;
  if (!bossDefeated) {
    bossDefeated = true;
    showVictory();
  }
}

// ---------------------------------------------------------------------------
// The Moon's body, as one reusable painter.
//
// Both the arena and the menu's MOON UPDATE badge draw the Moon, and they have
// to be the same Moon — a hand-made CSS lookalike drifted from the real thing
// immediately and read as a different character. So the body lives here and
// `drawMoon` is only the part that knows about the fight: the shake, the squash,
// the halo, the debris, the slam ring.
//
// Everything is drawn in the boss's own space at `MOON_RADIUS`; the caller
// scales. `g` is any 2D context, so gradients are cached per context rather than
// in a module-level variable — a CanvasGradient belongs to the context that
// made it and cannot be handed to another one.
// ---------------------------------------------------------------------------
function moonBodyGradient(g) {
  const R = MOON_RADIUS;
  if (!g.__moonBody) {
    const grad = g.createRadialGradient(-R * 0.34, -R * 0.38, R * 0.12, 0, 0, R);
    grad.addColorStop(0, "#fbf8f1");
    grad.addColorStop(0.4, "#cbc7bf");
    grad.addColorStop(0.76, "#8a8781");
    grad.addColorStop(1, "#3b3936");
    g.__moonBody = grad;
  }
  return g.__moonBody;
}

// o: { t, lit, damage, charge, shoot, hit, eclipsed, dying, shut, lookX, lookY, glow }
function paintMoonBody(g, o) {
  const R = MOON_RADIUS;

  g.fillStyle = moonBodyGradient(g);
  g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();

  // Maria, craters, scars, terminator and face all clip to the same disc.
  // Clipping is one of the priciest canvas calls, so set it once.
  g.save();
  g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.clip();

  // maria — the dark seas, kept out toward the limb so the face still reads
  for (const m of MOON_MARIA) {
    g.fillStyle = "rgba(58, 57, 62, 0.34)";
    g.beginPath();
    g.ellipse(m.x * R, m.y * R, m.rx * R, m.ry * R, m.a, 0, Math.PI * 2);
    g.fill();
  }

  // craters, with the light coming from the upper left like the body gradient
  for (const crater of MOON_CRATERS) {
    const x = Math.cos(crater.a) * crater.d * R;
    const y = Math.sin(crater.a) * crater.d * R;
    g.fillStyle = "rgba(38, 37, 36, 0.34)";
    g.beginPath(); g.arc(x, y, crater.r, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255, 255, 255, 0.17)";
    g.beginPath(); g.arc(x - crater.r * 0.28, y - crater.r * 0.3, crater.r * 0.62, 0, Math.PI * 2); g.fill();
  }

  // --- battle damage -------------------------------------------------------
  // Not lava — the Moon has none. Damage punches fresh craters, and a fresh
  // crater on an airless world throws bright rays of ejecta right across the
  // face. The number showing is the health bar, told in rock.
  const scarCount = Math.min(MOON_SCARS.length,
    Math.floor(o.damage * MOON_SCARS.length + (o.dying ? MOON_SCARS.length : 0)));
  for (let i = 0; i < scarCount; i++) {
    const scar = MOON_SCARS[i];
    const sx = scar.x * R;
    const sy = scar.y * R;
    const sr = scar.r * R;
    g.strokeStyle = "rgba(252, 250, 244, 0.3)";
    g.lineWidth = 2;
    g.beginPath();
    for (let n = 0; n < 7; n++) {
      const a = scar.seed + (n / 7) * Math.PI * 2;
      const len = sr * (2.4 + ((n * 7 + i * 3) % 5) * 0.5);
      g.moveTo(sx + Math.cos(a) * sr * 0.9, sy + Math.sin(a) * sr * 0.9);
      g.lineTo(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
    }
    g.stroke();
    g.fillStyle = "rgba(250, 248, 242, 0.22)";
    g.beginPath(); g.arc(sx, sy, sr * 1.25, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(26, 25, 24, 0.72)";
    g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255, 255, 255, 0.22)";
    g.beginPath(); g.arc(sx - sr * 0.26, sy - sr * 0.3, sr * 0.6, 0, Math.PI * 2); g.fill();
  }

  // The lit fraction is the phase, so this one shape carries the whole state of
  // the fight: a crescent to open, half awake, then full and blazing.
  paintMoonShadow(g, R, o.lit, o.eclipsed ? 0.93 : 0.8);

  // The face goes *over* the shadow and is then dusted with it again at low
  // alpha, so the dark half subdues it without hiding it — and the eyes, which
  // glow, cut straight through. A crescent Moon staring out of its own shadow
  // is the whole character of the fight.
  paintMoonFace(g, o);
  paintMoonShadow(g, R, o.lit, o.eclipsed ? 0.5 : 0.28);

  g.restore();

  // rim light along the lit limb — crisp, because there is no air to soften it
  g.strokeStyle = o.eclipsed ? "rgba(255, 250, 235, 0.95)" : "rgba(244, 248, 255, 0.5)";
  g.lineWidth = o.eclipsed ? 3 : 2;
  g.beginPath(); g.arc(0, 0, R - 1, Math.PI * 0.86, Math.PI * 1.78); g.stroke();
}

// The shadowed part of a lunar phase: the far limb, closed off by a half
// ellipse whose width is how far past half-lit we are. `lit` 0 is new, 0.5 is
// exactly half, 1 is full. Must be called inside the body's clip.
function paintMoonShadow(g, R, lit, alpha) {
  const k = 1 - 2 * Math.max(0, Math.min(1, lit));
  if (k <= -0.995) return;                       // full: nothing to darken
  g.save();
  g.fillStyle = `rgba(6, 8, 14, ${alpha})`;
  g.beginPath();
  g.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, false);
  // Past half-lit the terminator bows away from the dark side and the shadow
  // shrinks; before it, it bows across the face and the shadow grows.
  g.ellipse(0, 0, Math.abs(k) * R, R, 0, Math.PI / 2, -Math.PI / 2, k < 0);
  g.closePath();
  g.fill();
  g.restore();
}

// Its face. Brows, tracking pupils, a mouth that gapes on the shot — painted
// cold: this is a body with no fire in it, so the only colour it owns is
// reflected sunlight.
function paintMoonFace(g, o) {
  const t = o.t;
  const angry = 0.35 + o.damage * 0.45 + o.charge * 0.55;
  const eyeGlow = o.eclipsed ? "#fff6d8" : o.charge > 0.05 ? "#9fd4ff" : o.hit > 0 ? "#fff3b0" : "#bfe4ff";
  const eyeRadius = (9 + o.charge * 4 + o.shoot * 2.5) * (o.hit > 0 ? 0.7 : 1);

  g.fillStyle = "#15161a";
  BROW_SIDES.forEach((side) => {
    g.save();
    g.translate(side * 27, -20);
    g.rotate(side * angry * 0.55 + Math.sin(t * .003 + side) * .035);
    g.beginPath();
    g.moveTo(-23, -9); g.lineTo(20, -19); g.lineTo(22, -7); g.lineTo(-22, 4);
    g.closePath(); g.fill();
    g.restore();
  });

  if (o.dying) {
    g.strokeStyle = "#1b1c22"; g.lineWidth = 6; g.lineCap = "round";
    for (const side of BROW_SIDES) {
      g.beginPath();
      g.moveTo(side * 27 - 8, -22); g.lineTo(side * 27 + 8, -6);
      g.moveTo(side * 27 + 8, -22); g.lineTo(side * 27 - 8, -6);
      g.stroke();
    }
  } else if (o.shut) {
    g.strokeStyle = o.hit > 0.05 ? eyeGlow : "#15161a";
    g.lineWidth = 6;
    g.lineCap = "round";
    BROW_SIDES.forEach((side) => {
      g.beginPath();
      g.moveTo(side * 27 - 10, -15);
      g.lineTo(side * 27, -10 - o.hit * 5);
      g.lineTo(side * 27 + 10, -15);
      g.stroke();
    });
  } else {
    const eyeGlowRadius = Math.round(16 + o.charge * 18 + (o.eclipsed ? 14 : 0));
    o.glow(eyeGlow, eyeGlowRadius, -27, -14);
    o.glow(eyeGlow, eyeGlowRadius, 27, -14);
    g.fillStyle = "#f4f2ec";
    g.beginPath();
    g.arc(-27, -14, eyeRadius, 0, Math.PI * 2);
    g.arc(27, -14, eyeRadius, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = eyeGlow;
    g.beginPath();
    g.arc(-27 + o.lookX, -14 + o.lookY, eyeRadius * 0.6, 0, Math.PI * 2);
    g.arc(27 + o.lookX, -14 + o.lookY, eyeRadius * 0.6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#0b1018";
    g.beginPath();
    g.arc(-27 + o.lookX, -14 + o.lookY, eyeRadius * 0.27, 0, Math.PI * 2);
    g.arc(27 + o.lookX, -14 + o.lookY, eyeRadius * 0.27, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath();
    g.arc(-31 + o.lookX, -18 + o.lookY, eyeRadius * 0.22, 0, Math.PI * 2);
    g.arc(23 + o.lookX, -18 + o.lookY, eyeRadius * 0.22, 0, Math.PI * 2);
    g.fill();
  }

  // mouth: a crater of a thing, gaping when it throws
  const mouthY = 44;
  if (o.dying) {
    g.fillStyle = "#15161a";
    g.beginPath(); g.ellipse(0, mouthY, 20, 15, 0, 0, Math.PI * 2); g.fill();
  } else if (o.shoot > 0.05 || o.charge > 0.3) {
    const open = 8 + o.shoot * 17 + o.charge * 8;
    const wide = 22 - o.charge * 8;
    g.fillStyle = "#101116";
    g.beginPath(); g.ellipse(0, mouthY, wide, open, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(190, 220, 255, 0.22)";
    g.beginPath(); g.ellipse(0, mouthY + open * 0.28, wide * 0.62, open * 0.4, 0, 0, Math.PI * 2); g.fill();
  } else {
    g.strokeStyle = "#15161a";
    g.lineWidth = 6;
    g.lineCap = "round";
    g.beginPath();
    g.arc(0, 44, 28, Math.PI + 0.32, Math.PI * 2 - 0.32);
    g.stroke();
  }
}

function drawMoon(t) {
  const deathProgress = bossDying ? 1 - Math.max(0, bossDeathTimer) / BOSS_DEATH_FRAMES : 0;
  // the body is gone once the big blast lands
  if (deathProgress > 0.74) return;

  let shakeX = 0;
  let shakeY = 0;
  if (bossShakeTimer > 0) {
    const power = bossDying ? 7 + deathProgress * 10 : 5;
    shakeX = rand(-power, power);
    shakeY = rand(-power, power);
    bossShakeTimer--;
  }

  const shoot = bossShootAnim > 0 ? bossShootAnim / BOSS_SHOOT_FRAMES : 0;   // 1 -> 0
  const hit = bossHitFlash > 0 ? bossHitFlash / BOSS_HIT_FRAMES : 0;         // 1 -> 0
  const charge = bossChargeAnim > 0 ? 1 - bossChargeAnim / BOSS_CHARGE_FRAMES : 0; // 0 -> 1
  const damage = 1 - Math.max(0, boss.health) / MOON_MAX_HEALTH;
  const eclipsed = moonEclipse > 0;

  // The phase is the fight. `moonLit` eases toward the third of the health bar
  // it is currently in, so the terminator visibly retreats over about a second
  // when it steps up rather than snapping.
  const litTarget = bossDying ? 1 : MOON_PHASE_LIGHT[bossPhase - 1];
  moonLit += (litTarget - moonLit) * 0.035;

  const bob = Math.sin(t * 0.0016) * 7;
  const cx = boss.x + shakeX;
  const cy = boss.y + bob + shakeY;
  const R = MOON_RADIUS;

  // squash/stretch: inhale on the wind-up, snap outward on the shot
  const squashX = 1 + shoot * 0.13 - charge * 0.09 - hit * 0.05;
  const squashY = 1 - shoot * 0.11 + charge * 0.11 + hit * 0.05;
  const scale = (1 + deathProgress * 0.12) * (1 - hit * 0.03);
  const fadeStart = 0.68;
  const alpha = bossDying && deathProgress > fadeStart
    ? Math.max(0, 1 - (deathProgress - fadeStart) / 0.06)
    : 1;

  // Tidally locked: it never turns away, so the crater field does not rotate.
  // What it does instead is librate — the real Moon's slow nod, which is the
  // only reason we have ever seen a sliver past the edge.
  moonLibration += 0.0021;

  ctx.save();
  ctx.globalAlpha = alpha;

  // --- halo ----------------------------------------------------------------
  // No atmosphere, so there is nothing to glow: what little there is comes from
  // sunlight scraping the limb, and it goes cold and hard while it winds up.
  const auraRadius = R * (1.2 + charge * 0.24 + shoot * 0.28 + (eclipsed ? 0.5 : 0));
  const auraColor = eclipsed
    ? "rgba(255, 250, 235, 0.42)"
    : charge > 0.05
      ? `rgba(${Math.round(200 + charge * 55)}, ${Math.round(226 + charge * 26)}, 255, ${(0.16 + charge * 0.26).toFixed(2)})`
      : "rgba(186, 214, 255, 0.14)";
  ctx.translate(cx, cy);
  if (!auraGradient || auraGradientRadius !== auraRadius || auraGradientColor !== auraColor) {
    auraGradient = ctx.createRadialGradient(0, 0, R * 0.78, 0, 0, auraRadius);
    auraGradient.addColorStop(0, auraColor);
    auraGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    auraGradientRadius = auraRadius;
    auraGradientColor = auraColor;
  }
  ctx.fillStyle = auraGradient;
  ctx.beginPath(); ctx.arc(0, 0, auraRadius, 0, Math.PI * 2); ctx.fill();

  // The gravity well, and — the important half — the ring the slam will clear.
  // It is drawn for the whole pull and tightens as the clock runs down, so
  // being caught by the slam is always something you could see coming.
  if (moonPull > 0) {
    for (let ring = 0; ring < 3; ring++) {
      const phase = ((t * 0.0011 + ring / 3) % 1);
      ctx.strokeStyle = `rgba(180, 214, 255, ${(0.34 * (1 - phase)).toFixed(3)})`;
      ctx.lineWidth = 2 + (1 - phase) * 2;
      ctx.beginPath(); ctx.arc(0, 0, R * (1.15 + phase * 3.2), 0, Math.PI * 2); ctx.stroke();
    }
    const imminent = moonPull < 55;
    const beat = imminent ? (moonPull % 10 < 5 ? 1 : 0.45) : 0.72;
    ctx.save();
    ctx.setLineDash([14, 11]);
    ctx.lineDashOffset = -t * 0.045;
    ctx.strokeStyle = imminent
      ? `rgba(255, 226, 150, ${beat.toFixed(2)})`
      : `rgba(206, 228, 255, ${beat.toFixed(2)})`;
    ctx.lineWidth = imminent ? 5 : 3;
    ctx.beginPath(); ctx.arc(0, 0, MOON_SLAM_R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = imminent ? 0.14 : 0.07;
    ctx.fillStyle = imminent ? "#ffd98a" : "#9fc4ff";
    ctx.beginPath(); ctx.arc(0, 0, MOON_SLAM_R, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // leans toward the player, harder while winding up
  const lean = Math.max(-1, Math.min(1, (player.x - boss.x) / (W * 0.4)));
  ctx.rotate(lean * (0.05 + charge * 0.09) + Math.sin(moonLibration) * 0.03);
  ctx.scale(scale * squashX, scale * squashY);

  // --- debris that has been knocked off, behind the body -------------------
  for (const shard of bossShards) {
    shard.angle += shard.speed;
    shard.spin += shard.spinSpeed;
  }
  drawBossShards(false);

  // --- body ----------------------------------------------------------------
  // Shared with the menu badge; see `paintMoonBody`.
  const toPlayer = Math.atan2(player.y - boss.y, player.x - boss.x);
  const look = Math.min(1, Math.hypot(player.x - boss.x, player.y - boss.y) / 260);
  const eyeR = (9 + charge * 4 + shoot * 2.5) * (hit > 0 ? 0.7 : 1);
  if (!bossDying) {
    if (bossBlink > 0) bossBlink--;
    else if (--bossBlinkTimer <= 0) {
      bossBlink = 8;
      bossBlinkTimer = 170 + Math.floor(Math.random() * 240);
    }
  }
  paintMoonBody(ctx, {
    t, lit: moonLit, damage, charge, shoot, hit,
    eclipsed, dying: bossDying,
    shut: hit > 0.05 || bossBlink > 0,
    lookX: Math.cos(toPlayer) * eyeR * 0.36 * look,
    lookY: Math.sin(toPlayer) * eyeR * 0.36 * look,
    glow: drawGlow,
  });

  // --- hit flash -----------------------------------------------------------
  if (hit > 0) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255, 255, 255, ${hit * 0.5})`;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  // --- debris passing in front ---------------------------------------------
  drawBossShards(true);

  ctx.restore();

  if (bossHitFlash > 0) bossHitFlash--;
  if (bossShootAnim > 0) bossShootAnim--;
}



// The eclipse veil. Painted in screen space after the body, so the bullets and
// the ship still draw on top of it and stay readable — losing sight of the
// Moon's wind-up is the attack; losing sight of what is already in the air
// would just be unfair.
function drawEclipseVeil(t) {
  if (moonEclipse <= 0) return;
  const ramp = Math.min(1, Math.min(moonEclipse, 40) / 40);   // fades in and out
  ctx.save();
  ctx.fillStyle = `rgba(2, 3, 7, ${(0.82 * ramp).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);
  // the corona: the one thing you can still see
  const R = MOON_RADIUS;
  const flare = 1 + Math.sin(t * 0.008) * 0.04;
  const g = ctx.createRadialGradient(boss.x, boss.y, R * 0.98, boss.x, boss.y, R * 2.5 * flare);
  g.addColorStop(0, `rgba(255, 250, 232, ${(0.55 * ramp).toFixed(3)})`);
  g.addColorStop(0.16, `rgba(255, 240, 200, ${(0.22 * ramp).toFixed(3)})`);
  g.addColorStop(1, "rgba(255, 230, 180, 0)");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(boss.x, boss.y, R * 2.5 * flare, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `rgba(3, 4, 9, ${(0.9 * ramp).toFixed(3)})`;
  ctx.beginPath(); ctx.arc(boss.x, boss.y, R * 0.99, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// VENUS — the wave 10 boss
//
// Mercury is a rock you shoot at while dodging aimed lines. Venus is weather:
// it never stops moving, and every attack covers an area rather than a lane, so
// the answer is always "be somewhere else by the time it lands" instead of
// "strafe out of the way". It has half again Mercury's health, so the fight is
// won by reading four patterns rather than by out-damaging one.
//
// The planet itself is all atmosphere — banded sulfuric cloud decks that
// super-rotate, a polar vortex at the top, and no visible surface until damage
// tears the deck open and the molten ground shows through.
// ---------------------------------------------------------------------------
const VENUS_BANDS = [
  { y: -0.78, h: 0.13, tone: "#f6dfae", alpha: 0.5, drift: 0.6 },
  { y: -0.5,  h: 0.19, tone: "#e8bb70", alpha: 0.44, drift: -0.9 },
  { y: -0.18, h: 0.22, tone: "#f2cf8c", alpha: 0.4, drift: 1.15 },
  { y: 0.16,  h: 0.2,  tone: "#d9a355", alpha: 0.46, drift: -0.7 },
  { y: 0.46,  h: 0.17, tone: "#c78a3e", alpha: 0.5, drift: 1.0 },
  { y: 0.72,  h: 0.13, tone: "#a96a2c", alpha: 0.52, drift: -1.3 },
];
// Fissure seeds in unit space, opened progressively as Venus loses health.
// These used to be Mercury's table, borrowed; molten rock is Venus's idea, so
// they live here now.
const VENUS_CRACKS = [
  [[-0.97, -0.05], [-0.78, -0.26], [-0.66, -0.55], [-0.42, -0.72]],
  [[-0.9, 0.28], [-0.66, 0.46], [-0.38, 0.68], [-0.06, 0.84]],
  [[0.95, -0.14], [0.76, -0.34], [0.64, -0.6], [0.4, -0.78]],
  [[0.9, 0.26], [0.66, 0.47], [0.42, 0.7], [0.12, 0.86]],
  [[-0.3, 0.9], [-0.02, 0.74], [0.26, 0.88], [0.5, 0.7]],
];

let venusBodyGradient = null;
let venusShadeGradient = null;
let venusAuraGradient = null;
let venusAuraRadius = 0;
let venusAuraColor = "";

// Each pattern lights the planet in its own colour before it fires. A boss this
// dense is only fair if you can tell what is coming, and it is also the thing
// that makes it look alive between attacks.
const VENUS_TELL = {
  rain:     { glow: "#c9e34a", eye: "#d9f24e" },
  spiral:   { glow: "#ff9a3c", eye: "#ffb457" },
  storm:    { glow: "#ffe9a8", eye: "#fff6d4" },
  pressure: { glow: "#ff6a12", eye: "#ff8f28" },
  sweep:    { glow: "#ffb457", eye: "#ffd68a" },
  dive:     { glow: "#fff0c0", eye: "#ffffff" },
  hunter:   { glow: "#d9f24e", eye: "#eaffb0" },
};

function seedVenusCells() {
  venusCells = [];
  for (let i = 0; i < 5; i++) {
    venusCells.push({
      u: rand(-1.2, 1.2),
      v: rand(-0.62, 0.62),
      rx: rand(0.16, 0.34),
      ry: rand(0.07, 0.14),
      speed: rand(0.0016, 0.0042) * (Math.random() < 0.5 ? -1 : 1),
      tone: Math.random() < 0.5 ? "rgba(96, 44, 16, .34)" : "rgba(255, 232, 176, .26)",
    });
  }
}

function drawVenus(t) {
  const deathProgress = bossDying ? 1 - Math.max(0, bossDeathTimer) / BOSS_DEATH_FRAMES : 0;
  if (deathProgress > 0.74) return;
  if (!venusCells.length) seedVenusCells();

  let shakeX = 0;
  let shakeY = 0;
  if (bossShakeTimer > 0) {
    const power = Math.min(9, bossShakeTimer);
    shakeX = rand(-power, power);
    shakeY = rand(-power, power);
    bossShakeTimer--;
  }
  // Mercury decays the shared hit flash in its own draw; Venus has to decay it
  // here too, or one hit whites the planet out for the rest of the fight.
  if (bossHitFlash > 0) bossHitFlash--;

  const shoot = bossShootAnim > 0 ? bossShootAnim / BOSS_SHOOT_FRAMES : 0;
  const hit = bossHitFlash > 0 ? bossHitFlash / BOSS_HIT_FRAMES : 0;
  const charge = bossChargeAnim > 0 ? 1 - bossChargeAnim / BOSS_CHARGE_FRAMES : 0;
  const damage = 1 - Math.max(0, boss.health) / VENUS_MAX_HEALTH;
  const phaseFlash = bossPhaseFlash > 0 ? bossPhaseFlash / 42 : 0;
  const tell = VENUS_TELL[venusTelegraph] || null;
  // 0 -> 1 across the first second of a telegraph, then holds
  const tellPower = tell ? Math.min(1, venusTelegraphAt / 40) : 0;
  const diving = venusDive && venusDive.phase === "fall";

  const R = VENUS_RADIUS;
  const cx = boss.x + shakeX;
  const cy = boss.y + Math.sin(t * 0.0013) * 6 + shakeY;
  // Retrograde: Venus turns backwards, so the cloud decks and the vortex both
  // run the opposite way to Mercury's crater field. The whole atmosphere spins
  // up while a pattern winds, which is the telegraph you feel before you read it.
  const spinUp = 1 + tellPower * 2.4 + charge * 2 + phaseFlash * 3;
  venusSpin -= (0.0022 + charge * 0.008) * spinUp;
  venusVortexSpin -= (0.011 + charge * 0.02) * spinUp;
  venusBandPhase += 0.004 * spinUp;

  // squash/stretch: it inhales on the wind-up and snaps outward on the shot,
  // and stretches lengthwise while it is diving
  const squashX = 1 + shoot * 0.12 - charge * 0.1 - tellPower * 0.04 + (diving ? -0.1 : 0);
  const squashY = 1 - shoot * 0.09 + charge * 0.12 + tellPower * 0.05 + (diving ? 0.16 : 0);
  const scale = (1 + deathProgress * 0.12) * (1 - hit * 0.03) * (1 + phaseFlash * 0.06);
  const fadeStart = 0.68;
  const alpha = bossDying && deathProgress > fadeStart
    ? Math.max(0, 1 - (deathProgress - fadeStart) / 0.06)
    : 1;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);

  // Heat haze, tinted by whatever is winding up.
  const auraRadius = R * (1.22 + charge * 0.26 + shoot * 0.24 + tellPower * 0.2 + phaseFlash * 0.5);
  const auraTint = phaseFlash > 0.05 ? "#ffffff" : tell ? tell.glow : "#ffc46e";
  const auraStrength = (0.2 + charge * 0.3 + tellPower * 0.26 + phaseFlash * 0.5).toFixed(2);
  const auraColor = rgbaFromHex(auraTint, Number(auraStrength));
  if (!venusAuraGradient || venusAuraRadius !== auraRadius || venusAuraColor !== auraColor) {
    venusAuraGradient = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, auraRadius);
    venusAuraGradient.addColorStop(0, auraColor);
    venusAuraGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    venusAuraRadius = auraRadius;
    venusAuraColor = auraColor;
  }
  ctx.fillStyle = venusAuraGradient;
  ctx.beginPath(); ctx.arc(0, 0, auraRadius, 0, Math.PI * 2); ctx.fill();

  const lean = Math.max(-1, Math.min(1, (player.x - boss.x) / (W * 0.4)));
  ctx.rotate(lean * (0.04 + charge * 0.07));
  ctx.scale(scale * squashX, scale * squashY);

  for (const shard of bossShards) {
    shard.angle += shard.speed;
    shard.spin += shard.spinSpeed;
  }
  drawBossShards(false);

  if (!venusBodyGradient) {
    venusBodyGradient = ctx.createRadialGradient(-R * 0.3, -R * 0.34, R * 0.1, 0, 0, R);
    venusBodyGradient.addColorStop(0, "#fff1cd");
    venusBodyGradient.addColorStop(0.38, "#f0c579");
    venusBodyGradient.addColorStop(0.74, "#c07d33");
    venusBodyGradient.addColorStop(1, "#5c3113");
    venusShadeGradient = ctx.createLinearGradient(R * 0.05, -R, R, R);
    venusShadeGradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    venusShadeGradient.addColorStop(1, "rgba(28, 8, 0, 0.62)");
  }
  ctx.fillStyle = venusBodyGradient;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();

  // One clip for the decks, the cells, the vortex, the fissures and the shade.
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();

  // Super-rotating cloud decks. Each band slides at its own rate and breathes
  // in thickness, so the atmosphere churns instead of sitting there as six
  // static stripes — which is what made the old planet look painted on.
  for (let i = 0; i < VENUS_BANDS.length; i++) {
    const band = VENUS_BANDS[i];
    const breathe = Math.sin(venusBandPhase * 2.1 + i * 1.7);
    const y = (band.y + breathe * 0.018) * R;
    const halfWidth = Math.sqrt(Math.max(0, 1 - band.y * band.y)) * R;
    const offset = Math.sin(venusBandPhase * band.drift + band.y * 4) * R * 0.26;
    ctx.globalAlpha = (band.alpha + breathe * 0.07) * alpha;
    ctx.fillStyle = band.tone;
    ctx.beginPath();
    ctx.ellipse(offset, y, halfWidth * 1.35, (band.h + breathe * 0.02) * R, breathe * 0.03, 0, Math.PI * 2);
    ctx.fill();
  }

  // Storm cells drifting across the face and wrapping at the limb.
  for (const cell of venusCells) {
    cell.u += cell.speed * spinUp;
    if (cell.u > 1.5) cell.u = -1.5;
    if (cell.u < -1.5) cell.u = 1.5;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = cell.tone;
    ctx.beginPath();
    ctx.ellipse(cell.u * R, cell.v * R, cell.rx * R, cell.ry * R, cell.v * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = alpha;

  // Polar vortex — a double spiral over the top pole, tightening as it spins up.
  ctx.save();
  ctx.translate(0, -R * 0.62);
  ctx.scale(1, 0.42);
  ctx.rotate(venusVortexSpin);
  ctx.strokeStyle = tell ? rgbaFromHex(tell.glow, 0.55) : "rgba(255, 244, 214, 0.5)";
  ctx.lineWidth = 3;
  const wind = 0.3 + tellPower * 0.1;
  for (let arm = 0; arm < 2; arm++) {
    ctx.beginPath();
    for (let i = 0; i <= 22; i++) {
      const a = arm * Math.PI + i * wind;
      const r = 3 + i * 1.7;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
  ctx.restore();

  // Molten fissures opening through the deck as it loses health.
  const crackCount = Math.floor(damage * VENUS_CRACKS.length + (bossDying ? VENUS_CRACKS.length : 0));
  if (crackCount > 0) {
    ctx.save();
    ctx.rotate(venusSpin);
    ctx.lineCap = "round";
    const pulse = 0.72 + Math.sin(t * 0.006) * 0.22 + phaseFlash * 0.4;
    for (let pass = 0; pass < 3; pass++) {
      ctx.strokeStyle = pass === 0
        ? `rgba(255, 90, 20, ${(0.4 * pulse).toFixed(3)})`
        : pass === 1 ? `rgba(255, 176, 60, ${Math.min(1, 0.9 * pulse).toFixed(3)})` : "#fff6d8";
      ctx.lineWidth = pass === 0 ? 13 : pass === 1 ? 6 : 2;
      for (let i = 0; i < Math.min(crackCount, VENUS_CRACKS.length); i++) {
        const seed = VENUS_CRACKS[i];
        ctx.beginPath();
        ctx.moveTo(seed[0][0] * R, seed[0][1] * R);
        for (let k = 1; k < seed.length; k++) ctx.lineTo(seed[k][0] * R, seed[k][1] * R);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  ctx.fillStyle = venusShadeGradient;
  ctx.fillRect(-R, -R, R * 2, R * 2);

  // Hot limb on the sunward side, so the sphere has an edge instead of fading out.
  ctx.globalAlpha = alpha * (0.45 + tellPower * 0.3);
  ctx.strokeStyle = tell ? tell.glow : "#ffe1a4";
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.arc(0, 0, R - 2, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.restore();

  // --- face ---------------------------------------------------------------
  // Two coals burning through the cloud, and a furnace vent for a mouth. Both
  // take the telegraph colour, which is how the tell reads at a glance.
  const look = Math.max(-1, Math.min(1, (player.x - boss.x) / (W * 0.45)));
  const lookY = Math.max(-1, Math.min(1, (player.y - boss.y) / (H * 0.5)));
  const blink = bossBlink > 0 ? 1 - bossBlink / 8 : 1;
  // it squints as a pattern winds up and glares wide when it fires
  const eyeOpen = Math.max(0.08, blink * (1 - hit * 0.6) * (1 - tellPower * 0.45 + shoot * 0.4));
  const eyeColor = hit > 0.3 ? "#ffffff" : tell ? tell.eye : charge > 0.3 ? "#fff0a0" : "#ff8f28";
  for (const side of BROW_SIDES) {
    const ex = side * R * 0.34;
    const ey = -R * 0.14;
    ctx.save();
    ctx.translate(ex, ey);
    drawGlow(hit > 0.3 ? "#ffffff" : tell ? tell.glow : "#ff7a1e", 26 + tellPower * 12, look * 3, lookY * 2);
    ctx.fillStyle = "#200c04";
    ctx.beginPath(); ctx.ellipse(0, 0, R * 0.19, R * 0.16 * eyeOpen, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = eyeColor;
    ctx.beginPath(); ctx.ellipse(look * 5, lookY * 3, R * 0.11, R * 0.1 * eyeOpen, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // heavy brow, dropping further into a scowl as the wind-up builds
    ctx.save();
    ctx.translate(ex, ey - R * 0.24 + tellPower * R * 0.05);
    ctx.rotate(side * (0.42 + tellPower * 0.22));
    ctx.fillStyle = "#3a1608";
    ctx.fillRect(-R * 0.24, -R * 0.05, R * 0.48, R * 0.1);
    ctx.restore();
  }
  const mouthOpen = R * (0.06 + shoot * 0.2 + charge * 0.06 + tellPower * 0.04);
  ctx.save();
  ctx.translate(0, R * 0.4);
  drawGlow(tell ? tell.glow : "#ff6a12", 30 + shoot * 18, 0, 0);
  ctx.fillStyle = "#1a0703";
  ctx.beginPath(); ctx.ellipse(0, 0, R * 0.34, mouthOpen + R * 0.05, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = shoot > 0.2 ? "#fff0b4" : tell ? tell.glow : "#ff7d1c";
  ctx.beginPath(); ctx.ellipse(0, 0, R * 0.27, mouthOpen, 0, 0, Math.PI * 2); ctx.fill();
  // heat plume on the shot itself
  if (shoot > 0.25) {
    ctx.globalAlpha = alpha * (shoot - 0.25) * 1.2;
    ctx.fillStyle = "#fff3cd";
    ctx.beginPath();
    ctx.moveTo(-R * 0.2, 0); ctx.lineTo(0, R * (0.3 + shoot * 0.5)); ctx.lineTo(R * 0.2, 0);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = alpha;
  }
  ctx.restore();

  if (hit > 0.3) {
    ctx.globalAlpha = alpha * hit * 0.55;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha;
  }
  // phase change: the whole deck whites out and a ring of cloud is thrown off
  if (phaseFlash > 0) {
    ctx.globalAlpha = alpha * phaseFlash * 0.7;
    ctx.fillStyle = "#fff4d6";
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = alpha * phaseFlash;
    ctx.strokeStyle = "#ffe2a6";
    ctx.lineWidth = 6 * phaseFlash + 1;
    ctx.beginPath(); ctx.arc(0, 0, R * (1 + (1 - phaseFlash) * 1.6), 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = alpha;
  }

  drawBossShards(true);
  ctx.restore();

  if (bossBlink > 0) bossBlink--;
  else if (--bossBlinkTimer <= 0) { bossBlink = 8; bossBlinkTimer = Math.round(rand(170, 320)); }
}

// --- Venus's attacks -------------------------------------------------------
// Four patterns, run one at a time with a rest between them so each one gets a
// clean read. `venusQueue` holds shots that are scheduled to leave later in the
// same pattern — spreading a volley over frames is what keeps the arena
// dangerous without ever putting a wall of bullets on screen at once.
// Six patterns, picked at random with no immediate repeat rather than run in a
// fixed cycle — a fixed order is a script, and once you have the script the
// fight is over. From phase 2 the picker also chains a second pattern onto the
// first, so the combinations keep coming even after all six are familiar.
const VENUS_ATTACKS = ["rain", "spiral", "storm", "pressure", "sweep", "dive", "hunter"];
const VENUS_ORB_COLOR = "#ff9a3c";
const VENUS_BOLT_WARN = 46;
const VENUS_BOLT_STRIKE = 14;
const VENUS_BOLT_HALF_WIDTH = 15;
let venusLastAttack = "";
let venusChain = 0;
// Drives the planet's own telegraph: which pattern is winding up, and how far
// through the wind-up it is. `drawVenus` reads both.
let venusTelegraph = "";
let venusTelegraphAt = 0;

// Hard ceiling on orbs in flight. Chaining two patterns in phase 3 could stack
// well past two hundred, which stops being difficulty and starts being a wall —
// and it is the only thing in this fight that can grow without bound.
const VENUS_ORB_CAP = 150;

function pushVenusOrb(angle, speed, radius = 8) {
  if (bossBullets.length >= VENUS_ORB_CAP) return;
  bossBullets.push({
    x: boss.x, y: boss.y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: radius,
    color: VENUS_ORB_COLOR,
    core: "#fff0bd",
  });
}

function queueVenusShot(delay, fn) {
  venusQueue.push({ delay, fn });
}

// Venus answers where the ship actually is. A flat random roll meant the fight
// never responded to how you were playing it — you could hug one wall for a
// whole phase and simply wait for the patterns that don't reach there. Every
// candidate is scored against the ship's position and speed first, so camping
// an edge pulls the two attacks that sweep it, and standing still pulls the two
// that land on top of you. Nothing is ever guaranteed: this weights the roll,
// it does not replace it.
function pickVenusAttack() {
  // dive is the one pattern that always wants breathing room, so it never
  // follows inside a phase-1 chain; from phase 2 the planet commits to it
  // mid-chain too, and in the final phase even the storm gets no breather
  const pool = venusChain > 0
    ? VENUS_ATTACKS.filter((a) => a !== venusLastAttack
      && (bossPhase >= 2 || a !== "dive")
      && (bossPhase >= 3 || a !== "storm"))
    : VENUS_ATTACKS.filter((a) => a !== venusLastAttack);
  const hugging = player.x < W * 0.2 || player.x > W * 0.8;
  const still = Math.hypot(player.vx, player.vy) < 1.3;
  const low = player.y > H * 0.62;
  const near = Math.hypot(player.x - boss.x, player.y - boss.y) < VENUS_RADIUS * 2.6;
  let total = 0;
  let best = pool[0];
  for (const attack of pool) {
    let weight = 1;
    if (hugging && (attack === "sweep" || attack === "pressure")) weight += 2.4;
    if (still && (attack === "storm" || attack === "hunter")) weight += 2.2;
    if (low && attack === "dive") weight += 2.6;
    if (near && (attack === "pressure" || attack === "spiral")) weight += 1.6;
    if (!hugging && attack === "rain") weight += 0.8;
    if (bossPhase >= 2 && attack === "hunter") weight += 0.7;
    total += weight;
    if (Math.random() * total < weight) best = attack;   // weighted reservoir pick
  }
  venusLastAttack = best;
  return best;
}

function startVenusAttack() {
  const hard = bossPhase >= 2;
  const brutal = bossPhase >= 3;
  venusAttack = pickVenusAttack();
  venusStep++;
  venusRotation = rand(0, Math.PI * 2);
  venusTelegraph = venusAttack;
  venusTelegraphAt = 0;
  bossShootAnim = BOSS_SHOOT_FRAMES;
  bossChargeAnim = 0;

  if (venusAttack === "rain") {
    // Acid downpour: full sheets of darts fall from the cloud deck, each with a
    // two-lane gap that walks. The gap changes direction at random now, so it
    // cannot be pre-walked.
    const columns = Math.max(6, Math.floor(W / 108));
    const step = W / columns;
    const sheets = brutal ? 6 : hard ? 5 : 4;
    let dir = Math.random() < 0.5 ? 1 : -1;
    let gapLane = Math.floor(Math.random() * columns);
    const speed = brutal ? 5 : hard ? 4.4 : 3.8;
    for (let sheet = 0; sheet < sheets; sheet++) {
      const lane0 = gapLane;
      for (let lane = 0; lane < columns; lane++) {
        if (lane === lane0 || lane === (lane0 + 1) % columns) continue;
        const x = step * (lane + 0.5);
        queueVenusShot(1 + sheet * (brutal ? 24 : 30) + lane * 2, () => fireVenusShot(x, -20, Math.PI / 2, speed, "venus-dart"));
      }
      if (Math.random() < 0.3) dir = -dir;      // the gap can double back
      gapLane = ((gapLane + dir) % columns + columns) % columns;
    }
    venusAttackTimer = sheets * (brutal ? 24 : 30) + 70;
    playSound(320, 0.5, "sawtooth");
    return;
  }

  if (venusAttack === "spiral") {
    // Retrograde spiral winding backwards, matching the planet's own rotation.
    // It reverses direction partway through in the later phases.
    const ticks = brutal ? 34 : hard ? 30 : 26;
    const arms = brutal ? 3 : hard ? 3 : 2;
    const flipAt = brutal ? Math.floor(ticks * 0.55) : -1;
    let dir = -1;
    for (let i = 0; i < ticks; i++) {
      const flip = i === flipAt;
      queueVenusShot(1 + i * 4, () => {
        if (flip) { dir = 1; playSound(240, 0.14, "triangle"); }
        for (let arm = 0; arm < arms; arm++) {
          pushVenusOrb(venusRotation + arm * (Math.PI * 2 / arms), brutal ? 3.9 : hard ? 3.7 : 3.5, 7);
        }
        venusRotation += dir * 0.22;
      });
    }
    venusAttackTimer = ticks * 4 + 30;
    playSound(150, 0.4, "triangle");
    return;
  }

  if (venusAttack === "storm") {
    // Cloud-deck lightning. The warning is shorter each phase, and the last two
    // columns lead the ship rather than marking where it already is.
    const count = brutal ? 7 : hard ? 5 : 4;
    const warn = brutal ? 24 : hard ? 32 : VENUS_BOLT_WARN;
    for (let i = 0; i < count; i++) {
      const lead = i >= count - 2;
      queueVenusShot(1 + i * (brutal ? 12 : 18), () => {
        const x = lead ? player.x + player.vx * (warn * 0.55) : rand(70, W - 70);
        venusBolts.push({ x: Math.max(30, Math.min(W - 30, x)), warn, strike: 0 });
        playSound(700 + i * 90, 0.08, "square");
      });
    }
    venusAttackTimer = count * (brutal ? 12 : 18) + warn + VENUS_BOLT_STRIKE + 24;
    return;
  }

  if (venusAttack === "sweep") {
    // A searchlight of heat orbs: a narrow fan that swings across the arena and
    // back. Unlike the ring there is no gap to find — the answer is to be behind
    // the sweep, which means committing to a direction early.
    const ticks = brutal ? 40 : hard ? 36 : 32;
    const spread = brutal ? 3 : hard ? 3 : 2;
    const start = Math.atan2(player.y - boss.y, player.x - boss.x) - 0.9;
    const swing = 1.8 / ticks;
    let dir = 1;
    for (let i = 0; i < ticks; i++) {
      const back = brutal && i === Math.floor(ticks * 0.6);
      queueVenusShot(1 + i * 4, () => {
        if (back) dir = -1;
        for (let k = 0; k < spread; k++) {
          pushVenusOrb(venusRotation + (k - (spread - 1) / 2) * 0.13, 3.9, 6);
        }
        venusRotation += dir * swing * 2.4;
      });
    }
    venusRotation = start;
    venusAttackTimer = ticks * 4 + 40;
    playSound(200, 0.45, "sawtooth");
    return;
  }

  if (venusAttack === "hunter") {
    // Seeker darts, fired one at a time so they arrive strung out rather than as
    // a wall. They steer for a long window and then commit, which is the one
    // pattern in the fight that follows you into a corner.
    const count = brutal ? 6 : hard ? 5 : 4;
    const gap = brutal ? 14 : 20;
    for (let i = 0; i < count; i++) {
      queueVenusShot(1 + i * gap, () => {
        const angle = Math.atan2(aimTargetY() - boss.y, aimTargetX() - boss.x) + rand(-0.55, 0.55);
        const speed = brutal ? 3.9 : hard ? 3.6 : 3.3;
        enemyBullets.push({
          x: boss.x, y: boss.y,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          speed,
          turnRate: brutal ? 0.045 : hard ? 0.037 : 0.03,
          homing: brutal ? 180 : 140,
          kind: "venus-dart",
          age: 0, phase: 0, fuse: 84, armed: 0, turn: 0.05, shards: 4,
        });
        spawnSparks(boss.x, boss.y, 6, "#d9f24e", { angle, spread: 0.4, minSpeed: 1, maxSpeed: 3, life: 18 });
        playSound(430 + i * 40, 0.09, "square");
      });
    }
    venusAttackTimer = count * gap + 64;
    playSound(260, 0.3, "sawtooth");
    return;
  }

  if (venusAttack === "dive") {
    // The planet itself comes down the ship's column and slams, throwing two
    // fronts of orbs along the floor. It is the only attack that threatens the
    // bottom of the arena, which is where everything else lets you hide.
    const targetX = Math.max(150, Math.min(W - 150, player.x));
    venusDive = { x: targetX, phase: "rise", timer: 34 };
    venusAttackTimer = 190;
    playSound(90, 0.5, "triangle");
    return;
  }

  // pressure: a greenhouse shockwave ring with one gap, and the gap moves
  // between rings so standing in the first one is not enough.
  const spokes = brutal ? 30 : hard ? 26 : 20;
  const rings = brutal ? 4 : hard ? 3 : 2;
  for (let ring = 0; ring < rings; ring++) {
    queueVenusShot(1 + ring * 44, () => {
      const gap = ring === 0
        ? Math.atan2(player.y - boss.y, player.x - boss.x) + Math.PI
        : venusRotation + rand(1.9, Math.PI + 1.2);
      venusRotation = gap;
      const half = brutal ? 0.26 : 0.34;
      for (let i = 0; i < spokes; i++) {
        const a = (i / spokes) * Math.PI * 2;
        let diff = a - gap;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        if (Math.abs(diff) < half) continue;   // the gap is the way out
        pushVenusOrb(a, 3.2, 8);
      }
      bossShakeTimer = Math.max(bossShakeTimer, 10);
      bossExplosions.push({ x: boss.x, y: boss.y, r: 0, max: 190, life: 20, maxLife: 20 });
      playSound(110, 0.4, "sawtooth");
    });
  }
  venusAttackTimer = rings * 44 + 74;
}

// The dive is the one attack the planet performs with its body rather than with
// projectiles, so it runs as its own little state machine instead of a queue.
function updateVenusDive() {
  if (!venusDive) return;
  venusDive.timer--;
  if (venusDive.phase === "rise") {
    // pull back and up, lining up over the ship's column
    boss.x += (venusDive.x - boss.x) * 0.12;
    boss.y += (bossSpawnY() - 46 - boss.y) * 0.12;
    bossChargeAnim = BOSS_CHARGE_FRAMES;
    if (venusDive.timer <= 0) { venusDive.phase = "fall"; venusDive.timer = 60; playSound(140, 0.3, "sawtooth"); }
    return;
  }
  if (venusDive.phase === "fall") {
    boss.y += (playableBottomY() - 40 - boss.y) * 0.23;
    bossChargeAnim = 0;
    if (Math.random() < 0.6) {
      spawnSparks(boss.x + rand(-VENUS_RADIUS, VENUS_RADIUS), boss.y, 1, "#ffb457",
        { minSpeed: 1, maxSpeed: 3, life: 20, gravity: -0.04 });
    }
    if (boss.y > playableBottomY() - 80 || venusDive.timer <= 0) {
      // slam: two fronts along the floor plus a hard shake
      for (const side of [-1, 1]) {
        for (let i = 0; i < 8; i++) {
          bossBullets.push({
            x: boss.x, y: boss.y + VENUS_RADIUS * 0.5,
            vx: side * (2.8 + i * 0.55), vy: -0.5 - i * 0.16,
            r: 9, color: VENUS_ORB_COLOR, core: "#fff0bd",
          });
        }
      }
      bossExplosions.push({ x: boss.x, y: boss.y + VENUS_RADIUS * 0.6, r: 0, max: 240, life: 26, maxLife: 26 });
      bossShakeTimer = Math.max(bossShakeTimer, 22);
      screenShakeFrames = Math.max(screenShakeFrames, 18);
      screenShakeStrength = Math.max(screenShakeStrength, 8);
      bossShootAnim = BOSS_SHOOT_FRAMES;
      flashDamage();
      playSound(58, 0.8, "sawtooth");
      venusDive.phase = "recover";
      venusDive.timer = 56;
    }
    return;
  }
  // climb back to station
  boss.y += (bossSpawnY() - boss.y) * 0.06;
  if (venusDive.timer <= 0) venusDive = null;
}

function updateVenusQueue() {
  if (!venusQueue.length) return;
  let due = false;
  for (const shot of venusQueue) {
    if (--shot.delay <= 0) { shot.fn(); due = true; }
  }
  if (due) compact(venusQueue, (shot) => shot.delay > 0);
}

// Vertical lightning columns: a thin warning line, then a wide bolt that hurts
// for as long as it is on screen.
function updateVenusBolts() {
  for (const bolt of venusBolts) {
    if (bolt.warn > 0) {
      bolt.warn--;
      const ready = 1 - bolt.warn / VENUS_BOLT_WARN;
      ctx.globalAlpha = 0.2 + ready * 0.45;
      ctx.fillStyle = "#ffd98a";
      ctx.fillRect(bolt.x - 1, 0, 2, H);
      ctx.globalAlpha = 0.1 + ready * 0.2;
      ctx.fillRect(bolt.x - VENUS_BOLT_HALF_WIDTH, 0, VENUS_BOLT_HALF_WIDTH * 2, H);
      ctx.globalAlpha = 1;
      if (bolt.warn === 0) {
        bolt.strike = VENUS_BOLT_STRIKE;
        screenShakeFrames = Math.max(screenShakeFrames, 8);
        screenShakeStrength = Math.max(screenShakeStrength, 4);
        playSound(70, 0.35, "sawtooth");
      }
      continue;
    }
    bolt.strike--;
    const fade = Math.max(0, bolt.strike / VENUS_BOLT_STRIKE);
    // a jagged core so the bolt reads as lightning rather than as a bar
    ctx.globalAlpha = 0.35 * fade;
    ctx.fillStyle = "#ffbe57";
    ctx.fillRect(bolt.x - VENUS_BOLT_HALF_WIDTH, 0, VENUS_BOLT_HALF_WIDTH * 2, H);
    ctx.globalAlpha = 0.9 * fade + 0.1;
    ctx.strokeStyle = "#fff6d4";
    ctx.lineWidth = 4 * fade + 2;
    ctx.beginPath();
    ctx.moveTo(bolt.x, 0);
    for (let y = 0; y < H; y += 42) ctx.lineTo(bolt.x + rand(-9, 9), y + 42);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (!devGodMode && playerInvulnerable === 0 && Math.abs(player.x - bolt.x) < VENUS_BOLT_HALF_WIDTH + (player.shrunk ? 6 : 12)) {
      hurtPlayer();
      if (!gameActive) return;
    }
  }
  compact(venusBolts, (bolt) => bolt.warn > 0 || bolt.strike > 0);
}

function updateVenusBoss(t) {
  updateVenusQueue();
  if (venusDive) {
    updateVenusDive();
    if (venusAttackTimer-- <= 0 && !venusDive) { venusAttack = "rest"; venusAttackTimer = venusRestFrames(); }
    return;
  }

  // A wider, faster sweep than Mercury's, and it dips toward the player rather
  // than sitting on one line. Each phase widens and quickens it.
  const rate = phaseRate();
  bossDrift += 0.0062 / rate;
  const range = Math.min(280 + bossPhase * 24, W * 0.28);
  // Hugging a wall used to be safe: the sweep was centred and the lean toward
  // the player was gentle. Now the planet leans much harder at a ship pinned
  // against an edge, so the corner closes instead of sheltering you.
  const pinned = player.x < W * 0.18 || player.x > W * 0.82 ? 0.34 : 0;
  const targetX = W / 2 + Math.sin(bossDrift) * range + (player.x - W / 2) * (0.34 + bossPhase * 0.06 + pinned);
  boss.x += (targetX - boss.x) * 0.026;
  boss.x = Math.max(140, Math.min(W - 140, boss.x));
  const homeY = bossSpawnY();
  boss.y += (homeY + Math.sin(bossDrift * 1.7) * 26 - boss.y) * 0.02;

  // embers off the fissures once the deck is properly torn
  if (bossDamageStage >= 2 && Math.random() < 0.5) {
    const a = rand(0, Math.PI * 2);
    spawnSparks(boss.x + Math.cos(a) * VENUS_RADIUS * 0.75, boss.y + Math.sin(a) * VENUS_RADIUS * 0.75,
      1, Math.random() < 0.5 ? "#ff7a1e" : "#ffd68a",
      { minSpeed: 0.2, maxSpeed: 1, life: 44, drag: 0.98, gravity: -0.02 });
  }

  if (venusTelegraph) venusTelegraphAt++;

  if (venusAttackTimer-- > 0) {
    if (venusAttackTimer === BOSS_CHARGE_FRAMES) {
      bossChargeAnim = BOSS_CHARGE_FRAMES;
      playSound(80, 0.3, "triangle");
    }
    if (bossChargeAnim > 0) bossChargeAnim--;
    return;
  }
  if (venusAttack !== "rest") {
    venusTelegraph = "";
    // From phase 2 an attack can run straight into a second one with no rest.
    if (venusChain > 0) { venusChain--; startVenusAttack(); return; }
    venusAttack = "rest";
    venusAttackTimer = venusRestFrames();
    return;
  }
  // chain length grows with the phase: none in 1, one or two in 2, and two or
  // three with no breather in the final phase
  venusChain = bossPhase === 1 ? 0
    : bossPhase === 2 ? 1 + Math.floor(Math.random() * 2)
    : 2 + Math.floor(Math.random() * 2);
  startVenusAttack();
}

function venusRestFrames() {
  // The rest shrinks with every pattern it has thrown and with the phase, and
  // the floor drops in the final third so the fight keeps tightening.
  const floor = bossPhase >= 3 ? 8 : 16;
  return Math.max(floor, Math.round((66 - venusStep * 3) * phaseRate()));
}

function trackedBossAngle(fromX, fromY, leadFrames) {
  // DECOY steals the boss's aim too, which is the only thing that makes it
  // worth a super slot during a boss fight.
  const leadX = decoy ? 0 : player.vx * leadFrames;
  const leadY = decoy ? 0 : player.vy * leadFrames;
  const targetX = Math.max(24, Math.min(W - 24, aimTargetX() + leadX));
  const targetY = Math.max(28, Math.min(playableBottomY(), aimTargetY() + leadY));
  return Math.atan2(targetY - fromY, targetX - fromX);
}

// A boulder off the surface. Bigger and slower than the regolith, and it is
// lit like everything else out here: reflected sun on one side, nothing on the
// other.
function pushMoonBoulder(angle, speed) {
  bossBullets.push({
    x: boss.x,
    y: boss.y + 60,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: 8,
    color: "#b4b0a8",
    core: "#f6f3ec",
  });
}

// ---------------------------------------------------------------------------
// THE MOON's attacks
//
// It has no atmosphere, no weather and no heat of its own, so it fights with
// the only three things it actually owns: the rock that falls on it, the pull
// it has on everything nearby, and its shadow.
//
//   CRATER FALL  a strike is *called* — a ring on the floor and a rock visibly
//                falling into it — a second before it lands. Every hit is
//                therefore the player's to avoid, which is what a first boss
//                should teach. Phase 3 walks the strikes across the arena.
//   TIDAL PULL   from phase 2 it drags the ship toward it for three seconds
//                while the dust streams inward. It does not damage: it takes
//                away the one thing the player was relying on, position.
//   REGOLITH     a ring of dust with one gap in it. Readable, and the gap
//                moves, so the answer is never "sit still".
//   EJECTA       chips thrown up by its own craters, which home in.
//   ECLIPSE      phase 3 only. The arena goes dark for four seconds and the
//                Moon is a black disc in a white corona. Its wind-ups become
//                unreadable, so the player has to fight on the sound and the
//                bullets alone.
// ---------------------------------------------------------------------------
const MOON_IMPACT_R = 84;
const MOON_IMPACT_CAP = 10;
// A slam is only frightening if you can be caught by it, so the pull has to be
// able to close this distance and the ring has to be drawn the whole time.
const MOON_SLAM_R = 262;

function callCraterStrike(x, y, delay, radius) {
  if (moonImpacts.length >= MOON_IMPACT_CAP) return;
  x = Math.max(40, Math.min(W - 40, x));
  y = Math.max(90, Math.min(H - 40, y));
  // Never stack two strikes on the same ground: overlapping rings read as one
  // marker and turn a spread into a single blob you can side-step.
  for (const other of moonImpacts) {
    if (other.t > 0 && Math.hypot(other.x - x, other.y - y) < radius * 1.55) return false;
  }
  moonImpacts.push({ x, y, r: radius, t: delay, max: delay, tilt: rand(-0.34, 0.34) });
  return true;
}

// One volley. The shape is always the same and always readable: **one round is
// aimed where the ship is going**, and the rest fan out around it, far enough
// apart that they deny separate ground instead of clustering into one puddle.
// Standing still puts the leading strike on your head; running in a straight
// line puts it in your path. Either way the answer is to turn.
function callCraterVolley() {
  const count = bossPhase >= 3 ? 5 : bossPhase >= 2 ? 4 : 3;
  const delay = bossPhase >= 3 ? 78 : bossPhase >= 2 ? 90 : 100;
  const radius = MOON_IMPACT_R * (bossPhase >= 3 ? 1.08 : 1);
  playSound(150, 0.3, "triangle");
  playSound(70, 0.5, "sine");

  // the leading round
  const lead = delay * 0.6;
  callCraterStrike(player.x + player.vx * lead, player.y + player.vy * lead, delay, radius);

  // and the fan: evenly divided around the ship so no two land together, far
  // enough out that the arena is genuinely carved up rather than crowded
  const base = rand(0, Math.PI * 2);
  const near = bossPhase >= 3 ? 165 : 195;
  const far = bossPhase >= 3 ? 330 : 360;
  for (let i = 0; i < count - 1; i++) {
    // If a slot is crowded out, walk it further along the ring rather than
    // dropping it — a volley that quietly loses half its rounds is why the
    // first version landed two markers on top of each other and felt thin.
    for (let attempt = 0; attempt < 4; attempt++) {
      const a = base + (i / (count - 1)) * Math.PI * 2 + attempt * 0.5 + rand(-0.22, 0.22);
      const dist = rand(near, far) + attempt * 30;
      if (callCraterStrike(player.x + Math.cos(a) * dist, player.y + Math.sin(a) * dist,
        delay + 12 + i * 14, radius)) break;
    }
  }
}

// The pull lets go. Everything still inside the ring is hit, and the ring
// itself becomes a wall of rock thrown outward, so the edge is no refuge.
function fireMoonSlam() {
  bossExplosions.push({ x: boss.x, y: boss.y, r: MOON_SLAM_R * 0.35, max: MOON_SLAM_R * 2.1, life: 34, maxLife: 34 });
  bossExplosions.push({ x: boss.x, y: boss.y, r: 0, max: MOON_SLAM_R * 1.1, life: 22, maxLife: 22 });
  spawnBossParticles(46, {
    x: boss.x, y: boss.y, minSpeed: 3, maxSpeed: 11, minSize: 2, maxSize: 7, life: 46,
    colors: ["#ffffff", "#e9e6dc", "#a5a29b", "#5c5a56"], drag: 0.97,
  });
  screenShakeFrames = Math.max(screenShakeFrames, 22);
  screenShakeStrength = Math.max(screenShakeStrength, 13);
  bossShakeTimer = Math.max(bossShakeTimer, 18);
  playSound(38, 1.2, "sawtooth");
  playSound(96, 0.5, "square");
  const arms = bossPhase >= 3 ? 20 : 15;
  const start = rand(0, Math.PI * 2);
  for (let i = 0; i < arms; i++) {
    const a = start + (i / arms) * Math.PI * 2;
    bossBullets.push({
      x: boss.x + Math.cos(a) * MOON_SLAM_R * 0.5,
      y: boss.y + Math.sin(a) * MOON_SLAM_R * 0.5,
      vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2,
      r: 7, color: "#cfcbc2", core: "#fbf9f3",
    });
  }
  if (!devGodMode && playerInvulnerable <= 0 && !bossDying
    && Math.hypot(player.x - boss.x, player.y - boss.y) < MOON_SLAM_R) {
    hurtPlayer();
  }
}

function updateMoonImpacts() {
  for (const im of moonImpacts) {
    im.t--;
    if (im.t !== 0) continue;
    // landfall
    bossExplosions.push({ x: im.x, y: im.y, r: im.r * 0.3, max: im.r * 1.7, life: 26, maxLife: 26 });
    spawnBossParticles(24, {
      x: im.x, y: im.y, minSpeed: 1.4, maxSpeed: 6.5, minSize: 2, maxSize: 6, life: 40,
      colors: ["#ffffff", "#d9d6cf", "#8d8a85", "#4a4845"], gravity: 0.05, drag: 0.97,
    });
    spawnSparks(im.x, im.y, 14, "#e6e3db", { minSpeed: 1, maxSpeed: 5, life: 34, drag: 0.95 });
    screenShakeFrames = Math.max(screenShakeFrames, 12);
    screenShakeStrength = Math.max(screenShakeStrength, 7);
    playSound(48, 0.45, "sawtooth");
    playSound(120, 0.16, "square");
    // The marker is drawn as an ellipse (0.62 vertical), so the hit test is the
    // same ellipse. A circular test under an elliptical ring meant the top and
    // bottom of every marker lied about where it was safe to stand.
    const ex = (player.x - im.x) / (im.r * 0.82);
    const ey = (player.y - im.y) / (im.r * 0.62 * 0.86);
    if (!devGodMode && playerInvulnerable <= 0 && !bossDying && ex * ex + ey * ey < 1) {
      hurtPlayer();
      if (!gameActive) return;
    }
    // the strike throws its own debris back up — this is where the chips that
    // chase the ship actually come from
    if (bossPhase >= 2 && bossMinions.length < MINION_CAP && Math.random() < 0.4) {
      spawnBossMinion(rand(0, Math.PI * 2));
    }
    // and it sprays the rim, so hugging the edge of a marker is not a free out.
    // Phase 3 only: at four or five craters a volley, spraying every one of them
    // from phase 2 put twenty extra rounds in the air per volley.
    if (bossPhase >= 3) {
      const shards = 5;
      const start = rand(0, Math.PI * 2);
      for (let i = 0; i < shards; i++) {
        const a = start + (i / shards) * Math.PI * 2;
        bossBullets.push({
          x: im.x + Math.cos(a) * im.r * 0.4, y: im.y + Math.sin(a) * im.r * 0.4,
          vx: Math.cos(a) * 2.1, vy: Math.sin(a) * 2.1,
          r: 5, color: "#c4c0b8", core: "#f2efe8",
        });
      }
    }
  }
  compact(moonImpacts, (im) => im.t > -20);
}

// The floor marker and the rock falling into it. The rock is drawn arriving
// exactly on the frame the ring closes, so the timing can be read off the
// screen rather than memorised.
function drawMoonImpacts(t) {
  for (const im of moonImpacts) {
    const done = im.t <= 0;
    if (done) {
      // the scorch left behind, fading out
      const fade = Math.max(0, 1 + im.t / 20);
      ctx.save();
      ctx.globalAlpha = fade * 0.5;
      ctx.fillStyle = "#1a1917";
      ctx.beginPath(); ctx.ellipse(im.x, im.y, im.r * 0.8, im.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "rgba(233, 230, 220, .55)";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(im.x, im.y, im.r * (1.1 - fade * 0.3), im.r * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      continue;
    }
    const p = 1 - im.t / im.max;          // 0 -> 1 as it falls
    const urgent = im.t < 22;
    ctx.save();
    // target ring: an outer fixed circle and an inner one closing onto it
    ctx.globalAlpha = 0.32 + p * 0.5;
    ctx.strokeStyle = urgent ? "#fff0c0" : "#cfe4ff";
    ctx.lineWidth = urgent ? 3 : 2;
    ctx.beginPath(); ctx.ellipse(im.x, im.y, im.r, im.r * 0.62, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.25 + p * 0.6;
    ctx.beginPath();
    ctx.ellipse(im.x, im.y, im.r * (1.55 - p * 0.55), im.r * 0.62 * (1.55 - p * 0.55), 0, 0, Math.PI * 2);
    ctx.stroke();
    // crosshair ticks, so the centre is unambiguous
    ctx.globalAlpha = 0.4 + p * 0.4;
    ctx.beginPath();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      ctx.moveTo(im.x + dx * im.r * 0.55, im.y + dy * im.r * 0.34);
      ctx.lineTo(im.x + dx * im.r * 0.85, im.y + dy * im.r * 0.52);
    }
    ctx.stroke();
    ctx.restore();

    // the rock itself, coming down on a slant and arriving as the ring closes
    const fall = im.t / im.max;
    const rx = im.x - Math.sin(im.tilt) * fall * (im.y + 160);
    const ry = im.y - fall * (im.y + 160);
    const size = 7 + p * 7;
    if (quality.glow) drawGlow("#ffd9a0", Math.round(14 + p * 16), rx, ry);
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(im.tilt + t * 0.02);
    ctx.fillStyle = "#8a867f";
    ctx.beginPath();
    ctx.moveTo(0, -size); ctx.lineTo(size * 0.85, -size * 0.2); ctx.lineTo(size * 0.5, size * 0.9);
    ctx.lineTo(-size * 0.6, size * 0.8); ctx.lineTo(-size * 0.9, -size * 0.25);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#c9c5bd";
    ctx.beginPath(); ctx.arc(-size * 0.25, -size * 0.3, size * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // entry trail
    if (Math.random() < 0.7) {
      spawnSparks(rx, ry, 1, Math.random() < 0.5 ? "#ffd9a0" : "#e9e6dc",
        { minSpeed: 0.2, maxSpeed: 1, life: 22, drag: 0.95, maxSize: 2 });
    }
  }
}

// ---------------------------------------------------------------------------
// The whole of the Moon's combat, per frame. Kept out of `drawBossArea` so it
// has the same shape as `updateVenusBoss` — until both bosses looked alike
// there was no shape for a third to copy.
// ---------------------------------------------------------------------------
function updateMoonBoss(t) {
  const rate = phaseRate();

  // It is heavy. It sweeps slowly and leans after the ship rather than chasing
  // it, so the arena always has somewhere to be — just not for long.
  bossDrift += 0.0034 / rate;
  const range = Math.min(190 + bossPhase * 34, W * 0.24);
  const target = W / 2 + Math.sin(bossDrift) * range + (player.x - W / 2) * (0.24 + bossPhase * 0.06);
  boss.x += (target - boss.x) * 0.018;
  boss.x = Math.max(120, Math.min(W - 120, boss.x));

  // --- tidal pull ---------------------------------------------------------
  if (moonPull > 0) {
    moonPull--;
    const dx = boss.x - player.x;
    const dy = boss.y - player.y;
    const d = Math.hypot(dx, dy) || 1;
    // Tuned against the ship's measured equilibrium, not by feel. With no input
    // the velocity is smoothed toward zero (0.77) *and* dragged (0.88), so it
    // keeps only 0.678 of itself per frame and a constant pull `p` settles at
    // `p / 0.322`. Thrusting away instead converges on `maxSpeed`, giving
    // `(p - 0.23 * maxSpeed) / 0.23`. At 0.8 that is a drift of ~2.5 px/frame in
    // versus ~2.0 px/frame out: over the ~2.6 seconds it lasts, doing nothing
    // puts you inside the ring and flying puts you clear of it, with no third
    // option. Anything under about 0.5 is invisible — the first cut of this
    // used 0.22 and players correctly reported that it did nothing at all.
    const base = bossPhase >= 3 ? 0.86 : 0.8;
    const strength = base * (0.82 + 0.36 * Math.min(1, d / 420));
    player.vx += (dx / d) * strength;
    player.vy += (dy / d) * strength;
    if (Math.random() < 0.75) {
      const a = rand(0, Math.PI * 2);
      const dist = rand(bossRadius() * 1.5, bossRadius() * 5.2);
      spawnSparks(boss.x + Math.cos(a) * dist, boss.y + Math.sin(a) * dist, 1, "#cfe4ff",
        { angle: a + Math.PI, spread: 0.12, minSpeed: 1.8, maxSpeed: 3.8, life: 26, drag: 1, maxSize: 2 });
    }
    // the ship itself streams as it strains against it
    if (Math.random() < 0.5) {
      spawnSparks(player.x, player.y, 1, "#bcd8ff",
        { angle: Math.atan2(dy, dx), spread: 0.3, minSpeed: 1.2, maxSpeed: 2.6, life: 20, maxSize: 2 });
    }
    if (moonPull === 0) fireMoonSlam();
  } else if (bossPhase >= 2 && !bossDying && --moonPullTimer <= 0) {
    moonPull = bossPhase >= 3 ? 175 : 155;
    // Unscaled for the same reason as the volley: with `rate` applied, phase 3
    // started a new pull every ~4.9s and each one lasted 3.2s, so the ship was
    // being dragged roughly half the time.
    moonPullTimer = Math.round(rand(640, 880));
    bossChargeAnim = BOSS_CHARGE_FRAMES;
    bossExplosions.push({ x: boss.x, y: boss.y, r: bossRadius(), max: bossRadius() * 5, life: 30, maxLife: 30 });
    showWaveBanner("TIDAL PULL", "GET OUT OF THE RING");
    playSound(44, 1.1, "sine");
    playSound(88, 0.7, "triangle");
  }

  // --- eclipse ------------------------------------------------------------
  if (moonEclipse > 0) {
    moonEclipse--;
    // In the dark it stops aiming and simply sweeps: two slow arms of rock
    // turning out of the corona. You cannot read its face, but you can read
    // the spiral, so the eclipse is a pattern to solve rather than a coin toss.
    moonSpiral += 0.075;
    // Spaced so the arms clear the screen about as fast as they are laid down;
    // any tighter and four seconds of eclipse silts the whole arena up.
    if (moonEclipse % 12 === 0 && bossBullets.length < 70) {
      for (const arm of [0, Math.PI]) {
        const a = moonSpiral + arm;
        bossBullets.push({
          x: boss.x + Math.cos(a) * MOON_RADIUS,
          y: boss.y + Math.sin(a) * MOON_RADIUS,
          vx: Math.cos(a) * 3, vy: Math.sin(a) * 3,
          r: 6, color: "#ffe9b8", core: "#fffdf2",
        });
      }
    }
    if (moonEclipse === 0) {
      // it comes back out of shadow with a flash and a ring you have to leave
      bossExplosions.push({ x: boss.x, y: boss.y, r: 0, max: bossRadius() * 4.2, life: 26, maxLife: 26 });
      playSound(320, 0.4, "square");
      screenShakeFrames = Math.max(screenShakeFrames, 10);
      screenShakeStrength = Math.max(screenShakeStrength, 6);
    }
  } else if (bossPhase >= 3 && !bossDying && --moonEclipseTimer <= 0) {
    moonEclipse = 210;
    moonEclipseTimer = 1000;
    showWaveBanner("ECLIPSE", "FIGHT BLIND");
    playSound(36, 1.6, "sine");
  }

  // --- crater fall --------------------------------------------------------
  // Cadence is NOT multiplied by `phaseRate()`. These three numbers are already
  // the per-phase tuning; scaling them again meant phase 3 threw a five-marker
  // volley every 1.8 seconds, which is where the fight stopped being playable.
  if (!bossDying && --moonImpactTimer <= 0) {
    callCraterVolley();
    moonImpactTimer = Math.round((bossPhase >= 3 ? 235 : bossPhase >= 2 ? 300 : 360) + rand(-30, 40));
  }
  updateMoonImpacts();
  if (!gameActive) return;

  // --- ejecta chips -------------------------------------------------------
  if (bossPhase >= 2 && --bossMinionTimer <= 0) {
    const batch = 2;
    for (let i = 0; i < batch; i++) spawnBossMinion(rand(0, Math.PI * 2));
    bossMinionTimer = Math.round((bossPhase >= 3 ? 320 : 400) + rand(-40, 60));
  }

  // dust lifts off the surface once it has been properly worked over
  if (bossDamageStage >= 2 && Math.random() < 0.35) {
    const a = rand(0, Math.PI * 2);
    spawnSparks(boss.x + Math.cos(a) * MOON_RADIUS * 0.72, boss.y + Math.sin(a) * MOON_RADIUS * 0.72,
      1, Math.random() < 0.5 ? "#e9e6dc" : "#9a978f",
      { minSpeed: 0.2, maxSpeed: 0.9, life: 44, drag: 0.98, gravity: -0.015 });
  }

  // While it is eclipsed the Moon stops aiming altogether: no regolith, no
  // boulders, no tracked shot — just the two spiral arms and the crater fuses
  // already burning. Darkness plus every other pattern at once was the single
  // worst moment in the fight; as its own set piece the eclipse is a rhythm
  // break you have to read rather than survive blind. The timers freeze with
  // it, so nothing fires the instant the light comes back.
  if (moonEclipse > 0) return;

  // --- regolith ring ------------------------------------------------------
  bossBurstTimer--;
  if (bossBurstTimer === 40) {
    bossChargeAnim = BOSS_CHARGE_FRAMES;
    playSound(70, 0.4, "triangle");
  }
  if (bossBurstTimer <= 0) {
    // a full ring with one gap cut in it: always survivable, never ignorable
    const count = 14 + bossPhase * 4;
    const start = rand(0, Math.PI * 2);
    const gap = bossPhase >= 3 ? 0.62 : 0.72;     // the way out narrows late
    const speed = 2.2 + bossPhase * 0.25;
    for (let i = 0; i < count; i++) {
      const a = start + (i / count) * Math.PI * 2;
      let delta = Math.atan2(player.y - boss.y, player.x - boss.x) - a;
      delta = Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta)));
      if (delta < gap) continue;                  // the gap opens toward the ship
      bossBullets.push({
        x: boss.x, y: boss.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        r: 6, color: "#cfcbc2", core: "#fbf9f3",
      });
    }
    bossShootAnim = BOSS_SHOOT_FRAMES;
    bossShakeTimer = Math.max(bossShakeTimer, 10);
    bossExplosions.push({ x: boss.x, y: boss.y, r: 0, max: 170, life: 22, maxLife: 22 });
    spawnBossParticles(18, {
      x: boss.x, y: boss.y, minSpeed: 2, maxSpeed: 5, minSize: 2, maxSize: 5, life: 30,
      colors: ["#e9e6dc", "#b4b1a9", "#7a7770"], drag: 0.97,
    });
    playSound(120, 0.35, "sawtooth");
    bossBurstTimer = Math.round(rand(430, 620) * rate);
  }


  // --- boulder spread -----------------------------------------------------
  bossAttackTimer--;
  if (bossAttackTimer === 28) {
    bossChargeAnim = BOSS_CHARGE_FRAMES;
    playSound(70, 0.22, "triangle");
  }
  if (bossAttackTimer <= 0) {
    const baseAngle = trackedBossAngle(boss.x, boss.y + 60, 26);
    const pattern = Math.random();
    if (pattern < 0.45) {
      for (const offset of [-0.32, 0, 0.32]) pushMoonBoulder(baseAngle + offset, 3.5);
    } else if (pattern < 0.8) {
      for (const offset of [-0.48, -0.24, 0, 0.24, 0.48]) pushMoonBoulder(baseAngle + offset, 3.05);
    } else {
      for (const offset of [-0.12, 0.12]) pushMoonBoulder(baseAngle + offset, 4.2);
    }
    bossShootAnim = BOSS_SHOOT_FRAMES;
    bossChargeAnim = 0;
    bossShakeTimer = Math.max(bossShakeTimer, 5);
    spawnBossParticles(18, {
      x: boss.x, y: boss.y + 34, angle: baseAngle, spread: 0.7, minSpeed: 1.5, maxSpeed: 5,
      minSize: 2, maxSize: 5, life: 26, colors: ["#e9e6dc", "#b4b1a9", "#fbf9f3"],
    });
    playSound(220, 0.15, "sawtooth");
    bossAttackTimer = Math.round(rand(175, 290) * phaseRate());
  }

  // --- aimed rock ---------------------------------------------------------
  bossShotTimer--;
  if (bossShotTimer === 12) {
    bossChargeAnim = BOSS_CHARGE_FRAMES;
    playSound(96, 0.12, "triangle");
  }
  if (bossChargeAnim > 0) bossChargeAnim--;
  if (bossShotTimer <= 0) {
    const angle = trackedBossAngle(boss.x, boss.y + 70, 18);
    const pattern = Math.random();
    const offsets = pattern < 0.56 ? [0] : pattern < 0.82 ? [-0.14, 0.14] : [-0.16, 0, 0.16];
    const speed = (pattern < 0.82 ? 3.5 : 4.05) + (bossPhase - 1) * 0.35;
    for (const offset of offsets) {
      const shotAngle = angle + offset;
      enemyBullets.push({
        x: boss.x,
        y: boss.y + 70,
        vx: Math.cos(shotAngle) * speed,
        vy: Math.sin(shotAngle) * speed,
        speed,
        turnRate: (pattern < 0.56 ? 0.026 : pattern < 0.82 ? 0.018 : 0) * (bossPhase >= 3 ? 1.35 : 1),
        homing: (pattern < 0.56 ? 105 : pattern < 0.82 ? 60 : 0) * (bossPhase >= 3 ? 1.4 : 1),
        kind: "meteor",
      });
    }
    bossShootAnim = BOSS_SHOOT_FRAMES;
    bossChargeAnim = 0;
    spawnBossParticles(10, {
      x: boss.x, y: boss.y + 34, angle, spread: 0.5, minSpeed: 1, maxSpeed: 3.6,
      minSize: 2, maxSize: 4, life: 20, colors: ["#e9e6dc", "#b4b1a9", "#fff6e0"],
    });
    bossShotTimer = Math.round(rand(52, 96) * rate);
  }
}

function drawBossArea(t) {
  const venus = bossKind === "venus";
  // The Moon fights in the same star field the rest of its chapter flies
  // through. The purple grid was the one place the backdrop changed identity
  // mid-run. Venus keeps the grid: its arena is the furnace, not open space.
  ctx.fillStyle = venus ? "#2a0d05" : "#000000"; ctx.fillRect(0, 0, W, H);
  if (venus) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bossGridLayer, 0, 0);
    ctx.restore();
  } else {
    drawStaticStars(t);
  }

  if (bossDying) updateBossDeath();
  if (!bossDying) updateBossPhase();
  if (venus) drawVenus(t); else drawMoon(t);
  updateBossExplosions();
  updateBossParticles();
  updateSparks();
  updateMuzzleFlashes();
  // The veil goes over the body and its debris but under everything that can
  // hurt you, so an eclipse hides the Moon's tells and never the bullets.
  if (!venus) { drawEclipseVeil(t); drawMoonImpacts(t); }

  // TECHNOLOGY burns the boss for as long as the beam is on it
  if (superBeam && !bossDying && superBeam.life % BEAM_TICK === 0 && beamDistance(boss.x, boss.y) < BEAM_HALF_WIDTH + bossRadius() * 0.8) {
    damageBoss(3, player.x, player.y);
    superDamage += 3;
    spawnSparks(boss.x, boss.y, 8, superBeam.color || superColor("lance"), { life: 20 });
  }

  if (!bossDying && venus) {
    updateVenusBoss(t);
  }

  if (!bossDying && !venus) updateMoonBoss(t);
  if (!gameActive) return;

  for (const bullet of enemyBullets) {
    if (bullet.homing > 0) {
      bullet.homing--;
      const targetAngle = Math.atan2(aimTargetY() - bullet.y, aimTargetX() - bullet.x);
      const currentAngle = Math.atan2(bullet.vy, bullet.vx);
      let angleDiff = targetAngle - currentAngle;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      const next = currentAngle + Math.max(-bullet.turnRate, Math.min(bullet.turnRate, angleDiff));
      bullet.vx = Math.cos(next) * bullet.speed;
      bullet.vy = Math.sin(next) * bullet.speed;
    }
    bullet.x += bullet.vx; bullet.y += bullet.vy;
    // MIRROR turns the round around; DECOY eats it. Either way it is spent
    // before it can reach the hull.
    if (tryMirrorReflect(bullet.x, bullet.y, 8) || tryDecoyIntercept(bullet.x, bullet.y, 8)) {
      bullet.y = H + 200;
      continue;
    }
    if (VENUS_TRAILS[bullet.kind] && Math.random() < 0.35) {
      spawnSparks(bullet.x - bullet.vx, bullet.y - bullet.vy, 1, VENUS_TRAILS[bullet.kind],
        { minSpeed: 0.1, maxSpeed: 0.8, life: 18, maxSize: 2 });
    }
    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    if (bullet.kind === "venus-dart") {
      ctx.rotate(Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2);
      drawAcidDart();
    } else if (bullet.kind === "venus-heat") {
      ctx.rotate(Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2);
      drawHeatShard();
    } else {
      ctx.rotate(Math.atan2(bullet.vy, bullet.vx));
      ctx.fillStyle = "#777";
      ctx.beginPath();
      ctx.moveTo(-8, -4); ctx.lineTo(-3, -9); ctx.lineTo(5, -7); ctx.lineTo(9, 0);
      ctx.lineTo(4, 8); ctx.lineTo(-5, 7); ctx.lineTo(-9, 2); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#aaa";
      ctx.beginPath(); ctx.arc(-2, -3, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (!devGodMode && playerInvulnerable === 0 && Math.abs(bullet.x - player.x) < 22 && Math.abs(bullet.y - player.y) < 24) {
      hurtPlayer();
      bullet.y = H + 200;
      if (!gameActive) return;
    }
  }
  compact(enemyBullets, (b) => b.y < H + 30 && b.y > -60 && b.x > -60 && b.x < W + 60);

  for (const bomb of superBombs) {
    bomb.x += bomb.vx; bomb.y += bomb.vy; bomb.life--;
    const color = bomb.color || superColor("bomb");
    drawGlow(color, 18, bomb.x, bomb.y);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 9, 0, Math.PI * 2); ctx.fill();
    if (Math.hypot(bomb.x - boss.x, bomb.y - boss.y) < 88 || bomb.life <= 0) {
      if (!bossDying && Math.hypot(bomb.x - boss.x, bomb.y - boss.y) < BOMB_RADIUS + bossRadius()) damageBoss(BOMB_BOSS_DAMAGE, bomb.x, bomb.y);
      bossExplosions.push({ x: bomb.x, y: bomb.y, r: 0, max: 110, life: 18, maxLife: 18 });
      startBombBlast(bomb.x, bomb.y, BOMB_RADIUS, color);
      bomb.explode = true;
    }
  }
  compact(superBombs, (bomb) => !bomb.explode);
  updateBombBlasts();

  for (const bullet of bullets) {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    drawPlayerBullet(bullet);
    if (!bossDying && bullet.ignore !== boss && Math.hypot(bullet.x - boss.x, bullet.y - boss.y) < bossRadius() + 4) {
      const hitX = bullet.x;
      const hitY = bullet.y;
      bullet.y = -100;
      damageBoss(bullet.damage || 1, hitX, hitY);
      superDamage += bullet.damage || 1;
      updateSuperMeter();
      if (bullet.type === "tech0") {
        spawnSparks(hitX, hitY, 14, WEAPON_COLORS.tech0, { minSpeed: 1, maxSpeed: 5, life: 20, maxSize: 4 });
        playSound(180, 0.1, "square");
        startTechChainBoss(hitX, hitY, null);
      }
      // Droplets splash off the hull and rake the brood instead.
      if (bullet.type === "magma") burstMagma(bullet, hitX, hitY, boss);
    }
  }
  compact(bullets, (bullet) => bullet.x > -20 && bullet.x < W + 20 && bullet.y > -20 && bullet.y < H + 20);
  if (!bossDying) {
    setWidth(dom.bossFill, Math.max(0, boss.health / bossMaxHealth()) * 100);
    // The bar is notched into the three phases; stamping which one we are in
    // lets the CSS recolour it, so the phase is legible from the HUD alone.
    if (dom.bossHealth && dom.bossHealth.dataset.phase !== String(bossPhase)) {
      dom.bossHealth.dataset.phase = String(bossPhase);
    }
  }

  for (const b of bossBullets) {
    b.x += b.vx;
    b.y += b.vy;
    const r = b.r || 7;
    if (tryMirrorReflect(b.x, b.y, r) || tryDecoyIntercept(b.x, b.y, r)) { b.y = H + 200; continue; }
    if (b.color) drawGlow(b.color, r * 2.4, b.x, b.y);
    ctx.fillStyle = b.color || "#ff8a5a";
    ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
    if (b.core) {
      ctx.fillStyle = b.core;
      ctx.beginPath(); ctx.arc(b.x - r * 0.22, b.y - r * 0.22, r * 0.38, 0, Math.PI * 2); ctx.fill();
    }
    const hitWidth = player.shrunk ? 13 : 22;
    const hitHeight = player.shrunk ? 14 : 24;
    if (!devGodMode && playerInvulnerable === 0 && Math.abs(b.x - player.x) < hitWidth + r && Math.abs(b.y - player.y) < hitHeight + r) {
      hurtPlayer();
      b.y = H + 200;
      if (!gameActive) return;
    }
  }
  compact(bossBullets, (b) => b.x > -30 && b.x < W + 30 && b.y > -30 && b.y < H + 30);

  if (bossMinions.length) {
    updateBossMinions();
    if (!gameActive) return;
  }

  if (venus) {
    updateVenusBolts();
    if (!gameActive) return;
  }

  updateSuperEntities(t);
  if (boss.health <= 0 && !bossDying) startBossDeath();
  updateSuperBeam(t);
  updateTechChains(t);
  drawChargeAura(t);
  drawPlayer();
}

let rewardRevealTimer = null;
let rewardSfxTimers = [];
let rewardMode = "moon";
function showVictory() {
  gamePaused = true;
  bossIntro = true;
  // Hearts, wave, score and the super meter are for a run in progress. Behind
  // the end-of-run cards they just leak the HUD into the artwork.
  dom.gameUi.classList.add("run-complete");
  music.play("victory");
  document.getElementById("boss-player-name").textContent = playerName;
  document.getElementById("victory-player-name").textContent = playerName;
  setText(document.getElementById("victory-score"), String(score).padStart(6, "0"));
  setText(document.getElementById("victory-waves"), "5");
  unlockMoonRewards();
  refreshLoadoutUI();
  dom.victoryScreen.classList.remove("visible");
  dom.victoryScreen.setAttribute("aria-hidden", "true");
  rewardMode = "moon";
  celebrationScene = "space";
  const rewards = document.getElementById("reward-screen");
  rewards.classList.remove("venus");
  rewards.querySelector(".reward-moon").hidden = false;
  rewards.querySelector(".reward-venus").hidden = true;
  openRewardScreen();
}

// Venus pays out Magma the same way Mercury paid out Tech.0: a standalone
// reward beat before the run carries on. The shared reveal below plays the
// lock cinematic, the sounds and the continue timing for both planets.
function showVenusRewards() {
  gamePaused = true;
  bossIntro = true;
  music.play("victory");
  unlockVenusRewards();
  refreshLoadoutUI();
  rewardMode = "venus";
  celebrationScene = "venus-arena";
  const rewards = document.getElementById("reward-screen");
  rewards.classList.add("venus");
  rewards.querySelector(".reward-moon").hidden = true;
  rewards.querySelector(".reward-venus").hidden = false;
  openRewardScreen();
}

function openRewardScreen() {
  syncMobileControls();
  clearTimeout(rewardRevealTimer);
  for (const timer of rewardSfxTimers) clearTimeout(timer);
  rewardSfxTimers = [];
  const rewards = document.getElementById("reward-screen");
  const next = document.getElementById("reward-continue");
  next.disabled = true;
  next.classList.remove("ready");
  rewards.classList.remove("snap");
  rewards.classList.add("visible");
  rewards.setAttribute("aria-hidden", "false");
  rewards.focus();
  // Lock-cinematic foley, matched to the CSS beats: three strain creaks, the
  // snap, the title slam, then the continue chime.
  const at = (ms, fn) => rewardSfxTimers.push(setTimeout(() => {
    if (rewards.classList.contains("visible")) fn();
  }, ms));
  at(200, () => playSound(140, 0.09, "square"));
  at(500, () => playSound(165, 0.09, "square"));
  at(800, () => playSound(190, 0.1, "square"));
  at(1000, () => {
    rewards.classList.add("snap");
    playSound(1200, 0.06, "square");
    playSound(90, 0.3, "sawtooth");
  });
  at(1250, () => { playSound(660, 0.12, "triangle"); playSound(990, 0.16, "triangle"); });
  at(1450, () => playSound(780, 0.1, "sine"));
  at(1600, () => playSound(920, 0.12, "sine"));
  rewardRevealTimer = setTimeout(() => {
    if (!rewards.classList.contains("visible")) return;
    next.disabled = false;
    next.classList.add("ready");
    next.focus();
    playSound(880, .18, "triangle");
    playSound(1320, .22, "sine");
  }, 1800);
}

// Local space: the hull points up, so the flame hangs off +y. Called from inside
// drawPlayer's transform — it inherits the ship's position, rotation and scale.
function drawShipThrust(now, drive) {
  const flick = 0.72 + Math.abs(Math.sin(now * 0.028)) * 0.28;
  const reach = (0.62 + drive * 0.55) * flick;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "rgba(255, 110, 30, .3)";
  ctx.beginPath();
  ctx.moveTo(-7.5, 12); ctx.lineTo(0, 12 + 26 * reach); ctx.lineTo(7.5, 12); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255, 176, 74, .48)";
  ctx.beginPath();
  ctx.moveTo(-4.8, 11); ctx.lineTo(0, 11 + 17 * reach); ctx.lineTo(4.8, 11); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255, 238, 204, .88)";
  ctx.beginPath();
  ctx.moveTo(-2.4, 10); ctx.lineTo(0, 10 + 9 * reach); ctx.lineTo(2.4, 10); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPlayer() {
  const scale = player.shrunk ? 0.55 : 1;
  const now = performance.now();
  const chargeReady = selectedWeapon === "charge" && chargeRatio() >= 1;
  const chargeShakeX = chargeReady ? Math.sin(now * 0.19) * 1.25 : 0;
  const chargeShakeY = chargeReady ? Math.cos(now * 0.23) * 0.7 : 0;
  ctx.save();
  ctx.translate(player.x + chargeShakeX, player.y + chargeShakeY);
  ctx.scale(scale, scale);
  ctx.rotate(Math.atan2(facing.y, facing.x) + Math.PI / 2);
  if (superMeter >= 1) {
    // Trace the hull itself: a thick neon edge and tightly contained softness,
    // never a circular lantern aura around the player.
    const pulse = 0.92 + Math.sin(now * 0.01) * 0.08;
    ctx.globalCompositeOperation = "lighter";
    const readyColor = superColor();
    ctx.strokeStyle = readyColor;
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.18 * pulse;
    ctx.lineWidth = 12;
    ctx.stroke(PLAYER_HULL);
    ctx.globalAlpha = 0.52 * pulse;
    ctx.lineWidth = 7;
    ctx.stroke(PLAYER_HULL);
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 4.5;
    ctx.shadowColor = readyColor;
    ctx.shadowBlur = 4;
    ctx.stroke(PLAYER_HULL);
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
  // Engine: the same three-cone flame the versus card lights, drawn behind the
  // hull inside the ship's own transform so it always trails the nose. It burns
  // harder while the player is actually driving.
  drawShipThrust(now, Math.min(1, Math.hypot(player.vx, player.vy) / Math.max(0.001, player.maxSpeed)));
  ctx.fillStyle = playerColor;
  ctx.fill(PLAYER_HULL);
  ctx.restore();
  if (playerInvulnerable > 0) { ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(player.x, player.y, player.shrunk ? 24 : 34, 0, Math.PI * 2); ctx.stroke(); }
  if (invincibilitySuperTimer > 0) {
    const radius = player.shrunk ? 29 : 42;
    const pulse = Math.sin(performance.now() * 0.012) * 2;
    const shieldColor = superColor("invincibility");
    drawGlow(shieldColor, 16, player.x, player.y);
    ctx.save();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = shieldColor;
    ctx.beginPath(); ctx.arc(player.x, player.y, radius + pulse, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = shieldColor;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(player.x, player.y, radius + pulse, 0, Math.PI * 2); ctx.stroke();
  }
}

function endGame() {
  const defeatedByBoss = bossMode;
  const venusWon = bossMode && bossKind === "venus";
  deathScene = bossMode
    ? (bossKind === "venus" ? "venus-arena" : "space")
    : (wave >= 6 ? "venus-sky" : "space");
  gameActive = false;
  playSound(90, 0.55, "sawtooth");
  playSound(60, 1.1, "sawtooth");
  bossIntro = false;
  music.stop();
  bossMode = false;
  superBeam = null;
  techChains = [];
  clearSuperEntities();
  gameOverShown = true;
  enemyBullets = [];
  syncMobileControls();
  syncWakeLock();
  versusCardUp = false;
  defeatPortrait = defeatedByBoss;
  // Losing to a boss should cost you the fight, not the run: TRY AGAIN goes back
  // to the stage that killed you.
  retryBoss = defeatedByBoss ? bossKind : null;
  retryWave = wave;
  dom.gameUi.classList.toggle("versus", defeatedByBoss);
  if (defeatedByBoss) {
    setText(dom.gameMessage, "");
    document.getElementById("try-again-btn").classList.remove("visible");
    document.getElementById("main-menu-btn").classList.remove("visible");
    setText(document.getElementById("defeat-title"), venusWon ? "VENUS WINS" : "THE MOON WINS");
    const quote = document.getElementById("defeat-quote");
    quote.replaceChildren();
    quote.insertAdjacentHTML("afterbegin", venusWon
      ? "\u201cMy sky is lead, my rain is acid \u2014<br />you were never getting past it.\u201d"
      : "\u201cI have watched every one of your wars<br />and outlasted all of them.\u201d");
    dom.moonDefeatScreen.classList.toggle("venus", venusWon);
    dom.moonDefeatScreen.classList.add("visible");
    dom.moonDefeatScreen.setAttribute("aria-hidden", "false");
    playSound(420, 0.12, "square");
    setTimeout(() => playSound(540, 0.12, "square"), 130);
    setTimeout(() => playSound(660, 0.18, "square"), 260);
    return;
  }
  setText(dom.gameMessage, "GAME OVER");
  dom.gameMessage.classList.add("game-over-message");
  document.getElementById("try-again-btn").classList.add("visible");
  document.getElementById("main-menu-btn").classList.add("visible");
}

// `startWave` / `startBoss` come from the LEVELS picker; the START button calls
// this with no arguments and gets wave 1 exactly as before.
function startGame(startWave = 1, startBoss = null) {
  defeatPortrait = false;
  versusCardUp = false;
  dom.gameUi.classList.remove("versus");
  dom.gameMessage.classList.remove("game-over-message");
  ensureAudio();
  if (audioContext && audioContext.state === "suspended") audioContext.resume();
  gameActive = true;
  celebrationScene = null;
  bossIntro = false;
  bossMode = false;
  bossKind = "moon";
  bossDefeated = false;
  bossBullets = [];
  resetBossAnimation();
  player.shrunk = false;
  gameOverShown = false;
  score = 0;
  lives = 3;
  wave = startWave;
  bullets = [];
  enemyBullets = [];
  superBombs = [];
  bombBlasts = [];
  techChains = [];
  clearSuperEntities();
  setPaused(false);
  sparks = [];
  muzzleFlashes.length = 0;
  superBeam = null;
  heartsDrawn = -1;
  chargeStartedAt = 0;
  kills = 0;
  superDamage = 0;
  superMeter = 0;
  lastSuperKills = 0;
  facing.x = 0;
  facing.y = -1;
  lastArrowDirection.x = 0;
  lastArrowDirection.y = -1;
  fireCooldown = 0;
  tech0Primed = true;
  playerInvulnerable = 0;
  invincibilitySuperTimer = 0;
  screenShakeFrames = 0;
  screenShakeStrength = 0;
  enemyShotTimer = 60;
  player.x = W / 2;
  player.y = playerStartY();
  player.vx = 0;
  player.vy = 0;
  // A boss stage skips the wave entirely and drops straight into the intro card;
  // anything else builds its roster the same way a cleared wave would. The
  // empty roster matters: without it a boss stage inherits the last run's
  // enemies, which would be waiting in the arena the moment the fight ends.
  if (startBoss) enemies = []; else createEnemies();
  music.play("battle");
  if (!startBoss) showWaveBanner(`WAVE ${wave}`, WAVE_INTROS[wave] || "GOOD LUCK");
  // The sky follows the stage, so jumping to wave 7 opens over Venus rather
  // than in Mercury's star field (and `endGame` records the right death scene).
  deathScene = startBoss === "venus" ? "venus-arena" : wave >= 6 ? "venus-sky" : "space";
  document.getElementById("menu-wrap").classList.add("hidden");
  document.getElementById("game-ui").classList.add("active");
  document.getElementById("game-ui").setAttribute("aria-hidden", "false");
  setText(dom.gameMessage, "");
  document.getElementById("try-again-btn").classList.remove("visible");
  document.getElementById("main-menu-btn").classList.remove("visible");
  document.getElementById("boss-health").classList.remove("visible");
  document.getElementById("boss-health").classList.remove("venus");
  document.getElementById("boss-intro").classList.remove("visible");
  document.getElementById("victory-screen").classList.remove("visible");
  document.getElementById("victory-screen").setAttribute("aria-hidden", "true");
  dom.gameUi.classList.remove("run-complete");
  dom.thanksScreen.classList.remove("visible");
  dom.thanksScreen.setAttribute("aria-hidden", "true");
  dom.moonDefeatScreen.classList.remove("visible");
  dom.moonDefeatScreen.setAttribute("aria-hidden", "true");
  playerName = "PLAYER";
  setText(dom.score, "000000");
  setText(dom.waveNumber, String(wave));
  setLives(lives);
  updateSuperMeter();
  syncMobileControls();
  if (startBoss) enterBossArea(startBoss);
}

// ---------------------------------------------------------------------------
// Front-end skin
//
// Ship chrome stays tied to the chosen hull, while weapon and super accents use
// their own palettes so the loadout is readable before and during combat.
// ---------------------------------------------------------------------------
function rgbString(hex) {
  const value = parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

function weaponColor(type = selectedWeapon) {
  return WEAPON_COLORS[type] || WEAPON_COLORS.blaster;
}

function superColor(type = selectedSuper) {
  return SUPER_COLORS[type] || SUPER_COLORS.bomb;
}

function setTheme(hex) {
  const root = document.documentElement;
  root.style.setProperty("--theme", hex);
  root.style.setProperty("--theme-rgb", rgbString(hex));
}

const MAX_DRAWN_HEARTS = 8;
let heartsDrawn = -1;

// Health is hearts now. Rebuilding the row on every hit would restart the beat
// animation on all of them, so it only rebuilds when the count actually moves.
function setLives(count, gained) {
  if (count === heartsDrawn) return;
  const previous = heartsDrawn;
  heartsDrawn = count;
  const shown = Math.min(count, MAX_DRAWN_HEARTS);
  let html = "";
  for (let i = 0; i < shown; i++) {
    const isNew = gained && i === shown - 1;
    html += `<i class="heart${isNew ? " gained" : ""}"></i>`;
  }
  // keep the row's width honest while the player is losing hearts
  for (let i = shown; i < Math.min(Math.max(previous, 3), MAX_DRAWN_HEARTS); i++) {
    html += '<i class="heart lost"></i>';
  }
  if (count > MAX_DRAWN_HEARTS) html += `<span class="hearts-extra">x${count}</span>`;
  dom.hearts.innerHTML = html;
}

let waveBannerTimer = null;

function showWaveBanner(main, sub) {
  const banner = dom.waveBanner;
  setText(dom.waveBannerMain, main);
  setText(dom.waveBannerSub, sub || "");
  banner.classList.remove("show");
  void banner.offsetWidth;
  banner.classList.add("show");
  clearTimeout(waveBannerTimer);
  waveBannerTimer = setTimeout(() => banner.classList.remove("show"), 2200);
}

function setPaused(paused) {
  gamePaused = paused;
  dom.pauseScreen.classList.toggle("visible", paused);
  dom.pauseScreen.setAttribute("aria-hidden", String(!paused));
  setText(dom.gameMessage, "");
  music.setDucked(paused);
  syncMobileControls();
  syncWakeLock();
  if (paused) {
    collapseAudioDrawers(dom.pauseScreen);
    focusMenuDefault(dom.pauseScreen);
  }
  else if (dom.pauseScreen.contains(document.activeElement)) document.activeElement.blur();
}

// Keep the screen awake mid-run. Phones love to sleep during a long boss
// fight; the lock is held only while a run is actively playing and released
// everywhere the run ends.
let wakeLock = null;
function syncWakeLock() {
  if (!("wakeLock" in navigator)) return;
  const want = gameActive && !gamePaused && !gameOverShown && !bossIntro;
  if (want && !wakeLock) {
    navigator.wakeLock.request("screen").then((lock) => {
      wakeLock = lock;
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    }).catch(() => { wakeLock = null; });
  } else if (!want && wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// Shared by the pause card, the game-over screen and Escape-to-quit, so leaving
// a run always tears down the same state.
function returnToMenu() {
  celebrationScene = null;
  versusCardUp = false;
  dom.gameUi.classList.remove("run-complete");
  dom.thanksScreen.classList.remove("visible");
  dom.thanksScreen.setAttribute("aria-hidden", "true");
  defeatPortrait = false;
  dom.gameUi.classList.remove("versus");
  gameActive = false;
  gamePaused = false;
  bossMode = false;
  bossKind = "moon";
  bossIntro = false;
  bossDying = false;
  venusQueue = [];
  venusBolts = [];
  hideHudLoadoutCard();
  gameOverShown = false;
  enemyBullets = [];
  bossBullets = [];
  bullets = [];
  superBombs = [];
  bombBlasts = [];
  superBeam = null;
  techChains = [];
  clearSuperEntities();
  dom.pauseScreen.classList.remove("visible");
  dom.pauseScreen.setAttribute("aria-hidden", "true");
  document.getElementById("game-ui").classList.remove("active");
  document.getElementById("game-ui").setAttribute("aria-hidden", "true");
  document.getElementById("menu-wrap").classList.remove("hidden", "launching");
  document.getElementById("boss-health").classList.remove("visible");
  document.getElementById("boss-health").classList.remove("venus");
  document.getElementById("boss-intro").classList.remove("visible");
  document.getElementById("victory-screen").classList.remove("visible");
  document.getElementById("victory-screen").setAttribute("aria-hidden", "true");
  dom.moonDefeatScreen.classList.remove("visible");
  dom.moonDefeatScreen.setAttribute("aria-hidden", "true");
  setText(dom.gameMessage, "");
  document.getElementById("try-again-btn").classList.remove("visible");
  document.getElementById("main-menu-btn").classList.remove("visible");
  syncMobileControls();
  syncWakeLock();
  music.play("menu");
  focusMenuDefault(dom.menu);
}

function flashDamage() {
  const flash = dom.damageFlash;
  flash.classList.remove("active");
  void flash.offsetWidth;
  flash.classList.add("active");
}

// Blast reach and boss damage for the bomb super, in one place so the tiles,
// the armory stats and every arena can never drift apart.
const BOMB_RADIUS = 160;
const BOMB_BOSS_DAMAGE = 15;
// Supers punctuate a fight rather than carry it — every cost went up so the
// meter is a reward for a sustained run instead of a per-wave freebie.
// Costs for the six sheet supers are the numbers written on the page itself.
const SUPER_COST = {
  bomb: 40, invincibility: 52, lance: 48,
  star: 45, mirror: 55, drone: 40, decoy: 30, firstaid: 55, orb: 25,
};
let superReadyShown = false;

function updateSuperMeter() {
  const requiredDamage = SUPER_COST[selectedSuper] || 20;
  superMeter = Math.min(1, (superDamage - lastSuperKills) / requiredDamage);
  setWidth(dom.superFill, superMeter * 100);
  const ready = superMeter >= 1;
  if (ready !== superReadyShown) {
    superReadyShown = ready;
    dom.superMeter.classList.toggle("ready", ready);
    if (ready && gameActive) {
      playSound(980, 0.1, "triangle");
      playSound(1320, 0.16, "sine");
    }
  }
}

const WEAPON_LABELS = { blaster: "BLASTER", charge: "CHARGE", cone: "CONE", tech0: "TECH.0", magma: "MAGMA" };
const SUPER_LABELS = {
  bomb: "BOMB", invincibility: "SHIELD", lance: "TECHNOLOGY",
  star: "STAR", mirror: "MIRROR", drone: "DRONE",
  decoy: "DECOY", firstaid: "FIRST-AID", orb: "RADIANT ORB",
};

const BOOK_ENTRIES = {
  blaster: ["STEADY & RELIABLE", "A quick stream of yellow bolts. Keep your aim steady and carve a path through the swarm.", "1 DAMAGE · RAPID FIRE"],
  charge: ["HOLD. BUILD. RELEASE.", "Grow an orange energy ball as you charge. Full power burns through every enemy in its path.", "1 / 3 / 5 DAMAGE · FULL CHARGE PIERCES"],
  cone: ["COVER THE ANGLES", "Three green bolts fan out with every shot. Catch moving targets and clear a wider lane.", "3 BOLTS · WIDE SPREAD"],
  tech0: ["LIGHTNING FINDS A WAY", "A cyan electric round hits hard, then arcs to five nearby enemies — dropping smaller ones outright, including the Moon's ejecta. Listen for the ready ping: each shot takes well under a second to recharge.", "3 IMPACT · 5 × 1 CHAIN · 0.7 SEC"],
  magma: ["HEAVY. SLOW. IT SPLASHES.", "A slug of Venusian lava, crusted black and cracked with fire. Slow in the air, but on impact it bursts into five burning droplets that spray across whatever is standing next to the target. Group them up and let it cook.", "3 IMPACT · 5 × 1 SPLASH · 0.5 SEC"],
  bomb: ["MAKE SOME SPACE", "Launch a blue warhead that erupts into a wide shockwave. Clears nearby enemies and hits a boss for 15 damage.", "160 PX BLAST · 15 BOSS DAMAGE"],
  invincibility: ["A MOMENT OF SAFETY", "Wrap your ship in a golden shield. Push through danger with three seconds of protection.", "3 SEC PROTECTION · HIGH COST"],
  lance: ["CUT THROUGH THE CHAOS", "A purple beam burns through everything along its path. Move your ship to sweep the beam across the battlefield.", "PIERCING BEAM · CONTINUOUS DAMAGE"],
  star: ["IT NEVER STOPS BOUNCING", "Throw a giant star that ricochets off every wall for six seconds, hitting anything it touches on the way round. Takes a while to charge.", "3 DAMAGE PER HIT · 6 SEC"],
  mirror: ["SEND IT BACK", "For five seconds every enemy shot bounces off your hull and hunts the nearest enemy instead. Fly straight into the fire — but it is the slowest super in the game to charge.", "5 SEC · 2 DAMAGE PER REFLECT"],
  drone: ["YOU FLY IT IN", "Launch a warhead drone. Your arrow keys steer it instead of shooting until it hits something and detonates — then they are yours again.", "30 BOSS DAMAGE · 190 PX BLAST"],
  decoy: ["LOOK OVER THERE", "Drop a hologram of your ship with 3 HP. Everything in the arena shoots at it instead of you, and it detonates when it dies.", "3 HP · FULL AGGRO · EXPLODES"],
  firstaid: ["PATCH YOURSELF UP", "The only super that gives hearts back. Costs the most meter in the game, and it is still worth it when you are down to one.", "+4 HEARTS · 55 DAMAGE TO CHARGE"],
  orb: ["A SUN OF YOUR OWN", "Plant a small star that hangs in the air for four seconds, spraying fire in every direction. Anything that touches it is vaporised.", "4 SEC · RADIAL FIRE · CONTACT KILL"]
};
let bookPage = "primary";
let bookPreview = "blaster";
let bookDetailStats = false;
const BOOK_STATS = {
  blaster: [["DAMAGE", "1 / bolt"], ["FIRE CYCLE", "0.17 sec"]],
  charge: [["DAMAGE", "1 / 3 / 5"], ["FULL CHARGE", "2.5 sec"], ["FULL PIERCE", "Unlimited"]],
  cone: [["DAMAGE", "1 × 3 bolts"], ["FIRE CYCLE", "0.3 sec"]],
  tech0: [["IMPACT", "3 damage"], ["CHAIN", "5 × 1"], ["FIRE CYCLE", "0.7 sec"]],
  magma: [["IMPACT", "3 damage"], ["SPLASH", "5 × 1"], ["FIRE CYCLE", "0.5 sec"]],
  bomb: [["BOSS DAMAGE", "15"], ["BLAST RADIUS", "160 px"], ["NORMAL ENEMIES", "Instant defeat"]],
  invincibility: [["DAMAGE", "None"], ["PROTECTION", "3 sec"], ["METER COST", "52 damage"]],
  lance: [["BOSS DAMAGE", "3 / tick"], ["TICK INTERVAL", "0.13 sec"], ["DURATION", "0.87 sec"]],
  star: [["DAMAGE", "3 / hit"], ["DURATION", "6 sec"], ["METER COST", "45 damage"]],
  mirror: [["REFLECT DAMAGE", "2"], ["DURATION", "5 sec"], ["METER COST", "55 damage"]],
  drone: [["BOSS DAMAGE", "30"], ["BLAST RADIUS", "190 px"], ["METER COST", "40 damage"]],
  decoy: [["DECOY HEALTH", "3 HP"], ["LIFESPAN", "15 sec"], ["METER COST", "30 damage"]],
  firstaid: [["HEALING", "+4 hearts"], ["HEART CAP", "8"], ["METER COST", "55 damage"]],
  orb: [["CONTACT", "Vaporises"], ["DURATION", "4 sec"], ["METER COST", "25 damage"]]
};
function renderBookDetail() {
  const book = document.getElementById("weapon-book");
  book.querySelector(".book-art").hidden = bookDetailStats;
  const stats = book.querySelector(".book-detail-stats");
  stats.hidden = !bookDetailStats;
  stats.replaceChildren();
  for (const [label, value] of BOOK_STATS[bookPreview]) {
    const row = document.createElement("div");
    const name = document.createElement("dt");
    const amount = document.createElement("dd");
    name.textContent = label; amount.textContent = value;
    row.append(name, amount); stats.append(row);
  }
  book.querySelector(".book-detail-label").textContent = bookDetailStats ? "STATS" : "ICON";
  book.querySelector(".detail-prev").disabled = !bookDetailStats;
  book.querySelector(".detail-next").disabled = bookDetailStats;
}
function renderWeaponBook() {
  const book = document.getElementById("weapon-book");
  if (!book) return;
  const isSuper = bookPage === "super";
  const key = bookPreview;
  const entry = BOOK_ENTRIES[key];
  book.dataset.page = bookPage;
  book.style.setProperty("--book-accent", (isSuper ? SUPER_COLORS : WEAPON_COLORS)[key]);
  book.querySelector(".gun-section").hidden = isSuper;
  book.querySelector(".super-section").hidden = !isSuper;
  book.querySelector(".book-category").textContent = isSuper ? "02 / SUPER ATTACKS" : "01 / PRIMARY GUNS";
  book.querySelector(".book-name").textContent = (isSuper ? SUPER_LABELS : WEAPON_LABELS)[key];
  book.querySelector(".book-kicker").textContent = entry[0];
  book.querySelector(".book-description").textContent = entry[1];
  const original = book.querySelector(`[data-${isSuper ? "super" : "weapon"}="${key}"] .projectile-preview`);
  const art = book.querySelector(".book-art");
  if (original) art.replaceChildren(original.cloneNode(true));
  art.style.setProperty("--loadout-color", (isSuper ? SUPER_COLORS : WEAPON_COLORS)[key]);
  art.style.setProperty("--loadout-rgb", rgbString((isSuper ? SUPER_COLORS : WEAPON_COLORS)[key]));
  book.querySelector(".book-prev").disabled = !isSuper;
  book.querySelector(".book-next").disabled = isSuper;
  renderBookDetail();
}
function setupWeaponBook() {
  const book = document.querySelector(".weapons-card");
  book.id = "weapon-book";
  book.classList.add("weapon-book");
  book.querySelector("h2").textContent = "FLIGHT ARMORY";
  const extra = book.querySelector("[data-weapon='tech0']");
  book.querySelector(".gun-section .weapon-grid").append(extra);
  const extraMagma = book.querySelector("[data-weapon='magma']");
  book.querySelector(".gun-section .weapon-grid").append(extraMagma);
  document.getElementById("primary-more-toggle").hidden = true;
  book.insertAdjacentHTML("beforeend", `<div class="book-overview" aria-live="polite"><div class="book-copy"><p class="book-category"></p><h3 class="book-name"></h3><p class="book-kicker"></p><p class="book-description"></p><p class="book-stats"></p></div><div class="book-art" aria-hidden="true"></div></div><nav class="book-navigation" aria-label="Armory pages"><button class="book-prev" type="button" aria-label="Previous page: primary guns"><span class="page-chevron" aria-hidden="true"></span> GUNS</button><button class="book-next" type="button" aria-label="Next page: super attacks">SUPERS <span class="page-chevron" aria-hidden="true"></span></button></nav>`);
  book.querySelectorAll(".weapon-tile").forEach((tile) => {
    tile.querySelector(".tile-badge")?.remove();
    const label = WEAPON_LABELS[tile.dataset.weapon] || SUPER_LABELS[tile.dataset.super];
    tile.setAttribute("aria-label", label);
    tile.title = label;
    // The page has to follow the tile. Setting only `bookPreview` left the book
    // on the guns page looking for `[data-weapon="orb"]`, which is null.
    tile.addEventListener("click", () => {
      bookPage = tile.dataset.super ? "super" : "primary";
      bookPreview = tile.dataset.weapon || tile.dataset.super;
      bookDetailStats = false;
      renderWeaponBook();
    });
  });
  book.querySelectorAll(".book-navigation button").forEach((button) => button.addEventListener("click", () => {
    bookPage = button.classList.contains("book-next") ? "super" : "primary";
    bookPreview = bookPage === "super" ? selectedSuper : selectedWeapon;
    bookDetailStats = false;
    renderWeaponBook();
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      book.querySelector(".book-overview").animate([{ transform: `perspective(900px) rotateY(${bookPage === "super" ? -18 : 18}deg)`, opacity: .3 }, { transform: "perspective(900px) rotateY(0deg)", opacity: 1 }], { duration: 360, easing: "ease-out" });
    }
    book.querySelector(bookPage === "super" ? ".book-prev" : ".book-next").focus();
    playSound(380, .06, "triangle");
  }));
  const art = book.querySelector(".book-art");
  const detail = document.createElement("section");
  book.querySelector(".book-stats")?.remove();
  detail.className = "book-detail";
  detail.setAttribute("aria-label", "Weapon illustration and statistics");
  art.before(detail);
  detail.append(art);
  detail.insertAdjacentHTML("beforeend", '<dl class="book-detail-stats" hidden></dl><nav class="book-detail-navigation" aria-label="Illustration and stats"><button class="detail-prev" type="button" aria-label="Show weapon icon"><span class="page-chevron" aria-hidden="true"></span></button><span class="book-detail-label" aria-live="polite">ICON</span><button class="detail-next" type="button" aria-label="Show weapon stats"><span class="page-chevron" aria-hidden="true"></span></button></nav>');
  detail.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    bookDetailStats = button.classList.contains("detail-next");
    renderBookDetail();
    detail.querySelector(bookDetailStats ? ".detail-prev" : ".detail-next").focus();
    playSound(440, .04, "triangle");
  }));
  renderWeaponBook();
}

// Every place a loadout can be picked (weapons panel + victory screen) is
// repainted from `selectedWeapon` / `selectedSuper`, so the highlight can never
// drift out of sync with what the ship actually fires.
function refreshLoadoutUI() {
  const root = document.documentElement;
  const activeWeaponColor = weaponColor();
  const activeSuperColor = superColor();
  root.style.setProperty("--weapon-color", activeWeaponColor);
  root.style.setProperty("--weapon-rgb", rgbString(activeWeaponColor));
  root.style.setProperty("--super-color", activeSuperColor);
  root.style.setProperty("--super-rgb", rgbString(activeSuperColor));
  for (const [type, value, color] of [["weapon", selectedWeapon, activeWeaponColor], ["super", selectedSuper, activeSuperColor]]) {
    const slot = document.getElementById(`hud-${type}-icon`);
    const source = document.querySelector(`.weapon-tile[data-${type}="${value}"] .projectile-preview`);
    if (!slot || !source) continue;
    slot.replaceChildren(source.cloneNode(true));
    slot.style.setProperty("--loadout-color", color);
    slot.style.setProperty("--loadout-rgb", rgbString(color));
    const label = type === "weapon" ? WEAPON_LABELS[value] : SUPER_LABELS[value];
    slot.setAttribute("aria-label", `${type === "weapon" ? "Gun" : "Super"}: ${label}`);
    // no `title`: the browser tooltip would race the hover card
    if (hudCardSlot === slot) showHudLoadoutCard(slot, value, color);
  }
  document.querySelectorAll("[data-weapon], [data-victory-weapon]").forEach((item) => {
    const value = item.dataset.weapon || item.dataset.victoryWeapon;
    item.classList.toggle("selected", value === selectedWeapon);
    item.setAttribute("aria-pressed", String(value === selectedWeapon));
  });
  document.querySelectorAll("[data-super], [data-victory-super]").forEach((item) => {
    const value = item.dataset.super || item.dataset.victorySuper;
    item.classList.toggle("selected", value === selectedSuper);
    item.setAttribute("aria-pressed", String(value === selectedSuper));
  });
  // Every readout, wherever it lives — the menu button, the armory footer and
  // the FLIGHT ARMORY buttons on the reward and victory screens.
  for (const target of document.querySelectorAll("[data-loadout-readout]")) {
    const weapon = document.createElement("span");
    const plus = document.createElement("span");
    const superName = document.createElement("span");
    weapon.textContent = WEAPON_LABELS[selectedWeapon];
    weapon.style.color = activeWeaponColor;
    plus.textContent = " + "; plus.style.color = "var(--theme)";
    superName.textContent = SUPER_LABELS[selectedSuper];
    superName.style.color = activeSuperColor;
    target.replaceChildren(weapon, plus, superName);
  }
}

// Hover/focus explainer for the two HUD loadout icons. It reuses the armory's
// own copy so the card and the FLIGHT ARMORY can never describe a weapon
// differently, and it renders on demand rather than every frame.
let hudCardSlot = null;
function showHudLoadoutCard(slot, key, color) {
  const card = document.getElementById("hud-loadout-card");
  if (!card) return;
  hudCardSlot = slot;
  const entry = BOOK_ENTRIES[key];
  const label = WEAPON_LABELS[key] || SUPER_LABELS[key];
  card.style.setProperty("--card-color", color);
  card.querySelector(".hud-card-name").textContent = label;
  card.querySelector(".hud-card-kicker").textContent = entry ? entry[0] : "";
  const stats = card.querySelector(".hud-card-stats");
  stats.replaceChildren();
  for (const [name, value] of BOOK_STATS[key] || []) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = name;
    dd.textContent = value;
    stats.append(dt, dd);
  }
  card.classList.add("visible");
}

function hideHudLoadoutCard(slot) {
  const card = document.getElementById("hud-loadout-card");
  if (!card || (slot && hudCardSlot !== slot)) return;
  hudCardSlot = null;
  card.classList.remove("visible");
}

function setupHudLoadoutCards() {
  for (const type of ["weapon", "super"]) {
    const slot = document.getElementById(`hud-${type}-icon`);
    if (!slot) continue;
    const open = () => showHudLoadoutCard(
      slot,
      type === "weapon" ? selectedWeapon : selectedSuper,
      type === "weapon" ? weaponColor() : superColor()
    );
    slot.addEventListener("pointerenter", open);
    slot.addEventListener("focus", open);
    slot.addEventListener("pointerleave", () => hideHudLoadoutCard(slot));
    slot.addEventListener("blur", () => hideHudLoadoutCard(slot));
  }
}
setupHudLoadoutCards();

function syncMoonRewardUI() {
  document.querySelectorAll("[data-moon-locked]").forEach((item) => {
    item.classList.toggle("locked", !moonRewardsUnlocked);
    item.setAttribute("aria-disabled", String(!moonRewardsUnlocked));
  });
  const greyChoice = document.querySelector(".color-choice.grey");
  if (greyChoice) {
    greyChoice.setAttribute("aria-label", moonRewardsUnlocked ? "Grey" : "Grey ship locked: beat the Moon");
  }
  syncRewardEquipButtons();
}

// The reward screen offers the new gear rather than forcing it: both buttons
// stay grey and optional, and flip to a filled "EQUIPPED" state once used.
function syncRewardEquipButtons() {
  const tech = document.getElementById("reward-equip-tech0");
  const grey = document.getElementById("reward-equip-grey");
  // Both buttons toggle: pressing an equipped reward puts back whatever was
  // selected before it, so trying the reward out is never a one-way door.
  if (tech) {
    const on = selectedWeapon === "tech0";
    tech.classList.toggle("equipped", on);
    tech.textContent = on ? "EQUIPPED" : "EQUIP";
    tech.setAttribute("aria-pressed", String(on));
  }
  if (grey) {
    const on = playerColor === GREY_SHIP_COLOR;
    grey.classList.toggle("equipped", on);
    grey.textContent = on ? "EQUIPPED" : "EQUIP";
    grey.setAttribute("aria-pressed", String(on));
  }
  const magma = document.getElementById("reward-equip-magma");
  if (magma) {
    const on = selectedWeapon === "magma";
    magma.classList.toggle("equipped", on);
    magma.textContent = on ? "EQUIPPED" : "EQUIP";
    magma.setAttribute("aria-pressed", String(on));
  }
  const magmaShip = document.getElementById("reward-equip-magma-ship");
  if (magmaShip) {
    const on = playerColor === MAGMA_SHIP_COLOR;
    magmaShip.classList.toggle("equipped", on);
    magmaShip.textContent = on ? "EQUIPPED" : "EQUIP";
    magmaShip.setAttribute("aria-pressed", String(on));
  }
}

function unlockMoonRewards() {
  if (!moonRewardsUnlocked) {
    moonRewardsUnlocked = true;
    try {
      localStorage.setItem(MOON_UNLOCK_KEY, "unlocked");
    } catch (error) {
      // The reward still unlocks for this session when storage is unavailable.
    }
  }
  syncMoonRewardUI();
}

// Single place that applies a ship colour, so the menu swatches and the reward
// screen's EQUIP button can never leave the selected swatch out of sync.
function setPlayerColor(hex) {
  playerColor = hex;
  setTheme(hex);
  document.querySelectorAll(".color-choice").forEach((item) => {
    item.classList.toggle("selected", item.dataset.color === hex);
  });
  syncRewardEquipButtons();
}

function setSelectedWeapon(nextWeapon) {
  if (nextWeapon === "tech0" && !moonRewardsUnlocked) return false;
  if (nextWeapon === "magma" && !venusRewardsUnlocked) return false;
  selectedWeapon = nextWeapon;
  refreshLoadoutUI();
  syncRewardEquipButtons();
  playSound(660, 0.06, "square");
  return true;
}

function syncVenusRewardUI() {
  document.querySelectorAll("[data-venus-locked]").forEach((item) => {
    item.classList.toggle("locked", !venusRewardsUnlocked);
    item.setAttribute("aria-disabled", String(!venusRewardsUnlocked));
  });
  // One swatch covers the Venus ship: plain red and the magma hex were within a
  // point of each other, so two of them read as a duplicate, not as two rewards.
  const redChoice = document.querySelector(".color-choice.red");
  if (redChoice) {
    redChoice.setAttribute("aria-label", venusRewardsUnlocked ? "Red" : "Red ship locked: beat Venus");
  }
  syncRewardEquipButtons();
}

function unlockVenusRewards() {
  if (!venusRewardsUnlocked) {
    venusRewardsUnlocked = true;
    try {
      localStorage.setItem(VENUS_UNLOCK_KEY, "unlocked");
    } catch (error) {
      // The reward still unlocks for this session when storage is unavailable.
    }
  }
  syncVenusRewardUI();
}

function setSelectedSuper(nextSuper) {
  if (superLocked(nextSuper)) return false;
  if (nextSuper !== selectedSuper && superMeter >= 1) {
    const requiredDamage = SUPER_COST[nextSuper] || 20;
    lastSuperKills = superDamage - requiredDamage * 0.5;
  }
  selectedSuper = nextSuper;
  refreshLoadoutUI();
  playSound(520, 0.06, "square");
  updateSuperMeter();
  return true;
}

// ---------------------------------------------------------------------------
// Audio
//
// One AudioContext, two buses: sfx and music. The music is a step sequencer —
// a 25ms timer schedules notes a fraction of a second ahead of the clock, which
// is the only way to get steady timing out of WebAudio (setInterval alone
// jitters badly enough to hear). Every instrument is synthesised; there are no
// samples to load.
// ---------------------------------------------------------------------------
let sfxGain = null;
let musicGain = null;
let masterGain = null;
let noiseBuffer = null;

function persistAudioSettings() {
  try {
    localStorage.setItem(AUDIO_STORAGE_KEY, JSON.stringify(audioSettings));
  } catch (error) {
    // Audio still works when storage is blocked; the preference just won't persist.
  }
}

function syncAudioControls() {
  document.querySelectorAll("[data-audio-control='music']").forEach((input) => { input.value = String(Math.round(audioSettings.music * 100)); });
  document.querySelectorAll("[data-audio-control='sfx']").forEach((input) => { input.value = String(Math.round(audioSettings.sfx * 100)); });
  document.querySelectorAll("[data-audio-output='music']").forEach((output) => { output.textContent = `${Math.round(audioSettings.music * 100)}%`; });
  document.querySelectorAll("[data-audio-output='sfx']").forEach((output) => { output.textContent = `${Math.round(audioSettings.sfx * 100)}%`; });
  document.querySelectorAll("[data-audio-mute]").forEach((button) => {
    button.textContent = audioSettings.muted ? "SOUND MUTED" : "SOUND ON";
    button.setAttribute("aria-pressed", String(audioSettings.muted));
  });
}

function applyAudioMix() {
  if (audioContext && masterGain && sfxGain) {
    const now = audioContext.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(audioSettings.muted ? 0 : 1, now, 0.015);
    sfxGain.gain.cancelScheduledValues(now);
    sfxGain.gain.setTargetAtTime(audioSettings.sfx, now, 0.015);
    music.refreshVolume();
  }
  syncAudioControls();
  persistAudioSettings();
}

function ensureAudio() {
  if (audioContext) return audioContext;
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    // "interactive" asks the platform for the smallest buffer it will give,
    // which is the difference between a trigger that feels connected and one
    // that feels laggy. The music sequencer schedules ahead and does not care.
    // Older WebKit's `webkitAudioContext` predates the options argument, so a
    // failure here falls back rather than taking the whole context down with
    // it — silent music is a much worse bug than a slightly larger buffer.
    try {
      audioContext = new AudioCtor({ latencyHint: "interactive" });
    } catch (error) {
      audioContext = new AudioCtor();
    }
    masterGain = audioContext.createGain();
    masterGain.gain.value = audioSettings.muted ? 0 : 1;
    masterGain.connect(audioContext.destination);
    sfxGain = audioContext.createGain();
    sfxGain.gain.value = audioSettings.sfx;
    sfxGain.connect(masterGain);
    musicGain = audioContext.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(masterGain);
    // Weapon fire is the only thing in the game that stacks five or six voices
    // inside 100ms, so it gets its own limiter rather than eating headroom off
    // the shared sfx bus. Fast attack to catch the transient, short release so
    // it recovers between rounds instead of pumping the explosions with it.
    //
    // Its own try/catch on purpose. This block used to sit in the outer one,
    // which meant a browser that choked on the compressor lost *every* sound in
    // the game — music, explosions, menus — not just the gun. Nothing below the
    // weapon bus is load-bearing, so it degrades to routing shots straight at
    // the sfx bus instead.
    try {
      weaponBus = audioContext.createGain();
      const weaponLimiter = audioContext.createDynamicsCompressor();
      weaponLimiter.threshold.value = -18;
      weaponLimiter.knee.value = 10;
      weaponLimiter.ratio.value = 8;
      weaponLimiter.attack.value = 0.002;
      weaponLimiter.release.value = 0.12;
      // One lowpass across every gun. Individual voices are already dark, but a
      // single shelf on the bus is what guarantees no future weapon can be the
      // shrill one — brightness is what makes a sound fired six times a second
      // wear out its welcome, long before loudness does.
      const weaponTone = audioContext.createBiquadFilter();
      weaponTone.type = "lowpass";
      weaponTone.frequency.value = 2600;
      weaponTone.Q.value = 0.5;
      weaponBus.connect(weaponTone).connect(weaponLimiter).connect(sfxGain);
      softClipCurve = buildSoftClip();
    } catch (error) {
      weaponBus = sfxGain;
      softClipCurve = null;
    }
    // one second of white noise, reused by every drum hit
    noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch (error) {
    // Every sound in the game goes silent from here, so it must not do that
    // silently: a swallowed exception left no trace anywhere and made "I hear
    // nothing" impossible to tell apart from a muted slider or a stale cache.
    console.warn("Petros: audio unavailable, the game will run silent.", error);
    audioContext = null;
  }
  return audioContext;
}

function playSound(frequency, duration, type) {
  if (!audioContext || !sfxGain) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.045, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(sfxGain);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

// ---------------------------------------------------------------------------
// Weapon voices
//
// Every gun gets a synthesised report rather than a beep. They are built from
// the same three ideas: a pitch that *falls* (an arcade shot is a downward
// sweep, never a steady tone), an envelope with a real attack so nothing
// clicks, and a filter that keeps the fizz out of the music.
//
// Rapid fire is the hard part, and it is a mixing problem, not a timbre one.
// The blaster fires six times a second; a sound that is identical, centred and
// un-ducked six times a second is exactly what makes a shooter exhausting to
// listen to. Four things fix that, and they matter more than the waveforms do:
//
//   * every shot is detuned a few cents and re-levelled a few percent, so the
//     ear never locks onto a repeating cycle;
//   * the blaster alternates stereo sides in step with the wingtip that fired,
//     so a held trigger reads as a rhythm across the field instead of one
//     sound stuttering in the middle;
//   * shots crowding inside ~140ms pull each other down (`shotLevel`), so the
//     tenth round of a burst is quieter than the first;
//   * the whole group runs through its own limiter, so a held trigger sits
//     under the music rather than sawing through it.
//
// Latency: everything is scheduled at `currentTime` on an "interactive"
// context, so a shot starts on the next render quantum (~3ms). There is no
// lookahead here and there must not be — the music sequencer schedules ahead
// because steady tempo needs it, and a trigger pull is the opposite problem.
let weaponBus = null;
let softClipCurve = null;
let weaponVoices = 0;
let lastShotAt = -1;
// A cap, not a mixing control: the duck below is what actually keeps bursts in
// line. This only exists so a pathological frame cannot open fifty oscillators.
const MAX_WEAPON_VOICES = 16;
// Hoisted because `weaponSfx.cone` runs inside the game loop, and the loop does
// not allocate.
const CONE_ARMS = [[-0.55, 990, 0], [0, 880, 0.012], [0.55, 810, 0.024]];

function buildSoftClip() {
  // tanh, normalised. Rounds the peak off the sub-heavy rounds so they read as
  // weight rather than as a spike the limiter has to chase.
  const curve = new Float32Array(1024);
  const k = Math.tanh(2.2);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / 1023) * 2 - 1) * 2.2) / k;
  return curve;
}

// Level for one shot: quieter the more recently the last one went off, plus a
// few percent of jitter so even a metronomic trigger is never twice the same.
function shotLevel(base) {
  const now = audioContext.currentTime;
  const gap = lastShotAt < 0 ? 1 : now - lastShotAt;
  lastShotAt = now;
  const crowd = gap < 0.14 ? 0.62 + gap * 2.71 : 1;
  return base * crowd * (0.9 + Math.random() * 0.2);
}

function beginShot() {
  if (!audioContext || !weaponBus || weaponVoices >= MAX_WEAPON_VOICES) return false;
  weaponVoices++;
  setTimeout(() => { weaponVoices--; }, 500);
  return true;
}

// Panning is per shot, so the node is per shot too. Safari only grew
// StereoPannerNode in 14.1; without it the shot just plays centred.
function weaponOut(pan) {
  if (!pan || !audioContext.createStereoPanner) return weaponBus;
  const panner = audioContext.createStereoPanner();
  panner.pan.value = pan;
  panner.connect(weaponBus);
  return panner;
}

// exponentialRampToValueAtTime cannot reach zero, and starting from zero is
// what clicks — hence 0.0001 at both ends and a couple of ms of attack.
function shotEnv(gain, t, peak, attack, decay) {
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function shotTone(type, from, to, t, dur, peak, dest, detune = 0) {
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  shotEnv(gain, t, peak, Math.min(0.004, dur * 0.12), dur);
  osc.connect(gain).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

// The shared one-second noise buffer, read from a random offset so repeated
// hits never replay the same slice of noise.
function shotNoise(t, dur, peak, dest, filterType, from, to, q = 1) {
  if (!noiseBuffer) return;
  const source = audioContext.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = audioContext.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
  filter.Q.value = q;
  const gain = audioContext.createGain();
  shotEnv(gain, t, peak, 0.002, dur);
  source.connect(filter).connect(gain).connect(dest);
  source.start(t, Math.random() * 0.5);
  source.stop(t + dur + 0.03);
}

// The soft clip is a nicety, not a requirement: if the curve could not be built
// the sub-heavy rounds just run clean into the bus.
function shaperOut() {
  if (!softClipCurve) return weaponBus;
  const shaper = audioContext.createWaveShaper();
  shaper.curve = softClipCurve;
  shaper.connect(weaponBus);
  return shaper;
}

function sweepFilter(type, from, to, t, dur, dest, q = 0.9) {
  const filter = audioContext.createBiquadFilter();
  filter.type = type;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(Math.max(40, to), t + dur);
  filter.Q.value = q;
  filter.connect(dest);
  return filter;
}

const weaponSfx = {
  // Heard more than everything else in the game combined, so it is deliberately
  // the quietest thing here: a soft triangle blip over a sine an octave down,
  // no noise layer at all, and a top end kept under 800Hz. Square waves and a
  // bright noise transient were the first attempt and they read as harsh
  // within about ten seconds of holding the trigger.
  blaster(barrel) {
    if (!beginShot()) return;
    const t = audioContext.currentTime;
    const level = shotLevel(0.034);
    const out = weaponOut(barrel * 0.34);
    const lp = sweepFilter("lowpass", 1700, 520, t, 0.075, out);
    const cents = Math.random() * 40 - 20 + barrel * 22;
    shotTone("triangle", 760, 235, t, 0.075, level, lp, cents);
    shotTone("sine", 380, 118, t, 0.09, level * 0.6, lp, cents);
  },

  // Three arms, three sides of the field, 12ms apart: the ear fuses that into
  // one wide report rather than three beeps. Triangles rather than saws, and
  // the noise that used to sit under it is gone — with three of them landing
  // together it was the sharpest thing in the game.
  cone() {
    if (!beginShot()) return;
    const t = audioContext.currentTime;
    const level = shotLevel(0.018);
    for (let i = 0; i < CONE_ARMS.length; i++) {
      const pan = CONE_ARMS[i][0];
      const freq = CONE_ARMS[i][1] * 0.72;
      const at = t + CONE_ARMS[i][2];
      const lp = sweepFilter("lowpass", 1600, 480, at, 0.08, weaponOut(pan));
      shotTone("triangle", freq, freq * 0.3, at, 0.08, level, lp, Math.random() * 30 - 15);
      shotTone("sine", freq * 0.5, freq * 0.16, at, 0.09, level * 0.5, lp);
    }
  },

  // Three tiers, and they still have to be audibly three — the whole weapon is
  // a bet on how long you held the key. The difference is carried by weight and
  // length now rather than by brightness: tier 5 is the only player sound with
  // real low end, but it gets there with a sub, not with a crack off the top.
  charge(damage) {
    if (!beginShot()) return;
    const t = audioContext.currentTime;
    if (damage >= 5) {
      const level = shotLevel(0.009);
      const shaper = shaperOut();
      const lp = sweepFilter("lowpass", 1500, 260, t, 0.36, shaper);
      shotTone("triangle", 320, 62, t, 0.36, level, lp, -7);
      shotTone("triangle", 320, 62, t, 0.36, level * 0.8, lp, 7);
      shotTone("sine", 110, 34, t, 0.44, level * 0.3, shaper);
      shotNoise(t, 0.24, level * 0.22, lp, "lowpass", 900, 220);
    } else if (damage >= 3) {
      const level = shotLevel(0.0123);
      const lp = sweepFilter("lowpass", 1500, 420, t, 0.22, weaponBus);
      shotTone("triangle", 430, 115, t, 0.22, level, lp, -6);
      shotTone("triangle", 430, 115, t, 0.22, level * 0.8, lp, 6);
      shotTone("sine", 140, 54, t, 0.26, level * 0.6, weaponBus);
    } else {
      const level = shotLevel(0.023);
      const lp = sweepFilter("lowpass", 1500, 500, t, 0.11, weaponBus);
      shotTone("triangle", 540, 190, t, 0.11, level, lp, Math.random() * 30 - 15);
      shotTone("sine", 270, 95, t, 0.1, level * 0.5, lp);
    }
  },

  // Still electric — a square modulating another square's frequency is what
  // separates "lightning" from "note" — but at a third of the old modulation
  // depth and with the bandpass an octave lower. The bright ping and the noise
  // crack that sat on top of it are gone; they were the whole problem.
  tech0() {
    if (!beginShot()) return;
    const t = audioContext.currentTime;
    const level = shotLevel(0.042);
    const bp = sweepFilter("bandpass", 1100, 420, t, 0.15, weaponBus, 1.6);
    const carrier = audioContext.createOscillator();
    carrier.type = "square";
    carrier.frequency.setValueAtTime(430, t);
    carrier.frequency.exponentialRampToValueAtTime(175, t + 0.15);
    const modulator = audioContext.createOscillator();
    modulator.type = "triangle";
    modulator.frequency.value = 95 + Math.random() * 70;
    const modDepth = audioContext.createGain();
    modDepth.gain.setValueAtTime(300, t);
    modDepth.gain.exponentialRampToValueAtTime(30, t + 0.15);
    modulator.connect(modDepth).connect(carrier.frequency);
    const gain = audioContext.createGain();
    shotEnv(gain, t, level, 0.004, 0.15);
    carrier.connect(gain).connect(bp);
    carrier.start(t);
    carrier.stop(t + 0.19);
    modulator.start(t);
    modulator.stop(t + 0.19);
    shotTone("sine", 620, 260, t, 0.09, level * 0.35, weaponBus);
  },

  // A mortar, felt rather than heard: sub sine doing the work, a soft noise
  // body well under 700Hz, and no transient on top. Slow enough to fire that it
  // can afford the longest tail of any gun without wearing out its welcome.
  magma() {
    if (!beginShot()) return;
    const t = audioContext.currentTime;
    const level = shotLevel(0.01);
    const shaper = shaperOut();
    shotTone("sine", 180, 34, t, 0.4, level * 0.45, shaper);
    const lp = sweepFilter("lowpass", 520, 160, t, 0.24, shaper);
    shotTone("triangle", 130, 46, t, 0.24, level * 0.5, lp);
    shotNoise(t, 0.3, level * 0.4, shaper, "lowpass", 700, 150);
  },
};

const music = (function () {
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.14;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  // Patterns are 16 steps to the bar, in MIDI note numbers; 0 is a rest and a
  // bar list cycles, so a four-bar loop costs four short arrays.
  const TRACKS = {
    // A short, drum-less fanfare for the title card — loops if the player
    // lingers there, then crossfades into `menu` once finishCredits() runs.
    intro: {
      bpm: 100,
      volume: 0.15,
      bass: [[36, 0, 0, 0, 41, 0, 0, 0, 43, 0, 0, 0, 41, 0, 0, 0]],
      arp:  [[60, 64, 67, 72, 76, 72, 67, 64, 60, 64, 67, 72, 76, 79, 76, 72]],
      lead: [[0, 0, 0, 0, 0, 0, 0, 0, 79, 0, 0, 0, 84, 0, 0, 0]],
      kick: [], snare: [], hat: [],
    },
    menu: {
      bpm: 92,
      volume: 0.16,
      swing: 0.02,
      bass: [[33, 0, 0, 0, 40, 0, 33, 0, 0, 0, 33, 0, 40, 0, 0, 0],
             [31, 0, 0, 0, 38, 0, 31, 0, 0, 0, 31, 0, 38, 0, 0, 0],
             [29, 0, 0, 0, 36, 0, 29, 0, 0, 0, 29, 0, 36, 0, 0, 0],
             [28, 0, 0, 0, 35, 0, 28, 0, 0, 0, 35, 0, 35, 0, 0, 0]],
      arp:  [[69, 72, 76, 72, 69, 72, 76, 79, 76, 72, 69, 72, 76, 72, 69, 67],
             [67, 71, 74, 71, 67, 71, 74, 79, 74, 71, 67, 71, 74, 71, 67, 65],
             [65, 69, 72, 69, 65, 69, 72, 76, 72, 69, 65, 69, 72, 69, 65, 64],
             [64, 68, 71, 68, 64, 68, 71, 76, 71, 68, 64, 68, 71, 71, 71, 71]],
      lead: [[0, 0, 0, 0, 0, 0, 0, 0, 88, 0, 0, 0, 0, 0, 0, 0],
             [0, 0, 0, 0, 0, 0, 0, 0, 86, 0, 0, 0, 0, 0, 0, 0],
             [0, 0, 0, 0, 0, 0, 0, 0, 84, 0, 0, 0, 0, 0, 0, 0],
             [0, 0, 0, 0, 0, 0, 0, 0, 83, 0, 0, 0, 83, 0, 0, 0]],
      kick: [], snare: [], hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    },
    battle: {
      bpm: 132,
      volume: 0.2,
      bass: [[45, 45, 0, 45, 45, 0, 45, 0, 45, 45, 0, 45, 48, 0, 47, 0],
             [45, 45, 0, 45, 45, 0, 45, 0, 45, 45, 0, 45, 43, 0, 41, 0],
             [41, 41, 0, 41, 41, 0, 41, 0, 41, 41, 0, 41, 43, 0, 45, 0],
             [43, 43, 0, 43, 43, 0, 43, 0, 47, 47, 0, 47, 48, 0, 50, 0]],
      arp:  [[0, 69, 0, 72, 0, 76, 0, 72, 0, 69, 0, 72, 0, 76, 0, 79],
             [0, 69, 0, 72, 0, 76, 0, 72, 0, 69, 0, 72, 0, 74, 0, 76],
             [0, 65, 0, 69, 0, 72, 0, 69, 0, 65, 0, 69, 0, 72, 0, 76],
             [0, 67, 0, 71, 0, 74, 0, 71, 0, 67, 0, 71, 0, 74, 0, 77]],
      lead: [[81, 0, 0, 84, 0, 83, 0, 81, 0, 0, 79, 0, 81, 0, 0, 0],
             [81, 0, 0, 84, 0, 86, 0, 84, 0, 0, 83, 0, 81, 0, 79, 0],
             [77, 0, 0, 81, 0, 84, 0, 81, 0, 0, 79, 0, 77, 0, 0, 0],
             [79, 0, 83, 0, 86, 0, 88, 0, 86, 0, 83, 0, 79, 0, 0, 0]],
      kick:  [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
      hat:   [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1],
    },
    boss: {
      bpm: 152,
      volume: 0.24,
      heavy: true,
      bass: [[38, 38, 38, 0, 38, 0, 38, 38, 39, 0, 39, 0, 38, 0, 36, 0],
             [38, 38, 38, 0, 38, 0, 38, 38, 41, 0, 41, 0, 40, 0, 38, 0],
             [36, 36, 36, 0, 36, 0, 36, 36, 37, 0, 37, 0, 36, 0, 34, 0],
             [33, 33, 33, 0, 33, 0, 34, 0, 36, 0, 37, 0, 38, 0, 40, 41]],
      arp:  [[62, 0, 65, 0, 69, 0, 65, 0, 62, 0, 65, 0, 70, 0, 69, 0],
             [62, 0, 65, 0, 69, 0, 65, 0, 62, 0, 66, 0, 69, 0, 68, 0],
             [60, 0, 63, 0, 67, 0, 63, 0, 60, 0, 63, 0, 68, 0, 67, 0],
             [57, 0, 60, 0, 65, 0, 62, 0, 65, 0, 68, 0, 70, 0, 73, 0]],
      lead: [[86, 0, 0, 0, 85, 0, 0, 0, 86, 0, 89, 0, 88, 0, 86, 0],
             [0, 0, 0, 0, 0, 0, 0, 0, 82, 0, 0, 0, 81, 0, 0, 0],
             [84, 0, 0, 0, 83, 0, 0, 0, 84, 0, 87, 0, 86, 0, 84, 0],
             [89, 0, 88, 0, 86, 0, 84, 0, 83, 0, 81, 0, 80, 0, 0, 0]],
      kick:  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1],
      hat:   [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    },
    // Venus gets its own theme: slower and heavier than Mercury's, sitting a
    // couple of semitones lower with a half-step grind under it, so the second
    // boss sounds like pressure rather than like a chase.
    venusBoss: {
      bpm: 138,
      volume: 0.25,
      heavy: true,
      bass: [[37, 0, 37, 37, 0, 37, 0, 37, 38, 0, 38, 0, 37, 0, 35, 0],
             [37, 0, 37, 37, 0, 37, 0, 37, 40, 0, 40, 0, 38, 0, 37, 0],
             [35, 0, 35, 35, 0, 35, 0, 35, 36, 0, 36, 0, 35, 0, 33, 0],
             [32, 0, 32, 0, 33, 0, 35, 0, 36, 0, 37, 0, 38, 0, 40, 0]],
      arp:  [[61, 0, 0, 0, 64, 0, 0, 0, 68, 0, 0, 0, 64, 0, 0, 0],
             [61, 0, 0, 0, 65, 0, 0, 0, 68, 0, 0, 0, 66, 0, 0, 0],
             [59, 0, 0, 0, 63, 0, 0, 0, 66, 0, 0, 0, 63, 0, 0, 0],
             [56, 0, 59, 0, 63, 0, 66, 0, 68, 0, 71, 0, 73, 0, 75, 0]],
      lead: [[85, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 83, 0, 0, 0],
             [80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
             [83, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 81, 0, 0, 0],
             [88, 0, 0, 0, 87, 0, 0, 0, 85, 0, 0, 0, 83, 0, 0, 0]],
      kick:  [1, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
      hat:   [1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1],
    },
    victory: {
      bpm: 128,
      volume: 0.22,
      once: false,
      bass: [[41, 0, 0, 0, 41, 0, 0, 0, 43, 0, 0, 0, 45, 0, 0, 0],
             [48, 0, 0, 0, 48, 0, 0, 0, 48, 0, 0, 0, 48, 0, 0, 0]],
      arp:  [[65, 69, 72, 77, 72, 69, 65, 69, 72, 76, 79, 84, 79, 76, 72, 76],
             [72, 76, 79, 84, 79, 84, 88, 84, 88, 0, 0, 0, 0, 0, 0, 0]],
      lead: [[89, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 91, 0, 0, 0],
             [93, 0, 0, 0, 96, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
      kick:  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1],
      snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
      hat:   [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    },
  };

  let timer = null;
  let track = null;
  let trackName = "";
  let step = 0;
  let nextStepTime = 0;
  let ducked = false;

  function noiseSource() {
    const source = audioContext.createBufferSource();
    source.buffer = noiseBuffer;
    return source;
  }

  function envelope(node, time, peak, attack, decay) {
    node.gain.setValueAtTime(0.0001, time);
    node.gain.linearRampToValueAtTime(peak, time + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, time + attack + decay);
  }

  function bassVoice(midi, time, dur, heavy) {
    const osc = audioContext.createOscillator();
    const sub = audioContext.createOscillator();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    osc.type = heavy ? "sawtooth" : "square";
    sub.type = "sine";
    osc.frequency.value = midiToFreq(midi);
    sub.frequency.value = midiToFreq(midi - 12);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(heavy ? 1700 : 1100, time);
    filter.frequency.exponentialRampToValueAtTime(320, time + dur);
    filter.Q.value = heavy ? 7 : 3;
    envelope(gain, time, heavy ? 0.5 : 0.38, 0.008, dur);
    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain).connect(musicGain);
    osc.start(time); sub.start(time);
    osc.stop(time + dur + 0.05); sub.stop(time + dur + 0.05);
  }

  function plucked(midi, time, dur, type, peak, detune) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = type;
    osc.frequency.value = midiToFreq(midi);
    if (detune) osc.detune.value = detune;
    envelope(gain, time, peak, 0.006, dur);
    osc.connect(gain).connect(musicGain);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  function kick(time) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.13);
    envelope(gain, time, 0.75, 0.004, 0.16);
    osc.connect(gain).connect(musicGain);
    osc.start(time);
    osc.stop(time + 0.25);
  }

  function snare(time) {
    const source = noiseSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    filter.type = "highpass";
    filter.frequency.value = 1400;
    envelope(gain, time, 0.32, 0.003, 0.13);
    source.connect(filter).connect(gain).connect(musicGain);
    source.start(time);
    source.stop(time + 0.2);
  }

  function hat(time, open) {
    const source = noiseSource();
    const filter = audioContext.createBiquadFilter();
    const gain = audioContext.createGain();
    filter.type = "highpass";
    filter.frequency.value = 7000;
    envelope(gain, time, 0.12, 0.002, open ? 0.09 : 0.03);
    source.connect(filter).connect(gain).connect(musicGain);
    source.start(time);
    source.stop(time + 0.14);
  }

  function scheduleStep(index, time) {
    const bars = track.bass.length;
    const bar = Math.floor(index / 16) % bars;
    const slot = index % 16;
    const stepDur = 60 / track.bpm / 4;

    const bassNote = track.bass[bar][slot];
    if (bassNote) bassVoice(bassNote, time, stepDur * 1.6, track.heavy);

    const arpNote = track.arp[bar][slot];
    if (arpNote) plucked(arpNote, time, stepDur * 1.1, track.heavy ? "sawtooth" : "square", 0.1, 6);

    const leadNote = track.lead[bar][slot];
    if (leadNote) {
      plucked(leadNote, time, stepDur * 3, "triangle", 0.22);
      plucked(leadNote, time, stepDur * 3, "square", 0.05, -8);
    }
    if (track.kick[slot]) kick(time);
    if (track.snare[slot]) snare(time);
    if (track.hat.length && track.hat[slot]) hat(time, slot % 4 === 2);
  }

  function tick() {
    if (!track) return;
    const stepDur = 60 / track.bpm / 4;
    while (nextStepTime < audioContext.currentTime + SCHEDULE_AHEAD) {
      const total = track.bass.length * 16;
      if (track.once && step >= total) { stop(); return; }
      scheduleStep(step % total, nextStepTime);
      step++;
      nextStepTime += stepDur;
    }
  }

  function fade(target, seconds) {
    const now = audioContext.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(target, now + seconds);
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    track = null;
    trackName = "";
    if (audioContext) fade(0, 0.35);
  }

  function targetVolume() {
    if (!track) return 0;
    return track.volume * audioSettings.music * (ducked ? 0.28 : 1);
  }

  function play(name, fadeSeconds = 0.6) {
    if (!ensureAudio()) return;
    if (audioContext.state === "suspended") audioContext.resume();
    if (trackName === name && timer) return;
    if (timer) clearInterval(timer);
    track = TRACKS[name];
    trackName = name;
    if (!track) { stop(); return; }
    step = 0;
    nextStepTime = audioContext.currentTime + 0.06;
    fade(targetVolume(), fadeSeconds);
    timer = setInterval(tick, LOOKAHEAD_MS);
    tick();
  }

  function setDucked(next) {
    ducked = next;
    if (!audioContext || !track) return;
    fade(targetVolume(), 0.25);
  }

  function refreshVolume() {
    if (!audioContext || !track) return;
    fade(targetVolume(), 0.12);
  }

  return { play, stop, setDucked, refreshVolume, current: () => trackName };
})();

// The direction the arrow keys currently describe. `held` is false when no
// arrow is down, in which case we report the last direction aimed at so the
// ship keeps pointing where the player left it.
function currentAimVector() {
  const keyboardX = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
  const keyboardY = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
  const keyboardHeld = Boolean(keyboardX || keyboardY);
  const x = keyboardHeld ? keyboardX : touchControls.aimX;
  const y = keyboardHeld ? keyboardY : touchControls.aimY;
  // Fills the shared vector rather than returning a fresh object: this runs
  // every frame, and callers only ever read it before the next call.
  aimVector.held = keyboardHeld || touchControls.aimHeld;
  aimVector.x = aimVector.held ? x : lastArrowDirection.x;
  aimVector.y = aimVector.held ? y : lastArrowDirection.y;
  return aimVector;
}

const MAX_PLAYER_BULLETS = 12;

function fireInDirection(dx, dy, damage = 1, type = "basic", size = 3) {
  if (!gameActive || bullets.length >= MAX_PLAYER_BULLETS) return false;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  facing.x = dx;
  facing.y = dy;
  const pierceRemaining = type === "charge" && damage >= 5 ? Infinity
    : type === "charge" && damage >= 3 ? 3
    : 1;
  const color = weaponColor(type === "basic" ? "blaster" : type);
  // The blaster alternates wingtips. Firing everything from one point looked
  // like the rounds were falling out of the middle of the hull; a held trigger
  // now has a left-right rhythm, and the flash follows the barrel that fired.
  let ox = 0;
  let oy = 0;
  if (type === "basic") {
    blasterBarrel = -blasterBarrel;
    ox = -dy * BLASTER_BARREL_OFFSET * blasterBarrel;
    oy = dx * BLASTER_BARREL_OFFSET * blasterBarrel;
  }
  bullets.push({ x: player.x + ox, y: player.y + oy, vx: dx * 10, vy: dy * 10, damage, type, size, pierceRemaining, color });
  spawnMuzzleFlash(dx, dy, type, type === "charge" ? 0.7 + size * 0.09 : type === "magma" ? 1.25 : 1, ox, oy);
  return true;
}

function releaseChargeShot(dirX, dirY, continueCharging = false) {
  if (!gameActive || gamePaused || bossIntro || gameOverShown || superDrone) { chargeStartedAt = 0; return false; }
  if (!chargeStartedAt) return false;
  if (!dirX && !dirY) {
    const direction = chargeDirection.x || chargeDirection.y ? chargeDirection : facing;
    dirX = direction.x;
    dirY = direction.y;
  }
  const held = performance.now() - chargeStartedAt;
  const damage = held >= CHARGE_FULL_MS ? 5 : held >= CHARGE_FULL_MS * 0.5 ? 3 : 1;
  const size = damage === 5 ? 14 : damage === 3 ? 9 : 5;
  let fired = false;
  if (!player.shrunk || fireCooldown <= 0) {
    fired = fireInDirection(dirX, dirY, damage, "charge", size);
    if (fired) weaponSfx.charge(damage);
    if (player.shrunk && fired) fireCooldown = 45;
  }
  const length = Math.hypot(dirX, dirY) || 1;
  lastArrowDirection.x = dirX / length;
  lastArrowDirection.y = dirY / length;
  chargeStartedAt = continueCharging ? performance.now() : 0;
  if (continueCharging) {
    const nextAim = currentAimVector();
    chargeDirection.x = nextAim.x;
    chargeDirection.y = nextAim.y;
  }
  return fired;
}

function activateSuper() {
  if (!gameActive || bossIntro || gamePaused || superMeter < 1) return false;
  // One live instance each: a second drone or orb on top of the first would
  // orphan the one already flying.
  if (selectedSuper === "star" && superStar) return false;
  if (selectedSuper === "drone" && superDrone) return false;
  if (selectedSuper === "decoy" && decoy) return false;
  if (selectedSuper === "orb" && radiantOrb) return false;
  if (selectedSuper === "firstaid" && lives >= MAX_DRAWN_HEARTS) return false;
  if (selectedSuper === "invincibility") {
    playerInvulnerable = 180;
    invincibilitySuperTimer = 180;
    playSound(880, 0.3, "triangle");
  } else if (selectedSuper === "lance") {
    fireLance();
  } else if (selectedSuper === "star") {
    fireSuperStar();
  } else if (selectedSuper === "mirror") {
    activateMirror();
  } else if (selectedSuper === "drone") {
    launchDrone();
  } else if (selectedSuper === "decoy") {
    deployDecoy();
  } else if (selectedSuper === "firstaid") {
    useFirstAid();
  } else if (selectedSuper === "orb") {
    summonRadiantOrb();
  } else {
    superBombs.push({ x: player.x, y: player.y, vx: facing.x * 8, vy: facing.y * 8, life: 75, explode: false, color: superColor("bomb") });
    playSound(180, 0.18, "triangle");
  }
  lastSuperKills = superDamage;
  superMeter = 0;
  updateSuperMeter();
  return true;
}

// Magma splashes. When the slug lands it bursts into droplets that spray back
// and sideways from the impact, each a 1-damage round with a short fuse. The
// droplets ignore whatever they splashed off (`ignore`), so the primary target
// is never double-billed — they exist to rake its neighbours. Shared by waves,
// bosses and the test room so every arena splashes the same way.
function burstMagma(bullet, x, y, target) {
  const back = Math.atan2(-bullet.vy, -bullet.vx);
  for (let i = 0; i < MAGMA_DROPS && bullets.length < MAGMA_DROP_CAP; i++) {
    const angle = back + (i / (MAGMA_DROPS - 1) - 0.5) * 3.4 + rand(-0.15, 0.15);
    const speed = MAGMA_DROP_SPEED * rand(0.75, 1.15);
    bullets.push({
      x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      damage: 1, type: "magmaDrop", size: 6, pierceRemaining: 1,
      color: WEAPON_COLORS.magma, life: MAGMA_DROP_LIFE, maxLife: MAGMA_DROP_LIFE, ignore: target,
    });
  }
  // A quick, quiet flash ring — the bomb blast's renderer at a fraction of the
  // size and life, with no screen shake, so a routine primary-weapon impact
  // reads as a burst without hammering the screen every 0.5s.
  const rays = [];
  for (let i = 0; i < 10; i++) rays.push({ angle: rand(0, Math.PI * 2), reach: rand(0.7, 1.05), width: rand(1.5, 3.2) });
  bombBlasts.push({ x, y, radius: 40, color: "#ff7a2a", life: 16, maxLife: 16, rays });
  spawnSparks(x, y, 14, "#ffb03a", { minSpeed: 1.4, maxSpeed: 5.5, life: 18, minSize: 2, maxSize: 4 });
  spawnSparks(x, y, 7, "#fff3d6", { minSpeed: 0.6, maxSpeed: 3, life: 12, maxSize: 3 });
  spawnSparks(x, y, 8, "#3a1a10", { minSpeed: 1.5, maxSpeed: 4.5, life: 24, maxSize: 3, gravity: 0.08 });
  playSound(80, 0.14, "triangle");
  playSound(420, 0.05, "sawtooth");
}

// --- Magma splatter -------------------------------------------------------
// The round is not an orb with a halo — a radial glow sprite stuck to a bullet
// read as a lens flare, which is what it looked like. It is a thrown splat of
// lava: a lobed, wobbling blob that runs from a dull crust rim through orange
// to a white-hot centre, with black crust chips floating on it and hot specks
// flung off the edge. The silhouette is traced from fixed lobe tables through
// two scratch arrays, so a splat allocates nothing and can be layered cheaply.
const MAGMA_LOBES = 9;
const MAGMA_LOBE_R = [1.0, 0.72, 1.18, 0.84, 1.08, 0.66, 1.22, 0.9, 0.78];
const MAGMA_LOBE_PH = [0.0, 1.9, 3.4, 0.8, 4.7, 2.3, 5.6, 1.2, 3.9];
const magmaBlobX = new Float64Array(MAGMA_LOBES);
const magmaBlobY = new Float64Array(MAGMA_LOBES);
// Crust chips riding on the melt: angle, distance and size, all in radii.
const MAGMA_CHIP_A = [0.9, 3.4, 5.2];
const MAGMA_CHIP_D = [0.62, 0.72, 0.58];
const MAGMA_CHIP_S = [0.2, 0.14, 0.17];
// Specks flung off the edge, same units.
const MAGMA_FLECK_A = [0.4, 1.7, 2.9, 4.1, 5.3];
const MAGMA_FLECK_D = [1.5, 1.85, 1.35, 1.68, 1.95];
const MAGMA_FLECK_S = [0.17, 0.1, 0.22, 0.13, 0.09];

// Traces the closed splat outline at `radius`, smoothing the lobe corners with
// quadratics through their midpoints. `seed` shifts the wobble per bullet so no
// two slugs pulse in lockstep; `wobble` is how far the lobes breathe, and
// `bias` (0-1) mixes the lobe table back toward a circle — the outer heat
// layers want a soft edge, or the spikes read as a dark star rather than heat.
function magmaBlobPath(radius, seed, t, wobble, bias) {
  for (let i = 0; i < MAGMA_LOBES; i++) {
    const a = (i / MAGMA_LOBES) * Math.PI * 2;
    const r = radius * (1 + (MAGMA_LOBE_R[i] - 1) * bias) * (1 + Math.sin(t * 0.006 + MAGMA_LOBE_PH[i] + seed) * wobble);
    magmaBlobX[i] = Math.cos(a) * r;
    magmaBlobY[i] = Math.sin(a) * r;
  }
  ctx.beginPath();
  ctx.moveTo((magmaBlobX[MAGMA_LOBES - 1] + magmaBlobX[0]) / 2, (magmaBlobY[MAGMA_LOBES - 1] + magmaBlobY[0]) / 2);
  for (let i = 0; i < MAGMA_LOBES; i++) {
    const j = (i + 1) % MAGMA_LOBES;
    ctx.quadraticCurveTo(magmaBlobX[i], magmaBlobY[i], (magmaBlobX[i] + magmaBlobX[j]) / 2, (magmaBlobY[i] + magmaBlobY[j]) / 2);
  }
  ctx.closePath();
}

function magmaBlobFill(radius, seed, t, wobble, bias, color, ox, oy) {
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = color;
  magmaBlobPath(radius, seed, t, wobble, bias);
  ctx.fill();
  ctx.restore();
}

// One splat, centred on the bullet and stretched slightly along its travel
// axis (local -y). Every layer gets its own seed so the lobes never stack into
// a circle. `chips` adds the floating crust — the slug has it, droplets don't.
function drawMagmaSplat(radius, seed, t, alpha, chips) {
  ctx.save();
  ctx.scale(0.94, 1.1);
  ctx.globalAlpha = alpha;
  // heat bleeding off the melt
  ctx.globalCompositeOperation = "lighter";
  magmaBlobFill(radius * 1.5, seed, t, 0.12, 0.4, "#6b1604", 0, radius * 0.1);
  ctx.globalCompositeOperation = "source-over";
  // cooling rim → body → hot centre, each pulled a little toward the leading edge
  magmaBlobFill(radius * 1.18, seed + 1.7, t, 0.16, 0.7, "#b82a09", 0, radius * 0.06);
  magmaBlobFill(radius, seed + 3.4, t, 0.19, 1, "#ff5a12", 0, 0);
  magmaBlobFill(radius * 0.66, seed + 0.9, t, 0.16, 0.85, "#ff9c1e", 0, -radius * 0.1);
  magmaBlobFill(radius * 0.36, seed + 5.1, t, 0.14, 0.7, "#ffd66a", 0, -radius * 0.14);
  ctx.beginPath();
  ctx.arc(0, -radius * 0.16, radius * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = "#fff3d6";
  ctx.fill();
  if (chips) {
    ctx.fillStyle = "#3a1a12";
    for (let i = 0; i < MAGMA_CHIP_A.length; i++) {
      const a = MAGMA_CHIP_A[i] + t * 0.0012 + seed;
      magmaBlobFill(radius * MAGMA_CHIP_S[i], seed + i * 2.1, t, 0.3, 1,
        "#3a1a12", Math.cos(a) * radius * MAGMA_CHIP_D[i], Math.sin(a) * radius * MAGMA_CHIP_D[i]);
    }
  }
  if (quality.particles > 0.3) {
    for (let i = 0; i < MAGMA_FLECK_A.length; i++) {
      const wob = Math.sin(t * 0.005 + MAGMA_FLECK_A[i] * 2 + seed);
      const a = MAGMA_FLECK_A[i] + t * 0.0006 + seed * 0.2;
      const d = radius * MAGMA_FLECK_D[i] * (1 + wob * 0.14);
      const r = radius * MAGMA_FLECK_S[i] * (0.85 + wob * 0.15);
      const x = Math.cos(a) * d;
      const y = Math.sin(a) * d;
      ctx.fillStyle = "#ff7a2a";
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffd66a";
      ctx.beginPath(); ctx.arc(x, y, r * 0.45, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// The slug: a splat of lava with a dripping tail, tumbling as it flies. Drawn
// in the bullet's local frame, where -y is the direction of travel.
function drawMagmaSlug(bullet, color) {
  const now = performance.now();
  const pulse = 0.6 + Math.sin(now * 0.02 + bullet.x * 0.05) * 0.4;
  const s = bullet.size;
  if (bullet.seed === undefined) bullet.seed = (bullet.x * 0.017 + bullet.y * 0.023) % 6.28;
  bullet.tick = (bullet.tick || 0) + 1;
  // the drip it leaves behind, thrown back along the travel axis
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = "#c22a12";
  ctx.beginPath();
  ctx.moveTo(-s * 0.5, s * 0.3);
  ctx.quadraticCurveTo(-s * 0.3, s + 10, 0, s + 18 + pulse * 8);
  ctx.quadraticCurveTo(s * 0.3, s + 10, s * 0.5, s * 0.3);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  if (bullet.tick % 2 === 0) {
    spawnSparks(bullet.x - bullet.vx * 0.6, bullet.y - bullet.vy * 0.6, 1, Math.random() < 0.6 ? "#ff7a2a" : "#ffb03a",
      { minSpeed: 0.15, maxSpeed: 1, life: 20, minSize: 2, maxSize: 4, gravity: 0.05 });
  }
  drawMagmaSplat(s * 1.05 + pulse * 0.6, bullet.seed, now, 1, true);
}

// A splash droplet: a smaller splat that shrinks, dims and sizzles out.
function drawMagmaDrop(bullet, color) {
  bullet.life--;
  if (bullet.life <= 0) { bullet.y = -100; return; }
  bullet.vx *= 0.95;
  bullet.vy *= 0.95;
  const fade = bullet.life / bullet.maxLife;
  if (bullet.seed === undefined) bullet.seed = (bullet.x * 0.017 + bullet.y * 0.023) % 6.28;
  drawMagmaSplat(bullet.size * (0.45 + fade * 0.5), bullet.seed, performance.now(), 0.45 + fade * 0.55, false);
  if (bullet.life % 4 === 0) spawnSparks(bullet.x, bullet.y, 1, "#ffb03a", { minSpeed: 0.15, maxSpeed: 0.7, life: 10, minSize: 2, maxSize: 3 });
}

// --- Muzzle flashes --------------------------------------------------------
// Rounds used to appear out of nothing at the ship's centre. A flash pinned to
// the nose for a few frames gives every shot a source, and since it is drawn in
// the weapon's own colour it also tells you at a glance what is equipped.
// Pooled: `compact()` prunes it, and the draw loop never allocates.
function spawnMuzzleFlash(dx, dy, type, scale = 1, ox = 0, oy = 0) {
  if (!quality.glow && quality.particles < 0.3) return;
  const color = weaponColor(type === "basic" ? "blaster" : type);
  const last = muzzleFlashes[muzzleFlashes.length - 1];
  // The cone fires three rounds in one press: widen the flash it already made
  // instead of stacking three of them on the same pixel.
  if (last && last.life === last.maxLife && last.color === color) {
    last.spread = Math.min(0.8, last.spread + 0.14);
    return;
  }
  if (muzzleFlashes.length >= MAX_MUZZLE_FLASHES) return;
  const life = type === "charge" || type === "magma" ? 10 : 7;
  muzzleFlashes.push({
    x: player.x + dx * 12 + ox, y: player.y + dy * 12 + oy, angle: Math.atan2(dy, dx),
    color, life, maxLife: life, scale, spread: 0.42,
  });
}

// A four-point star of light at the barrel: a long spike down the firing line,
// short side spikes and a white core, all additive and gone within ~0.1s. A
// plain wedge was tried first and read as a dull khaki trapezoid — flat colour
// at low alpha over the backdrop never looks like a flash; short and bright
// does. `spread` widens the star when a burst weapon fires several rounds.
function updateMuzzleFlashes() {
  for (const flash of muzzleFlashes) {
    flash.life--;
    const fade = Math.max(0, flash.life / flash.maxLife);
    const grow = 1 - fade;
    const reach = (19 + 11 * grow) * flash.scale * (0.7 + 0.3 * fade);
    const side = reach * (0.26 + flash.spread * 0.34);
    ctx.save();
    ctx.translate(flash.x, flash.y);
    ctx.rotate(flash.angle);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.85 * fade;
    ctx.fillStyle = flash.color;
    ctx.beginPath();
    ctx.moveTo(reach, 0);
    ctx.quadraticCurveTo(reach * 0.3, -side * 0.5, 0, -side);
    ctx.quadraticCurveTo(-reach * 0.2, -side * 0.35, -reach * 0.45, 0);
    ctx.quadraticCurveTo(-reach * 0.2, side * 0.35, 0, side);
    ctx.quadraticCurveTo(reach * 0.3, side * 0.5, reach, 0);
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(reach * 0.55, 0);
    ctx.quadraticCurveTo(reach * 0.12, -side * 0.28, 0, -side * 0.5);
    ctx.quadraticCurveTo(-reach * 0.1, -side * 0.2, -reach * 0.2, 0);
    ctx.quadraticCurveTo(-reach * 0.1, side * 0.2, 0, side * 0.5);
    ctx.quadraticCurveTo(reach * 0.12, side * 0.28, reach * 0.55, 0);
    ctx.closePath(); ctx.fill();
    // the shock ring pushing out of the barrel
    ctx.globalAlpha = 0.45 * fade;
    ctx.strokeStyle = flash.color;
    ctx.lineWidth = 1.4 * fade + 0.4;
    ctx.beginPath();
    ctx.arc(0, 0, (4 + 11 * grow) * flash.scale, -1.1, 1.1);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
  }
  compact(muzzleFlashes, (f) => f.life > 0);
}

// --- Player round rendering -----------------------------------------------
// Every primary gun draws in the bullet's local frame, where -y is the way it
// is travelling. Shared vocabulary, so the four guns read as one armoury:
// a tapered additive tracer behind the round, a dark rim under the body so the
// shape survives over a lit backdrop, and a white-hot centre. No `shadowBlur`,
// no per-frame gradients — everything here is flat fills over baked tables.

// The rim under each round. A weapon's own hue at ~25% luminance beats black:
// the silhouette stays legible without a hole punched in the middle of it.
const BULLET_RIM = { blaster: "#5a3d00", cone: "#0a4a26", charge: "#8a3a05", tech0: "#083f4a" };

// A tapered tracer streaming off the back of a round: two additive quads, the
// inner one shorter and hotter, so the round looks like it is moving even in a
// still frame. `len` and `half` are in local pixels.
function drawBulletTracer(len, half, color, alpha) {
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-half, 0);
  ctx.quadraticCurveTo(-half * 0.5, len * 0.6, 0, len);
  ctx.quadraticCurveTo(half * 0.5, len * 0.6, half, 0);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = alpha * 0.75;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(-half * 0.42, 0);
  ctx.quadraticCurveTo(-half * 0.2, len * 0.32, 0, len * 0.55);
  ctx.quadraticCurveTo(half * 0.2, len * 0.32, half * 0.42, 0);
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

// A capsule — a bar with semicircular caps — traced at the origin along the
// travel axis. The blaster and cone icons are both rounded bars, so their
// rounds are too: the thing in flight has to be the thing on the tile.
function capsulePath(halfW, halfH) {
  ctx.beginPath();
  ctx.arc(0, -halfH + halfW, halfW, Math.PI, 0);
  ctx.lineTo(halfW, halfH - halfW);
  ctx.arc(0, halfH - halfW, halfW, 0, Math.PI);
  ctx.closePath();
}

// The blaster round: the icon's glowing bar, built up in layers. It keeps that
// silhouette exactly — what makes it read as fast is three shrinking
// afterimages strung out behind it, which cost three fills and sell speed far
// better than making the bar itself longer.
function drawBlasterBolt(bullet, color) {
  const t = performance.now();
  const s = bullet.size;
  const pulse = 0.85 + Math.sin(t * 0.05 + bullet.x * 0.06 + bullet.y * 0.04) * 0.15;
  const halfW = s * 1.15;
  const halfH = s * 3.6;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = color;
  for (let i = 3; i >= 1; i--) {
    ctx.globalAlpha = 0.46 / i;
    ctx.save();
    ctx.translate(0, halfH * 0.75 * i);
    capsulePath(halfW * (1 - i * 0.16), halfH * (1 - i * 0.18));
    ctx.fill();
    ctx.restore();
  }
  // the icon's box-shadow, as a soft additive bloom around the bar
  ctx.globalAlpha = 0.14;
  ctx.beginPath(); ctx.ellipse(0, 0, halfW * 1.7, halfH * 1.08 * pulse, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = BULLET_RIM.blaster;
  capsulePath(halfW * 1.25, halfH * 1.08); ctx.fill();
  ctx.fillStyle = color;
  capsulePath(halfW, halfH); ctx.fill();
  ctx.fillStyle = "#fff8d8";
  capsulePath(halfW * 0.42, halfH * 0.72); ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(0, -halfH + halfW, halfW * 0.75 * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

// The cone round: the icon's three stubby bars, so each shot is one short
// capsule — no barbs, no fins. Only the brightness breathes, on its own phase,
// so a fan of three shimmers instead of looking stamped.
function drawConeShard(bullet, color) {
  const t = performance.now();
  const s = bullet.size;
  if (bullet.seed === undefined) bullet.seed = (bullet.x * 0.031 + bullet.y * 0.017) % 6.28;
  const pulse = 0.85 + Math.sin(t * 0.04 + bullet.seed) * 0.15;
  const halfW = s * 1.05;
  const halfH = s * 2.35;
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = color;
  for (let i = 2; i >= 1; i--) {
    ctx.globalAlpha = 0.4 / i;
    ctx.save();
    ctx.translate(0, halfH * 0.8 * i);
    capsulePath(halfW * (1 - i * 0.2), halfH * (1 - i * 0.22));
    ctx.fill();
    ctx.restore();
  }
  ctx.globalAlpha = 0.16 * pulse;
  ctx.beginPath(); ctx.ellipse(0, 0, halfW * 2.2, halfH * 1.35, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = BULLET_RIM.cone;
  capsulePath(halfW * 1.3, halfH * 1.12); ctx.fill();
  ctx.fillStyle = color;
  capsulePath(halfW, halfH); ctx.fill();
  ctx.fillStyle = "#f2fff6";
  capsulePath(halfW * 0.4, halfH * 0.66); ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = pulse;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(0, -halfH + halfW, halfW * 0.7, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

// The charge round: a plasma ball whose size already scales 3→9 with hold time,
// so the render scales with it too. Every extra ring of damage is visible —
// a wider halo, a second orbit ring, and at pierce strength (>=3) a rotating
// dashed containment ring — so you can see what a full-hold shot bought you.
function drawChargeOrb(bullet, color) {
  const t = performance.now();
  const s = bullet.size;
  const dmg = bullet.damage || 1;
  const hot = dmg >= 4;
  const pulse = 0.86 + Math.sin(t * 0.02 + bullet.x * 0.05) * 0.14;
  if (bullet.seed === undefined) bullet.seed = (bullet.x * 0.021 + bullet.y * 0.019) % 6.28;
  if (hot) {
    const flicker = 0.82 + Math.sin(t * 0.035 + bullet.x * 0.07 + bullet.y * 0.04) * 0.18;
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#ff3f20";
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.moveTo(-s * 0.82, s * 0.2);
    ctx.quadraticCurveTo(-s * 0.62, s + 10, 0, s + 30 * flicker);
    ctx.quadraticCurveTo(s * 0.62, s + 10, s * 0.82, s * 0.2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffdc5a";
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(-s * 0.48, s * 0.1);
    ctx.quadraticCurveTo(-s * 0.28, s + 6, 0, s + 19 * flicker);
    ctx.quadraticCurveTo(s * 0.28, s + 6, s * 0.48, s * 0.1);
    ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  } else {
    drawBulletTracer(11 + s, s * 0.8, color, 0.8);
  }
  // halo, body, hot centre — the centre sits forward so the ball has a nose
  ctx.globalCompositeOperation = "lighter";
  // two soft steps rather than one disc — a single additive circle drew a hard
  // brown ring around the ball instead of reading as heat falling off
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, s * 2.4 * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.16;
  ctx.beginPath(); ctx.arc(0, 0, s * 1.6 * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = BULLET_RIM.charge;
  ctx.beginPath(); ctx.arc(0, 0, s * 1.08, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffd9a0";
  ctx.beginPath(); ctx.arc(-s * 0.1, -s * 0.2, s * 0.58, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.beginPath(); ctx.arc(-s * 0.14, -s * 0.26, s * 0.32 * pulse, 0, Math.PI * 2); ctx.fill();
  // energy orbiting the ball: one arc per damage step, so a big shot is busier
  const arcs = Math.min(4, 1 + Math.floor(dmg / 2));
  const spin = t * 0.006 + bullet.seed;
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "#ffdc5a";
  ctx.lineCap = "round";
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.75;
  ctx.beginPath();
  for (let i = 0; i < arcs; i++) {
    const start = spin + (i * Math.PI * 2) / arcs;
    ctx.arc(0, 0, s * 1.5, start, start + 0.7);
    if (i < arcs - 1) ctx.moveTo(0, 0);   // one path, arcs kept apart by moveTo
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  if (hot) {
    const emberRoll = Math.random();
    const emberColor = emberRoll < 0.28 ? "#ffffff" : emberRoll < 0.66 ? "#ffdc5a" : "#ff3f20";
    spawnSparks(bullet.x - bullet.vx * 0.5, bullet.y - bullet.vy * 0.5, 2, emberColor,
      { minSpeed: 0.2, maxSpeed: 1.2, life: 18, maxSize: 3 });
  }
}
// The Tech.0 round is the icon's lightning glyph, flying nose-first. The icon
// is `clip-path: polygon(55% 0, 100% 0, 68% 37%, 94% 37%, 24% 100%, 43% 54%,
// 8% 54%)` on a 24x34 box; these are those seven points, centred and turned
// 180 degrees so the long point leads. A ball with needles was tried here and
// looked good on its own, but it was not the thing on the weapon tile.
const TECH0_GLYPH = [
  -1.2, 17, -12, 17, -4.32, 4.42, -10.56, 4.42, 6.24, -17, 1.68, -1.36, 10.08, -1.36,
];

function tech0GlyphPath(k) {
  ctx.beginPath();
  ctx.moveTo(TECH0_GLYPH[0] * k, TECH0_GLYPH[1] * k);
  for (let i = 2; i < TECH0_GLYPH.length; i += 2) ctx.lineTo(TECH0_GLYPH[i] * k, TECH0_GLYPH[i + 1] * k);
  ctx.closePath();
}

// The crackle it drags behind: the zigzag is walked from a fixed jitter table
// indexed by the frame counter. `Math.random()` per frame strobes, and a fresh
// array per frame would allocate 60 times a second per round in flight.
const TECH_JITTER = [0.9, -1.4, 0.4, 1.6, -0.7, 1.1, -1.8, 0.2, 1.3, -1.0, 0.6, -0.3];
const TECH_TAIL_STEPS = 5;

function techArcPath(spread, len, phase) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 1; i <= TECH_TAIL_STEPS; i++) {
    const j = TECH_JITTER[(i + phase) % TECH_JITTER.length];
    ctx.lineTo(j * spread, (len * i) / TECH_TAIL_STEPS);
  }
}

function drawTech0Bolt(bullet, color) {
  const t = performance.now();
  const s = bullet.size;
  const pulse = 0.85 + Math.sin(t * 0.03 + bullet.x * 0.05 + bullet.y * 0.06) * 0.15;
  const k = (s / 5.5) * pulse;
  bullet.tick = (bullet.tick || 0) + 1;
  const phase = bullet.tick >> 1;    // the arc re-strikes every other frame
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // three passes down the same broken path: bloom, body, white-hot filament
  ctx.globalAlpha = 0.2;
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  techArcPath(4.5, s + 18, phase); ctx.stroke();
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3.5;
  techArcPath(4.5, s + 18, phase); ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = "#eaffff";
  ctx.lineWidth = 1.4;
  techArcPath(4.5, s + 18, phase); ctx.stroke();
  // the glyph's drop-shadow, as a bloom sized to the bolt
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.ellipse(0, 0, s * 1.7, s * 2.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  // rim, body, white-hot inner bolt — the same glyph three times
  ctx.fillStyle = BULLET_RIM.tech0;
  tech0GlyphPath(k * 1.22); ctx.fill();
  ctx.fillStyle = color;
  tech0GlyphPath(k); ctx.fill();
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = "#eaffff";
  ctx.globalAlpha = 0.9;
  tech0GlyphPath(k * 0.52); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  if (bullet.tick % 3 === 0) {
    spawnSparks(bullet.x, bullet.y + 6, 1, color, { minSpeed: 0.2, maxSpeed: 1, life: 12, maxSize: 2 });
  }
}

function drawPlayerBullet(bullet) {
  const color = bullet.color || weaponColor(bullet.type === "basic" ? "blaster" : bullet.type);
  if (bullet.mirror) steerMirrorBullet(bullet);
  ctx.save();
  ctx.translate(bullet.x, bullet.y);
  ctx.rotate(Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2);
  if (bullet.type === "charge") {
    drawChargeOrb(bullet, color);
  } else if (bullet.type === "tech0") {
    drawTech0Bolt(bullet, color);
  } else if (bullet.type === "magma") {
    drawMagmaSlug(bullet, color);
  } else if (bullet.type === "magmaDrop") {
    drawMagmaDrop(bullet, color);
  } else if (bullet.type === "cone") {
    drawConeShard(bullet, color);
  } else if (bullet.type === "mirror") {
    // a turned-around enemy round: a chrome shard with a bright leading edge
    drawGlow(color, 16, 0, 0);
    ctx.fillStyle = "#0b2a33";
    ctx.beginPath();
    ctx.moveTo(0, -10); ctx.lineTo(5, 0); ctx.lineTo(0, 9); ctx.lineTo(-5, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(3.4, 0); ctx.lineTo(0, 6.5); ctx.lineTo(-3.4, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(1.4, -0.5); ctx.lineTo(0, 2); ctx.lineTo(-1.4, -0.5);
    ctx.closePath(); ctx.fill();
  } else if (bullet.type === "radiant") {
    // A sun round on a sulfur sky: the halo disappears into the backdrop, so it
    // is drawn as a hard shape with a dark rim and a white spine instead.
    drawGlow(color, 9, 0, 0);
    ctx.fillStyle = "#3d1201";
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(4.6, 0); ctx.lineTo(0, 9); ctx.lineTo(-4.6, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -9.6); ctx.lineTo(3.1, 0); ctx.lineTo(0, 6.8); ctx.lineTo(-3.1, 0);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.moveTo(0, -7); ctx.lineTo(1.3, 0); ctx.lineTo(0, 3); ctx.lineTo(-1.3, 0);
    ctx.closePath(); ctx.fill();
  } else {
    drawBlasterBolt(bullet, color);
  }
  ctx.restore();
}

let chargeMeterShown = false;
let chargeFillColor = "";

// Runs every frame, so it only writes when something actually changed.
function setChargeColor(color) {
  if (chargeFillColor === color) return;
  chargeFillColor = color;
  dom.chargeFill.style.background = color;
}

function updateChargeMeter() {
  const active = gameActive && selectedWeapon === "charge";
  if (active !== chargeMeterShown) {
    chargeMeterShown = active;
    dom.chargeMeter.classList.toggle("visible", active);
  }
  if (!active || !chargeStartedAt) {
    setWidth(dom.chargeFill, 0);
    setChargeColor(weaponColor("charge"));
    return;
  }
  const held = performance.now() - chargeStartedAt;
  const full = held >= CHARGE_FULL_MS;
  setWidth(dom.chargeFill, Math.min(100, held / CHARGE_FULL_MS * 100));
  setChargeColor(weaponColor("charge"));
  if (full !== chargeMeterFull) {
    chargeMeterFull = full;
    dom.chargeMeter.classList.toggle("full", full);
  }
}
let chargeMeterFull = false;

const CONE_ANGLES = [-0.16, 0, 0.16];

function fireCone(dx, dy) {
  // Reserve the whole burst before firing so the global projectile cap can
  // never clip a Cone volley down to one or two shots.
  if (bullets.length > MAX_PLAYER_BULLETS - CONE_ANGLES.length) return false;
  const length = Math.hypot(dx, dy) || 1; dx /= length; dy /= length;
  const base = Math.atan2(dy, dx);
  for (const offset of CONE_ANGLES) {
    const angle = base + offset;
    fireInDirection(Math.cos(angle), Math.sin(angle), 1, "cone");
  }
  weaponSfx.cone();
  // after the shots, so it isn't left pointing along the last cone arm
  facing.x = dx;
  facing.y = dy;
  return true;
}


// ---------------------------------------------------------------------------
// LEVELS
//
// A jump-to-any-stage picker, one page per chapter. The wave numbers here are
// the same `wave` the loop runs on, and a page's boss tile is the fight you
// would have walked into by clearing that chapter's last wave, so the picker
// can never describe a run the game does not actually play.
//
// Each page paints the chapter's real sky on a canvas of its own, from the same
// tables the game draws with — `STAR_TINTS` for the Moon's star field, and
// `VENUS_SKY_STOPS` / `VENUS_DECKS` for the furnace when Venus comes back.
// Faking it with CSS gradients was the first attempt and it looked like a menu
// illustration instead of the place you are about to fly into.
// ---------------------------------------------------------------------------
const LEVEL_PAGES = [
  {
    sky: "space", eyebrow: "CHAPTER 01", planet: "MOON",
    levels: [
      { wave: 1, name: "First contact" },
      { wave: 2, name: "Chargers" },
      { wave: 3, name: "Turrets" },
      { wave: 4, name: "Mixed assault" },
      { wave: 5, name: "Last wave" },
      { wave: 5, boss: "moon", name: "Moon" },
    ],
  },
  // Venus and everything past it are pulled from the picker until that chapter
  // is ready to ship. The code behind them is still here (waveRoster 6+, the
  // Venus sky, the Venus boss) — nothing routes a player into it, and this list
  // is the only place that decides what is reachable.
];

// What a stage costs: the wave before it, cleared. A boss stands on the last
// wave of its chapter, so it wants that wave cleared rather than the one before
// — Mercury opens once wave 5 is done, Venus once wave 9 is.
function levelRequires(level) {
  if (level.boss) return level.boss === "venus" ? 9 : 5;
  return level.wave - 1;
}

let levelPageIndex = 0;
let levelFlipping = false;
let levelsReturnTarget = null;
const LEVEL_FLIP_MS = 420;

// --- the sky previews ------------------------------------------------------
// Miniatures, not screenshots: same palettes, same construction, sized to the
// card. They are repainted from the one rAF loop while the panel is open, so
// the sky in the picker drifts exactly like the sky you are jumping into.
// Built from the arena's own `STAR_LAYERS` and `STAR_DENSITY` rather than an
// approximation of them: three parallax layers with their own sizes, speeds and
// alphas, a per-star twinkle rate and phase, and the ejecta cross the biggest
// ones get. The old preview was one flat field of 1px dots all drifting at
// random speeds, which read as noise rather than as depth.
function levelPreviewStars(cv) {
  const count = Math.max(24, Math.round(cv.width * cv.height * STAR_DENSITY));
  const stars = [];
  for (let i = 0; i < count; i++) {
    const layer = STAR_LAYERS[Math.floor(Math.random() * STAR_LAYERS.length)];
    stars.push({
      x: Math.floor(rand(0, cv.width)), y: rand(0, cv.height),
      size: layer.size,
      speed: layer.speed * rand(0.75, 1.3),
      alpha: layer.alpha * rand(0.6, 1),
      twinkle: rand(0.6, 2.4),
      phase: rand(0, Math.PI * 2),
      tint: Math.floor(Math.random() * STAR_TINTS.length),
      sparkle: layer.size === 3 && Math.random() < 0.22,
    });
  }
  stars.sort((a, b) => a.tint - b.tint);
  return stars;
}

// The same loop as `drawStaticStars`, on a smaller canvas. Cleared to pure
// black like `draw()` does: the old #04040a was a shade of blue, and next to
// the arena it previews it read as a lit sky rather than as vacuum.
function paintLevelSpace(g, cv, t) {
  g.fillStyle = "#000000";
  g.fillRect(0, 0, cv.width, cv.height);
  if (!cv.levelStars) cv.levelStars = levelPreviewStars(cv);
  let tint = -1;
  const wobble = t * 0.004;
  for (const star of cv.levelStars) {
    star.y += star.speed;
    if (star.y > cv.height + 4) { star.y = -4; star.x = Math.floor(rand(0, cv.width)); }
    if (star.tint !== tint) { tint = star.tint; g.fillStyle = STAR_TINTS[tint]; }
    const alpha = Math.min(1, star.alpha * (0.55 + 0.45 * Math.sin(wobble * star.twinkle + star.phase)));
    const x = Math.floor(star.x);
    const y = Math.floor(star.y);
    g.globalAlpha = alpha;
    g.fillRect(x, y, star.size, star.size);
    if (star.sparkle) {
      g.globalAlpha = alpha * 0.5;
      g.fillRect(x - star.size, y + 1, star.size * 3, 1);
      g.fillRect(x + 1, y - star.size, 1, star.size * 3);
    }
  }
  g.globalAlpha = 1;
}

function paintLevelVenus(g, cv, t) {
  const w = cv.width;
  const h = cv.height;
  if (!cv.levelSky || cv.levelSkyH !== h) {
    cv.levelSky = g.createLinearGradient(0, 0, 0, h);
    for (const [stop, color] of VENUS_SKY_STOPS) cv.levelSky.addColorStop(stop, color);
    const sun = g.createRadialGradient(w * 0.72, h * 0.14, 0, w * 0.72, h * 0.14, Math.max(w, h) * 0.42);
    sun.addColorStop(0, "rgba(255, 233, 176, 0.55)");
    sun.addColorStop(0.16, "rgba(255, 175, 74, 0.32)");
    sun.addColorStop(0.45, "rgba(198, 84, 22, 0.16)");
    sun.addColorStop(1, "rgba(120, 40, 10, 0)");
    cv.levelSun = sun;
    cv.levelSkyH = h;
  }
  g.fillStyle = cv.levelSky;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "lighter";
  g.fillStyle = cv.levelSun;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "source-over";
  g.lineJoin = "round";
  for (const deck of VENUS_DECKS) {
    const drift = t * deck.speed * w;
    const top = h * deck.y;
    const bottom = top + h * deck.h;
    const amp = deck.amp * (h / 600);
    g.beginPath();
    g.moveTo(-20, bottom + 20);
    for (let x = -20; x <= w + 20; x += 12) {
      const phase = (x + drift) * deck.wave;
      g.lineTo(x, top + Math.sin(phase) * amp + Math.sin(phase * 0.41 + 1.7) * amp * 0.55);
    }
    g.lineTo(w + 20, bottom + 20);
    g.closePath();
    g.globalAlpha = deck.alpha;
    g.fillStyle = deck.body;
    g.fill();
    g.globalAlpha = deck.alpha * 0.85;
    g.strokeStyle = deck.rim;
    g.lineWidth = 2;
    g.stroke();
  }
  g.globalAlpha = 1;
}

// Repainted from `draw()` while the panel is open — one rAF for the whole game,
// menu included, so this never starts a second loop of its own.
function paintLevelPreviews(t) {
  const pages = dom.levelBook ? dom.levelBook.children : null;
  if (!pages) return;
  for (const page of pages) {
    const cv = page.firstElementChild;
    if (!cv || cv.tagName !== "CANVAS") continue;
    const box = cv.getBoundingClientRect();
    if (!box.width || !box.height) continue;
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (cv.width !== w || cv.height !== h) {
      cv.width = w;
      cv.height = h;
      cv.levelStars = null;
      cv.levelSky = null;
    }
    const g = cv.getContext("2d");
    if (page.dataset.sky === "space") paintLevelSpace(g, cv, t); else paintLevelVenus(g, cv, t);
  }
}

// --- the pages -------------------------------------------------------------
// The Moon's portrait for the picker, as SVG rather than stacked CSS gradients.
// It is the *character*, not a sphere in its colours: the angry brows, the two
// glowing eyes and the frown are what make it recognisable, and a first pass
// that got the body ramp and the maria right but left the face off looked like
// a completely different boss. Every coordinate is `drawMoon`'s own, scaled by
// 50/78 (the viewBox half-width over `MOON_RADIUS`) and re-centred on 50,50 —
// so if the fight's proportions move, rescale from there rather than eyeballing.
const MOON_ORB_TEMPLATE = `
<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <defs>
    <radialGradient id="moon-orb-body-ID" cx="34%" cy="28%" r="74%">
      <stop offset="0" stop-color="#fbf8f1"/>
      <stop offset=".4" stop-color="#cbc7bf"/>
      <stop offset=".76" stop-color="#8a8781"/>
      <stop offset="1" stop-color="#3b3936"/>
    </radialGradient>
    <clipPath id="moon-orb-clip-ID"><circle cx="50" cy="50" r="47"/></clipPath>
  </defs>
  <g clip-path="url(#moon-orb-clip-ID)">
    <circle cx="50" cy="50" r="47" fill="url(#moon-orb-body-ID)"/>
    <g fill="#3a393e" opacity=".26">
      <ellipse cx="28.4" cy="29.3" rx="13.2" ry="9.4" transform="rotate(28.6 28.4 29.3)"/>
      <ellipse cx="70.7" cy="31.2" rx="10.3" ry="7.5" transform="rotate(-22.9 70.7 31.2)"/>
      <ellipse cx="77.3" cy="64.1" rx="11.3" ry="8.9" transform="rotate(51.6 77.3 64.1)"/>
      <ellipse cx="22.7" cy="66.0" rx="10.3" ry="7.5" transform="rotate(-40.1 22.7 66)"/>
      <ellipse cx="50" cy="16.2" rx="12.2" ry="6.1" transform="rotate(5.7 50 16.2)"/>
    </g>
    <g fill="#262524" opacity=".34">
      <circle cx="40.6" cy="26.5" r="4.4"/>
      <circle cx="79.7" cy="38" r="4"/>
      <circle cx="20" cy="47" r="3.4"/>
      <circle cx="60" cy="84" r="3.8"/>
    </g>
    <!-- the terminator: the lit fraction is the phase, and the phase is the fight -->
    <!-- The terminator at MOON_PHASE_LIGHT[0] (0.24 lit). Sweep 1 puts the shadow
         on the right limb, which is the side drawMoon leaves dark — flip it and
         the picker lights the opposite limb from the fight. Dark, not black: the
         unlit surface is still surface, and at 34px an opaque shadow reads as a
         hole punched in the tile. -->
    <path d="M50 3 A47 47 0 0 1 50 97 A26 47 0 0 1 50 3 Z" fill="#0a0c13" opacity=".58"/>
  </g>
  <!-- face, over the shadow, exactly as drawMoonFace stacks it -->
  <g fill="#15161a">
    <path d="M-14.7 -5.8 L12.8 -12.2 L14.1 -4.5 L-14.1 2.6 Z" transform="translate(32.7 37.2) rotate(-11)"/>
    <path d="M-14.7 -5.8 L12.8 -12.2 L14.1 -4.5 L-14.1 2.6 Z" transform="translate(67.3 37.2) rotate(11)"/>
  </g>
  <g>
    <circle cx="32.7" cy="41" r="5.8" fill="#f4f2ec"/>
    <circle cx="67.3" cy="41" r="5.8" fill="#f4f2ec"/>
    <circle cx="32.7" cy="41" r="3.5" fill="#bfe4ff"/>
    <circle cx="67.3" cy="41" r="3.5" fill="#bfe4ff"/>
    <circle cx="32.7" cy="41" r="1.6" fill="#0b1018"/>
    <circle cx="67.3" cy="41" r="1.6" fill="#0b1018"/>
    <circle cx="30.1" cy="38.5" r="1.3" fill="rgba(255,255,255,.9)"/>
    <circle cx="64.7" cy="38.5" r="1.3" fill="rgba(255,255,255,.9)"/>
  </g>
  <!-- The scowl. Sweep 1, and check it by measuring rather than by eye: the arc's
       midpoint must land at y 60.3, *above* the corners at 72.6, which is where
       drawMoon's arc(0, 44, 28, PI+0.32, 2PI-0.32) puts it. Flipped to sweep 0
       it becomes a broad smile, and at 34px the difference is easy to misread. -->
  <path d="M33 72.6 A17.9 17.9 0 0 1 67 72.6" fill="none" stroke="#15161a" stroke-width="3.8" stroke-linecap="round"/>
  <!-- rim light along the lit limb: crisp, because there is no air to soften it -->
  <path d="M8 69.8 A46.4 46.4 0 0 1 85.8 20.4" fill="none" stroke="rgba(244,248,255,.5)" stroke-width="1.6"/>
</svg>`;

// Two copies of this SVG live in the document at once — the LEVELS boss orb and
// the ALPHA progress pip — and `url(#id)` is a document-wide lookup, so sharing
// ids between them made one instance paint with the other's (hidden) gradient
// and clip: the orb went black. Every copy gets its own suffix.
function moonOrbSvg(suffix) {
  return MOON_ORB_TEMPLATE.replaceAll("-ID", "-" + suffix);
}

function buildLevelPage(index) {
  const page = LEVEL_PAGES[index];
  const el = document.createElement("div");
  el.className = "level-page";
  el.dataset.sky = page.sky;
  el.append(document.createElement("canvas"));
  const inner = document.createElement("div");
  inner.className = "level-page-inner";
  const eyebrow = document.createElement("p");
  eyebrow.className = "level-eyebrow";
  eyebrow.textContent = page.eyebrow;
  const planet = document.createElement("h3");
  planet.className = "level-planet";
  planet.textContent = page.planet;
  const grid = document.createElement("div");
  grid.className = "level-grid";
  for (const level of page.levels) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = level.boss ? "level-tile boss" : "level-tile";
    tile.dataset.wave = String(level.wave);
    const open = clearedWave >= levelRequires(level);
    if (level.boss) {
      tile.dataset.boss = level.boss;
      const orb = document.createElement("i");
      orb.className = `boss-orb ${level.boss}`;
      if (level.boss === "moon") orb.innerHTML = moonOrbSvg("lv");

      const caption = document.createElement("small");
      caption.textContent = "BOSS";
      tile.append(orb, caption);
      tile.setAttribute("aria-label", open ? `Boss: ${level.name}` : `Boss ${level.name} locked: clear wave ${levelRequires(level)}`);
    } else {
      const number = document.createElement("span");
      number.className = "level-number";
      number.textContent = String(level.wave);
      tile.append(number);
      tile.setAttribute("aria-label", open ? `Wave ${level.wave}: ${level.name}` : `Wave ${level.wave} locked: clear wave ${levelRequires(level)}`);
    }
    if (!open) {
      tile.classList.add("locked");
      // Genuinely disabled, not just styled: `MENU_FOCUS_SELECTOR` skips
      // [disabled], so the arrow keys walk straight past a locked stage.
      tile.disabled = true;
    }
    grid.append(tile);
  }
  inner.append(eyebrow, planet, grid);
  el.append(inner);
  return el;
}

function renderLevelChrome() {
  // A single chapter needs no arrows and no dots — with Venus pulled, showing
  // them would advertise pages that are not there.
  const nav = document.querySelector(".level-nav");
  if (nav) nav.hidden = LEVEL_PAGES.length < 2;
  const dots = dom.levelDots;
  dots.textContent = "";
  for (let i = 0; i < LEVEL_PAGES.length; i++) {
    const dot = document.createElement("i");
    if (i === levelPageIndex) dot.className = "on";
    dots.append(dot);
  }
  document.getElementById("level-prev").disabled = levelPageIndex === 0;
  document.getElementById("level-next").disabled = levelPageIndex === LEVEL_PAGES.length - 1;
}

function showLevelPage(index) {
  levelPageIndex = index;
  dom.levelBook.textContent = "";
  dom.levelBook.append(buildLevelPage(index));
  renderLevelChrome();
}

// Both pages move at once. The first version swung one page out, swapped its
// contents while it was edge-on and swung it back in, which read as a stutter
// with a jump in the middle — the incoming page has to already be travelling
// when the outgoing one leaves.
function flipLevelPage(delta) {
  const next = levelPageIndex + delta;
  if (levelFlipping || next < 0 || next >= LEVEL_PAGES.length) return;
  levelFlipping = true;
  const book = dom.levelBook;
  const outgoing = book.firstElementChild;
  const incoming = buildLevelPage(next);
  const keepFocus = outgoing && outgoing.contains(document.activeElement);
  incoming.classList.add(delta > 0 ? "level-enter-right" : "level-enter-left");
  book.append(incoming);
  void incoming.offsetWidth;      // commit the offscreen start before animating
  incoming.classList.remove("level-enter-right", "level-enter-left");
  if (outgoing) outgoing.classList.add(delta > 0 ? "level-leave-left" : "level-leave-right");
  levelPageIndex = next;
  renderLevelChrome();
  playSound(delta > 0 ? 420 : 360, 0.05, "triangle");
  setTimeout(() => {
    if (outgoing) outgoing.remove();
    levelFlipping = false;
    if (keepFocus) {
      const first = incoming.querySelector(".level-tile");
      if (first) first.focus();
    }
  }, LEVEL_FLIP_MS);
}

function openLevelsPanel(trigger) {
  levelsReturnTarget = trigger;
  showLevelPage(levelPageIndex);
  dom.levelsPanel.classList.add("visible");
  dom.levelsPanel.setAttribute("aria-hidden", "false");
  // Straight onto the first stage, not the close button: `focusMenuDefault`
  // would take the first focusable in the card, and that is the x.
  const first = dom.levelBook.querySelector(".level-tile");
  if (first) first.focus(); else focusMenuDefault(dom.levelsPanel);
}

function startLevel(tile) {
  const wave = Number(tile.dataset.wave) || 1;
  const boss = tile.dataset.boss || null;
  closeMenuPanel(dom.levelsPanel, null);
  // The picker also opens from the pause card, and the pause overlay sits above
  // the canvas — leaving it up would play the warp behind a PAUSED screen.
  if (gamePaused) setPaused(false);
  // The same warp the START button flies, so a stage jump is not a lesser exit
  // from the menu than a fresh run.
  beginWarpLaunch(() => startGame(wave, boss));
}

// The ALPHA panel's progress row: the finished planet is the LEVELS picker's own
// Moon portrait rather than a coloured dot, and the eleven still to come are
// empty rings with a question mark.
const alphaPipMoon = document.getElementById("alpha-pip-moon");
if (alphaPipMoon) alphaPipMoon.innerHTML = moonOrbSvg("alpha");
const thanksPipMoon = document.getElementById("thanks-pip-moon");
if (thanksPipMoon) thanksPipMoon.innerHTML = moonOrbSvg("thanks");

// The menu's MOON UPDATE badge shows the same portrait, at size. It has to be
// the identical asset: a hand-built CSS lookalike was the first attempt and it
// drifted from the real body immediately — wrong eyes, wrong crescent — so it
// read as a different character to the one you actually fight.
const moonPromoOrb = document.getElementById("moon-promo-orb");
if (moonPromoOrb) moonPromoOrb.innerHTML = moonOrbSvg("promo");

function showLoading(callback) {
  const el = document.getElementById("loading-screen");
  const fill = document.querySelector(".loading-fill");
  el.classList.remove("hidden");
  fill.style.width = "0%";
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 30 + 10;
    if (progress >= 100) {
      progress = 100;
      fill.style.width = "100%";
      clearInterval(interval);
      setTimeout(() => {
        el.classList.add("hidden");
        callback();
      }, 400);
    } else {
      fill.style.width = progress + "%";
    }
  }, 200);
}

// A coarse first guess so a weak machine doesn't have to spend its first seconds
// dropping tiers: few cores usually means a weak GPU too. `?quality=low` (or
// high/medium/potato) pins a tier for testing and disables the auto-tuning.
const requestedQuality = new URLSearchParams(location.search).get("quality");
const pinnedIndex = QUALITY_TIERS.findIndex((tier) => tier.name === requestedQuality);
if (pinnedIndex >= 0) {
  qualityPinned = true;
  qualityIndex = pinnedIndex;
  quality = QUALITY_TIERS[pinnedIndex];
} else if ((navigator.hardwareConcurrency || 4) <= 4) {
  qualityIndex = 1;
  quality = QUALITY_TIERS[1];
}
document.documentElement.dataset.quality = quality.name;

setupWeaponBook();
resize();
initStars();
syncMoonRewardUI();
syncVenusRewardUI();
syncSuperLockUI();
refreshLoadoutUI();
setTheme(playerColor);
syncAudioControls();
requestAnimationFrame(frame);

// --- title card ------------------------------------------------------------
// "DANIEL AND PETROS PRESENT..." holds until the player clicks or presses a
// key — that same gesture is what unlocks audio, so the card and the sound
// always start together instead of the card timing out ahead of the music.
let creditsDone = false;

function finishCredits() {
  if (creditsDone) return;
  creditsDone = true;
  const credits = document.getElementById("credits-screen");
  credits.classList.add("fading");
  document.getElementById("menu-wrap").classList.remove("hidden", "launching");
  setTimeout(() => credits.classList.add("gone"), 750);
  // If the welcome theme is already sounding, hand off to the menu track with
  // a slow crossfade rather than the usual snappy track switch. If audio
  // hasn't been unlocked yet, leave it alone — unlockAudio() below checks
  // creditsDone and will start straight into "menu" on the player's first
  // gesture instead of starting a track against a still-suspended context.
  if (audioContext && music.current() === "intro") music.play("menu", 1.4);
}
// a click or key advances past the card
document.getElementById("credits-screen").addEventListener("click", finishCredits);

// Browsers won't let audio start before a gesture, so the welcome/menu track
// waits for the player's first click or keypress and then comes in — the
// welcome theme while the title card is up, the menu track once it's gone.
// Deliberately mousedown/touchstart/keydown, not pointerdown: Safari's
// autoplay-gesture detection only recognises the legacy input events (as
// every button click handler elsewhere in this file already relies on) and
// silently ignores Pointer Events, so a pointerdown-only listener would run
// this function on Safari without ever actually unsuspending the context.
function unlockAudio() {
  ensureAudio();
  if (audioContext && audioContext.state === "suspended") audioContext.resume();
  if (!gameActive) music.play(creditsDone ? "menu" : "intro");
  window.removeEventListener("mousedown", unlockAudio);
  window.removeEventListener("touchstart", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
}
window.addEventListener("mousedown", unlockAudio);
window.addEventListener("touchstart", unlockAudio, { passive: true });
window.addEventListener("keydown", unlockAudio);

document.getElementById("start-btn").addEventListener("click", function () {
  beginWarpLaunch(startGame);
});
document.getElementById("try-again-btn").addEventListener("click", function () {
  showLoading(startGame);
});
document.getElementById("main-menu-btn").addEventListener("click", returnToMenu);
document.getElementById("defeat-retry").addEventListener("click", function () {
  dom.moonDefeatScreen.classList.remove("visible");
  dom.moonDefeatScreen.setAttribute("aria-hidden", "true");
  const wave = retryWave;
  const boss = retryBoss;
  showLoading(() => startGame(wave, boss));
});
document.getElementById("defeat-menu").addEventListener("click", returnToMenu);
document.getElementById("resume-btn").addEventListener("click", function () {
  setPaused(false);
});
document.getElementById("pause-menu-btn").addEventListener("click", returnToMenu);
document.getElementById("continue-boss").addEventListener("click", startBossFight);
// The Moon is the end of the built game, so CONTINUE does not fly on into Venus
// airspace: it hands over to the thanks card, which is the run's last beat and
// carries the only way out (MAIN MENU).
document.getElementById("victory-continue").addEventListener("click", function () {
  dom.victoryScreen.classList.remove("visible");
  dom.victoryScreen.setAttribute("aria-hidden", "true");
  dom.thanksScreen.classList.add("visible");
  dom.thanksScreen.setAttribute("aria-hidden", "false");
  focusMenuDefault(dom.thanksScreen);
});
document.getElementById("thanks-menu").addEventListener("click", function () {
  celebrationScene = null;
  returnToMenu();
});
document.getElementById("reward-equip-tech0").addEventListener("click", function () {
  if (selectedWeapon === "tech0") setSelectedWeapon(rewardPreviousWeapon);
  else { rewardPreviousWeapon = selectedWeapon; setSelectedWeapon("tech0"); }
});
document.getElementById("reward-equip-magma").addEventListener("click", function () {
  if (selectedWeapon === "magma") setSelectedWeapon(rewardPreviousWeapon);
  else { rewardPreviousWeapon = selectedWeapon; setSelectedWeapon("magma"); }
});
document.getElementById("reward-equip-grey").addEventListener("click", function () {
  if (playerColor === GREY_SHIP_COLOR) setPlayerColor(rewardPreviousColor);
  else { rewardPreviousColor = playerColor; setPlayerColor(GREY_SHIP_COLOR); }
  playSound(760, 0.07, "square");
});
document.getElementById("reward-equip-magma-ship").addEventListener("click", function () {
  if (playerColor === MAGMA_SHIP_COLOR) setPlayerColor(rewardPreviousColor);
  else { rewardPreviousColor = playerColor; setPlayerColor(MAGMA_SHIP_COLOR); }
  playSound(760, 0.07, "square");
});
document.getElementById("reward-continue").addEventListener("click", function () {
  const rewards = document.getElementById("reward-screen");
  const next = document.getElementById("reward-continue");
  rewards.classList.remove("visible", "snap");
  next.classList.remove("ready");
  rewards.setAttribute("aria-hidden", "true");
  if (rewardMode === "venus") {
    // back past the furnace: the extra heart was granted by finishBossDeath,
    // the waves resume here
    gamePaused = false;
    bossIntro = false;
    syncMobileControls();
    celebrationScene = null;
    music.play("battle");
    createEnemies();
    showWaveBanner("VENUS DESTROYED", "+1 HEART");
    announceWave(11, 1800);
    return;
  }
  dom.victoryScreen.classList.add("visible");
  dom.victoryScreen.setAttribute("aria-hidden", "false");
  focusMenuDefault(dom.victoryScreen);
});
document.getElementById("admin-submit").addEventListener("click", function () {
  const input = document.getElementById("admin-code");
  const status = document.getElementById("admin-status");
  if (input.value.trim().toUpperCase() === "BUILDER") {
    status.textContent = "BUILDER UNLOCKED — PRESS `";
    input.value = "";
    builder.unlock();
  } else {
    status.textContent = "INVALID CODE";
  }
});
// ---------------------------------------------------------------------------
// BUILDER
//
// The dev console, unlocked by typing BUILDER into the menu's code box and
// toggled after that with the backtick key. It replaces the old PETROSADMIN
// (invincibility) and TEST (a practice room with one dummy target) codes, both
// of which were a fixed cheat each; this is the general case.
//
// How it can change *anything*: `builderEval` is a top-level function, so a
// direct `eval` inside it runs in this script's own lexical scope and can read
// and assign every top-level `let` in the file — `wave`, `lives`, `boss`,
// `selectedSuper`, all of it. That is the whole trick, and it is why the
// function must stay at the top level of main.js rather than being moved into
// a module or an IIFE.
function builderEval(source) {
  return eval(source);
}

// Completion is built from the file's own source rather than a hand-kept list:
// `builderEval` can reach every top-level binding, but nothing can *enumerate*
// them (script-scope `let` is not a property of `window`), so the console
// fetches main.js and reads the declarations out of it. A hand-kept list would
// be wrong within a week; this one cannot drift.
let builderSymbols = [];
// Captured now: `document.currentScript` is null by the time the console is
// unlocked, and the ?v= cache-bust means "main.js" alone can fetch a stale copy.
const BUILDER_SELF_URL = (document.currentScript && document.currentScript.src) || "main.js";
function builderLoadSymbols() {
  fetch(BUILDER_SELF_URL).then((r) => r.text()).then((text) => {
    const found = new Set();
    const decl = /^(?:let|const|var|function)\s+([A-Za-z_$][\w$]*)/gm;
    let m;
    while ((m = decl.exec(text))) found.add(m[1]);
    builderSymbols = Array.from(found).sort();
  }).catch(() => {
    builderSymbols = [];
  });
}

const builder = (function () {
  const ui = {};
  const history = [];
  let historyIndex = -1;
  let unlocked = false;
  let built = false;
  let watches = [];

  function log(text, cls) {
    if (!ui.log) return;
    const line = document.createElement("div");
    if (cls) line.className = cls;
    line.textContent = text;
    ui.log.append(line);
    while (ui.log.childElementCount > 200) ui.log.firstElementChild.remove();
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  // Objects get one level of shape rather than "[object Object]", which is
  // useless when the thing you asked for is `player` or `boss`.
  function show(value) {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "function") return `function ${value.name || "(anonymous)"}()`;
    if (typeof value !== "object") return String(value);
    if (Array.isArray(value)) return `Array(${value.length})` + (value.length && value.length <= 12 ? ` [${value.map(show).join(", ")}]` : "");
    try {
      const keys = Object.keys(value);
      const head = keys.slice(0, 10).map((k) => {
        const v = value[k];
        const short = v && typeof v === "object" ? (Array.isArray(v) ? `Array(${v.length})` : "{…}") : typeof v === "number" ? Math.round(v * 1000) / 1000 : String(v);
        return `${k}: ${short}`;
      });
      return `{ ${head.join(", ")}${keys.length > 10 ? ", …" : ""} }`;
    } catch (error) {
      return String(value);
    }
  }

  const COMMANDS = {
    help: {
      help: "list every command",
      run() {
        log("BUILDER — commands", "b-key");
        for (const name of Object.keys(COMMANDS).sort()) log(`  ${name.padEnd(9)} ${COMMANDS[name].help}`);
        log("  anything else is evaluated as JS in the game's own scope,", "b-note");
        log("  so `wave = 9`, `boss.health = 1` and `lives` all work.", "b-note");
        log("  Tab completes, up/down walks history, ` closes.", "b-note");
      },
    },
    god: {
      help: "[on|off] invulnerability",
      run(a) { devGodMode = a[0] ? a[0] !== "off" && a[0] !== "0" : !devGodMode; log(`god ${devGodMode ? "on" : "off"}`); },
    },
    lives: {
      help: "N — set hearts",
      run(a) {
        if (!a.length) return log(`lives = ${lives}`);
        lives = Math.max(0, Math.floor(Number(a[0]) || 0));
        setLives(lives, true);
        log(`lives = ${lives}`);
      },
    },
    wave: {
      help: "N — restart at wave N",
      run(a) {
        if (!a.length) return log(`wave = ${wave}`);
        const n = Number(a[0]);
        if (!Number.isFinite(n)) return log("wave <n>", "b-err");
        startGame(Math.max(1, Math.floor(n)), null);
        log(`jumped to wave ${Math.max(1, Math.floor(n))}`);
      },
    },
    boss: {
      help: "[moon|venus] — jump into a boss fight",
      run(a) {
        const kind = a[0] === "venus" ? "venus" : "moon";
        startGame(kind === "venus" ? 10 : 5, kind);
        log(`entering ${kind}`);
      },
    },
    bosshp: {
      help: "N — set the live boss's health",
      run(a) {
        if (!bossMode) return log("no boss in play", "b-err");
        if (!a.length) return log(`boss.health = ${boss.health} / ${bossMaxHealth()}`);
        boss.health = Math.max(0, Number(a[0]) || 0);
        log(`boss.health = ${boss.health} / ${bossMaxHealth()}`);
      },
    },
    kill: {
      help: "kill every enemy on screen",
      run() {
        let n = 0;
        for (const enemy of enemies) if (enemy.alive) { damageEnemy(enemy, 9999); n++; }
        for (const m of bossMinions) if (m.health > 0) { m.health = 0; n++; }
        log(`killed ${n}`);
      },
    },
    clear: {
      help: "clear incoming fire (or `clear log`)",
      run(a) {
        if (a[0] === "log") { ui.log.textContent = ""; return; }
        const n = enemyBullets.length + bossBullets.length;
        enemyBullets.length = 0;
        bossBullets.length = 0;
        log(`cleared ${n} shots`);
      },
    },
    meter: {
      help: "[0..1] — set the super meter (default full)",
      run(a) {
        const want = a.length ? Math.max(0, Math.min(1, Number(a[0]))) : 1;
        lastSuperKills = superDamage - want * (SUPER_COST[selectedSuper] || 20);
        updateSuperMeter();
        log(`meter = ${(superMeter * 100).toFixed(0)}%`);
      },
    },
    super: {
      help: "NAME — equip a super",
      run(a) {
        const name = (a[0] || "").toLowerCase();
        if (!SUPER_COST[name]) return log(`supers: ${Object.keys(SUPER_COST).join(", ")}`, "b-err");
        // Deliberately ignores the lock — being able to try an unreleased
        // reward is most of the point of the console. `unlock all` is there
        // when you want the player-facing state instead.
        selectedSuper = name;
        refreshLoadoutUI();
        updateSuperMeter();
        log(`super = ${name}${superLocked(name) ? "  (locked for players)" : ""}`);
      },
    },
    gun: {
      help: "NAME — equip a primary",
      run(a) {
        const name = (a[0] || "").toLowerCase();
        if (!WEAPON_LABELS[name]) return log(`guns: ${Object.keys(WEAPON_LABELS).join(", ")}`, "b-err");
        selectedWeapon = name;
        refreshLoadoutUI();
        log(`gun = ${name}`);
      },
    },
    color: {
      help: "#rrggbb — ship colour",
      run(a) {
        if (!/^#[0-9a-f]{6}$/i.test(a[0] || "")) return log("expected #rrggbb", "b-err");
        setPlayerColor(a[0]);
        log(`ship = ${a[0]}`);
      },
    },
    unlock: {
      help: "[all|none] — rewards and stage progress",
      run(a) {
        if (a[0] === "none") {
          moonRewardsUnlocked = false;
          venusRewardsUnlocked = false;
          unlockedSupers = new Set();
          persistUnlockedSupers();
          clearedWave = 0;
          syncMoonRewardUI();
          syncVenusRewardUI();
          syncSuperLockUI();
          return log("locked everything");
        }
        unlockMoonRewards();
        unlockVenusRewards();
        for (const name of Object.keys(LOCKED_SUPERS)) unlockSuper(name);
        recordWaveCleared(99);
        log("unlocked every reward, super and stage");
      },
    },
    speed: {
      help: "N — time scale (0.25 slow-mo, 2 fast)",
      run(a) {
        if (!a.length) return log(`speed = ${devTimeScale}x`);
        devTimeScale = Math.max(0.05, Math.min(4, Number(a[0]) || 1));
        log(`speed = ${devTimeScale}x`);
      },
    },
    spawn: {
      help: "TYPE [N] — spawn enemies",
      run(a) {
        const type = (a[0] || "grunt").toLowerCase();
        if (!ENEMY_TYPES[type]) return log(`types: ${Object.keys(ENEMY_TYPES).join(", ")}`, "b-err");
        const count = Math.max(1, Math.min(40, Math.floor(Number(a[1]) || 1)));
        for (let i = 0; i < count; i++) {
          enemies.push(makeEnemy(type, 80 + Math.random() * Math.max(1, W - 160), 90 + Math.random() * 120, Math.random() * 6));
        }
        log(`spawned ${count} x ${type}`);
      },
    },
    tp: {
      help: "X Y — move the ship",
      run(a) {
        if (!Number.isFinite(Number(a[0])) || !Number.isFinite(Number(a[1]))) return log("tp <x> <y>", "b-err");
        player.x = Number(a[0]);
        player.y = Number(a[1]);
        player.vx = 0;
        player.vy = 0;
        log(`ship at ${Math.round(player.x)}, ${Math.round(player.y)}`);
      },
    },
    watch: {
      help: "EXPR — pin a live value to the top of the console",
      run(a, raw) {
        if (!raw) return log("watch <expression>", "b-err");
        watches.push(raw);
        log(`watching ${raw}`);
      },
    },
    unwatch: {
      help: "[N|all] — drop a pinned value",
      run(a) {
        if (!a[0] || a[0] === "all") { watches = []; return log("cleared watches"); }
        watches.splice(Math.floor(Number(a[0])) - 1, 1);
        log("dropped");
      },
    },
    vars: {
      help: "[filter] — list game symbols and their values",
      run(a) {
        const filter = (a[0] || "").toLowerCase();
        const names = builderSymbols.filter((n) => !filter || n.toLowerCase().includes(filter));
        if (!names.length) return log(builderSymbols.length ? "no match" : "symbol table still loading", "b-err");
        log(`${names.length} symbol${names.length === 1 ? "" : "s"}`, "b-key");
        for (const name of names.slice(0, 60)) {
          let value;
          try { value = show(builderEval(name)); } catch (error) { value = "<unreadable>"; }
          if (value.length > 90) value = value.slice(0, 87) + "…";
          log(`  ${name} = ${value}`);
        }
        if (names.length > 60) log(`  …and ${names.length - 60} more`, "b-note");
      },
    },
  };

  function completions(text) {
    if (!text) return [];
    // First word: a command. After that, whatever the game actually calls things.
    const head = text.split(/\s+/)[0];
    const pool = text.includes(" ")
      ? builderSymbols
      : Object.keys(COMMANDS).concat(builderSymbols);
    const word = text.includes(" ") ? text.slice(text.lastIndexOf(" ") + 1) : head;
    if (!word) return [];
    const lower = word.toLowerCase();
    return pool.filter((n) => n.toLowerCase().startsWith(lower) && n !== word).sort();
  }

  function ghost() {
    const text = ui.line.value;
    const hits = completions(text);
    if (!hits.length) { ui.ghost.textContent = ""; return; }
    const shown = hits.slice(0, 8).join("  ");
    ui.ghost.textContent = hits.length > 8 ? `${shown}  …+${hits.length - 8}` : shown;
  }

  function complete() {
    const text = ui.line.value;
    const hits = completions(text);
    if (!hits.length) return;
    const cut = text.includes(" ") ? text.lastIndexOf(" ") + 1 : 0;
    // Longest common prefix, so tabbing narrows rather than guessing.
    let prefix = hits[0];
    for (const hit of hits) {
      let i = 0;
      while (i < prefix.length && i < hit.length && prefix[i].toLowerCase() === hit[i].toLowerCase()) i++;
      prefix = prefix.slice(0, i);
    }
    ui.line.value = text.slice(0, cut) + prefix + (hits.length === 1 ? " " : "");
    ghost();
  }

  function run(raw) {
    const text = raw.trim();
    if (!text) return;
    log(`> ${text}`, "b-in");
    history.push(text);
    historyIndex = history.length;
    const parts = text.split(/\s+/);
    const name = parts[0].toLowerCase();
    const rest = text.slice(parts[0].length).trim();
    // `wave 7` is a command; `wave * 3 + 1` is an expression that happens to
    // start with a command's name. A command only wins when its arguments look
    // like arguments — bare words, numbers, hex colours — and never when the
    // line carries JS punctuation. `watch` is exempt: its argument *is* an
    // expression, so it always takes the rest of the line raw.
    const looksLikeArgs = rest === "" || /^[\w#.-]+(\s+[\w#.-]+)*$/.test(rest);
    const command = COMMANDS[name] && (name === "watch" || looksLikeArgs) ? COMMANDS[name] : null;
    try {
      if (command) command.run(parts.slice(1), rest);
      else log(show(builderEval(text)));
    } catch (error) {
      log(String(error && error.message ? error.message : error), "b-err");
    }
  }

  // Repainted from the one rAF in draw(), like everything else on screen.
  function paintWatches() {
    if (!built || !ui.watch) return;
    if (!watches.length) { ui.watch.hidden = true; return; }
    const lines = watches.map((expr, i) => {
      let value;
      try { value = show(builderEval(expr)); } catch (error) { value = "<error>"; }
      return `${i + 1}. ${expr} = ${value}`;
    });
    const next = lines.join("\n");
    if (ui.watch.textContent !== next) ui.watch.textContent = next;
    ui.watch.hidden = false;
  }

  function open() {
    if (!unlocked || !built) return;
    ui.root.hidden = false;
    ui.line.focus();
  }
  function close() {
    if (!built) return;
    ui.root.hidden = true;
    ui.line.blur();
  }
  function toggle() { if (ui.root.hidden) open(); else close(); }

  function unlock() {
    if (unlocked) return;
    unlocked = true;
    build();
    builderLoadSymbols();
    open();
    log("BUILDER unlocked. Type `help`. Backtick toggles this window.", "b-key");
  }

  // Nothing exists until the code is entered — no markup in index.html, no
  // elements in the document, no key listeners, nothing in the tab order or the
  // accessibility tree, and nothing to reveal by deleting a `hidden` attribute
  // in devtools. A gated-but-present panel is still a panel a player can find.
  function build() {
    if (built) return;
    built = true;
    ui.root = document.createElement("div");
    ui.root.className = "builder";
    ui.root.id = "builder";
    ui.root.setAttribute("aria-label", "Builder console");
    ui.root.innerHTML = `
      <div class="builder-bar">
        <span class="builder-title">BUILDER</span>
        <span class="builder-hint">\` toggles &middot; <b>help</b> for commands</span>
        <button class="builder-close" type="button" aria-label="Close builder">&times;</button>
      </div>
      <div class="builder-watch" hidden></div>
      <div class="builder-log" role="log" aria-live="polite"></div>
      <div class="builder-ghost" aria-hidden="true"></div>
      <div class="builder-input">
        <span class="builder-caret">&gt;</span>
        <input type="text" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Builder command" />
      </div>`;
    document.body.append(ui.root);
    ui.log = ui.root.querySelector(".builder-log");
    ui.line = ui.root.querySelector(".builder-input input");
    ui.ghost = ui.root.querySelector(".builder-ghost");
    ui.watch = ui.root.querySelector(".builder-watch");
    ui.root.querySelector(".builder-close").addEventListener("click", close);

    // Capture phase on window, so the game's own keydown/keyup listeners (which
    // are on window, bubbling) never see a keystroke meant for the console.
    // Without this, typing `god` walks the ship and `s` fires the super.
    window.addEventListener("keydown", function (event) {
      // Toggle on the key alone, with no condition on focus or visibility. The
      // first version also required the panel be hidden *or* its input focused,
      // which meant that the moment you clicked into the game to play — the
      // normal thing to do with a console open — the key went dead and fell
      // through to the menu handler instead.
      //
      // `key` as well as `code`, because the physical key that produces a
      // backtick is not Backquote on every keyboard layout.
      if (unlocked && (event.code === "Backquote" || event.key === "`")) {
        event.preventDefault();
        event.stopPropagation();
        toggle();
        return;
      }
      if (document.activeElement !== ui.line) return;
      event.stopPropagation();
      if (event.code === "Enter" || event.code === "NumpadEnter") {
        event.preventDefault();
        run(ui.line.value);
        ui.line.value = "";
        ghost();
      } else if (event.code === "Tab") {
        event.preventDefault();
        complete();
      } else if (event.code === "ArrowUp") {
        event.preventDefault();
        if (historyIndex > 0) ui.line.value = history[--historyIndex] || "";
        ghost();
      } else if (event.code === "ArrowDown") {
        event.preventDefault();
        historyIndex = Math.min(history.length, historyIndex + 1);
        ui.line.value = history[historyIndex] || "";
        ghost();
      } else if (event.code === "Escape") {
        event.preventDefault();
        close();
      }
    }, true);
    window.addEventListener("keyup", function (event) {
      if (document.activeElement === ui.line) event.stopPropagation();
    }, true);
    ui.line.addEventListener("input", ghost);
  }

  // Only what the game itself calls. `open`/`toggle`/`close`/`log` were on here
  // and were a second way in for anyone who found the object.
  return { unlock, paintWatches, isOpen: () => built && !ui.root.hidden };
})();

["alpha-btn", "alpha-title-btn"].forEach((id) => {
  const mark = document.getElementById(id);
  if (mark) mark.addEventListener("click", function () { openAlphaPanel(this); });
});
["alpha-close", "alpha-dismiss"].forEach((id) => {
  const button = document.getElementById(id);
  if (button) button.addEventListener("click", function () {
    closeMenuPanel(dom.alphaPanel, alphaReturnTarget || document.getElementById("alpha-btn"));
  });
});
document.getElementById("controls-btn").addEventListener("click", function () {
  openControlsPanel(this);
});
document.getElementById("pause-controls-btn").addEventListener("click", function () {
  openControlsPanel(this);
});
// Dev reset: drops both unlock flags back to a fresh install so the locked
// states can be tested without clearing site data by hand. Two-step on purpose
// -- one stray click on the menu should not throw away real progress -- and it
// only clears progress, not the audio mix, which is a preference.
const resetBtn = document.getElementById("reset-btn");
let resetArmTimer = null;

// Every label change goes through here, and every pending timer lives in the
// single `resetArmTimer` slot -- the confirmation flash used to schedule an
// untracked timeout, so a click during that flash re-armed the button and was
// then silently disarmed a moment later by the stale timer.
function setResetState(state, label) {
  clearTimeout(resetArmTimer);
  resetArmTimer = null;
  if (!resetBtn) return;
  resetBtn.classList.toggle("armed", state === "armed");
  resetBtn.classList.toggle("done", state === "done");
  setText(resetBtn, label);
}

function disarmReset() {
  setResetState("idle", "RESET");
}

function resetAllProgress() {
  try {
    localStorage.removeItem(MOON_UNLOCK_KEY);
    localStorage.removeItem(VENUS_UNLOCK_KEY);
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(SUPER_UNLOCK_KEY);
  } catch (error) {
    // Nothing was persisted, so the in-memory flags below are the whole reset.
  }
  moonRewardsUnlocked = false;
  venusRewardsUnlocked = false;
  unlockedSupers = new Set();
  persistUnlockedSupers();
  clearedWave = 0;
  devGodMode = false;
  devTimeScale = 1;
  rewardPreviousWeapon = "blaster";
  rewardPreviousColor = "#7ef9ff";
  if (selectedWeapon === "tech0" || selectedWeapon === "magma") selectedWeapon = "blaster";
  if (playerColor === GREY_SHIP_COLOR || playerColor === MAGMA_SHIP_COLOR) {
    setPlayerColor("#7ef9ff");
  }
  syncMoonRewardUI();
  syncVenusRewardUI();
  syncSuperLockUI();
  refreshLoadoutUI();
}

if (resetBtn) resetBtn.addEventListener("click", function () {
  if (!resetBtn.classList.contains("armed")) {
    setResetState("armed", "SURE?");
    playSound(300, 0.08, "square");
    resetArmTimer = setTimeout(disarmReset, 4000);
    return;
  }
  resetAllProgress();
  setResetState("done", "DONE \u2713");
  playSound(180, 0.16, "sawtooth");
  resetArmTimer = setTimeout(disarmReset, 1400);
});
document.querySelectorAll(".color-choice").forEach((choice) => choice.addEventListener("click", function () {
  if (choice.matches("[data-moon-locked]") && !moonRewardsUnlocked) {
    openLockPanel(choice);
    return;
  }
  if (choice.matches("[data-venus-locked]") && !venusRewardsUnlocked) {
    openLockPanel(choice);
    return;
  }
  setPlayerColor(choice.dataset.color);
  playSound(760, 0.07, "square");
}));
document.getElementById("controls-close").addEventListener("click", function () {
  closeMenuPanel(dom.controlsPanel, controlsReturnTarget || document.getElementById("controls-btn"));
});
document.getElementById("levels-btn").addEventListener("click", function () {
  openLevelsPanel(this);
});
document.getElementById("pause-levels-btn").addEventListener("click", function () {
  openLevelsPanel(this);
});
document.getElementById("levels-close").addEventListener("click", function () {
  closeMenuPanel(dom.levelsPanel, levelsReturnTarget || document.getElementById("levels-btn"));
});
document.getElementById("level-prev").addEventListener("click", () => flipLevelPage(-1));
document.getElementById("level-next").addEventListener("click", () => flipLevelPage(1));
// One delegated handler: the pages and their tiles are rebuilt on every flip.
document.getElementById("level-book").addEventListener("click", function (event) {
  const tile = event.target.closest(".level-tile");
  if (tile && !levelFlipping) startLevel(tile);
});
// The armory is the same panel wherever it is opened from — the menu, the reward
// card or the victory card — so closing it has to return focus to whichever
// button asked for it rather than always to the menu's.
let weaponsReturnTarget = null;
function openWeaponsPanel(trigger) {
  const panel = document.getElementById("weapons-panel");
  weaponsReturnTarget = trigger || document.getElementById("weapons-btn");
  bookPage = "primary"; bookPreview = selectedWeapon; renderWeaponBook();
  panel.classList.add("visible");
  panel.setAttribute("aria-hidden", "false");
  focusMenuDefault(panel);
}
document.getElementById("weapons-btn").addEventListener("click", function () {
  openWeaponsPanel(this);
});
document.getElementById("reward-armory").addEventListener("click", function () {
  openWeaponsPanel(this);
});
document.getElementById("victory-armory").addEventListener("click", function () {
  openWeaponsPanel(this);
});
document.getElementById("weapons-close").addEventListener("click", function () {
  closeMenuPanel(dom.weaponsPanel, weaponsReturnTarget || document.getElementById("weapons-btn"));
});
document.getElementById("moon-lock-close").addEventListener("click", function () {
  closeMenuPanel(dom.moonLockPanel, moonLockReturnTarget);
});
document.getElementById("primary-more-toggle").addEventListener("click", function () {
  setPrimaryGunsExpanded(this.getAttribute("aria-expanded") !== "true");
});

document.querySelectorAll("[data-audio-toggle]").forEach((toggle) => toggle.addEventListener("click", function () {
  const section = toggle.closest(".audio-controls");
  setAudioDrawer(section, !section.classList.contains("expanded"));
}));
document.querySelectorAll("[data-audio-control]").forEach((input) => input.addEventListener("input", function () {
  audioSettings[input.dataset.audioControl] = Number(input.value) / 100;
  applyAudioMix();
}));
document.querySelectorAll("[data-audio-control='sfx']").forEach((input) => input.addEventListener("change", function () {
  playSound(720, 0.06, "square");
}));
document.querySelectorAll("[data-audio-mute]").forEach((button) => button.addEventListener("click", function () {
  ensureAudio();
  audioSettings.muted = !audioSettings.muted;
  applyAudioMix();
  if (!audioSettings.muted) playSound(820, 0.08, "square");
}));
document.querySelectorAll(".weapon-tile[data-weapon]").forEach((tile) => tile.addEventListener("click", function () {
  if (tile.matches("[data-moon-locked]") && !moonRewardsUnlocked) {
    openLockPanel(tile);
    return;
  }
  if (tile.matches("[data-venus-locked]") && !venusRewardsUnlocked) {
    openLockPanel(tile);
    return;
  }
  setSelectedWeapon(tile.dataset.weapon);
}));
document.querySelectorAll(".weapon-tile[data-super]").forEach((tile) => tile.addEventListener("click", function () {
  if (superLocked(tile.dataset.super)) {
    openLockPanel(tile);
    return;
  }
  setSelectedSuper(tile.dataset.super);
}));

document.querySelectorAll("[data-victory-weapon]").forEach((tile) => tile.addEventListener("click", function () {
  if (tile.matches("[data-moon-locked]") && !moonRewardsUnlocked) {
    openLockPanel(tile);
    return;
  }
  if (tile.matches("[data-venus-locked]") && !venusRewardsUnlocked) {
    openLockPanel(tile);
    return;
  }
  setSelectedWeapon(tile.dataset.victoryWeapon);
}));
document.querySelectorAll("[data-victory-super]").forEach((tile) => tile.addEventListener("click", function () {
  setSelectedSuper(tile.dataset.victorySuper);
}));

// Dual analog touch sticks feed the same movement and firing paths used by the
// keyboard. Pointer capture keeps a drag alive even when a thumb leaves a pad.
function setupTouchStick(stick) {
  const kind = stick.dataset.touchStick;
  const pointerKey = kind === "move" ? "movePointer" : "aimPointer";

  function updateFromPointer(event) {
    const rect = stick.getBoundingClientRect();
    const maxTravel = rect.width * 0.31;
    const rawX = event.clientX - (rect.left + rect.width / 2);
    const rawY = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(rawX, rawY);
    const clamped = Math.min(maxTravel, distance);
    const normalX = distance ? rawX / distance : 0;
    const normalY = distance ? rawY / distance : 0;
    const rawStrength = clamped / maxTravel;
    const strength = rawStrength < 0.12 ? 0 : (rawStrength - 0.12) / 0.88;
    const inputX = normalX * strength;
    const inputY = normalY * strength;
    stick.style.setProperty("--stick-x", `${normalX * clamped}px`);
    stick.style.setProperty("--stick-y", `${normalY * clamped}px`);
    stick.classList.toggle("active", strength > 0);

    if (kind === "move") {
      touchControls.moveX = inputX;
      touchControls.moveY = inputY;
      return;
    }

    touchControls.aimX = inputX;
    touchControls.aimY = inputY;
    touchControls.aimHeld = strength > 0;
    if (!touchControls.aimHeld) return;
    const aimLength = Math.hypot(inputX, inputY) || 1;
    lastArrowDirection.x = inputX / aimLength;
    lastArrowDirection.y = inputY / aimLength;
    chargeDirection.x = lastArrowDirection.x;
    chargeDirection.y = lastArrowDirection.y;
    if (selectedWeapon === "charge") {
      if (!touchControls.chargeActive) {
        touchControls.chargeActive = true;
        chargeStartedAt = performance.now();
      }
    }
  }

  stick.addEventListener("pointerdown", function (event) {
    if (!gameActive || gamePaused || bossIntro || gameOverShown || touchControls[pointerKey] !== null) return;
    event.preventDefault();
    touchControls[pointerKey] = event.pointerId;
    try { stick.setPointerCapture(event.pointerId); } catch (error) { /* capture is optional */ }
    updateFromPointer(event);
  });
  stick.addEventListener("pointermove", function (event) {
    if (touchControls[pointerKey] !== event.pointerId) return;
    event.preventDefault();
    updateFromPointer(event);
  });

  function finishPointer(event, cancelled) {
    if (touchControls[pointerKey] !== event.pointerId) return;
    event.preventDefault();
    touchControls[pointerKey] = null;
    stick.classList.remove("active");
    stick.style.setProperty("--stick-x", "0px");
    stick.style.setProperty("--stick-y", "0px");
    if (kind === "move") {
      touchControls.moveX = 0;
      touchControls.moveY = 0;
      return;
    }
    const shotX = touchControls.aimX || lastArrowDirection.x;
    const shotY = touchControls.aimY || lastArrowDirection.y;
    touchControls.aimHeld = false;
    if (touchControls.chargeActive) {
      if (cancelled) chargeStartedAt = 0;
      else releaseChargeShot(shotX, shotY, false);
    }
    touchControls.chargeActive = false;
  }

  stick.addEventListener("pointerup", (event) => finishPointer(event, false));
  stick.addEventListener("pointercancel", (event) => finishPointer(event, true));
  stick.addEventListener("lostpointercapture", (event) => finishPointer(event, true));
  stick.addEventListener("contextmenu", (event) => event.preventDefault());
}

document.querySelectorAll("[data-touch-stick]").forEach(setupTouchStick);

function bindMobileAction(button, onPress, onRelease) {
  if (!button) return;
  let activePointer = null;
  button.addEventListener("pointerdown", function (event) {
    if (!gameActive || gamePaused || bossIntro || gameOverShown || activePointer !== null) return;
    event.preventDefault();
    activePointer = event.pointerId;
    button.classList.add("pressed");
    try { button.setPointerCapture(event.pointerId); } catch (error) { /* capture is optional */ }
    onPress();
  });
  const finish = function (event) {
    if (activePointer !== event.pointerId) return;
    event.preventDefault();
    activePointer = null;
    button.classList.remove("pressed");
    if (onRelease) onRelease();
  };
  button.addEventListener("pointerup", finish);
  button.addEventListener("pointercancel", finish);
  button.addEventListener("lostpointercapture", finish);
  button.addEventListener("contextmenu", (event) => event.preventDefault());
}

bindMobileAction(dom.mobileSuper, activateSuper);
bindMobileAction(dom.mobileShrink, function () { touchControls.shrinkHeld = true; }, function () { touchControls.shrinkHeld = false; });
dom.mobilePause.addEventListener("click", function () {
  if (gameActive && !bossIntro && !gameOverShown) setPaused(true);
});

window.addEventListener("keydown", function (e) {
  if (handleMenuKeydown(e)) return;
  keys[e.code] = true;
  if (isConfirmKey(e.code) && tryConfirmScreen(e.code)) {
    e.preventDefault();
    return;
  }
  if (e.code.startsWith("Arrow")) {
    const aim = currentAimVector();
    // remember the full vector, so releasing one half of a diagonal leaves the
    // ship pointing along the arrow that is still held rather than snapping
    if (aim.held) { lastArrowDirection.x = aim.x; lastArrowDirection.y = aim.y; }
  }
  if (gameActive && e.repeat === false && e.code.startsWith("Arrow")) {
    if (selectedWeapon === "charge") {
      const aim = currentAimVector();
      if (aim.held) { chargeDirection.x = aim.x; chargeDirection.y = aim.y; }
      if (!chargeStartedAt) chargeStartedAt = performance.now();
    } else {
      // Don't fire here — a diagonal is two separate keydowns, so firing on the
      // event shot once per axis. Just clear the cooldown; drawGame() fires on
      // the next frame using the combined direction.
      // Keep the remaining cooldown: tapping aim must not bypass weapon cadence.
    }
  }
  if (gameActive && e.code === "Escape") {
    e.preventDefault();
    if (!e.repeat && !bossIntro) setPaused(!gamePaused);
  }
  if (gameActive && e.code === "Space") {
    e.preventDefault();
    if (!e.repeat) spaceDownAt = performance.now();
  }
});

window.addEventListener("keyup", function (e) {
  keys[e.code] = false;
  if (e.code === "Space" && suppressSpaceRelease) {
    suppressSpaceRelease = false;
    return;
  }
  if (e.code === "Space" && performance.now() - spaceDownAt <= 180) activateSuper();
  if (e.code.startsWith("Arrow") && selectedWeapon === "charge" && chargeStartedAt) {
    // Fire along every arrow that was down at the instant of release, including
    // the one just released — otherwise letting go of a diagonal fired straight.
    const released = ARROW_VECTORS[e.code];
    const shotX = Math.max(-1, Math.min(1, (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0) + released[0]));
    const shotY = Math.max(-1, Math.min(1, (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0) + released[1]));
    const dirX = shotX || shotY ? shotX : chargeDirection.x;
    const dirY = shotX || shotY ? shotY : chargeDirection.y;
    const stillHeld = keys.ArrowLeft || keys.ArrowRight || keys.ArrowUp || keys.ArrowDown;
    releaseChargeShot(dirX, dirY, stillHeld);
  }
});
window.addEventListener("blur", function () {
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  resetTouchControls();
});
document.addEventListener("visibilitychange", function () {
  if (!document.hidden) return;
  Object.keys(keys).forEach((key) => { keys[key] = false; });
  resetTouchControls();
  if (gameActive && !bossIntro && !gameOverShown) setPaused(true);
});
// iOS Safari can still pinch-zoom and pull-to-refresh around touch-action, so
// kill the gestures that would tear the player out of a run. Menu panels keep
// scrolling: the guard only fires on the playfield itself.
document.addEventListener("gesturestart", (event) => event.preventDefault());
document.addEventListener("touchmove", function (event) {
  if (!gameActive || gamePaused) return;
  const target = event.target;
  if (target.closest && target.closest("#space-bg, .mobile-controls, .touch-stick, .mobile-action, .mobile-pause-btn")) {
    if (event.cancelable) event.preventDefault();
  }
}, { passive: false });
