const canvas = document.getElementById("space-bg");
const ctx = canvas.getContext("2d");

let W, H;
let centerX, centerY;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  centerX = W / 2;
  centerY = H / 2;
}
window.addEventListener("resize", resize);
resize();

const STAR_COUNT = 260;
const STATIC_STAR_COUNT = 180;

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
const keys = {};

function rand(min, max) {
  return Math.random() * (max - min) + min;
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
  for (let i = 0; i < STATIC_STAR_COUNT; i++) {
    staticStars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      radius: rand(0.25, 0.75),
      alpha: rand(0.35, 0.8),
    });
  }
}

function drawStaticStars() {
  ctx.fillStyle = "#ffffff";
  for (const star of staticStars) {
    ctx.globalAlpha = star.alpha;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
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
  s.color = [
    "255, 255, 255",
    "255, 220, 90",
    "190, 125, 255",
    "18, 18, 24",
  ][Math.floor(Math.random() * 4)];
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

    ctx.strokeStyle = `rgba(${s.color}, ${alpha * 0.28})`;
    ctx.lineWidth = Math.max(0.4, radius * 0.6);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(previousX, previousY);
    ctx.lineTo(x, y);
    ctx.stroke();

    ctx.fillStyle = `rgba(${s.color}, ${alpha})`;
    ctx.strokeStyle = s.color === "18, 18, 24"
      ? `rgba(95, 95, 110, ${alpha * 0.45})`
      : "transparent";
    ctx.lineWidth = 0.45;
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
    if (s.color === "18, 18, 24") ctx.stroke();

    if (s.depth > 1.12 || x < -radius || x > W + radius || y < -radius || y > H + radius) {
      resetStarOutward(s);
    }
  }
}

function draw(t) {
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, W, H);
  centerX = W / 2;
  centerY = H / 2;
  if (!gameActive) drawStaticStars();
  if (gameOverShown) drawStars(t);
  if (gameActive && !gamePaused) drawGame();
  updateChargeMeter();
  const waveDisplay = document.getElementById("wave-number");
  if (waveDisplay) waveDisplay.textContent = String(wave);
  requestAnimationFrame(draw);
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

function drawGame() {
  const left = keys.KeyA;
  const right = keys.KeyD;
  const up = keys.KeyW;
  const down = keys.KeyS;
  const shrunk = keys.Space && performance.now() - spaceDownAt > 180;
  player.shrunk = Boolean(shrunk);
  const targetX = (right ? 1 : 0) - (left ? 1 : 0);
  const targetY = (down ? 1 : 0) - (up ? 1 : 0);
  const movementSpeed = player.shrunk ? player.maxSpeed * 1.4 : player.maxSpeed;
  player.vx += (targetX * movementSpeed - player.vx) * player.speed;
  player.vy += (targetY * movementSpeed - player.vy) * player.speed;
  player.x += player.vx;
  player.y += player.vy;
  if (!targetX) player.vx *= 0.88;
  if (!targetY) player.vy *= 0.88;
  player.x = Math.max(24, Math.min(W - 24, player.x));
  player.y = Math.max(28, Math.min(H - 28, player.y));
  if ((player.x <= 24 && player.vx < 0) || (player.x >= W - 24 && player.vx > 0)) player.vx = 0;
  if ((player.y <= 28 && player.vy < 0) || (player.y >= H - 28 && player.vy > 0)) player.vy = 0;

  if (fireCooldown > 0) fireCooldown--;
  const activeAimX = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
  const activeAimY = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
  const aimX = activeAimX || lastArrowDirection.x;
  const aimY = activeAimY || lastArrowDirection.y;
  if (aimX || aimY) {
    const aimLength = Math.hypot(aimX, aimY);
    facing = { x: aimX / aimLength, y: aimY / aimLength };
  }
  if (fireCooldown <= 0) {
    const shootX = (keys.ArrowRight || keys.ArrowLeft || keys.ArrowUp || keys.ArrowDown) ? aimX : 0;
    const shootY = (keys.ArrowRight || keys.ArrowLeft || keys.ArrowUp || keys.ArrowDown) ? aimY : 0;
    if (selectedWeapon === "cone" && (shootX || shootY)) {
      fireCone(shootX, shootY);
      fireCooldown = 18;
    } else if (selectedWeapon === "blaster" && (shootX || shootY)) {
      fireInDirection(shootX, shootY);
      fireCooldown = 10;
    }
  }

  if (bossIntro) return;
  if (playerInvulnerable > 0) playerInvulnerable--;
  if (invincibilitySuperTimer > 0) invincibilitySuperTimer--;
  if (bossMode) { drawBossArea(); return; }
  if (testMode) { drawTestRoom(); return; }

  for (const bomb of superBombs) {
    bomb.x += bomb.vx;
    bomb.y += bomb.vy;
    bomb.life--;
    if (enemies.some((enemy) => enemy.alive && Math.hypot(enemy.x - bomb.x, enemy.y - bomb.y) < 26)) {
      bomb.explode = true;
    }
    ctx.fillStyle = "#63f7ff";
    ctx.shadowColor = "#63f7ff";
    ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 9, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    if (bomb.life <= 0 || bomb.x < 0 || bomb.x > W || bomb.y < 0 || bomb.y > H) bomb.explode = true;
  }
  for (const bomb of superBombs.filter((b) => b.explode)) {
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
  superBombs = superBombs.filter((b) => !b.explode);
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
  bullets = bullets.filter((b) => b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20);

  enemyShotTimer--;
  if (enemyShotTimer <= 0) {
    const living = enemies.filter((enemy) => enemy.alive);
    if (living.length) {
      const shooter = living[Math.floor(Math.random() * living.length)];
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
      document.getElementById("lives").textContent = String(lives);
      bullet.y = H + 100;
      if (lives <= 0) { endGame(); return; }
    }
  }
  enemyBullets = enemyBullets.filter((bullet) => bullet.y < H + 20);

  const time = performance.now() * 0.001;
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
      document.getElementById("lives").textContent = String(lives);
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
        document.getElementById("score").textContent = String(score).padStart(6, "0");
        break;
      }
    }
  }
  if (enemies.every((e) => !e.alive)) {
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
  boss = { x: W / 2, y: 180, health: 75 };
  bossShotTimer = 30;
  bossAttackTimer = 0;
  bossBullets = [];
  document.getElementById("boss-health").classList.add("visible");
  const bossFill = document.getElementById("boss-fill");
  bossFill.style.width = "0%";
  const bossHealth = document.getElementById("boss-health");
  bossHealth.classList.remove("filling");
  void bossHealth.offsetWidth;
  bossHealth.classList.add("filling");
  setTimeout(() => bossHealth.classList.remove("filling"), 1600);
  player.x = W / 2; player.y = H - 80; player.vx = 0; player.vy = 0;
  document.getElementById("boss-player-name").textContent = playerName;
  document.getElementById("boss-intro").classList.add("visible");
}

function startBossFight() {
  bossIntro = false; bossMode = true;
  document.getElementById("boss-intro").classList.remove("visible");
  if (audioContext && !bossMusicTimer) {
    const notes = [110, 138, 123, 92]; let index = 0;
    bossMusicTimer = setInterval(() => playSound(notes[index++ % notes.length], 0.28, "sawtooth"), 360);
  }
}

function drawBossArea() {
  ctx.fillStyle = "#16051f"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(180, 80, 255, 0.16)";
  for (let x = 0; x < W; x += 50) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 50) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  const planet = ctx.createRadialGradient(boss.x - 24, boss.y - 28, 8, boss.x, boss.y, 78);
  planet.addColorStop(0, "#e3e3e3"); planet.addColorStop(0.55, "#929292"); planet.addColorStop(1, "#3e3e3e");
  ctx.fillStyle = planet; ctx.beginPath(); ctx.arc(boss.x, boss.y, 78, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(35,35,35,0.3)";
  [[-28,-25,10],[25,-8,7],[-8,30,13],[42,28,5]].forEach(([x,y,r]) => { ctx.beginPath(); ctx.arc(boss.x+x,boss.y+y,r,0,Math.PI*2); ctx.fill(); });
  ctx.fillStyle = "#191919";
  ctx.beginPath(); ctx.moveTo(boss.x - 35, boss.y - 12); ctx.lineTo(boss.x - 7, boss.y - 25); ctx.lineTo(boss.x - 5, boss.y - 15); ctx.lineTo(boss.x - 32, boss.y - 4); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(boss.x + 35, boss.y - 12); ctx.lineTo(boss.x + 7, boss.y - 25); ctx.lineTo(boss.x + 5, boss.y - 15); ctx.lineTo(boss.x + 32, boss.y - 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ff4f91"; ctx.beginPath(); ctx.arc(boss.x - 19, boss.y - 11, 5, 0, Math.PI * 2); ctx.arc(boss.x + 19, boss.y - 11, 5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#191919"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(boss.x, boss.y + 16, 22, Math.PI + 0.25, Math.PI * 2 - 0.25); ctx.stroke();
  bossShotTimer--;
  if (bossShotTimer <= 0) {
    const angle = Math.atan2(player.y - boss.y, player.x - boss.x);
    enemyBullets.push({ x: boss.x, y: boss.y + 70, vx: Math.cos(angle) * 4.2, vy: Math.sin(angle) * 4.2, speed: 4.2, turnRate: 0.018 });
    bossShotTimer = 28;
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
      document.getElementById("lives").textContent = String(lives);
      bullet.y = H + 100;
      if (lives <= 0) { endGame(); return; }
    }
  }
  enemyBullets = enemyBullets.filter((bullet) => bullet.y < H + 20);
  for (const bomb of superBombs) {
    bomb.x += bomb.vx; bomb.y += bomb.vy; bomb.life--;
    ctx.fillStyle = "#63f7ff"; ctx.shadowColor = "#63f7ff"; ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(bomb.x, bomb.y, 9, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    if (Math.hypot(bomb.x - boss.x, bomb.y - boss.y) < 88 || bomb.life <= 0) {
      boss.health -= 15;
      bomb.explode = true;
    }
  }
  superBombs = superBombs.filter((bomb) => !bomb.explode);
  for (const bullet of bullets) {
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;
    ctx.fillStyle = "#ffdc5a";
    ctx.fillRect(bullet.x - 2, bullet.y - 6, 4, 12);
    if (Math.hypot(bullet.x - boss.x, bullet.y - boss.y) < 82) {
      bullet.y = -100;
      boss.health -= bullet.damage || 1;
      superDamage += bullet.damage || 1;
      updateSuperMeter();
    }
  }
  bullets = bullets.filter((bullet) => bullet.x > -20 && bullet.x < W + 20 && bullet.y > -20 && bullet.y < H + 20);
  document.getElementById("boss-fill").style.width = `${(boss.health / 75) * 100}%`;

  bossAttackTimer--;
  if (bossAttackTimer <= 0) {
    const baseAngle = Math.atan2(player.y - boss.y, player.x - boss.x);
    bossBullets.push(
      { x: boss.x, y: boss.y + 60, vx: Math.cos(baseAngle - 0.3) * 4, vy: Math.sin(baseAngle - 0.3) * 4 },
      { x: boss.x, y: boss.y + 60, vx: Math.cos(baseAngle) * 4, vy: Math.sin(baseAngle) * 4 },
      { x: boss.x, y: boss.y + 60, vx: Math.cos(baseAngle + 0.3) * 4, vy: Math.sin(baseAngle + 0.3) * 4 }
    );
    playSound(220, 0.15, "sawtooth");
    bossAttackTimer = 180;
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
      document.getElementById("lives").textContent = String(lives);
      b.y = H + 100;
      if (lives <= 0) { endGame(); return; }
    }
  }
  bossBullets = bossBullets.filter((b) => b.x > -30 && b.x < W + 30 && b.y > -30 && b.y < H + 30);

  if (boss.health <= 0) {
    bossMode = false;
    wave = 6;
    if (bossMusicTimer) { clearInterval(bossMusicTimer); bossMusicTimer = null; }
    document.getElementById("boss-health").classList.remove("visible");
    bullets = [];
    bossBullets = [];
    lives++;
    const livesEl = document.getElementById("lives");
    if (livesEl) livesEl.textContent = String(lives);
    if (!bossDefeated) {
      bossDefeated = true;
      showVictory();
    }
  }
  drawPlayer();
}

function showVictory() {
  gamePaused = true;
  bossIntro = true;
  document.getElementById("boss-player-name").textContent = playerName;
  document.getElementById("victory-player-name").textContent = playerName;
  document.querySelectorAll("[data-victory-weapon]").forEach((item) => item.classList.toggle("selected", item.dataset.victoryWeapon === selectedWeapon));
  document.querySelectorAll("[data-victory-super]").forEach((item) => item.classList.toggle("selected", item.dataset.victorySuper === selectedSuper));
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
  superBombs = superBombs.filter((bomb) => !bomb.explode);
  for (const bullet of bullets) {
    bullet.x += bullet.vx; bullet.y += bullet.vy;
    ctx.save(); ctx.translate(bullet.x, bullet.y); ctx.rotate(Math.atan2(bullet.vy, bullet.vx) + Math.PI / 2);
    if (bullet.type === "charge") { ctx.fillStyle = "#ff8a32"; ctx.beginPath(); ctx.arc(0, 0, bullet.size, 0, Math.PI * 2); ctx.fill(); }
    else if (bullet.type === "cone") { ctx.fillStyle = "#63ff91"; ctx.beginPath(); ctx.moveTo(0,-7); ctx.lineTo(4,0); ctx.lineTo(0,7); ctx.lineTo(-4,0); ctx.closePath(); ctx.fill(); }
    else { ctx.fillStyle = "#ffdc5a"; ctx.fillRect(-2, -6, 4, 12); }
    ctx.restore();
    if (Math.hypot(bullet.x - W / 2, bullet.y - 190) < 58) { bullet.y = -100; testDamage += bullet.damage || 1; superDamage += bullet.damage || 1; updateSuperMeter(); }
  }
  bullets = bullets.filter((b) => b.y > -20 && b.y < H + 20 && b.x > -20 && b.x < W + 20);
  ctx.fillStyle = "#777"; ctx.beginPath(); ctx.arc(W / 2, 190, 58, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#aaa"; ctx.beginPath(); ctx.arc(W / 2 - 18, 175, 9, 0, Math.PI * 2); ctx.arc(W / 2 + 20, 205, 7, 0, Math.PI * 2); ctx.fill();
  document.getElementById("test-damage").textContent = `DAMAGE: ${testDamage}`;
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
  facing = { x: 0, y: -1 };
  lastArrowDirection = { x: 0, y: -1 };
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
  document.getElementById("score").textContent = "000000";
  document.getElementById("lives").textContent = "3";
  updateSuperMeter();
}

function flashDamage() {
  const flash = document.getElementById("damage-flash");
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
  document.getElementById("super-fill").style.width = `${superMeter * 100}%`;
}

function setSelectedSuper(nextSuper) {
  if (nextSuper !== selectedSuper && superMeter >= 1) {
    const requiredDamage = nextSuper === "void" ? 40 : 20;
    lastSuperKills = superDamage - requiredDamage * 0.5;
  }
  selectedSuper = nextSuper;
  document.querySelectorAll("[data-super], [data-victory-super]").forEach((item) => item.classList.toggle("selected", item.dataset.super === nextSuper || item.dataset.victorySuper === nextSuper));
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

function fireInDirection(dx, dy, damage = player.shrunk ? 0.5 : 1, type = "basic", size = 3) {
  if (!gameActive || bullets.length >= 10) return;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  facing = { x: dx, y: dy };
  bullets.push({ x: player.x, y: player.y, vx: dx * 10, vy: dy * 10, damage, type, size, piercing: damage > 1, hitEnemies: new Set() });
}

function updateChargeMeter() {
  const meter = document.getElementById("charge-meter");
  const fill = document.getElementById("charge-fill");
  const active = gameActive && selectedWeapon === "charge";
  meter.classList.toggle("visible", active);
  if (!active || !chargeStartedAt) { fill.style.width = "0%"; fill.style.background = "#63ff91"; return; }
  const held = performance.now() - chargeStartedAt;
  fill.style.width = `${Math.min(100, held / 2500 * 100)}%`;
  fill.style.background = held < 850 ? "#63ff91" : held < 1700 ? "#ff9d32" : "#ff4747";
}

function fireCone(dx, dy) {
  const length = Math.hypot(dx, dy) || 1; dx /= length; dy /= length;
  const aim = { x: dx, y: dy };
  const angles = [-0.16, 0, 0.16];
  angles.forEach((offset) => {
    const angle = Math.atan2(dy, dx) + offset;
    fireInDirection(Math.cos(angle), Math.sin(angle), player.shrunk ? 0.5 : 1, "cone");
  });
  facing = aim;
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

initStars();
initStaticStars();
requestAnimationFrame(draw);

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
  selectedWeapon = tile.dataset.weapon;
  document.querySelectorAll("[data-weapon], [data-victory-weapon]").forEach((item) => item.classList.toggle("selected", item.dataset.weapon === selectedWeapon || item.dataset.victoryWeapon === selectedWeapon));
}));
document.querySelectorAll(".weapon-tile[data-super]").forEach((tile) => tile.addEventListener("click", function () {
  setSelectedSuper(tile.dataset.super);
}));

document.querySelectorAll("[data-victory-weapon]").forEach((tile) => tile.addEventListener("click", function () {
  selectedWeapon = tile.dataset.victoryWeapon;
  document.querySelectorAll("[data-weapon], [data-victory-weapon]").forEach((item) => item.classList.toggle("selected", item.dataset.weapon === selectedWeapon || item.dataset.victoryWeapon === selectedWeapon));
}));
document.querySelectorAll("[data-victory-super]").forEach((tile) => tile.addEventListener("click", function () {
  setSelectedSuper(tile.dataset.victorySuper);
}));

window.addEventListener("keydown", function (e) {
  keys[e.code] = true;
  const arrowDirections = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrowDirections[e.code]) lastArrowDirection = { x: arrowDirections[e.code][0], y: arrowDirections[e.code][1] };
  if (gameActive && e.repeat === false) {
    if (selectedWeapon === "charge" && e.code.startsWith("Arrow")) {
      const chargeX = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
      const chargeY = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
      chargeDirection = { x: chargeX || lastArrowDirection.x, y: chargeY || lastArrowDirection.y };
      if (!chargeStartedAt) chargeStartedAt = performance.now();
    }
    if (selectedWeapon !== "charge" && e.code.startsWith("Arrow")) {
      const shotX = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
      const shotY = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
      if (shotX || shotY) fireInDirection(shotX, shotY);
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
  if (e.code === "Space" && gameActive && performance.now() - spaceDownAt <= 180 && superMeter >= 1) {
    if (selectedSuper === "invincibility") { playerInvulnerable = 300; invincibilitySuperTimer = 300; lastSuperKills = superDamage; superMeter = 0; updateSuperMeter(); return; }
    if (selectedSuper === "void") { superBombs.push({ x: player.x, y: player.y, vx: facing.x * 8, vy: facing.y * 8, life: 75, explode: false, void: true }); lastSuperKills = superDamage; superMeter = 0; updateSuperMeter(); return; }
    superBombs.push({ x: player.x, y: player.y, vx: facing.x * 8, vy: facing.y * 8, life: 75, explode: false });
    playSound(180, 0.18, "triangle");
    lastSuperKills = superDamage;
    superMeter = 0;
    updateSuperMeter();
  }
  if (e.code.startsWith("Arrow") && selectedWeapon === "charge" && chargeStartedAt) {
    const remainingArrow = keys.ArrowLeft || keys.ArrowRight || keys.ArrowUp || keys.ArrowDown;
    if (remainingArrow) { chargeDirection = { ...lastArrowDirection }; return; }
    const damage = Math.min(5, Math.max(1, Math.ceil((performance.now() - chargeStartedAt) / 500)));
    const size = Math.min(9, 3 + Math.floor((performance.now() - chargeStartedAt) / 350));
    fireInDirection(chargeDirection.x, chargeDirection.y, damage, "charge", size);
    chargeStartedAt = 0;
  }
});
window.addEventListener("blur", function () {
  Object.keys(keys).forEach((key) => { keys[key] = false; });
});
