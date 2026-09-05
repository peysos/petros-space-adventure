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
let adminInvincible = false;
let testMode = false;
let testDamage = 0;
let bossMode = false;
let bossIntro = false;
let playerName = "PLAYER";
let playerColor = "#7ef9ff";
const GREY_SHIP_COLOR = "#b9b9c0";
// What to fall back to when a reward is un-equipped from the reward screen.
let rewardPreviousWeapon = "blaster";
let rewardPreviousColor = "#7ef9ff";
const WEAPON_COLORS = { blaster: "#ffdc5a", charge: "#ff8a32", cone: "#63ff91", tech0: "#63f7ff" };
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
let bossKind = "mercury";
// Both fights run three phases, stepped at 2/3 and 1/3 health. The phase drives
// every timer in the fight, so "harder" is one number rather than a dozen
// scattered constants.
let bossPhase = 1;
let bossPhaseFlash = 0;
let bossMinions = [];
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
const MERCURY_UNLOCK_KEY = "petros-space-adventure-mercury-rewards";
const audioSettings = loadAudioSettings();
let mercuryRewardsUnlocked = loadMercuryRewards();

function loadMercuryRewards() {
  try {
    return localStorage.getItem(MERCURY_UNLOCK_KEY) === "unlocked";
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
  testDamage: document.getElementById("test-damage"),
  damageFlash: document.getElementById("damage-flash"),
  menu: document.getElementById("menu-wrap"),
  controlsPanel: document.getElementById("controls-panel"),
  changelogPanel: document.getElementById("changelog-panel"),
  weaponsPanel: document.getElementById("weapons-panel"),
  mercuryLockPanel: document.getElementById("mercury-lock-panel"),
  bossIntro: document.getElementById("boss-intro"),
  victoryScreen: document.getElementById("victory-screen"),
  mercuryDefeatScreen: document.getElementById("mercury-defeat-screen"),
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
  [bullets, enemyBullets, bossBullets, superBombs, bombBlasts, sparks, bossParticles, bossExplosions]
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
  if (dom.mercuryLockPanel.classList.contains("visible")) return dom.mercuryLockPanel;
  if (dom.weaponsPanel.classList.contains("visible")) return dom.weaponsPanel;
  if (dom.mercuryDefeatScreen.classList.contains("visible")) return dom.mercuryDefeatScreen;
  if (dom.victoryScreen.classList.contains("visible")) return dom.victoryScreen;
  if (dom.bossIntro.classList.contains("visible")) return dom.bossIntro;
  if (dom.weaponsPanel.classList.contains("visible")) return dom.weaponsPanel;
  if (dom.changelogPanel.classList.contains("visible")) return dom.changelogPanel;
  if (dom.controlsPanel.classList.contains("visible")) return dom.controlsPanel;
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
    : root.querySelector(".selected, #resume-btn, #try-again-btn, #defeat-retry, #continue-boss, #victory-continue");
  const target = preferred && isVisibleControl(preferred) ? preferred : menuFocusables(root)[0];
  if (target) target.focus();
}

function closeMenuPanel(panel, trigger) {
  panel.classList.remove("visible");
  panel.setAttribute("aria-hidden", "true");
  if (trigger) trigger.focus();
}

let controlsReturnTarget = null;
let mercuryLockReturnTarget = null;

function openControlsPanel(trigger) {
  controlsReturnTarget = trigger;
  dom.controlsPanel.classList.add("visible");
  dom.controlsPanel.setAttribute("aria-hidden", "false");
  focusMenuDefault(dom.controlsPanel);
}

function openMercuryLockPanel(trigger) {
  mercuryLockReturnTarget = trigger;
  dom.mercuryLockPanel.classList.add("visible");
  dom.mercuryLockPanel.setAttribute("aria-hidden", "false");
  focusMenuDefault(dom.mercuryLockPanel);
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
    if (dom.mercuryLockPanel.classList.contains("visible")) {
      event.preventDefault();
      closeMenuPanel(dom.mercuryLockPanel, mercuryLockReturnTarget);
      return true;
    }
    if (dom.weaponsPanel.classList.contains("visible")) {
      event.preventDefault();
      closeMenuPanel(dom.weaponsPanel, dom.victoryScreen.classList.contains("visible") ? document.getElementById("victory-continue") : document.getElementById("weapons-btn"));
      return true;
    }
    if (dom.controlsPanel.classList.contains("visible")) {
      event.preventDefault();
      closeMenuPanel(dom.controlsPanel, controlsReturnTarget || document.getElementById("controls-btn"));
      return true;
    }
    if (dom.changelogPanel.classList.contains("visible")) {
      event.preventDefault();
      closeMenuPanel(dom.changelogPanel, document.getElementById("changelog-btn"));
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
  if (dom.changelogPanel.classList.contains("visible") && (event.code === "ArrowUp" || event.code === "ArrowDown")) {
    event.preventDefault();
    const history = dom.changelogPanel.querySelector(".changelog-history");
    if (history) history.scrollBy({ top: event.code === "ArrowDown" ? 80 : -80, behavior: "smooth" });
    return true;
  }
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
  stepAccumulator += Math.min(now - lastFrameTime, STEP_MS * MAX_CATCHUP_STEPS);
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
  // drawBossArea/drawTestRoom fill every pixel themselves, so clearing to black
  // first is a second full-screen fill for nothing — the priciest kind of no-op.
  const arenaRepaints = gameActive && !gamePaused && !bossIntro && (bossMode || testMode);
  if (!arenaRepaints) {
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, W, H);
  } else if (screenShakeFrames > 0) {
    // Prepaint the arena colour so a translated hit frame never exposes stale
    // pixels along the viewport edge.
    ctx.fillStyle = bossMode ? "#16051f" : "#07131a";
    ctx.fillRect(0, 0, W, H);
  }
  centerX = W / 2;
  centerY = H / 2;
  if (!gameActive) drawStaticStars(t);
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
  updateChargeMeter();
  setText(dom.waveNumber, String(wave));
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
  if (wave < 6 || bossMode || testMode) return;
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
    playSound(48, 0.34, "sawtooth");
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
  5: "FINAL WAVE BEFORE MERCURY",
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
  } else if (testMode) {
    pushSuperTarget(W / 2, 190, 58, null, "dummy");
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
  } else {
    testDamage += amount;
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
  if (!bossMode && !testMode) {
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
    if (!adminInvincible && playerInvulnerable === 0 && Math.abs(bullet.x - player.x) < hitWidth && Math.abs(bullet.y - player.y) < hitHeight) {
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
        playSound(240, 0.09, "sawtooth");
        playSound(1240, 0.05, "square");
        spawnSparks(player.x + facing.x * 22, player.y + facing.y * 22, 6, WEAPON_COLORS.tech0,
          { minSpeed: 1, maxSpeed: 3.4, life: 16, maxSize: 3 });
      }
    }
  }

  if (bossIntro) return;
  if (playerInvulnerable > 0) playerInvulnerable--;
  if (invincibilitySuperTimer > 0) invincibilitySuperTimer--;
  if (bossMode) { drawBossArea(t); return; }
  if (testMode) { drawTestRoom(); return; }
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
    if (!adminInvincible && playerInvulnerable === 0 && Math.abs(player.x - enemy.x) < enemy.w + playerHitbox && Math.abs(player.y - ey) < enemy.h + playerHitbox) {
      hurtPlayer();
      if (!gameActive) return;
    }

    for (const bullet of bullets) {
      if (Math.abs(bullet.x - enemy.x) < enemy.w + 4 && Math.abs(bullet.y - ey) < enemy.h + 6) {
        const hitX = enemy.x;
        const hitY = ey;
        damageEnemy(enemy, bullet.damage || 1);
        if (bullet.type === "tech0") {
          bullet.y = -100;
          startTechChain(enemy, hitX, hitY);
        } else if (bullet.pierceRemaining !== Infinity) {
          bullet.pierceRemaining--;
          if (bullet.pierceRemaining <= 0) bullet.y = -100;
        }
        break;
      }
    }
    if (superBeam) damageAlongBeam(enemy, ey);
  }
  updateTechChains(t);
  let anyAlive = false;
  for (const enemy of enemies) if (enemy.alive) { anyAlive = true; break; }
  if (!anyAlive) {
    bullets = [];
    techChains = [];
    enemyBullets = [];
    if (wave === 5) { enterBossArea("mercury"); return; }
    if (wave === 9) { wave = 10; setText(dom.waveNumber, "10"); enterBossArea("venus"); return; }
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

function enterBossArea(kind = "mercury") {
  bossKind = kind;
  bossMode = false;
  bossIntro = true;
  bossDefeated = false;
  boss = { x: W / 2, y: bossSpawnY(), health: bossMaxHealth() };
  resetBossAnimation();
  setText(document.getElementById("boss-health-name"), bossLabel());
  setText(document.getElementById("boss-intro-name"), bossLabel());
  bossShotTimer = 64;
  bossAttackTimer = 150;
  bossBullets = [];
  techChains = [];
  document.getElementById("boss-health").classList.add("visible");
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
  document.getElementById("boss-intro").classList.add("visible");
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
const PHASE_RATE = [1, 0.76, 0.56];        // timer multiplier per phase
const MINION_CAP = 7;

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
      : ["#ffffff", "#ffdc5a", "#c9c9c9", "#6f6f6f"],
    gravity: 0.04, drag: 0.98,
  });
  bossHitFlash = BOSS_HIT_FRAMES;   // Mercury has no phase art of its own; the damage flash carries it
  playSound(58, 0.9, "sawtooth");
  playSound(190, 0.3, "square");
  showWaveBanner(bossLabel(), bossPhase === 3 ? "FINAL PHASE" : `PHASE ${bossPhase}`);
  if (bossKind === "mercury") {
    // the shell cracking is what throws the first brood out
    for (let i = 0; i < bossPhase; i++) spawnBossMinion(rand(0, Math.PI * 2));
    bossMinionTimer = 90;
  }
  return true;
}

function spawnBossMinion(angle) {
  if (bossMinions.length >= MINION_CAP) return;
  const dist = BOSS_RADIUS * 0.9;
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
    if (!adminInvincible && playerInvulnerable === 0 && Math.abs(m.x - player.x) < hitWidth && Math.abs(m.y - player.y) < hitHeight) {
      hurtPlayer();
      m.health = 0;
      if (!gameActive) return;
    }
    for (const bullet of bullets) {
      if (bullet.y < -50) continue;
      if (Math.abs(bullet.x - m.x) < 16 && Math.abs(bullet.y - m.y) < 16) {
        m.health -= bullet.damage || 1;
        m.hitFlash = 6;
        superDamage += bullet.damage || 1;
        updateSuperMeter();
        if (bullet.type === "tech0") startTechChainBoss(m.x, m.y, m);
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
      dist: BOSS_RADIUS * rand(1.12, 1.5),
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
  document.getElementById("boss-intro").classList.remove("visible");
  syncMobileControls();
  music.play(bossKind === "venus" ? "venusBoss" : "boss");
  showWaveBanner(bossLabel(), bossKind === "venus" ? "SURVIVE THE FURNACE" : "DESTROY THE PLANET");
}

const BOSS_MAX_HEALTH = 110;
const BOSS_RADIUS = 78;
// Venus is the second boss: bigger, tougher, and with attacks that cover the
// arena instead of aiming a line at the ship.
const VENUS_MAX_HEALTH = 210;
const VENUS_RADIUS = 96;

function bossRadius() { return bossKind === "venus" ? VENUS_RADIUS : BOSS_RADIUS; }
function bossMaxHealth() { return bossKind === "venus" ? VENUS_MAX_HEALTH : BOSS_MAX_HEALTH; }
function bossLabel() { return bossKind === "venus" ? "VENUS" : "MERCURY"; }
const BOSS_HIT_FRAMES = 12;
const BOSS_SHOOT_FRAMES = 20;
const BOSS_CHARGE_FRAMES = 26;
const BOSS_DEATH_FRAMES = 175;
const BROW_SIDES = [-1, 1];

// Mercury's gradients: the body and terminator are fixed in the planet's local
// space, the corona varies only with its radius and colour.
let bodyGradient = null;
let shadeGradient = null;
let auraGradient = null;
let auraGradientRadius = 0;
let auraGradientColor = "";

// Fixed surface features, so Mercury reads as the same rock every frame while
// the whole crater field rotates slowly under the clip.
const BOSS_CRATERS = [
  { a: 0.4, d: 0.42, r: 13 }, { a: 1.7, d: 0.62, r: 9 }, { a: 2.6, d: 0.3, r: 16 },
  { a: 3.5, d: 0.7, r: 7 }, { a: 4.3, d: 0.5, r: 11 }, { a: 5.2, d: 0.28, r: 8 },
  { a: 5.9, d: 0.68, r: 12 }, { a: 2.1, d: 0.85, r: 6 }, { a: 4.9, d: 0.86, r: 5 },
];
// Crack seeds in unit space; revealed progressively as Mercury loses health.
const BOSS_CRACKS = [
  [[-0.97, -0.05], [-0.78, -0.26], [-0.66, -0.55], [-0.42, -0.72]],
  [[-0.9, 0.28], [-0.66, 0.46], [-0.38, 0.68], [-0.06, 0.84]],
  [[0.95, -0.14], [0.76, -0.34], [0.64, -0.6], [0.4, -0.78]],
  [[0.9, 0.26], [0.66, 0.47], [0.42, 0.7], [0.12, 0.86]],
  [[-0.3, 0.9], [-0.02, 0.74], [0.26, 0.88], [0.5, 0.7]],
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
    ctx.globalAlpha = fade * 0.55;
    ctx.fillStyle = progress < 0.4 ? "#fff3c4" : "#ff8a32";
    ctx.beginPath(); ctx.arc(boom.x, boom.y, radius * 0.72, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = fade;
    ctx.strokeStyle = "#ffdc5a";
    ctx.lineWidth = 4 * fade + 1;
    ctx.beginPath(); ctx.arc(boom.x, boom.y, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  compact(bossExplosions, (boom) => boom.life > 0);
}

// Mercury takes a hit: flash, recoil, and spit rock chips back along the shot.
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
    const dist = rand(0, BOSS_RADIUS * 0.85);
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
  bossDying = false;
  bossMode = false;
  document.getElementById("boss-health").classList.remove("visible");
  bullets = [];
  bossBullets = [];
  enemyBullets = [];
  venusBolts = [];
  bossMinions = [];
  clearSuperEntities();
  lives++;
  setLives(lives, true);
  if (bossKind === "venus") {
    // Venus has no reward screen of its own yet — the run simply carries on
    // into the waves past the furnace with the extra heart already granted.
    bossKind = "mercury";
    bossDefeated = true;
    wave = 11;
    player.x = W / 2; player.y = playerStartY(); player.vx = 0; player.vy = 0;
    music.play("battle");
    createEnemies();
    showWaveBanner("VENUS DESTROYED", "+1 HEART");
    announceWave(11, 1800);
    return;
  }
  wave = 6;
  if (!bossDefeated) {
    bossDefeated = true;
    showVictory();
  }
}

function drawMercury(t) {
  const deathProgress = bossDying ? 1 - Math.max(0, bossDeathTimer) / BOSS_DEATH_FRAMES : 0;
  // the planet is gone once the big blast lands
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
  const damage = 1 - Math.max(0, boss.health) / BOSS_MAX_HEALTH;

  const bob = Math.sin(t * 0.0016) * 7;
  const cx = boss.x + shakeX;
  const cy = boss.y + bob + shakeY;
  const R = BOSS_RADIUS;

  // squash/stretch: inhale on the wind-up, snap outward on the shot
  const squashX = 1 + shoot * 0.13 - charge * 0.09 - hit * 0.05;
  const squashY = 1 - shoot * 0.11 + charge * 0.11 + hit * 0.05;
  const scale = (1 + deathProgress * 0.12) * (1 - hit * 0.03);
  // hold full opacity while it cracks apart, then blow out over ~10 frames
  const fadeStart = 0.68;
  const alpha = bossDying && deathProgress > fadeStart
    ? Math.max(0, 1 - (deathProgress - fadeStart) / 0.06)
    : 1;

  bossSpin += 0.0016 + charge * 0.01;

  ctx.save();
  ctx.globalAlpha = alpha;

  // Corona — reddens and swells while charging a shot. Built around the origin
  // and translated into place so the same gradient survives the shake/bob jitter,
  // and rebuilt only when its radius or colour actually changes.
  const auraRadius = R * (1.28 + charge * 0.22 + shoot * 0.3);
  const auraColor = charge > 0.05
    ? `rgba(255, ${Math.round(120 - charge * 70)}, 90, ${(0.16 + charge * 0.3).toFixed(2)})`
    : "rgba(190, 150, 255, 0.16)";
  ctx.translate(cx, cy);
  if (!auraGradient || auraGradientRadius !== auraRadius || auraGradientColor !== auraColor) {
    auraGradient = ctx.createRadialGradient(0, 0, R * 0.75, 0, 0, auraRadius);
    auraGradient.addColorStop(0, auraColor);
    auraGradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    auraGradientRadius = auraRadius;
    auraGradientColor = auraColor;
  }
  ctx.fillStyle = auraGradient;
  ctx.beginPath(); ctx.arc(0, 0, auraRadius, 0, Math.PI * 2); ctx.fill();

  // leans toward the player, harder while winding up a shot
  const lean = Math.max(-1, Math.min(1, (player.x - boss.x) / (W * 0.4)));
  ctx.rotate(lean * (0.05 + charge * 0.09));
  ctx.scale(scale * squashX, scale * squashY);

  // --- debris that has been knocked off, behind the planet ----------------
  for (const shard of bossShards) {
    shard.angle += shard.speed;
    shard.spin += shard.spinSpeed;
  }
  drawBossShards(false);

  // --- body ---------------------------------------------------------------
  // The body and terminator gradients are in the planet's own coordinate space,
  // so they never change; building them once beats rebuilding two per frame.
  if (!bodyGradient) {
    bodyGradient = ctx.createRadialGradient(-R * 0.34, -R * 0.38, R * 0.12, 0, 0, R);
    bodyGradient.addColorStop(0, "#f2efe9");
    bodyGradient.addColorStop(0.42, "#b8b4ad");
    bodyGradient.addColorStop(0.78, "#78746f");
    bodyGradient.addColorStop(1, "#2e2c2b");
    shadeGradient = ctx.createLinearGradient(R * 0.1, -R, R, R);
    shadeGradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    shadeGradient.addColorStop(1, "rgba(0, 0, 0, 0.6)");
  }
  ctx.fillStyle = bodyGradient;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();

  // Craters, terminator and cracks all clip to the same disc. Clipping is one of
  // the priciest canvas calls, so set it once and draw all three inside it.
  const crackCount = Math.floor(damage * BOSS_CRACKS.length + (bossDying ? BOSS_CRACKS.length : 0));
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();

  // craters, slowly rotating
  ctx.save();
  ctx.rotate(bossSpin);
  for (const crater of BOSS_CRATERS) {
    const x = Math.cos(crater.a) * crater.d * R;
    const y = Math.sin(crater.a) * crater.d * R;
    ctx.fillStyle = "rgba(40, 38, 37, 0.32)";
    ctx.beginPath(); ctx.arc(x, y, crater.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
    ctx.beginPath(); ctx.arc(x - crater.r * 0.28, y - crater.r * 0.3, crater.r * 0.62, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // terminator shadow
  ctx.fillStyle = shadeGradient;
  ctx.fillRect(-R, -R, R * 2, R * 2);

  // --- battle damage: cracks open up as the health bar drains -------------
  if (crackCount > 0) {
    // Molten seams: a dark fissure with a hot core and a bloom either side, all
    // pulsing together, so the planet looks lit from inside rather than drawn on.
    const pulse = bossDying ? 1 : 0.55 + Math.sin(t * 0.006) * 0.25;
    const shown = Math.min(crackCount, BOSS_CRACKS.length);
    for (let pass = 0; pass < 3; pass++) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (pass === 0) {
        ctx.strokeStyle = `rgba(255, 90, 20, ${(0.2 * pulse).toFixed(3)})`;
        ctx.lineWidth = (bossDying ? 18 : 10) * pulse;
      } else if (pass === 1) {
        ctx.strokeStyle = `rgba(255, ${bossDying ? 210 : 160}, 70, ${(0.85 * pulse).toFixed(3)})`;
        ctx.lineWidth = bossDying ? 7 : 4;
      } else {
        ctx.strokeStyle = "rgba(255, 250, 225, 0.9)";
        ctx.lineWidth = bossDying ? 2.6 : 1.5;
      }
      for (let i = 0; i < shown; i++) {
        const path = BOSS_CRACKS[i];
        ctx.beginPath();
        for (let n = 0; n < path.length; n++) {
          const x = path[n][0] * R;
          const y = path[n][1] * R;
          if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // branches, so the fissures fork instead of running as single lines
        if (pass === 1 && path.length > 2) {
          const mid = path[1];
          ctx.beginPath();
          ctx.moveTo(mid[0] * R, mid[1] * R);
          ctx.lineTo(mid[0] * R + (i % 2 ? 26 : -26), mid[1] * R + 20);
          ctx.stroke();
        }
      }
    }
  }
  ctx.restore();

  // rim light
  ctx.strokeStyle = "rgba(255, 246, 220, 0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, R - 1, Math.PI * 0.9, Math.PI * 1.75); ctx.stroke();

  // --- face ---------------------------------------------------------------
  const angry = 0.35 + damage * .45 + charge * 0.55;
  const eyeGlow = charge > 0.05 ? "#ff5a3c" : hit > 0 ? "#fff3b0" : "#ff4f91";
  const eyeRadius = (9 + charge * 4 + shoot * 2.5) * (hit > 0 ? 0.7 : 1);

  ctx.fillStyle = "#171717";
  BROW_SIDES.forEach((side) => {
    ctx.save();
    ctx.translate(side * 27, -20);
    ctx.rotate(side * angry * 0.55 + Math.sin(t * .003 + side) * .035);
    ctx.beginPath();
    ctx.moveTo(-23, -9); ctx.lineTo(20, -19); ctx.lineTo(22, -7); ctx.lineTo(-22, 4);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  });

  // blink on its own clock — the cheapest trick there is for making a face
  // look like something is behind it
  if (!bossDying) {
    if (bossBlink > 0) bossBlink--;
    else if (--bossBlinkTimer <= 0) {
      bossBlink = 8;
      bossBlinkTimer = 170 + Math.floor(Math.random() * 240);
    }
  }
  const shut = hit > 0.05 || bossBlink > 0;

  if (bossDying) {
    ctx.strokeStyle = "#21151d"; ctx.lineWidth = 6; ctx.lineCap = "round";
    for (const side of BROW_SIDES) {
      ctx.beginPath();
      ctx.moveTo(side * 27 - 8, -22); ctx.lineTo(side * 27 + 8, -6);
      ctx.moveTo(side * 27 + 8, -22); ctx.lineTo(side * 27 - 8, -6);
      ctx.stroke();
    }
  } else if (shut) {
    ctx.strokeStyle = hit > 0.05 ? eyeGlow : "#171717";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    BROW_SIDES.forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * 27 - 10, -15);
      ctx.lineTo(side * 27, -10 - hit * 5);
      ctx.lineTo(side * 27 + 10, -15);
      ctx.stroke();
    });
  } else {
    // pupils track the ship
    const toPlayer = Math.atan2(player.y - boss.y, player.x - boss.x);
    const look = Math.min(1, Math.hypot(player.x - boss.x, player.y - boss.y) / 260);
    const lookX = Math.cos(toPlayer) * eyeRadius * 0.36 * look;
    const lookY = Math.sin(toPlayer) * eyeRadius * 0.36 * look;
    const eyeGlowRadius = Math.round(16 + charge * 18);
    drawGlow(eyeGlow, eyeGlowRadius, -27, -14);
    drawGlow(eyeGlow, eyeGlowRadius, 27, -14);
    ctx.fillStyle = "#f6f1ea";
    ctx.beginPath();
    ctx.arc(-27, -14, eyeRadius, 0, Math.PI * 2);
    ctx.arc(27, -14, eyeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = eyeGlow;
    ctx.beginPath();
    ctx.arc(-27 + lookX, -14 + lookY, eyeRadius * 0.6, 0, Math.PI * 2);
    ctx.arc(27 + lookX, -14 + lookY, eyeRadius * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#170606";
    ctx.beginPath();
    ctx.arc(-27 + lookX, -14 + lookY, eyeRadius * 0.27, 0, Math.PI * 2);
    ctx.arc(27 + lookX, -14 + lookY, eyeRadius * 0.27, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.beginPath();
    ctx.arc(-31 + lookX, -18 + lookY, eyeRadius * 0.22, 0, Math.PI * 2);
    ctx.arc(23 + lookX, -18 + lookY, eyeRadius * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mouth has three explicit poses: a clean frown, clenched charge-up, then a
  // dark open mouth with upper/lower teeth and a muzzle flash at shot release.
  const mouthY = 35 + Math.sin(t * .0025) * 1.4;
  if (bossDying) {
    ctx.fillStyle = "#21151d";
    ctx.beginPath(); ctx.ellipse(0, mouthY, 16, 19, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#bd7085";
    ctx.beginPath(); ctx.ellipse(4, mouthY + 14, 8, 13, -.12, 0, Math.PI * 2); ctx.fill();
  } else if (hit > .08) {
    ctx.strokeStyle = "#21151d"; ctx.lineWidth = 5; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-19, mouthY + 3); ctx.quadraticCurveTo(-4, mouthY - 12, 18, mouthY); ctx.stroke();
  } else if (shoot > 0.04) {
    const mouthOpen = 9 + shoot * 14;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, mouthY, 20 + shoot * 6, mouthOpen, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#16080a";
    ctx.beginPath();
    ctx.ellipse(0, mouthY, 20 + shoot * 6, mouthOpen, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.28 + shoot * 0.48;
    ctx.fillStyle = "#ff6a2c";
    ctx.beginPath();
    ctx.ellipse(0, mouthY + mouthOpen * 0.28, 10 + shoot * 4, 5 + shoot * 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#f4ead8";
    const top = mouthY - mouthOpen * 0.78;
    const bottom = mouthY + mouthOpen * 0.78;
    const tooth = Math.min(7, mouthOpen * 0.34);
    for (let i = -2; i <= 2; i++) {
      const x = i * 8;
      ctx.beginPath();
      ctx.moveTo(x - 3.3, top); ctx.lineTo(x + 3.3, top); ctx.lineTo(x, top + tooth);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 3.3, bottom); ctx.lineTo(x + 3.3, bottom); ctx.lineTo(x, bottom - tooth);
      ctx.closePath(); ctx.fill();
    }
    if (shoot > 0.62) {
      drawGlow("#ff8a32", 18, 0, mouthY + mouthOpen * 0.45);
      ctx.fillStyle = "#fff2c9";
      ctx.beginPath(); ctx.arc(0, mouthY + mouthOpen * 0.45, 4 + shoot * 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  } else if (charge > 0.05) {
    const clench = 5 + charge * 2;
    ctx.save();
    ctx.beginPath(); ctx.ellipse(0, mouthY, 23, clench + 2, 0, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#171719";
    ctx.beginPath(); ctx.ellipse(0, mouthY, 23, clench + 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f2eee5";
    ctx.fillRect(-20, mouthY - clench, 40, clench * 2);
    ctx.strokeStyle = "#77736d";
    ctx.lineWidth = 1.5;
    for (let x = -12; x <= 12; x += 8) {
      ctx.beginPath(); ctx.moveTo(x, mouthY - clench); ctx.lineTo(x, mouthY + clench); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(-20, mouthY); ctx.lineTo(20, mouthY); ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle = "#171717";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 44, 28, Math.PI + 0.32, Math.PI * 2 - 0.32);
    ctx.stroke();
  }

  // --- hit flash overlay --------------------------------------------------
  if (hit > 0) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255, 255, 255, ${hit * 0.5})`;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  // --- debris passing in front -------------------------------------------
  drawBossShards(true);

  ctx.restore();

  if (bossHitFlash > 0) bossHitFlash--;
  if (bossShootAnim > 0) bossShootAnim--;
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
  const crackCount = Math.floor(damage * BOSS_CRACKS.length + (bossDying ? BOSS_CRACKS.length : 0));
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
      for (let i = 0; i < Math.min(crackCount, BOSS_CRACKS.length); i++) {
        const seed = BOSS_CRACKS[i];
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
const VENUS_ORB_CAP = 130;

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
  // dive and storm are the two that most want breathing room, so they are never
  // the immediate follow-up inside a chain
  const pool = venusChain > 0
    ? VENUS_ATTACKS.filter((a) => a !== "dive" && a !== "storm" && a !== venusLastAttack)
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
    const sheets = brutal ? 5 : hard ? 4 : 3;
    let dir = Math.random() < 0.5 ? 1 : -1;
    let gapLane = Math.floor(Math.random() * columns);
    const speed = brutal ? 4.3 : hard ? 3.9 : 3.4;
    for (let sheet = 0; sheet < sheets; sheet++) {
      const lane0 = gapLane;
      for (let lane = 0; lane < columns; lane++) {
        if (lane === lane0 || lane === (lane0 + 1) % columns) continue;
        const x = step * (lane + 0.5);
        queueVenusShot(1 + sheet * (brutal ? 28 : 34) + lane * 2, () => fireVenusShot(x, -20, Math.PI / 2, speed, "venus-dart"));
      }
      if (Math.random() < 0.3) dir = -dir;      // the gap can double back
      gapLane = ((gapLane + dir) % columns + columns) % columns;
    }
    venusAttackTimer = sheets * (brutal ? 28 : 34) + 70;
    playSound(320, 0.5, "sawtooth");
    return;
  }

  if (venusAttack === "spiral") {
    // Retrograde spiral winding backwards, matching the planet's own rotation.
    // It reverses direction partway through in the later phases.
    const ticks = brutal ? 28 : hard ? 24 : 20;
    const arms = brutal ? 3 : hard ? 3 : 2;
    const flipAt = brutal ? Math.floor(ticks * 0.55) : -1;
    let dir = -1;
    for (let i = 0; i < ticks; i++) {
      const flip = i === flipAt;
      queueVenusShot(1 + i * 5, () => {
        if (flip) { dir = 1; playSound(240, 0.14, "triangle"); }
        for (let arm = 0; arm < arms; arm++) {
          pushVenusOrb(venusRotation + arm * (Math.PI * 2 / arms), 3.1, 7);
        }
        venusRotation += dir * 0.22;
      });
    }
    venusAttackTimer = ticks * 5 + 34;
    playSound(150, 0.4, "triangle");
    return;
  }

  if (venusAttack === "storm") {
    // Cloud-deck lightning. The warning is shorter each phase, and the last two
    // columns lead the ship rather than marking where it already is.
    const count = brutal ? 6 : hard ? 4 : 3;
    const warn = brutal ? 30 : hard ? 38 : VENUS_BOLT_WARN;
    for (let i = 0; i < count; i++) {
      const lead = i >= count - 2;
      queueVenusShot(1 + i * (brutal ? 15 : 22), () => {
        const x = lead ? player.x + player.vx * (warn * 0.55) : rand(70, W - 70);
        venusBolts.push({ x: Math.max(30, Math.min(W - 30, x)), warn, strike: 0 });
        playSound(700 + i * 90, 0.08, "square");
      });
    }
    venusAttackTimer = count * (brutal ? 15 : 22) + warn + VENUS_BOLT_STRIKE + 24;
    return;
  }

  if (venusAttack === "sweep") {
    // A searchlight of heat orbs: a narrow fan that swings across the arena and
    // back. Unlike the ring there is no gap to find — the answer is to be behind
    // the sweep, which means committing to a direction early.
    const ticks = brutal ? 34 : hard ? 30 : 26;
    const spread = brutal ? 3 : hard ? 3 : 2;
    const start = Math.atan2(player.y - boss.y, player.x - boss.x) - 0.9;
    const swing = 1.8 / ticks;
    let dir = 1;
    for (let i = 0; i < ticks; i++) {
      const back = brutal && i === Math.floor(ticks * 0.6);
      queueVenusShot(1 + i * 4, () => {
        if (back) dir = -1;
        for (let k = 0; k < spread; k++) {
          pushVenusOrb(venusRotation + (k - (spread - 1) / 2) * 0.13, 3.4, 6);
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
    const count = brutal ? 5 : hard ? 4 : 3;
    const gap = brutal ? 16 : 22;
    for (let i = 0; i < count; i++) {
      queueVenusShot(1 + i * gap, () => {
        const angle = Math.atan2(aimTargetY() - boss.y, aimTargetX() - boss.x) + rand(-0.55, 0.55);
        const speed = brutal ? 3.5 : 3.1;
        enemyBullets.push({
          x: boss.x, y: boss.y,
          vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
          speed,
          turnRate: brutal ? 0.038 : hard ? 0.031 : 0.025,
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
  const rings = brutal ? 3 : hard ? 2 : 1;
  for (let ring = 0; ring < rings; ring++) {
    queueVenusShot(1 + ring * 48, () => {
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
  venusAttackTimer = rings * 48 + 74;
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
    boss.y += (playableBottomY() - 40 - boss.y) * 0.19;
    bossChargeAnim = 0;
    if (Math.random() < 0.6) {
      spawnSparks(boss.x + rand(-VENUS_RADIUS, VENUS_RADIUS), boss.y, 1, "#ffb457",
        { minSpeed: 1, maxSpeed: 3, life: 20, gravity: -0.04 });
    }
    if (boss.y > playableBottomY() - 80 || venusDive.timer <= 0) {
      // slam: two fronts along the floor plus a hard shake
      for (const side of [-1, 1]) {
        for (let i = 0; i < 6; i++) {
          bossBullets.push({
            x: boss.x, y: boss.y + VENUS_RADIUS * 0.5,
            vx: side * (2.6 + i * 0.55), vy: -0.5 - i * 0.16,
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
    if (!adminInvincible && playerInvulnerable === 0 && Math.abs(player.x - bolt.x) < VENUS_BOLT_HALF_WIDTH + (player.shrunk ? 6 : 12)) {
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
  // chain length grows with the phase: none in 1, up to 2 in 2, and the final
  // phase always chains — it never gives a single-pattern breather again
  venusChain = bossPhase === 1 ? 0
    : bossPhase === 2 ? Math.floor(Math.random() * 3)
    : 1 + Math.floor(Math.random() * 3);
  startVenusAttack();
}

function venusRestFrames() {
  // The rest shrinks with every pattern it has thrown and with the phase, and
  // the floor drops in the final third so the fight keeps tightening.
  const floor = bossPhase >= 3 ? 12 : 20;
  return Math.max(floor, Math.round((78 - venusStep * 3) * phaseRate()));
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

function pushBossOrb(angle, speed) {
  bossBullets.push({
    x: boss.x,
    y: boss.y + 60,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
  });
}

function drawBossArea(t) {
  const venus = bossKind === "venus";
  ctx.fillStyle = venus ? "#2a0d05" : "#16051f"; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bossGridLayer, 0, 0);
  ctx.restore();

  if (bossDying) updateBossDeath();
  if (!bossDying) updateBossPhase();
  if (venus) drawVenus(t); else drawMercury(t);
  updateBossExplosions();
  updateBossParticles();
  updateSparks();

  // TECHNOLOGY burns the boss for as long as the beam is on it
  if (superBeam && !bossDying && superBeam.life % BEAM_TICK === 0 && beamDistance(boss.x, boss.y) < BEAM_HALF_WIDTH + bossRadius() * 0.8) {
    damageBoss(3, player.x, player.y);
    superDamage += 3;
    spawnSparks(boss.x, boss.y, 8, superBeam.color || superColor("lance"), { life: 20 });
  }

  if (!bossDying && venus) {
    updateVenusBoss(t);
  }

  if (!bossDying && !venus) {
    const rate = phaseRate();
    // Mercury sweeps the arena and leans toward the player. A stationary boss is
    // what made "stand here and never get hit" possible in the first place, and
    // it sweeps harder each phase.
    bossDrift += 0.0048 / rate;
    const range = Math.min(220 + bossPhase * 30, W * 0.24);
    const target = W / 2 + Math.sin(bossDrift) * range + (player.x - W / 2) * (0.28 + bossPhase * 0.05);
    boss.x += (target - boss.x) * 0.022;
    boss.x = Math.max(120, Math.min(W - 120, boss.x));

    // From phase 2 it keeps throwing chips of itself at the ship.
    if (bossPhase >= 2 && --bossMinionTimer <= 0) {
      const batch = bossPhase >= 3 ? 3 : 2;
      for (let i = 0; i < batch; i++) spawnBossMinion(rand(0, Math.PI * 2));
      bossMinionTimer = Math.round((bossPhase >= 3 ? 250 : 360) + rand(-40, 60));
    }

    // molten embers rise off the cracks once it is properly hurt
    if (bossDamageStage >= 2 && Math.random() < 0.4) {
      const a = rand(0, Math.PI * 2);
      spawnSparks(boss.x + Math.cos(a) * BOSS_RADIUS * 0.7, boss.y + Math.sin(a) * BOSS_RADIUS * 0.7,
        1, Math.random() < 0.5 ? "#ff6a20" : "#ffd65a",
        { minSpeed: 0.2, maxSpeed: 0.9, life: 40, drag: 0.98, gravity: -0.02 });
    }

    // radial burst: rare, slow, easy to walk out of — but it sweeps the arena,
    // so there is no corner that is safe forever
    bossBurstTimer--;
    if (bossBurstTimer === 40) {
      bossChargeAnim = BOSS_CHARGE_FRAMES;
      playSound(60, 0.4, "triangle");
    }
    if (bossBurstTimer <= 0) {
      const count = Math.round(rand(7, 11));
      const phase = rand(0, Math.PI * 2);
      for (let i = 0; i < count; i++) {
        const a = phase + (i / count) * Math.PI * 2 + rand(-0.045, 0.045);
        bossBullets.push({ x: boss.x, y: boss.y, vx: Math.cos(a) * 2.4, vy: Math.sin(a) * 2.4 });
      }
      bossShootAnim = BOSS_SHOOT_FRAMES;
      bossShakeTimer = Math.max(bossShakeTimer, 10);
      bossExplosions.push({ x: boss.x, y: boss.y, r: 0, max: 150, life: 20, maxLife: 20 });
      playSound(140, 0.35, "sawtooth");
      bossBurstTimer = Math.round(rand(450, 650) * phaseRate());
    }

    bossShotTimer--;
    if (bossShotTimer === 12) {
      bossChargeAnim = BOSS_CHARGE_FRAMES;
      playSound(90, 0.12, "triangle");
    }
    if (bossChargeAnim > 0) bossChargeAnim--;
    if (bossShotTimer <= 0) {
      const angle = trackedBossAngle(boss.x, boss.y + 70, 18);
      const pattern = Math.random();
      const offsets = pattern < 0.56 ? [0] : pattern < 0.82 ? [-0.14, 0.14] : [-0.16, 0, 0.16];
      const speed = (pattern < 0.82 ? 3.6 : 4.15) + (bossPhase - 1) * 0.35;
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
        minSize: 2, maxSize: 4, life: 20, colors: ["#ffdc5a", "#ff8a32", "#fff3c4"],
      });
      bossShotTimer = Math.round(rand(48, 94) * phaseRate());
    }
  }

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
    if (!adminInvincible && playerInvulnerable === 0 && Math.abs(bullet.x - player.x) < 22 && Math.abs(bullet.y - player.y) < 24) {
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
    if (!bossDying && Math.hypot(bullet.x - boss.x, bullet.y - boss.y) < bossRadius() + 4) {
      const hitX = bullet.x;
      const hitY = bullet.y;
      bullet.y = -100;
      damageBoss(bullet.damage || 1, bullet.x, bullet.y);
      superDamage += bullet.damage || 1;
      updateSuperMeter();
      if (bullet.type === "tech0") {
        spawnSparks(hitX, hitY, 14, WEAPON_COLORS.tech0, { minSpeed: 1, maxSpeed: 5, life: 20, maxSize: 4 });
        playSound(180, 0.1, "square");
        startTechChainBoss(hitX, hitY, null);
      }
    }
  }
  compact(bullets, (bullet) => bullet.x > -20 && bullet.x < W + 20 && bullet.y > -20 && bullet.y < H + 20);
  if (!bossDying) {
    setWidth(dom.bossFill, Math.max(0, boss.health / bossMaxHealth()) * 100);
  }

  if (!bossDying && !venus) {
    bossAttackTimer--;
    if (bossAttackTimer === 28) {
      bossChargeAnim = BOSS_CHARGE_FRAMES;
      playSound(70, 0.22, "triangle");
    }
    if (bossAttackTimer <= 0) {
      const baseAngle = trackedBossAngle(boss.x, boss.y + 60, 26);
      const pattern = Math.random();
      if (pattern < 0.45) {
        for (const offset of [-0.32, 0, 0.32]) pushBossOrb(baseAngle + offset, 3.5);
      } else if (pattern < 0.8) {
        for (const offset of [-0.48, -0.24, 0, 0.24, 0.48]) pushBossOrb(baseAngle + offset, 3.05);
      } else {
        for (const offset of [-0.12, 0.12]) pushBossOrb(baseAngle + offset, 4.2);
      }
      bossShootAnim = BOSS_SHOOT_FRAMES;
      bossChargeAnim = 0;
      bossShakeTimer = Math.max(bossShakeTimer, 5);
      spawnBossParticles(18, {
        x: boss.x, y: boss.y + 34, angle: baseAngle, spread: 0.7, minSpeed: 1.5, maxSpeed: 5,
        minSize: 2, maxSize: 5, life: 26, colors: ["#ffdc5a", "#ff8a32", "#fff3c4"],
      });
      playSound(220, 0.15, "sawtooth");
      bossAttackTimer = Math.round(rand(175, 290) * phaseRate());
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
    if (!adminInvincible && playerInvulnerable === 0 && Math.abs(b.x - player.x) < hitWidth + r && Math.abs(b.y - player.y) < hitHeight + r) {
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
function showVictory() {
  gamePaused = true;
  bossIntro = true;
  music.play("victory");
  document.getElementById("boss-player-name").textContent = playerName;
  document.getElementById("victory-player-name").textContent = playerName;
  setText(document.getElementById("victory-score"), String(score).padStart(6, "0"));
  setText(document.getElementById("victory-waves"), "5");
  unlockMercuryRewards();
  refreshLoadoutUI();
  dom.victoryScreen.classList.remove("visible");
  dom.victoryScreen.setAttribute("aria-hidden", "true");
  syncMobileControls();
  clearTimeout(rewardRevealTimer);
  const rewards = document.getElementById("reward-screen");
  const next = document.getElementById("reward-continue");
  next.disabled = true;
  rewards.classList.add("visible");
  rewards.setAttribute("aria-hidden", "false");
  rewards.focus();
  rewardRevealTimer = setTimeout(() => {
    if (!rewards.classList.contains("visible")) return;
    next.disabled = false;
    next.focus();
    playSound(880, .18, "triangle");
  }, 1800);
}

function drawTestRoom() {
  ctx.fillStyle = "#07131a"; ctx.fillRect(0, 0, W, H);
  for (const bomb of superBombs) {
    bomb.x += bomb.vx; bomb.y += bomb.vy; bomb.life--;
    const color = bomb.color || superColor("bomb");
    drawGlow(color, 16, bomb.x, bomb.y);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 10, 0, Math.PI * 2); ctx.fill();
    if (Math.hypot(bomb.x - W / 2, bomb.y - 190) < 68 || bomb.life <= 0) {
      bomb.explode = true;
      if (Math.hypot(bomb.x - W / 2, bomb.y - 190) < BOMB_RADIUS + 58) testDamage += BOMB_BOSS_DAMAGE;
      startBombBlast(bomb.x, bomb.y, BOMB_RADIUS, color);
    }
  }
  compact(superBombs, (bomb) => !bomb.explode);
  updateBombBlasts();
  for (const bullet of bullets) {
    bullet.x += bullet.vx; bullet.y += bullet.vy;
    drawPlayerBullet(bullet);
    if (Math.hypot(bullet.x - W / 2, bullet.y - 190) < 58) { bullet.y = -100; testDamage += bullet.damage || 1; superDamage += bullet.damage || 1; updateSuperMeter(); }
  }
  compact(bullets, (b) => b.y > -20 && b.y < H + 20 && b.x > -20 && b.x < W + 20);
  ctx.fillStyle = "#777"; ctx.beginPath(); ctx.arc(W / 2, 190, 58, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#aaa"; ctx.beginPath(); ctx.arc(W / 2 - 18, 175, 9, 0, Math.PI * 2); ctx.arc(W / 2 + 20, 205, 7, 0, Math.PI * 2); ctx.fill();
  if (superBeam && superBeam.life % BEAM_TICK === 0 && beamDistance(W / 2, 190) < BEAM_HALF_WIDTH + 58) {
    testDamage += 2;
    superDamage += 2;
  }
  updateSparks();
  updateSuperBeam(0);
  updateSuperEntities(performance.now());
  drawChargeAura(performance.now());
  setText(dom.testDamage, `DAMAGE: ${testDamage}`);
  updateChargeMeter();
  drawPlayer();
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
  gameActive = false;
  playSound(90, 0.55, "sawtooth");
  playSound(60, 1.1, "sawtooth");
  document.getElementById("test-damage").classList.remove("visible");
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
  if (defeatedByBoss) {
    setText(dom.gameMessage, "");
    document.getElementById("try-again-btn").classList.remove("visible");
    document.getElementById("main-menu-btn").classList.remove("visible");
    setText(document.getElementById("defeat-title"), venusWon ? "VENUS WINS" : "MERCURY WINS");
    const quote = document.getElementById("defeat-quote");
    quote.replaceChildren();
    quote.insertAdjacentHTML("afterbegin", venusWon
      ? "\u201cMy sky is lead, my rain is acid \u2014<br />you were never getting past it.\u201d"
      : "\u201cI'm closest to the sun<br />but will ruin all your fun.\u201d");
    dom.mercuryDefeatScreen.classList.toggle("venus", venusWon);
    dom.mercuryDefeatScreen.classList.add("visible");
    dom.mercuryDefeatScreen.setAttribute("aria-hidden", "false");
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

function startGame() {
  dom.gameMessage.classList.remove("game-over-message");
  ensureAudio();
  if (audioContext && audioContext.state === "suspended") audioContext.resume();
  gameActive = true;
  testDamage = 0;
  bossIntro = false;
  bossMode = false;
  bossKind = "mercury";
  bossDefeated = false;
  bossBullets = [];
  resetBossAnimation();
  player.shrunk = false;
  gameOverShown = false;
  score = 0;
  lives = 3;
  wave = 1;
  bullets = [];
  enemyBullets = [];
  superBombs = [];
  bombBlasts = [];
  techChains = [];
  clearSuperEntities();
  setPaused(false);
  sparks = [];
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
  createEnemies();
  music.play("battle");
  showWaveBanner("WAVE 1", "GOOD LUCK");
  document.getElementById("menu-wrap").classList.add("hidden");
  document.getElementById("game-ui").classList.add("active");
  document.getElementById("game-ui").setAttribute("aria-hidden", "false");
  setText(dom.gameMessage, "");
  document.getElementById("try-again-btn").classList.remove("visible");
  document.getElementById("main-menu-btn").classList.remove("visible");
  document.getElementById("boss-health").classList.remove("visible");
  document.getElementById("test-damage").classList.toggle("visible", testMode);
  document.getElementById("boss-intro").classList.remove("visible");
  document.getElementById("victory-screen").classList.remove("visible");
  document.getElementById("victory-screen").setAttribute("aria-hidden", "true");
  dom.mercuryDefeatScreen.classList.remove("visible");
  dom.mercuryDefeatScreen.setAttribute("aria-hidden", "true");
  playerName = "PLAYER";
  setText(dom.score, "000000");
  setLives(lives);
  updateSuperMeter();
  syncMobileControls();
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
  gameActive = false;
  gamePaused = false;
  bossMode = false;
  bossKind = "mercury";
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
  document.getElementById("menu-wrap").classList.remove("hidden");
  document.getElementById("boss-health").classList.remove("visible");
  document.getElementById("boss-intro").classList.remove("visible");
  document.getElementById("victory-screen").classList.remove("visible");
  document.getElementById("victory-screen").setAttribute("aria-hidden", "true");
  dom.mercuryDefeatScreen.classList.remove("visible");
  dom.mercuryDefeatScreen.setAttribute("aria-hidden", "true");
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

const WEAPON_LABELS = { blaster: "BLASTER", charge: "CHARGE", cone: "CONE", tech0: "TECH.0" };
const SUPER_LABELS = {
  bomb: "BOMB", invincibility: "SHIELD", lance: "TECHNOLOGY",
  star: "STAR", mirror: "MIRROR", drone: "DRONE",
  decoy: "DECOY", firstaid: "FIRST-AID", orb: "RADIANT ORB",
};

const BOOK_ENTRIES = {
  blaster: ["STEADY & RELIABLE", "A quick stream of yellow bolts. Keep your aim steady and carve a path through the swarm.", "1 DAMAGE · RAPID FIRE"],
  charge: ["HOLD. BUILD. RELEASE.", "Grow an orange energy ball as you charge. Full power burns through every enemy in its path.", "1 / 3 / 5 DAMAGE · FULL CHARGE PIERCES"],
  cone: ["COVER THE ANGLES", "Three green bolts fan out with every shot. Catch moving targets and clear a wider lane.", "3 BOLTS · WIDE SPREAD"],
  tech0: ["LIGHTNING FINDS A WAY", "A cyan electric round hits hard, then arcs to five nearby enemies — dropping smaller ones outright, including Mercury's brood. Listen for the ready ping: each shot takes well under a second to recharge.", "3 IMPACT · 5 × 1 CHAIN · 0.7 SEC"],
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
  art.replaceChildren(original.cloneNode(true));
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
  document.getElementById("primary-more-toggle").hidden = true;
  book.insertAdjacentHTML("beforeend", `<div class="book-overview" aria-live="polite"><div class="book-copy"><p class="book-category"></p><h3 class="book-name"></h3><p class="book-kicker"></p><p class="book-description"></p><p class="book-stats"></p></div><div class="book-art" aria-hidden="true"></div></div><nav class="book-navigation" aria-label="Armory pages"><button class="book-prev" type="button" aria-label="Previous page: primary guns"><span class="page-chevron" aria-hidden="true"></span> GUNS</button><button class="book-next" type="button" aria-label="Next page: super attacks">SUPERS <span class="page-chevron" aria-hidden="true"></span></button></nav>`);
  book.querySelectorAll(".weapon-tile").forEach((tile) => {
    tile.querySelector(".tile-badge")?.remove();
    const label = WEAPON_LABELS[tile.dataset.weapon] || SUPER_LABELS[tile.dataset.super];
    tile.setAttribute("aria-label", label);
    tile.title = label;
    tile.addEventListener("click", () => { bookPreview = tile.dataset.weapon || tile.dataset.super; bookDetailStats = false; renderWeaponBook(); });
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
  const readout = document.getElementById("loadout-readout");
  const summary = document.getElementById("loadout-summary-text");
  for (const target of [readout, summary]) {
    if (!target) continue;
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

function syncMercuryRewardUI() {
  document.querySelectorAll("[data-mercury-locked]").forEach((item) => {
    item.classList.toggle("locked", !mercuryRewardsUnlocked);
    item.setAttribute("aria-disabled", String(!mercuryRewardsUnlocked));
  });
  const greyChoice = document.querySelector(".color-choice.grey");
  if (greyChoice) {
    greyChoice.setAttribute("aria-label", mercuryRewardsUnlocked ? "Grey" : "Grey ship locked: beat Mercury");
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
}

function unlockMercuryRewards() {
  if (!mercuryRewardsUnlocked) {
    mercuryRewardsUnlocked = true;
    try {
      localStorage.setItem(MERCURY_UNLOCK_KEY, "unlocked");
    } catch (error) {
      // The reward still unlocks for this session when storage is unavailable.
    }
  }
  syncMercuryRewardUI();
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
  if (nextWeapon === "tech0" && !mercuryRewardsUnlocked) return false;
  selectedWeapon = nextWeapon;
  refreshLoadoutUI();
  syncRewardEquipButtons();
  playSound(660, 0.06, "square");
  return true;
}

function setSelectedSuper(nextSuper) {
  if (nextSuper !== selectedSuper && superMeter >= 1) {
    const requiredDamage = SUPER_COST[nextSuper] || 20;
    lastSuperKills = superDamage - requiredDamage * 0.5;
  }
  selectedSuper = nextSuper;
  refreshLoadoutUI();
  playSound(520, 0.06, "square");
  updateSuperMeter();
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
    audioContext = new AudioCtor();
    masterGain = audioContext.createGain();
    masterGain.gain.value = audioSettings.muted ? 0 : 1;
    masterGain.connect(audioContext.destination);
    sfxGain = audioContext.createGain();
    sfxGain.gain.value = audioSettings.sfx;
    sfxGain.connect(masterGain);
    musicGain = audioContext.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(masterGain);
    // one second of white noise, reused by every drum hit
    noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  } catch (error) {
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

const music = (function () {
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.14;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  // Patterns are 16 steps to the bar, in MIDI note numbers; 0 is a rest and a
  // bar list cycles, so a four-bar loop costs four short arrays.
  const TRACKS = {
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

  function play(name) {
    if (!ensureAudio()) return;
    if (audioContext.state === "suspended") audioContext.resume();
    if (trackName === name && timer) return;
    if (timer) clearInterval(timer);
    track = TRACKS[name];
    trackName = name;
    if (!track) { stop(); return; }
    step = 0;
    nextStepTime = audioContext.currentTime + 0.06;
    fade(targetVolume(), 0.6);
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
  bullets.push({ x: player.x, y: player.y, vx: dx * 10, vy: dy * 10, damage, type, size, pierceRemaining, color });
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

function drawPlayerBullet(bullet) {
  const color = bullet.color || weaponColor(bullet.type === "basic" ? "blaster" : bullet.type);
  if (bullet.mirror) steerMirrorBullet(bullet);
  ctx.save();
  ctx.translate(bullet.x, bullet.y);
  ctx.rotate(Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2);
  if (bullet.type === "charge") {
    const hot = (bullet.damage || 1) >= 4;
    if (hot) {
      const flicker = 0.82 + Math.sin(performance.now() * 0.035 + bullet.x * 0.07 + bullet.y * 0.04) * 0.18;
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "#ff3f20";
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      ctx.moveTo(-bullet.size * 0.82, bullet.size * 0.2);
      ctx.quadraticCurveTo(-bullet.size * 0.62, bullet.size + 10, 0, bullet.size + 30 * flicker);
      ctx.quadraticCurveTo(bullet.size * 0.62, bullet.size + 10, bullet.size * 0.82, bullet.size * 0.2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#ffdc5a";
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(-bullet.size * 0.48, bullet.size * 0.1);
      ctx.quadraticCurveTo(-bullet.size * 0.28, bullet.size + 6, 0, bullet.size + 19 * flicker);
      ctx.quadraticCurveTo(bullet.size * 0.28, bullet.size + 6, bullet.size * 0.48, bullet.size * 0.1);
      ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }
    drawGlow(color, hot ? 20 : 12, 0, 0);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, 0, bullet.size, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(0, 0, bullet.size * 0.45, 0, Math.PI * 2); ctx.fill();
    if (hot) {
      const emberRoll = Math.random();
      const emberColor = emberRoll < 0.28 ? "#ffffff" : emberRoll < 0.66 ? "#ffdc5a" : "#ff3f20";
      spawnSparks(bullet.x - bullet.vx * 0.5, bullet.y - bullet.vy * 0.5, 2,
        emberColor,
        { minSpeed: 0.2, maxSpeed: 1.2, life: 18, maxSize: 3 });
    }
  } else if (bullet.type === "tech0") {
    const flicker = Math.sin(performance.now() * 0.04 + bullet.x * 0.08) * 3;
    const pulse = 0.75 + Math.sin(performance.now() * 0.03 + bullet.x * 0.05 + bullet.y * 0.06) * 0.25;
    ctx.globalCompositeOperation = "lighter";
    // wide faint outer arc, then a thin white-hot inner arc along the same path
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(0, bullet.size + 14);
    ctx.lineTo(-4, bullet.size + 8);
    ctx.lineTo(3 + flicker, bullet.size + 2);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = "#eaffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, bullet.size + 14);
    ctx.lineTo(-4, bullet.size + 8);
    ctx.lineTo(3 + flicker, bullet.size + 2);
    ctx.lineTo(0, 0);
    ctx.stroke();
    ctx.globalAlpha = 1;
    drawGlow(color, 14 + Math.round(5 * pulse), 0, 0);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, 0, bullet.size, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#efffff";
    ctx.beginPath(); ctx.arc(-1, -1, bullet.size * 0.45, 0, Math.PI * 2); ctx.fill();
    bullet.tick = (bullet.tick || 0) + 1;
    if (bullet.tick % 3 === 0) {
      spawnSparks(bullet.x, bullet.y + 6, 1, color, { minSpeed: 0.2, maxSpeed: 1, life: 12, maxSize: 2 });
    }
    ctx.globalCompositeOperation = "source-over";
  } else if (bullet.type === "cone") {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, 0); ctx.lineTo(0, 7); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill();
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
    ctx.fillStyle = color;
    ctx.fillRect(-2, -6, 4, 12);
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
  // after the shots, so it isn't left pointing along the last cone arm
  facing.x = dx;
  facing.y = dy;
  return true;
}

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
syncMercuryRewardUI();
refreshLoadoutUI();
setTheme(playerColor);
syncAudioControls();
requestAnimationFrame(frame);

// --- title card ------------------------------------------------------------
// "DANIEL AND PETROS PRESENT..." holds for a beat, then hands over to the menu.
const CREDITS_HOLD_MS = 2600;
let creditsDone = false;

function finishCredits() {
  if (creditsDone) return;
  creditsDone = true;
  const credits = document.getElementById("credits-screen");
  credits.classList.add("fading");
  document.getElementById("menu-wrap").classList.remove("hidden");
  setTimeout(() => credits.classList.add("gone"), 750);
}
setTimeout(finishCredits, CREDITS_HOLD_MS);
// a click or key skips the wait
document.getElementById("credits-screen").addEventListener("click", finishCredits);

// Browsers won't let audio start before a gesture, so the menu track waits for
// the player's first click or keypress and then comes in.
function unlockAudio() {
  ensureAudio();
  if (audioContext && audioContext.state === "suspended") audioContext.resume();
  if (!gameActive) music.play("menu");
  window.removeEventListener("pointerdown", unlockAudio);
  window.removeEventListener("keydown", unlockAudio);
}
window.addEventListener("pointerdown", unlockAudio);
window.addEventListener("keydown", unlockAudio);

document.getElementById("start-btn").addEventListener("click", function () {
  showLoading(startGame);
});
document.getElementById("try-again-btn").addEventListener("click", function () {
  showLoading(startGame);
});
document.getElementById("main-menu-btn").addEventListener("click", returnToMenu);
document.getElementById("defeat-retry").addEventListener("click", function () {
  dom.mercuryDefeatScreen.classList.remove("visible");
  dom.mercuryDefeatScreen.setAttribute("aria-hidden", "true");
  showLoading(startGame);
});
document.getElementById("defeat-menu").addEventListener("click", returnToMenu);
document.getElementById("resume-btn").addEventListener("click", function () {
  setPaused(false);
});
document.getElementById("pause-menu-btn").addEventListener("click", returnToMenu);
document.getElementById("continue-boss").addEventListener("click", startBossFight);
document.getElementById("victory-continue").addEventListener("click", function () {
  document.getElementById("victory-screen").classList.remove("visible");
  document.getElementById("victory-screen").setAttribute("aria-hidden", "true");
  setPaused(false);
  bossIntro = false;
  bossMode = false;
  syncMobileControls();
  music.play("battle");
  wave = 6;
  player.x = W / 2; player.y = playerStartY(); player.vx = 0; player.vy = 0;
  enemyBullets = [];
  createEnemies();
  showWaveBanner("WAVE 6", "ENTERING VENUS AIRSPACE");
});
document.getElementById("reward-equip-tech0").addEventListener("click", function () {
  if (selectedWeapon === "tech0") setSelectedWeapon(rewardPreviousWeapon);
  else { rewardPreviousWeapon = selectedWeapon; setSelectedWeapon("tech0"); }
});
document.getElementById("reward-equip-grey").addEventListener("click", function () {
  if (playerColor === GREY_SHIP_COLOR) setPlayerColor(rewardPreviousColor);
  else { rewardPreviousColor = playerColor; setPlayerColor(GREY_SHIP_COLOR); }
  playSound(760, 0.07, "square");
});
document.getElementById("reward-continue").addEventListener("click", function () {
  const rewards = document.getElementById("reward-screen");
  rewards.classList.remove("visible");
  rewards.setAttribute("aria-hidden", "true");
  dom.victoryScreen.classList.add("visible");
  dom.victoryScreen.setAttribute("aria-hidden", "false");
  focusMenuDefault(dom.victoryScreen);
});
document.getElementById("admin-submit").addEventListener("click", function () {
  const input = document.getElementById("admin-code");
  const status = document.getElementById("admin-status");
  if (input.value.trim().toUpperCase() === "PETROSADMIN") {
    adminInvincible = true;
    status.textContent = "INVINCIBILITY ENABLED";
    input.value = "";
  } else if (input.value.trim().toUpperCase() === "TEST") {
    testMode = true;
    status.textContent = "TEST ROOM ENABLED";
    input.value = "";
  } else {
    status.textContent = "INVALID CODE";
  }
});
document.getElementById("controls-btn").addEventListener("click", function () {
  openControlsPanel(this);
});
document.getElementById("pause-controls-btn").addEventListener("click", function () {
  openControlsPanel(this);
});
document.getElementById("changelog-btn").addEventListener("click", function () {
  dom.changelogPanel.classList.add("visible");
  dom.changelogPanel.setAttribute("aria-hidden", "false");
  focusMenuDefault(dom.changelogPanel);
});
document.getElementById("changelog-close").addEventListener("click", function () {
  closeMenuPanel(dom.changelogPanel, document.getElementById("changelog-btn"));
});
document.querySelectorAll(".color-choice").forEach((choice) => choice.addEventListener("click", function () {
  if (choice.matches("[data-mercury-locked]") && !mercuryRewardsUnlocked) {
    openMercuryLockPanel(choice);
    return;
  }
  setPlayerColor(choice.dataset.color);
  playSound(760, 0.07, "square");
}));
document.getElementById("controls-close").addEventListener("click", function () {
  closeMenuPanel(dom.controlsPanel, controlsReturnTarget || document.getElementById("controls-btn"));
});
document.getElementById("weapons-btn").addEventListener("click", function () {
  const panel = document.getElementById("weapons-panel");
  bookPage = "primary"; bookPreview = selectedWeapon; renderWeaponBook();
  panel.classList.add("visible");
  panel.setAttribute("aria-hidden", "false");
  focusMenuDefault(panel);
});
document.getElementById("weapons-close").addEventListener("click", function () {
  closeMenuPanel(dom.weaponsPanel, dom.victoryScreen.classList.contains("visible") ? document.getElementById("victory-continue") : document.getElementById("weapons-btn"));
});
document.getElementById("mercury-lock-close").addEventListener("click", function () {
  closeMenuPanel(dom.mercuryLockPanel, mercuryLockReturnTarget);
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
  if (tile.matches("[data-mercury-locked]") && !mercuryRewardsUnlocked) {
    openMercuryLockPanel(tile);
    return;
  }
  setSelectedWeapon(tile.dataset.weapon);
}));
document.querySelectorAll(".weapon-tile[data-super]").forEach((tile) => tile.addEventListener("click", function () {
  setSelectedSuper(tile.dataset.super);
}));

document.querySelectorAll("[data-victory-weapon]").forEach((tile) => tile.addEventListener("click", function () {
  if (tile.matches("[data-mercury-locked]") && !mercuryRewardsUnlocked) {
    openMercuryLockPanel(tile);
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
