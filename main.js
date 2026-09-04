const canvas = document.getElementById("space-bg");
// alpha:false lets the compositor skip blending the canvas against the page.
const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });

let W, H;
let centerX, centerY;

// The boss arena grid is identical every frame, so it is stroked once into an
// offscreen layer and blitted with a single drawImage instead of re-pathing
// ~100 lines per frame.
const bossGridLayer = document.createElement("canvas");
const bossGridCtx = bossGridLayer.getContext("2d");

let resizePending = false;

// Called from the init block at the bottom, once every declaration below exists.
function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  centerX = W / 2;
  centerY = H / 2;
  bossGridLayer.width = W;
  bossGridLayer.height = H;
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

function bakeBossGrid() {
  bossGridCtx.clearRect(0, 0, W, H);
  bossGridCtx.strokeStyle = "rgba(180, 80, 255, 0.16)";
  bossGridCtx.lineWidth = 1;
  bossGridCtx.beginPath();
  for (let x = 0; x < W; x += 50) { bossGridCtx.moveTo(x, 0); bossGridCtx.lineTo(x, H); }
  for (let y = 0; y < H; y += 50) { bossGridCtx.moveTo(0, y); bossGridCtx.lineTo(W, y); }
  bossGridCtx.stroke();
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
let selectedWeapon = "blaster";
let selectedSuper = "bomb";
let chargeStartedAt = 0;
let chargeDirection = { x: 0, y: -1 };
let lastArrowDirection = { x: 0, y: -1 };
let bossMusicTimer = null;
let boss = { x: 0, y: 180, health: 75 };
let bossShotTimer = 30;
let bossDefeated = false;
let bossAttackTimer = 0;
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
let enemyShotTimer = 60;
let kills = 0;
let superDamage = 0;
let superMeter = 0;
let lastSuperKills = 0;
let facing = { x: 0, y: -1 };
let superBombs = [];
let audioContext = null;
let spaceDownAt = 0;
let suppressSpaceRelease = false;
const keys = {};

const ARROW_VECTORS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// This script runs at the end of <body>, so every element already exists.
// Resolving them once removes thousands of getElementById calls per second.
const dom = {
  score: document.getElementById("score"),
  lives: document.getElementById("lives"),
  waveNumber: document.getElementById("wave-number"),
  superFill: document.getElementById("super-fill"),
  chargeMeter: document.getElementById("charge-meter"),
  chargeFill: document.getElementById("charge-fill"),
  bossFill: document.getElementById("boss-fill"),
  testDamage: document.getElementById("test-damage"),
  damageFlash: document.getElementById("damage-flash"),
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
  const scaled = Math.round(W * H * STAR_DENSITY);
  const count = Math.min(MAX_BACKDROP_STARS, Math.max(MIN_BACKDROP_STARS, scaled));
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
  for (let i = 0; i < steps; i++) draw(now);
}

function draw(t) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);
  centerX = W / 2;
  centerY = H / 2;
  if (!gameActive) drawStaticStars(t);
  if (gameOverShown) drawStars(t);
  if (gameActive && !gamePaused) drawGame(t);
  updateChargeMeter();
  setText(dom.waveNumber, String(wave));
}

function createEnemies() {
  enemies = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 8; col++) {
      enemies.push({
        x: W / 2 - 280 + col * 80,
        y: 120 + row * 62,
        w: 22,
        h: 16,
        alive: true,
        health: 1,
        phase: col * 0.4 + row,
      });
    }
  }
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
      fireCooldown = 18;
    } else if (selectedWeapon === "blaster") {
      fireInDirection(aimX, aimY);
      fireCooldown = 10;
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
    ctx.fillStyle = "#63f7ff";
    ctx.shadowColor = "#63f7ff";
    ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    if (bomb.life <= 0 || bomb.x < 0 || bomb.x > W || bomb.y < 0 || bomb.y > H) bomb.explode = true;
  }
  for (const bomb of superBombs) {
    if (!bomb.explode) continue;
    const blastRadius = 125;
    ctx.strokeStyle = "rgba(255, 220, 90, 0.8)";
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(bomb.x, bomb.y, blastRadius, 0, Math.PI * 2); ctx.stroke();
    for (const enemy of enemies) {
      if (enemy.alive && Math.hypot(enemy.x - bomb.x, enemy.y - bomb.y) < blastRadius) {
        enemy.alive = false; score += 100; kills++;
      }
    }
    playSound(110, 0.3, "sawtooth");
  }
  compact(superBombs, (b) => !b.explode);
  updateSuperMeter();
  const shipScale = player.shrunk ? 0.55 : 1;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.scale(shipScale, shipScale);
  ctx.rotate(Math.atan2(facing.y, facing.x) + Math.PI / 2);
  ctx.fillStyle = playerColor;
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(-18, 16);
  ctx.lineTo(0, 9);
  ctx.lineTo(18, 16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (playerInvulnerable > 0) {
    const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.06;
    const shieldRadius = (player.shrunk ? 24 : 34) * pulse;
    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.72)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(player.x, player.y, shieldRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  for (const bullet of bullets) {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    ctx.rotate(Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2);
    if (bullet.type === "charge") {
      ctx.fillStyle = "#ff8a32"; ctx.shadowColor = "#ff8a32"; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(0, 0, bullet.size, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    } else if (bullet.type === "cone") {
      ctx.fillStyle = "#63ff91";
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, 0); ctx.lineTo(0, 7); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill();
    } else { ctx.fillStyle = "#ffdc5a"; ctx.fillRect(-2, -6, 4, 12); }
    ctx.restore();
  }
  compact(bullets, (b) => b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20);

  enemyShotTimer--;
  if (enemyShotTimer <= 0) {
    // Pick a random living enemy by counting first, so no array is allocated.
    let livingCount = 0;
    for (const enemy of enemies) if (enemy.alive) livingCount++;
    if (livingCount) {
      let pick = Math.floor(Math.random() * livingCount);
      let shooter = null;
      for (const enemy of enemies) {
        if (enemy.alive && pick-- === 0) { shooter = enemy; break; }
      }
      const angle = Math.atan2(player.y - shooter.y, player.x - shooter.x);
      enemyBullets.push({
        x: shooter.x,
        y: shooter.y + 18,
        vx: Math.cos(angle) * 2.8,
        vy: Math.sin(angle) * 2.8,
        speed: 2.8,
        turnRate: 0.035,
      });
    }
    enemyShotTimer = 45 + Math.floor(Math.random() * 45);
  }
  ctx.fillStyle = "#ff6b8a";
  for (const bullet of enemyBullets) {
    let nextAngle = Math.atan2(bullet.vy, bullet.vx);
    if (bullet.y < H) {
      const targetAngle = Math.atan2(player.y - bullet.y, player.x - bullet.x);
      const currentAngle = Math.atan2(bullet.vy, bullet.vx);
      let angleDiff = targetAngle - currentAngle;
      angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
      nextAngle = currentAngle + Math.max(-bullet.turnRate, Math.min(bullet.turnRate, angleDiff));
      bullet.vx = Math.cos(nextAngle) * bullet.speed;
      bullet.vy = Math.sin(nextAngle) * bullet.speed;
    }
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    ctx.rotate(nextAngle + Math.PI / 2);
    ctx.fillRect(-2, -6, 4, 12);
    ctx.restore();
    const hitWidth = player.shrunk ? 13 : 22;
    const hitHeight = player.shrunk ? 14 : 24;
    if (!adminInvincible && playerInvulnerable === 0 && Math.abs(bullet.x - player.x) < hitWidth && Math.abs(bullet.y - player.y) < hitHeight) {
      lives--;
      flashDamage();
      playerInvulnerable = 90;
      setText(dom.lives, String(lives));
      bullet.y = H + 100;
      if (lives <= 0) { endGame(); return; }
    }
  }
  compact(enemyBullets, (bullet) => bullet.y < H + 20);

  const time = t * 0.001;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const ey = enemy.y + Math.sin(time * 2 + enemy.phase) * 5;
    ctx.fillStyle = "#c77dff";
    ctx.beginPath();
    ctx.moveTo(enemy.x, ey - enemy.h);
    ctx.lineTo(enemy.x - enemy.w, ey + 7);
    ctx.lineTo(enemy.x - 7, ey + 3);
    ctx.lineTo(enemy.x, ey + enemy.h);
    ctx.lineTo(enemy.x + 7, ey + 3);
    ctx.lineTo(enemy.x + enemy.w, ey + 7);
    ctx.closePath();
    ctx.fill();

    const playerHitbox = player.shrunk ? 8 : 16;
    if (!adminInvincible && playerInvulnerable === 0 && Math.abs(player.x - enemy.x) < enemy.w + playerHitbox && Math.abs(player.y - ey) < enemy.h + playerHitbox) {
      lives--;
      flashDamage();
      playerInvulnerable = 90;
      setText(dom.lives, String(lives));
      if (lives <= 0) {
        endGame();
        return;
      }
    }

    for (const bullet of bullets) {
      if (Math.abs(bullet.x - enemy.x) < enemy.w && Math.abs(bullet.y - ey) < 20) {
        enemy.health -= bullet.damage || 1;
        if (!bullet.piercing) bullet.y = -100;
        superDamage += bullet.damage || 1;
        if (enemy.health <= 0) {
          enemy.alive = false;
          score += 100;
          kills++;
          playSound(520, 0.08, "square");
        }
        setText(dom.score, String(score).padStart(6, "0"));
        break;
      }
    }
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
    showWaveCleared(wave);
    wave++;
    createEnemies();
  }
}

function enterBossArea() {
  bossMode = false;
  bossIntro = true;
  bossDefeated = false;
  boss = { x: W / 2, y: 180, health: BOSS_MAX_HEALTH };
  resetBossAnimation();
  bossShotTimer = 30;
  bossAttackTimer = 0;
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
}

function startBossFight() {
  bossIntro = false; bossMode = true;
  document.getElementById("boss-intro").classList.remove("visible");
  if (audioContext && !bossMusicTimer) {
    const notes = [110, 138, 123, 92]; let index = 0;
    bossMusicTimer = setInterval(() => playSound(notes[index++ % notes.length], 0.28, "sawtooth"), 360);
  }
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
const mouthGradients = [null, null];

// Fixed surface features, so Mercury reads as the same rock every frame while
// the whole crater field rotates slowly under the clip.
const BOSS_CRATERS = [
  { a: 0.4, d: 0.42, r: 13 }, { a: 1.7, d: 0.62, r: 9 }, { a: 2.6, d: 0.3, r: 16 },
  { a: 3.5, d: 0.7, r: 7 }, { a: 4.3, d: 0.5, r: 11 }, { a: 5.2, d: 0.28, r: 8 },
  { a: 5.9, d: 0.68, r: 12 }, { a: 2.1, d: 0.85, r: 6 }, { a: 4.9, d: 0.86, r: 5 },
];
// Crack seeds in unit space; revealed progressively as Mercury loses health.
const BOSS_CRACKS = [
  [[-0.62, -0.28], [-0.3, -0.14], [-0.16, -0.34], [0.08, -0.2]],
  [[0.2, 0.66], [0.1, 0.34], [0.34, 0.16], [0.28, -0.12]],
  [[-0.72, 0.3], [-0.38, 0.34], [-0.22, 0.58], [0.02, 0.62]],
  [[0.74, 0.1], [0.44, 0.04], [0.3, -0.26], [0.5, -0.5]],
  [[-0.1, -0.78], [-0.04, -0.42], [-0.3, -0.2], [-0.2, 0.1]],
];

function spawnBossParticles(count, options) {
  for (let i = 0; i < count; i++) {
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
  if (bossMusicTimer) { clearInterval(bossMusicTimer); bossMusicTimer = null; }
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
  const livesEl = dom.lives;
  if (livesEl) setText(livesEl, String(lives));
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

  ctx.scale(scale * squashX, scale * squashY);

  // --- orbital ring, back half -------------------------------------------
  const ringTilt = 0.34;
  ctx.save();
  ctx.rotate(-0.18);
  ctx.strokeStyle = "rgba(160, 140, 200, 0.45)";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, 6, R * 1.42, R * ringTilt, 0, Math.PI, Math.PI * 2); ctx.stroke();
  ctx.restore();

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
    const glow = bossDying ? 1 : 0.5 + Math.sin(t * 0.01) * 0.2;
    const crackColor = `rgba(255, ${bossDying ? 200 : 140}, 60, ${glow.toFixed(3)})`;
    const crackWidth = bossDying ? 6 : 3.5;
    for (let i = 0; i < Math.min(crackCount, BOSS_CRACKS.length); i++) {
      const path = BOSS_CRACKS[i];
      ctx.beginPath();
      for (let n = 0; n < path.length; n++) {
        const x = path[n][0] * R;
        const y = path[n][1] * R;
        if (n === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = crackColor;
      ctx.lineWidth = crackWidth;
      ctx.stroke();
      ctx.strokeStyle = "rgba(20, 14, 12, 0.75)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
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
  const eyeRadius = (5.5 + charge * 3.5 + shoot * 2) * (hit > 0 ? 0.7 : 1);

  ctx.fillStyle = "#171717";
  BROW_SIDES.forEach((side) => {
    ctx.save();
    ctx.translate(side * 19, -13);
    ctx.rotate(side * angry * 0.55);
    ctx.beginPath();
    ctx.moveTo(-16, -6); ctx.lineTo(14, -13); ctx.lineTo(15, -5); ctx.lineTo(-15, 2);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  });

  if (hit > 0.05) {
    // squinting in pain
    ctx.strokeStyle = eyeGlow;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    BROW_SIDES.forEach((side) => {
      ctx.beginPath();
      ctx.moveTo(side * 19 - 6, -10);
      ctx.lineTo(side * 19 + 6, -10);
      ctx.stroke();
    });
  } else {
    ctx.shadowColor = eyeGlow;
    ctx.shadowBlur = 12 + charge * 16;
    ctx.fillStyle = eyeGlow;
    ctx.beginPath();
    ctx.arc(-19, -11, eyeRadius, 0, Math.PI * 2);
    ctx.arc(19, -11, eyeRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(-21, -13, eyeRadius * 0.32, 0, Math.PI * 2);
    ctx.arc(17, -13, eyeRadius * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }

  // mouth: frown at rest, puckers on the wind-up, gapes on the shot
  const mouthOpen = shoot * 20 + charge * 8;
  if (mouthOpen > 1.5) {
    // Two fixed variants (winding up vs. firing), built on first use.
    const winding = charge > 0.05 && shoot === 0;
    if (!mouthGradients[winding ? 1 : 0]) {
      const gradient = ctx.createRadialGradient(0, 22, 2, 0, 22, 26);
      gradient.addColorStop(0, winding ? "#ffd07a" : "#ffe9a8");
      gradient.addColorStop(0.5, "#ff6a2c");
      gradient.addColorStop(1, "#160606");
      mouthGradients[winding ? 1 : 0] = gradient;
    }
    ctx.fillStyle = mouthGradients[winding ? 1 : 0];
    ctx.beginPath();
    ctx.ellipse(0, 22, 14 + mouthOpen * 0.5, mouthOpen, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = "#171717";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(0, 34, 22, Math.PI + 0.3, Math.PI * 2 - 0.3);
    ctx.stroke();
  }

  // --- hit flash overlay --------------------------------------------------
  if (hit > 0) {
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255, 255, 255, ${hit * 0.5})`;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }

  // --- orbital ring, front half ------------------------------------------
  ctx.save();
  ctx.rotate(-0.18);
  ctx.strokeStyle = "rgba(215, 195, 255, 0.75)";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.ellipse(0, 6, R * 1.42, R * ringTilt, 0, 0, Math.PI); ctx.stroke();
  const moonAngle = t * 0.0012;
  ctx.fillStyle = "#e6e0f5";
  ctx.beginPath();
  ctx.arc(Math.cos(moonAngle) * R * 1.42, 6 + Math.sin(moonAngle) * R * ringTilt, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();

  if (bossHitFlash > 0) bossHitFlash--;
  if (bossShootAnim > 0) bossShootAnim--;
}

function drawBossArea(t) {
  ctx.fillStyle = "#16051f"; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(bossGridLayer, 0, 0);

  if (bossDying) updateBossDeath();
  drawMercury(t);
  updateBossExplosions();
  updateBossParticles();

  if (!bossDying) {
    bossShotTimer--;
    if (bossShotTimer === 12) {
      bossChargeAnim = BOSS_CHARGE_FRAMES;
      playSound(90, 0.12, "triangle");
    }
    if (bossChargeAnim > 0) bossChargeAnim--;
    if (bossShotTimer <= 0) {
      const angle = Math.atan2(player.y - boss.y, player.x - boss.x);
      enemyBullets.push({ x: boss.x, y: boss.y + 70, vx: Math.cos(angle) * 4.2, vy: Math.sin(angle) * 4.2, speed: 4.2, turnRate: 0.018 });
      bossShootAnim = BOSS_SHOOT_FRAMES;
      bossChargeAnim = 0;
      spawnBossParticles(10, {
        x: boss.x, y: boss.y + 34, angle, spread: 0.5, minSpeed: 1, maxSpeed: 3.6,
        minSize: 2, maxSize: 4, life: 20, colors: ["#ffdc5a", "#ff8a32", "#fff3c4"],
      });
      bossShotTimer = 28;
    }
  }

  for (const bullet of enemyBullets) {
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
      lives--; playerInvulnerable = 90; flashDamage();
      setText(dom.lives, String(lives));
      bullet.y = H + 100;
      if (lives <= 0) { endGame(); return; }
    }
  }
  compact(enemyBullets, (bullet) => bullet.y < H + 20);

  for (const bomb of superBombs) {
    bomb.x += bomb.vx; bomb.y += bomb.vy; bomb.life--;
    ctx.fillStyle = "#63f7ff"; ctx.shadowColor = "#63f7ff"; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    if (Math.hypot(bomb.x - boss.x, bomb.y - boss.y) < 88 || bomb.life <= 0) {
      if (!bossDying) damageBoss(15, bomb.x, bomb.y);
      bossExplosions.push({ x: bomb.x, y: bomb.y, r: 0, max: 110, life: 18, maxLife: 18 });
      bomb.explode = true;
    }
  }
  compact(superBombs, (bomb) => !bomb.explode);

  for (const bullet of bullets) {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    ctx.rotate(Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2);
    if (bullet.type === "charge") {
      ctx.fillStyle = "#ff8a32"; ctx.shadowColor = "#ff8a32"; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(0, 0, bullet.size, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    } else if (bullet.type === "cone") {
      ctx.fillStyle = "#63ff91";
      ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(4, 0); ctx.lineTo(0, 7); ctx.lineTo(-4, 0); ctx.closePath(); ctx.fill();
    } else { ctx.fillStyle = "#ffdc5a"; ctx.fillRect(-2, -6, 4, 12); }
    ctx.restore();
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
    if (bossAttackTimer === 20) {
      bossChargeAnim = BOSS_CHARGE_FRAMES;
      playSound(70, 0.22, "triangle");
    }
    if (bossAttackTimer <= 0) {
      const baseAngle = Math.atan2(player.y - boss.y, player.x - boss.x);
      bossBullets.push(
        { x: boss.x, y: boss.y + 60, vx: Math.cos(baseAngle - 0.3) * 4, vy: Math.sin(baseAngle - 0.3) * 4 },
        { x: boss.x, y: boss.y + 60, vx: Math.cos(baseAngle) * 4, vy: Math.sin(baseAngle) * 4 },
        { x: boss.x, y: boss.y + 60, vx: Math.cos(baseAngle + 0.3) * 4, vy: Math.sin(baseAngle + 0.3) * 4 }
      );
      bossShootAnim = BOSS_SHOOT_FRAMES;
      bossChargeAnim = 0;
      bossShakeTimer = Math.max(bossShakeTimer, 5);
      spawnBossParticles(18, {
        x: boss.x, y: boss.y + 34, angle: baseAngle, spread: 0.7, minSpeed: 1.5, maxSpeed: 5,
        minSize: 2, maxSize: 5, life: 26, colors: ["#ffdc5a", "#ff8a32", "#fff3c4"],
      });
      playSound(220, 0.15, "sawtooth");
      bossAttackTimer = 180;
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
      lives--;
      flashDamage();
      playerInvulnerable = 90;
      setText(dom.lives, String(lives));
      b.y = H + 100;
      if (lives <= 0) { endGame(); return; }
    }
  }
  compact(bossBullets, (b) => b.x > -30 && b.x < W + 30 && b.y > -30 && b.y < H + 30);

  if (boss.health <= 0 && !bossDying && !bossDefeated) startBossDeath();
  drawPlayer();
}

function showVictory() {
  gamePaused = true;
  bossIntro = true;
  document.getElementById("boss-player-name").textContent = playerName;
  document.getElementById("victory-player-name").textContent = playerName;
  refreshLoadoutUI();
  document.getElementById("victory-screen").classList.add("visible");
  document.getElementById("victory-screen").setAttribute("aria-hidden", "false");
}

function drawTestRoom() {
  ctx.fillStyle = "#07131a"; ctx.fillRect(0, 0, W, H);
  for (const bomb of superBombs) {
    bomb.x += bomb.vx; bomb.y += bomb.vy; bomb.life--;
    ctx.fillStyle = "#63f7ff"; ctx.shadowColor = "#63f7ff"; ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    if (Math.hypot(bomb.x - W / 2, bomb.y - 190) < 68 || bomb.life <= 0) { bomb.explode = true; testDamage += 15; }
  }
  compact(superBombs, (bomb) => !bomb.explode);
  for (const bullet of bullets) {
    bullet.x += bullet.vx; bullet.y += bullet.vy;
    ctx.save(); ctx.translate(bullet.x, bullet.y); ctx.rotate(Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2);
    if (bullet.type === "charge") { ctx.fillStyle = "#ff8a32"; ctx.beginPath(); ctx.arc(0, 0, bullet.size, 0, Math.PI * 2); ctx.fill(); }
    else if (bullet.type === "cone") { ctx.fillStyle = "#63ff91"; ctx.beginPath(); ctx.moveTo(0,-7); ctx.lineTo(4,0); ctx.lineTo(0,7); ctx.lineTo(-4,0); ctx.closePath(); ctx.fill(); }
    else { ctx.fillStyle = "#ffdc5a"; ctx.fillRect(-2, -6, 4, 12); }
    ctx.restore();
    if (Math.hypot(bullet.x - W / 2, bullet.y - 190) < 58) { bullet.y = -100; testDamage += bullet.damage || 1; superDamage += bullet.damage || 1; updateSuperMeter(); }
  }
  compact(bullets, (b) => b.y > -20 && b.y < H + 20 && b.x > -20 && b.x < W + 20);
  ctx.fillStyle = "#777"; ctx.beginPath(); ctx.arc(W / 2, 190, 58, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#aaa"; ctx.beginPath(); ctx.arc(W / 2 - 18, 175, 9, 0, Math.PI * 2); ctx.arc(W / 2 + 20, 205, 7, 0, Math.PI * 2); ctx.fill();
  setText(dom.testDamage, `DAMAGE: ${testDamage}`);
  updateChargeMeter();
  drawPlayer();
}

function drawPlayer() {
  const scale = player.shrunk ? 0.55 : 1;
  ctx.save(); ctx.translate(player.x, player.y); ctx.scale(scale, scale); ctx.rotate(Math.atan2(facing.y, facing.x) + Math.PI / 2);
  ctx.fillStyle = playerColor; ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-18, 16); ctx.lineTo(0, 9); ctx.lineTo(18, 16); ctx.closePath(); ctx.fill(); ctx.restore();
  if (playerInvulnerable > 0) { ctx.strokeStyle = "rgba(255,255,255,.7)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(player.x, player.y, player.shrunk ? 24 : 34, 0, Math.PI * 2); ctx.stroke(); }
  if (invincibilitySuperTimer > 0) {
    const radius = player.shrunk ? 29 : 42;
    const pulse = Math.sin(performance.now() * 0.012) * 2;
    ctx.fillStyle = "rgba(255, 205, 45, .12)";
    ctx.strokeStyle = "rgba(255, 215, 70, .95)";
    ctx.lineWidth = 3;
    ctx.shadowColor = "rgba(255, 190, 30, .85)";
    ctx.shadowBlur = 16;
    ctx.beginPath(); ctx.arc(player.x, player.y, radius + pulse, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

function endGame() {
  gameActive = false;
  playSound(90, 0.55, "sawtooth");
  document.getElementById("test-damage").classList.remove("visible");
  bossIntro = false;
  if (bossMusicTimer) { clearInterval(bossMusicTimer); bossMusicTimer = null; }
  bossMode = false;
  gameOverShown = true;
  enemyBullets = [];
  document.getElementById("game-message").textContent = "GAME OVER";
  document.getElementById("try-again-btn").classList.add("visible");
  document.getElementById("main-menu-btn").classList.add("visible");
}

function startGame() {
  try {
    if (!audioContext) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (AudioCtor) audioContext = new AudioCtor();
    }
    audioContext?.resume();
  } catch (error) {
    audioContext = null;
  }
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
  gamePaused = false;
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
  enemyShotTimer = 60;
  player.x = W / 2;
  player.y = H - 80;
  player.vx = 0;
  player.vy = 0;
  createEnemies();
  document.getElementById("menu-wrap").classList.add("hidden");
  document.getElementById("game-ui").classList.add("active");
  document.getElementById("game-ui").setAttribute("aria-hidden", "false");
  document.getElementById("game-message").textContent = "";
  document.getElementById("wave-clear-message").textContent = "";
  document.getElementById("wave-clear-message").classList.remove("flash");
  document.getElementById("try-again-btn").classList.remove("visible");
  document.getElementById("main-menu-btn").classList.remove("visible");
  document.getElementById("boss-health").classList.remove("visible");
  document.getElementById("test-damage").classList.toggle("visible", testMode);
  document.getElementById("boss-intro").classList.remove("visible");
  document.getElementById("victory-screen").classList.remove("visible");
  document.getElementById("victory-screen").setAttribute("aria-hidden", "true");
  playerName = "PLAYER";
  setText(dom.score, "000000");
  setText(dom.lives, "3");
  updateSuperMeter();
}

function flashDamage() {
  const flash = dom.damageFlash;
  flash.classList.remove("active");
  void flash.offsetWidth;
  flash.classList.add("active");
}

function showWaveCleared(number) {
  const message = document.getElementById("wave-clear-message");
  message.textContent = `WAVE ${number} CLEARED`;
  message.classList.remove("flash");
  void message.offsetWidth;
  message.classList.add("flash");
}

function updateSuperMeter() {
  const requiredDamage = selectedSuper === "void" ? 40 : 20;
  superMeter = Math.min(1, (superDamage - lastSuperKills) / requiredDamage);
  setWidth(dom.superFill, superMeter * 100);
}

const WEAPON_LABELS = { blaster: "BLASTER", charge: "CHARGE", cone: "CONE" };
const SUPER_LABELS = { bomb: "BOMB", invincibility: "INVINCIBILITY", void: "VOID" };

// Every place a loadout can be picked (weapons panel + victory screen) is
// repainted from `selectedWeapon` / `selectedSuper`, so the highlight can never
// drift out of sync with what the ship actually fires.
function refreshLoadoutUI() {
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
    const requiredDamage = nextSuper === "void" ? 40 : 20;
    lastSuperKills = superDamage - requiredDamage * 0.5;
  }
  selectedSuper = nextSuper;
  refreshLoadoutUI();
  playSound(520, 0.06, "square");
  updateSuperMeter();
}

function playSound(frequency, duration, type) {
  if (!audioContext) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.045, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + duration);
}

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

function fireInDirection(dx, dy, damage = player.shrunk ? 0.5 : 1, type = "basic", size = 3) {
  if (!gameActive || bullets.length >= 10) return;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  facing.x = dx;
  facing.y = dy;
  bullets.push({ x: player.x, y: player.y, vx: dx * 10, vy: dy * 10, damage, type, size, piercing: damage > 1 });
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
    setChargeColor("#63ff91");
    return;
  }
  const held = performance.now() - chargeStartedAt;
  setWidth(dom.chargeFill, Math.min(100, held / 2500 * 100));
  setChargeColor(held < 850 ? "#63ff91" : held < 1700 ? "#ff9d32" : "#ff4747");
}

const CONE_ANGLES = [-0.16, 0, 0.16];

function fireCone(dx, dy) {
  const length = Math.hypot(dx, dy) || 1; dx /= length; dy /= length;
  const base = Math.atan2(dy, dx);
  for (const offset of CONE_ANGLES) {
    const angle = base + offset;
    fireInDirection(Math.cos(angle), Math.sin(angle), player.shrunk ? 0.5 : 1, "cone");
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

resize();
initStars();
refreshLoadoutUI();
requestAnimationFrame(frame);

document.getElementById("start-btn").addEventListener("click", function () {
  showLoading(startGame);
});
document.getElementById("try-again-btn").addEventListener("click", function () {
  showLoading(startGame);
});
document.getElementById("main-menu-btn").addEventListener("click", function () {
  gameActive = false;
  bossMode = false;
  bossIntro = false;
  document.getElementById("game-ui").classList.remove("active");
  document.getElementById("menu-wrap").classList.remove("hidden");
  document.getElementById("game-message").textContent = "";
  document.getElementById("try-again-btn").classList.remove("visible");
  document.getElementById("main-menu-btn").classList.remove("visible");
});
document.getElementById("continue-boss").addEventListener("click", startBossFight);
document.getElementById("victory-continue").addEventListener("click", function () {
  document.getElementById("victory-screen").classList.remove("visible");
  document.getElementById("victory-screen").setAttribute("aria-hidden", "true");
  gamePaused = false;
  bossIntro = false;
  bossMode = false;
  wave = 6;
  player.x = W / 2; player.y = H - 80; player.vx = 0; player.vy = 0;
  enemyBullets = [];
  createEnemies();
  showWaveCleared(5);
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
  const panel = document.getElementById("controls-panel");
  panel.classList.add("visible");
  panel.setAttribute("aria-hidden", "false");
});
document.querySelectorAll(".color-choice").forEach((choice) => choice.addEventListener("click", function () {
  playerColor = choice.dataset.color;
  document.querySelectorAll(".color-choice").forEach((item) => item.classList.remove("selected"));
  choice.classList.add("selected");
}));
document.getElementById("controls-close").addEventListener("click", function () {
  const panel = document.getElementById("controls-panel");
  panel.classList.remove("visible");
  panel.setAttribute("aria-hidden", "true");
});
document.getElementById("weapons-btn").addEventListener("click", function () {
  const panel = document.getElementById("weapons-panel");
  panel.classList.add("visible");
  panel.setAttribute("aria-hidden", "false");
});
document.getElementById("weapons-close").addEventListener("click", function () {
  const panel = document.getElementById("weapons-panel");
  panel.classList.remove("visible");
  panel.setAttribute("aria-hidden", "true");
});
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
      fireCooldown = 0;
    }
  }
  if (gameActive && e.code === "Escape") {
    e.preventDefault();
    if (!e.repeat) {
      gamePaused = !gamePaused;
      document.getElementById("game-message").textContent = gamePaused ? "PAUSED" : "";
    }
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
    if (selectedSuper === "invincibility") { playerInvulnerable = 300; invincibilitySuperTimer = 300; lastSuperKills = superDamage; superMeter = 0; updateSuperMeter(); return; }
    if (selectedSuper === "void") { superBombs.push({ x: player.x, y: player.y, vx: facing.x * 8, vy: facing.y * 8, life: 75, explode: false, void: true }); lastSuperKills = superDamage; superMeter = 0; updateSuperMeter(); return; }
    superBombs.push({ x: player.x, y: player.y, vx: facing.x * 8, vy: facing.y * 8, life: 75, explode: false });
    playSound(180, 0.18, "triangle");
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
    const damage = Math.min(5, Math.max(1, Math.ceil((performance.now() - chargeStartedAt) / 500)));
    const size = Math.min(9, 3 + Math.floor((performance.now() - chargeStartedAt) / 350));
    fireInDirection(dirX, dirY, damage, "charge", size);
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
