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
  W = window.innerWidth;
  H = window.innerHeight;
  centerX = W / 2;
  centerY = H / 2;
  applyRenderScale();
  bossGridLayer.width = canvas.width;
  bossGridLayer.height = canvas.height;
  bakeBossGrid();
  // the backdrop is viewport-sized, so respread it to keep full coverage
  initStaticStars();
}
window.addEventListener("resize", function () {
  // Each resize reallocates two canvas backing stores; coalesce a drag into one.
  if (resizePending) return;
  resizePending = true;
  requestAnimationFrame(function () { resizePending = false; resize(); });
});

function setQuality(index) {
  const next = Math.max(0, Math.min(QUALITY_TIERS.length - 1, index));
  if (next === qualityIndex) return;
  qualityIndex = next;
  quality = QUALITY_TIERS[next];
  document.documentElement.dataset.quality = quality.name;
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
const WEAPON_COLORS = { blaster: "#63f7ff", charge: "#ffb43d", cone: "#ff72c8" };
const SUPER_COLORS = { bomb: "#ff4f4f", invincibility: "#63ff91", lance: "#9d7bff" };
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
let score = 0;
let lives = 3;
let wave = 1;
let player = { x: 0, y: 0, vx: 0, vy: 0, speed: 0.23, maxSpeed: 5.5 };
let bullets = [];
let enemyBullets = [];
let enemies = [];
let fireCooldown = 0;
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
let sparks = [];
let audioContext = null;
let spaceDownAt = 0;
let suppressSpaceRelease = false;
const keys = {};

const AUDIO_STORAGE_KEY = "petros-space-adventure-audio";
const audioSettings = loadAudioSettings();

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
  bossIntro: document.getElementById("boss-intro"),
  victoryScreen: document.getElementById("victory-screen"),
  mercuryDefeatScreen: document.getElementById("mercury-defeat-screen"),
  gameUi: document.getElementById("game-ui"),
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

function openControlsPanel(trigger) {
  controlsReturnTarget = trigger;
  dom.controlsPanel.classList.add("visible");
  dom.controlsPanel.setAttribute("aria-hidden", "false");
  focusMenuDefault(dom.controlsPanel);
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
    if (dom.weaponsPanel.classList.contains("visible")) {
      event.preventDefault();
      closeMenuPanel(dom.weaponsPanel, document.getElementById("weapons-btn"));
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
  const active = document.activeElement;
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
  if (gameOverShown) drawStars(t);
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

// ---------------------------------------------------------------------------
// Enemies
//
// Three kinds, so a wave has a shape instead of a grid:
//   grunt   — holds formation, fires the slow homing shot
//   charger — winds up, then relentlessly homes into the player until destroyed
//   turret  — armoured, never moves, fires a wide non-homing spread
// Chargers and turrets are what close the old "stand in this corner and never
// get hit" gap: one comes to you, the other fills space you aren't standing in.
// ---------------------------------------------------------------------------
const ENEMY_TYPES = {
  grunt:   { w: 22, h: 16, health: 1, score: 100, color: "#c77dff" },
  charger: { w: 20, h: 20, health: 2, score: 175, color: "#ff7a4f" },
  turret:  { w: 26, h: 22, health: 3, score: 250, color: "#5ad1c0" },
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
  };
}

// Per-wave roster. Waves past the boss keep escalating from the same shapes.
function waveRoster(number) {
  if (number === 1) return { rows: 3, cols: 8, chargers: 0, turrets: 0 };
  if (number === 2) return { rows: 2, cols: 8, chargers: 2, turrets: 0 };
  if (number === 3) return { rows: 2, cols: 8, chargers: 1, turrets: 2 };
  if (number === 4) return { rows: 2, cols: 7, chargers: 3, turrets: 2 };
  if (number === 5) return { rows: 3, cols: 8, chargers: 3, turrets: 2 };
  const past = number - 5;
  return {
    rows: 3,
    cols: 8,
    chargers: Math.min(6, 3 + past),
    turrets: Math.min(4, 2 + Math.floor(past / 2)),
  };
}

const WAVE_INTROS = {
  2: "CHARGERS INBOUND",
  3: "TURRETS DEPLOYED",
  4: "MIXED ASSAULT",
  5: "FINAL WAVE BEFORE MERCURY",
};

function createEnemies() {
  enemies = [];
  const roster = waveRoster(wave);
  const spacing = Math.min(80, (W - 160) / Math.max(1, roster.cols));
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
  spawnSparks(x, y, 18, "#ffbd52", { minSpeed: 1, maxSpeed: 7, life: 26, minSize: 2, maxSize: 4 });
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
      ctx.strokeStyle = "#ffcf70";
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
// Charge weapon: a contracting ring shows progress; at full charge the effects
// drop away and the hull itself gives a small, readable vibration.
// ---------------------------------------------------------------------------
const CHARGE_FULL_MS = 2500;

function chargeRatio() {
  if (!chargeStartedAt) return 0;
  return Math.min(1, (performance.now() - chargeStartedAt) / CHARGE_FULL_MS);
}

function drawChargeAura(t) {
  const ratio = chargeRatio();
  if (ratio <= 0 || ratio >= 1) return;
  const radius = (player.shrunk ? 22 : 32) * (1.35 - ratio * 0.35);
  const pulse = Math.sin(t * 0.012) * 1.5;
  const color = weaponColor("charge");

  // A restrained gathering ring; no orbiting embers or flame cloud.
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.24 + ratio * 0.46;
  ctx.lineWidth = 2 + ratio;
  ctx.beginPath(); ctx.arc(player.x, player.y, radius + pulse, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
}

// A slow shot that steers toward the player for a limited window and then
// commits. The old version homed forever but only while `y < H`, which is what
// let a player park in a corner and watch shots curve harmlessly past.
function fireHomingShot(x, y, speed) {
  const angle = Math.atan2(player.y - y, player.x - x);
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

function updateEnemyBullets() {
  for (const bullet of enemyBullets) {
    let nextAngle = Math.atan2(bullet.vy, bullet.vx);
    if (bullet.homing > 0) {
      bullet.homing--;
      const targetAngle = Math.atan2(player.y - bullet.y, player.x - bullet.x);
      let angleDiff = targetAngle - nextAngle;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      nextAngle += Math.max(-bullet.turnRate, Math.min(bullet.turnRate, angleDiff));
      bullet.vx = Math.cos(nextAngle) * bullet.speed;
      bullet.vy = Math.sin(nextAngle) * bullet.speed;
    }
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    ctx.rotate(nextAngle + Math.PI / 2);
    if (bullet.kind === "straight") {
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
  const shrunk = keys.Space && performance.now() - spaceDownAt > 180;
  player.shrunk = Boolean(shrunk);
  const targetX = (right ? 1 : 0) - (left ? 1 : 0);
  const targetY = (down ? 1 : 0) - (up ? 1 : 0);
  // normalise so holding two keys doesn't make diagonals ~41% faster
  const inputLength = Math.hypot(targetX, targetY) || 1;
  const moveX = targetX / inputLength;
  const moveY = targetY / inputLength;
  const movementSpeed = player.shrunk ? player.maxSpeed * 1.4 : player.maxSpeed;
  player.vx += (moveX * movementSpeed - player.vx) * player.speed;
  player.vy += (moveY * movementSpeed - player.vy) * player.speed;
  player.x += player.vx;
  player.y += player.vy;
  if (!targetX) player.vx *= 0.88;
  if (!targetY) player.vy *= 0.88;
  player.x = Math.max(24, Math.min(W - 24, player.x));
  player.y = Math.max(28, Math.min(H - 28, player.y));
  if ((player.x <= 24 && player.vx < 0) || (player.x >= W - 24 && player.vx > 0)) player.vx = 0;
  if ((player.y <= 28 && player.vy < 0) || (player.y >= H - 28 && player.vy > 0)) player.vy = 0;

  if (fireCooldown > 0) fireCooldown--;
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
  if (fireCooldown <= 0 && aim.held) {
    if (selectedWeapon === "cone") {
      fireCone(aimX, aimY);
      fireCooldown = player.shrunk ? 54 : 18;
    } else if (selectedWeapon === "blaster") {
      fireInDirection(aimX, aimY);
      fireCooldown = player.shrunk ? 30 : 10;
    }
  }

  if (bossIntro) return;
  if (playerInvulnerable > 0) playerInvulnerable--;
  if (invincibilitySuperTimer > 0) invincibilitySuperTimer--;
  if (bossMode) { drawBossArea(t); return; }
  if (testMode) { drawTestRoom(); return; }

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
    const blastRadius = 125;
    startBombBlast(bomb.x, bomb.y, blastRadius, bomb.color);
    for (const enemy of enemies) {
      if (enemy.alive && Math.hypot(enemy.x - bomb.x, enemy.y - bomb.y) < blastRadius) {
        enemy.alive = false; score += 100; kills++;
      }
    }
  }
  compact(superBombs, (b) => !b.explode);
  updateBombBlasts();
  updateSuperMeter();
  updateSuperBeam(t);
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
    drawEnemy(enemy, ey, time);

    const playerHitbox = player.shrunk ? 8 : 16;
    if (!adminInvincible && playerInvulnerable === 0 && Math.abs(player.x - enemy.x) < enemy.w + playerHitbox && Math.abs(player.y - ey) < enemy.h + playerHitbox) {
      hurtPlayer();
      if (!gameActive) return;
    }

    for (const bullet of bullets) {
      if (Math.abs(bullet.x - enemy.x) < enemy.w + 4 && Math.abs(bullet.y - ey) < enemy.h + 6) {
        damageEnemy(enemy, bullet.damage || 1);
        if (bullet.pierceRemaining !== Infinity) {
          bullet.pierceRemaining--;
          if (bullet.pierceRemaining <= 0) bullet.y = -100;
        }
        break;
      }
    }
    if (superBeam) damageAlongBeam(enemy, ey);
  }
  let anyAlive = false;
  for (const enemy of enemies) if (enemy.alive) { anyAlive = true; break; }
  if (!anyAlive) {
    bullets = [];
    enemyBullets = [];
    if (wave === 5) { enterBossArea(); return; }
    player.x = W / 2;
    player.y = H - 80;
    player.vx = 0;
    player.vy = 0;
    showWaveBanner(`WAVE ${wave} CLEARED`, "");
    wave++;
    createEnemies();
    announceWave(wave, 1250);
  }
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
function updateEnemy(enemy, time) {
  if (enemy.type === "grunt") return enemy.y + Math.sin(time * 2 + enemy.phase) * 5;

  if (enemy.type === "turret") {
    enemy.spin += 0.01;
    // barrel tracks the player, and the spread is fired along it
    const aim = Math.atan2(player.y - enemy.y, player.x - enemy.x);
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
    const aim = Math.atan2(player.y - enemy.y, player.x - enemy.x);
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
    const targetAngle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
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

function enterBossArea() {
  bossMode = false;
  bossIntro = true;
  bossDefeated = false;
  boss = { x: W / 2, y: Math.max(215, Math.min(250, H * 0.35)), health: BOSS_MAX_HEALTH };
  resetBossAnimation();
  bossShotTimer = 64;
  bossAttackTimer = 150;
  bossBullets = [];
  document.getElementById("boss-health").classList.add("visible");
  // through setWidth, so the change-detection cache doesn't go stale and skip
  // the first real write of the next fight
  setWidth(dom.bossFill, 0);
  const bossHealth = document.getElementById("boss-health");
  bossHealth.classList.remove("filling");
  void bossHealth.offsetWidth;
  bossHealth.classList.add("filling");
  setTimeout(() => bossHealth.classList.remove("filling"), 1600);
  player.x = W / 2; player.y = H - 80; player.vx = 0; player.vy = 0;
  document.getElementById("boss-player-name").textContent = playerName;
  document.getElementById("boss-intro").classList.add("visible");
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
  music.play("boss");
  showWaveBanner("MERCURY", "DESTROY THE PLANET");
}

const BOSS_MAX_HEALTH = 75;
const BOSS_RADIUS = 78;
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
  const stage = Math.floor((1 - Math.max(0, boss.health) / BOSS_MAX_HEALTH) * 4);
  if (stage > bossDamageStage) {
    bossDamageStage = stage;
    spawnBossShards(3);
    bossShakeTimer = Math.max(bossShakeTimer, 12);
  }
  bossHitFlash = BOSS_HIT_FRAMES;
  bossShakeTimer = Math.max(bossShakeTimer, 6);
  const angle = Math.atan2(boss.y - fromY, boss.x - fromX) + Math.PI;
  spawnBossParticles(Math.min(14, 4 + Math.round(amount * 2)), {
    x: boss.x + Math.cos(angle + Math.PI) * BOSS_RADIUS * 0.8,
    y: boss.y + Math.sin(angle + Math.PI) * BOSS_RADIUS * 0.8,
    angle,
    spread: 0.9,
    minSpeed: 1.4,
    maxSpeed: 4.6,
    minSize: 2,
    maxSize: 4,
    life: 26,
    colors: ["#e8e8e8", "#b0b0b0", "#ffdc5a", "#7d7d7d"],
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
  wave = 6;
  document.getElementById("boss-health").classList.remove("visible");
  bullets = [];
  bossBullets = [];
  enemyBullets = [];
  lives++;
  setLives(lives, true);
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
  const angry = 0.4 + charge * 0.6;
  const eyeGlow = charge > 0.05 ? "#ff5a3c" : hit > 0 ? "#fff3b0" : "#ff4f91";
  const eyeRadius = (9 + charge * 4 + shoot * 2.5) * (hit > 0 ? 0.7 : 1);

  ctx.fillStyle = "#171717";
  BROW_SIDES.forEach((side) => {
    ctx.save();
    ctx.translate(side * 27, -20);
    ctx.rotate(side * angry * 0.55);
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

  if (shut) {
    ctx.strokeStyle = hit > 0.05 ? eyeGlow : "#171717";
    ctx.lineWidth = 6;
    ctx.lineCap = "round";
    BROW_SIDES.forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * 27 - 10, -12);
      ctx.lineTo(side * 27 + 10, -12);
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
  const mouthY = 35;
  if (shoot > 0.04) {
    const mouthOpen = 9 + shoot * 14;
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
  } else if (charge > 0.05) {
    const clench = 5 + charge * 2;
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

function trackedBossAngle(fromX, fromY, leadFrames) {
  const targetX = Math.max(24, Math.min(W - 24, player.x + player.vx * leadFrames));
  const targetY = Math.max(28, Math.min(H - 28, player.y + player.vy * leadFrames));
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
  ctx.fillStyle = "#16051f"; ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(bossGridLayer, 0, 0);
  ctx.restore();

  if (bossDying) updateBossDeath();
  drawMercury(t);
  updateBossExplosions();
  updateBossParticles();
  updateSparks();

  // TECHNOLOGY burns the boss for as long as the beam is on it
  if (superBeam && !bossDying && superBeam.life % BEAM_TICK === 0 && beamDistance(boss.x, boss.y) < BEAM_HALF_WIDTH + BOSS_RADIUS * 0.8) {
    damageBoss(3, player.x, player.y);
    superDamage += 3;
    spawnSparks(boss.x, boss.y, 8, superBeam.color || superColor("lance"), { life: 20 });
  }

  if (!bossDying) {
    // Mercury sweeps the arena and leans toward the player. A stationary boss is
    // what made "stand here and never get hit" possible in the first place.
    bossDrift += 0.0048;
    const range = Math.min(220, W * 0.2);
    const target = W / 2 + Math.sin(bossDrift) * range + (player.x - W / 2) * 0.28;
    boss.x += (target - boss.x) * 0.022;
    boss.x = Math.max(120, Math.min(W - 120, boss.x));

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
      bossBurstTimer = Math.round(rand(450, 650));
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
      const speed = pattern < 0.82 ? 3.6 : 4.15;
      for (const offset of offsets) {
        const shotAngle = angle + offset;
        enemyBullets.push({
          x: boss.x,
          y: boss.y + 70,
          vx: Math.cos(shotAngle) * speed,
          vy: Math.sin(shotAngle) * speed,
          speed,
          turnRate: pattern < 0.56 ? 0.026 : pattern < 0.82 ? 0.018 : 0,
          homing: pattern < 0.56 ? 105 : pattern < 0.82 ? 60 : 0,
          kind: "meteor",
        });
      }
      bossShootAnim = BOSS_SHOOT_FRAMES;
      bossChargeAnim = 0;
      spawnBossParticles(10, {
        x: boss.x, y: boss.y + 34, angle, spread: 0.5, minSpeed: 1, maxSpeed: 3.6,
        minSize: 2, maxSize: 4, life: 20, colors: ["#ffdc5a", "#ff8a32", "#fff3c4"],
      });
      bossShotTimer = Math.round(rand(48, 94));
    }
  }

  for (const bullet of enemyBullets) {
    if (bullet.homing > 0) {
      bullet.homing--;
      const targetAngle = Math.atan2(player.y - bullet.y, player.x - bullet.x);
      const currentAngle = Math.atan2(bullet.vy, bullet.vx);
      let angleDiff = targetAngle - currentAngle;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      const next = currentAngle + Math.max(-bullet.turnRate, Math.min(bullet.turnRate, angleDiff));
      bullet.vx = Math.cos(next) * bullet.speed;
      bullet.vy = Math.sin(next) * bullet.speed;
    }
    bullet.x += bullet.vx; bullet.y += bullet.vy;
    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    ctx.rotate(Math.atan2(bullet.vy, bullet.vx));
    ctx.fillStyle = "#777";
    ctx.beginPath();
    ctx.moveTo(-8, -4); ctx.lineTo(-3, -9); ctx.lineTo(5, -7); ctx.lineTo(9, 0);
    ctx.lineTo(4, 8); ctx.lineTo(-5, 7); ctx.lineTo(-9, 2); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#aaa";
    ctx.beginPath(); ctx.arc(-2, -3, 2, 0, Math.PI * 2); ctx.fill();
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
      if (!bossDying) damageBoss(15, bomb.x, bomb.y);
      bossExplosions.push({ x: bomb.x, y: bomb.y, r: 0, max: 110, life: 18, maxLife: 18 });
      startBombBlast(bomb.x, bomb.y, 110, color);
      bomb.explode = true;
    }
  }
  compact(superBombs, (bomb) => !bomb.explode);
  updateBombBlasts();

  for (const bullet of bullets) {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    drawPlayerBullet(bullet);
    if (!bossDying && Math.hypot(bullet.x - boss.x, bullet.y - boss.y) < 82) {
      bullet.y = -100;
      damageBoss(bullet.damage || 1, bullet.x, bullet.y);
      superDamage += bullet.damage || 1;
      updateSuperMeter();
    }
  }
  compact(bullets, (bullet) => bullet.x > -20 && bullet.x < W + 20 && bullet.y > -20 && bullet.y < H + 20);
  if (!bossDying) {
    setWidth(dom.bossFill, Math.max(0, boss.health / BOSS_MAX_HEALTH) * 100);
  }

  if (!bossDying) {
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
      bossAttackTimer = Math.round(rand(175, 290));
    }
  }

  ctx.fillStyle = "#ff8a5a";
  for (const b of bossBullets) {
    b.x += b.vx;
    b.y += b.vy;
    ctx.beginPath(); ctx.arc(b.x, b.y, 7, 0, Math.PI * 2); ctx.fill();
    const hitWidth = player.shrunk ? 13 : 22;
    const hitHeight = player.shrunk ? 14 : 24;
    if (!adminInvincible && playerInvulnerable === 0 && Math.abs(b.x - player.x) < hitWidth + 7 && Math.abs(b.y - player.y) < hitHeight + 7) {
      hurtPlayer();
      b.y = H + 200;
      if (!gameActive) return;
    }
  }
  compact(bossBullets, (b) => b.x > -30 && b.x < W + 30 && b.y > -30 && b.y < H + 30);

  if (boss.health <= 0 && !bossDying && !bossDefeated) startBossDeath();
  updateSuperBeam(t);
  drawChargeAura(t);
  drawPlayer();
}

function showVictory() {
  gamePaused = true;
  bossIntro = true;
  music.play("victory");
  document.getElementById("boss-player-name").textContent = playerName;
  document.getElementById("victory-player-name").textContent = playerName;
  setText(document.getElementById("victory-score"), String(score).padStart(6, "0"));
  setText(document.getElementById("victory-waves"), "5");
  refreshLoadoutUI();
  document.getElementById("victory-screen").classList.add("visible");
  document.getElementById("victory-screen").setAttribute("aria-hidden", "false");
  focusMenuDefault(dom.victoryScreen);
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
      testDamage += 15;
      startBombBlast(bomb.x, bomb.y, 110, color);
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
  const defeatedByMercury = bossMode;
  gameActive = false;
  playSound(90, 0.55, "sawtooth");
  playSound(60, 1.1, "sawtooth");
  document.getElementById("test-damage").classList.remove("visible");
  bossIntro = false;
  music.stop();
  bossMode = false;
  superBeam = null;
  gameOverShown = true;
  enemyBullets = [];
  if (defeatedByMercury) {
    setText(dom.gameMessage, "");
    document.getElementById("try-again-btn").classList.remove("visible");
    document.getElementById("main-menu-btn").classList.remove("visible");
    dom.mercuryDefeatScreen.classList.add("visible");
    dom.mercuryDefeatScreen.setAttribute("aria-hidden", "false");
    playSound(420, 0.12, "square");
    setTimeout(() => playSound(540, 0.12, "square"), 130);
    setTimeout(() => playSound(660, 0.18, "square"), 260);
    focusMenuDefault(dom.mercuryDefeatScreen);
    return;
  }
  setText(dom.gameMessage, "GAME OVER");
  document.getElementById("try-again-btn").classList.add("visible");
  document.getElementById("main-menu-btn").classList.add("visible");
  focusMenuDefault(dom.gameUi);
}

function startGame() {
  ensureAudio();
  if (audioContext && audioContext.state === "suspended") audioContext.resume();
  gameActive = true;
  testDamage = 0;
  bossIntro = false;
  bossMode = false;
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
  playerInvulnerable = 0;
  invincibilitySuperTimer = 0;
  screenShakeFrames = 0;
  screenShakeStrength = 0;
  enemyShotTimer = 60;
  player.x = W / 2;
  player.y = H - 80;
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
  if (paused) {
    collapseAudioDrawers(dom.pauseScreen);
    focusMenuDefault(dom.pauseScreen);
  }
  else if (dom.pauseScreen.contains(document.activeElement)) document.activeElement.blur();
}

// Shared by the pause card, the game-over screen and Escape-to-quit, so leaving
// a run always tears down the same state.
function returnToMenu() {
  gameActive = false;
  gamePaused = false;
  bossMode = false;
  bossIntro = false;
  bossDying = false;
  gameOverShown = false;
  enemyBullets = [];
  bossBullets = [];
  bullets = [];
  superBombs = [];
  bombBlasts = [];
  superBeam = null;
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
  music.play("menu");
  focusMenuDefault(dom.menu);
}

function flashDamage() {
  const flash = dom.damageFlash;
  flash.classList.remove("active");
  void flash.offsetWidth;
  flash.classList.add("active");
}

const SUPER_COST = { bomb: 22, invincibility: 36, lance: 33 };
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

const WEAPON_LABELS = { blaster: "BLASTER", charge: "CHARGE", cone: "CONE" };
const SUPER_LABELS = { bomb: "BOMB", invincibility: "SHIELD", lance: "TECHNOLOGY" };

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
  const label = `${WEAPON_LABELS[selectedWeapon]} + ${SUPER_LABELS[selectedSuper]}`;
  const readout = document.getElementById("loadout-readout");
  const summary = document.getElementById("loadout-summary-text");
  if (readout) readout.textContent = label;
  if (summary) summary.textContent = label;
}

function setSelectedWeapon(nextWeapon) {
  selectedWeapon = nextWeapon;
  refreshLoadoutUI();
  playSound(660, 0.06, "square");
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
    victory: {
      bpm: 128,
      volume: 0.22,
      once: true,
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
  const x = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
  const y = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
  // Fills the shared vector rather than returning a fresh object: this runs
  // every frame, and callers only ever read it before the next call.
  aimVector.held = Boolean(x || y);
  aimVector.x = aimVector.held ? x : lastArrowDirection.x;
  aimVector.y = aimVector.held ? y : lastArrowDirection.y;
  return aimVector;
}

function fireInDirection(dx, dy, damage = 1, type = "basic", size = 3) {
  if (!gameActive || bullets.length >= 10) return;
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
}

function drawPlayerBullet(bullet) {
  const color = bullet.color || weaponColor(bullet.type === "basic" ? "blaster" : bullet.type);
  ctx.save();
  ctx.translate(bullet.x, bullet.y);
  ctx.rotate(Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2);
  if (bullet.type === "charge") {
    const hot = (bullet.damage || 1) >= 4;
    drawGlow(color, hot ? 20 : 12, 0, 0);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(0, 0, bullet.size, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(0, 0, bullet.size * 0.45, 0, Math.PI * 2); ctx.fill();
    if (hot) {
      spawnSparks(bullet.x - bullet.vx * 0.5, bullet.y - bullet.vy * 0.5, 2,
        Math.random() < 0.35 ? "#ffffff" : color,
        { minSpeed: 0.2, maxSpeed: 1.2, life: 18, maxSize: 3 });
    }
  } else if (bullet.type === "cone") {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, 0); ctx.lineTo(0, 7); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill();
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
  const length = Math.hypot(dx, dy) || 1; dx /= length; dy /= length;
  const base = Math.atan2(dy, dx);
  for (const offset of CONE_ANGLES) {
    const angle = base + offset;
    fireInDirection(Math.cos(angle), Math.sin(angle), 1, "cone");
  }
  // after the shots, so it isn't left pointing along the last cone arm
  facing.x = dx;
  facing.y = dy;
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

resize();
initStars();
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
  music.play("battle");
  wave = 6;
  player.x = W / 2; player.y = H - 80; player.vx = 0; player.vy = 0;
  enemyBullets = [];
  createEnemies();
  showWaveBanner("WAVE 6", "MERCURY'S SURVIVORS");
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
  playerColor = choice.dataset.color;
  setTheme(playerColor);
  document.querySelectorAll(".color-choice").forEach((item) => item.classList.remove("selected"));
  choice.classList.add("selected");
  playSound(760, 0.07, "square");
}));
document.getElementById("controls-close").addEventListener("click", function () {
  closeMenuPanel(dom.controlsPanel, controlsReturnTarget || document.getElementById("controls-btn"));
});
document.getElementById("weapons-btn").addEventListener("click", function () {
  const panel = document.getElementById("weapons-panel");
  panel.classList.add("visible");
  panel.setAttribute("aria-hidden", "false");
  focusMenuDefault(panel);
});
document.getElementById("weapons-close").addEventListener("click", function () {
  closeMenuPanel(dom.weaponsPanel, document.getElementById("weapons-btn"));
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
  setSelectedWeapon(tile.dataset.weapon);
}));
document.querySelectorAll(".weapon-tile[data-super]").forEach((tile) => tile.addEventListener("click", function () {
  setSelectedSuper(tile.dataset.super);
}));

document.querySelectorAll("[data-victory-weapon]").forEach((tile) => tile.addEventListener("click", function () {
  setSelectedWeapon(tile.dataset.victoryWeapon);
}));
document.querySelectorAll("[data-victory-super]").forEach((tile) => tile.addEventListener("click", function () {
  setSelectedSuper(tile.dataset.victorySuper);
}));

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
      if (!player.shrunk || fireCooldown <= 0) fireCooldown = 0;
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
  if (e.code === "Space" && gameActive && !bossIntro && !gamePaused && performance.now() - spaceDownAt <= 180 && superMeter >= 1) {
    if (selectedSuper === "invincibility") {
      playerInvulnerable = 180;
      invincibilitySuperTimer = 180;
      playSound(880, 0.3, "triangle");
    } else if (selectedSuper === "lance") {
      fireLance();
    } else {
      superBombs.push({ x: player.x, y: player.y, vx: facing.x * 8, vy: facing.y * 8, life: 75, explode: false, color: superColor("bomb") });
      playSound(180, 0.18, "triangle");
    }
    lastSuperKills = superDamage;
    superMeter = 0;
    updateSuperMeter();
  }
  if (e.code.startsWith("Arrow") && selectedWeapon === "charge" && chargeStartedAt) {
    // Fire along every arrow that was down at the instant of release, including
    // the one just released — otherwise letting go of a diagonal fired straight.
    const released = ARROW_VECTORS[e.code];
    const shotX = Math.max(-1, Math.min(1, (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0) + released[0]));
    const shotY = Math.max(-1, Math.min(1, (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0) + released[1]));
    const dirX = shotX || shotY ? shotX : chargeDirection.x;
    const dirY = shotX || shotY ? shotY : chargeDirection.y;
    const held = performance.now() - chargeStartedAt;
    const damage = held >= CHARGE_FULL_MS ? 5 : held >= CHARGE_FULL_MS * 0.5 ? 3 : 1;
    const size = damage === 5 ? 9 : damage === 3 ? 6 : 3;
    if (!player.shrunk || fireCooldown <= 0) {
      fireInDirection(dirX, dirY, damage, "charge", size);
      if (player.shrunk) fireCooldown = 45;
    }
    lastArrowDirection.x = dirX;
    lastArrowDirection.y = dirY;
    const stillHeld = keys.ArrowLeft || keys.ArrowRight || keys.ArrowUp || keys.ArrowDown;
    // arrows still down means the player is lining up the next shot
    chargeStartedAt = stillHeld ? performance.now() : 0;
    if (stillHeld) {
      const aim = currentAimVector();
      chargeDirection.x = aim.x;
      chargeDirection.y = aim.y;
    }
  }
});
window.addEventListener("blur", function () {
  Object.keys(keys).forEach((key) => { keys[key] = false; });
});
