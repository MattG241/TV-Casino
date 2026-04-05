// ── TV Casino - TV Display ──────────────────────────────────────────────

const socket = io({ transports: ['polling', 'websocket'] });

const AVATARS = ['😎', '🤠', '👑', '🎩', '🦊', '🐺', '🦁', '🐲', '💀', '🤖', '👽', '🎭'];

let roomCode = '';
let players = [];
let currentGame = null;
let lastRoulettePhase = null;
let floatingPositions = {};
let floatAnimFrameId = null;
// Map of playerId → selfie dataUrl (populated from players:update)
let playerSelfies = {};

// ── Debug panel ─────────────────────────────────────────────────────────
const _dbgLines = [];
function dbg(msg) {
  const t = new Date().toISOString().substr(11, 8);
  _dbgLines.unshift(`[${t}] ${msg}`);
  if (_dbgLines.length > 6) _dbgLines.pop();
  const el = document.getElementById('tvDbgStatus');
  if (el) el.innerHTML = _dbgLines.join('<br>');
  console.log('[TV]', msg);
}

socket.on('connect', () => dbg(`✅ Socket connected: ${socket.id} (transport: ${socket.io.engine.transport.name})`));
socket.on('disconnect', (reason) => dbg(`❌ Socket disconnected: ${reason}`));
socket.on('connect_error', (err) => dbg(`🔴 Connect error: ${err.message}`));
socket.io.on('reconnect', (n) => dbg(`🔁 Reconnected after ${n} attempts`));
socket.io.on('reconnect_attempt', (n) => dbg(`🔄 Reconnect attempt #${n}`));

// Fullscreen disabled — Smart TVs don't support the Fullscreen API

const soundBtn = document.getElementById('soundToggle');
if (soundBtn) {
  soundBtn.addEventListener('click', () => {
    const on = CasinoAudio.toggle();
    soundBtn.textContent = on ? '🔊' : '🔇';
    if (on) CasinoAudio.startMusic();
  });
}

// ── Init: TV creates the room ───────────────────────────────────────────

function init() {
  dbg('📡 Sending tv:create...');
  socket.emit('tv:create');
}

// Wait until connected before creating the room
socket.on('connect', () => {
  if (!roomCode) init();
});

function getBaseUrl() {
  return `${window.location.protocol}//${window.location.host}`;
}

function showJoinInfo() {
  const baseUrl = getBaseUrl();
  const joinUrl = `${baseUrl}/?room=${roomCode}`;

  document.getElementById('tvRoomCode').textContent = roomCode;
  const joinCodeEl = document.getElementById('tvJoinCode');
  if (joinCodeEl) joinCodeEl.textContent = roomCode;

  const urlEl = document.getElementById('tvJoinUrl');
  if (urlEl) urlEl.textContent = joinUrl;

  const canvas = document.getElementById('qrCanvas');
  if (canvas && typeof QRCode !== 'undefined') {
    QRCode.render(canvas, joinUrl);
  }
}

// ── Floating Players ────────────────────────────────────────────────────

function updateFloatingPlayers() {
  const area = document.getElementById('tvFloatingArea');
  if (!area) return;

  const waitText = document.getElementById('tvWaitingText');
  if (waitText) {
    waitText.textContent = players.length > 0
      ? `${players.length} player${players.length !== 1 ? 's' : ''} joined`
      : 'Waiting for players...';
  }

  // Remove players that left
  area.querySelectorAll('.tv-floating-player').forEach(el => {
    const pid = el.dataset.pid;
    if (!players.find(p => p.id === pid)) {
      el.remove();
      delete floatingPositions[pid];
    }
  });

  const areaRect = area.getBoundingClientRect();
  const w = areaRect.width || 600;
  const h = areaRect.height || 400;

  // Add/update players
  players.forEach(p => {
    let el = area.querySelector(`[data-pid="${p.id}"]`);
    if (!el) {
      el = document.createElement('div');
      el.className = 'tv-floating-player';
      el.dataset.pid = p.id;
      area.appendChild(el);
      // Random starting position
      floatingPositions[p.id] = {
        x: 40 + Math.random() * (w - 140),
        y: 30 + Math.random() * (h - 120),
        vx: (Math.random() - 0.5) * 1.2,
        vy: (Math.random() - 0.5) * 1.2,
        bobPhase: Math.random() * Math.PI * 2,
      };
    }
    el.innerHTML = `
      <div class="fp-avatar">${AVATARS[p.avatar] || '😎'}</div>
      <div class="fp-name">${p.name}</div>
      <div class="fp-chips">$${p.chips.toLocaleString()}</div>
    `;
  });

  // Start animation if not running
  if (!floatAnimFrameId && players.length > 0) {
    animateFloating();
  }
}

function animateFloating() {
  const area = document.getElementById('tvFloatingArea');
  if (!area || !area.closest('.tv-screen.active')) {
    floatAnimFrameId = null;
    return;
  }

  const w = area.clientWidth || 600;
  const h = area.clientHeight || 400;

  for (const p of players) {
    const pos = floatingPositions[p.id];
    if (!pos) continue;
    const el = area.querySelector(`[data-pid="${p.id}"]`);
    if (!el) continue;

    pos.x += pos.vx;
    pos.y += pos.vy;
    pos.bobPhase += 0.02;

    // Bounce off walls
    if (pos.x < 20 || pos.x > w - 100) pos.vx *= -1;
    if (pos.y < 10 || pos.y > h - 100) pos.vy *= -1;
    pos.x = Math.max(20, Math.min(pos.x, w - 100));
    pos.y = Math.max(10, Math.min(pos.y, h - 100));

    const bobY = Math.sin(pos.bobPhase) * 8;
    el.style.left = pos.x + 'px';
    el.style.top = (pos.y + bobY) + 'px';
  }

  floatAnimFrameId = requestAnimationFrame(animateFloating);
}

// ── Socket Events ───────────────────────────────────────────────────────

socket.on('tv:created', (data) => {
  roomCode = data.code;
  players = data.players;
  dbg(`🏠 Room created: ${roomCode}`);
  showJoinInfo();
});

socket.on('tv:connected', (data) => {
  roomCode = data.code;
  players = data.players;
  document.getElementById('tvRoomCode').textContent = roomCode;
  renderPlayers();
  if (data.currentGame) {
    currentGame = data.currentGame;
    showTVScreen('tv' + capitalize(data.currentGame));
  }
});

socket.on('room:error', (data) => {
  document.getElementById('tvRoomCode').textContent = 'ERROR';
});

socket.on('players:update', (data) => {
  const prevCount = players.length;
  players = data;
  // Cache selfie images from player data
  data.forEach(p => {
    if (p.selfie && !playerSelfies[p.id]) {
      playerSelfies[p.id] = p.selfie;
    }
  });
  renderPlayers();
  updateFloatingPlayers();
  if (data.length > prevCount) CasinoAudio.playerJoin();
});

// ── Game Events ─────────────────────────────────────────────────────────

socket.on('lobby:vote-start', () => {
  // Horse racing only — go straight back to waiting screen between races
  showTVScreen('tvWaiting');
});

socket.on('game:started', ({ game }) => {
  currentGame = game;
  showTVScreen('tvHorseracing');
  CasinoAudio.gameStart();
  renderPlayers();
});

socket.on('game:state', ({ game, state }) => {
  if (game === 'horseracing') renderTVHorseRacing(state);
});

socket.on('game:timer', ({ timer }) => {
  const el = document.querySelector('.tv-timer');
  if (el) {
    el.textContent = timer;
    el.classList.toggle('urgent', timer <= 5);
    if (timer <= 5 && timer > 0) CasinoAudio.urgentTick();
    else if (timer > 5) CasinoAudio.tick();
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────

function capitalize(s) {
  if (s === 'horseracing') return 'Horseracing';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function showTVScreen(id) {
  document.querySelectorAll('.tv-screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
  if (id !== 'tvWaiting') floatAnimFrameId = null;
  // Clean up 3D when leaving horse racing
  if (id !== 'tvHorseracing' && typeof Race3D !== 'undefined' && Race3D.isInitialized()) {
    Race3D.stopRendering();
    Race3D.dispose();
  }
  // Stop gallop audio
  if (id !== 'tvHorseracing') CasinoAudio.stopGallop();
}

function renderPlayers() {
  const html = players.map(p => `
    <div class="tv-player" id="tvPlayer_${p.id}">
      <div class="avatar">${AVATARS[p.avatar] || '😎'}</div>
      <div class="name">${p.name}</div>
      <div class="chips">$${p.chips.toLocaleString()}</div>
    </div>
  `).join('');
  // Update all player bars in game screens
  document.querySelectorAll('.tv-players').forEach(el => el.innerHTML = html);
}


function showConfetti() {
  const container = document.getElementById('confetti');
  container.innerHTML = '';
  const colors = ['#ffd700', '#ff1744', '#00c853', '#2979ff', '#7c4dff', '#ff6d00'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = Math.random() * 1 + 's';
    piece.style.animationDuration = (1.5 + Math.random()) + 's';
    container.appendChild(piece);
  }
  setTimeout(() => container.innerHTML = '', 3000);
}

// ── TV HORSE RACING ─────────────────────────────────────────────────────

let lastRacePhase = null;
let lastSpokenText = null;
const SILK_COLORS = ['#c0392b','#2980b9','#d4a843','#1a1a2e','#27ae60','#8e44ad','#e67e22','#16a085','#e84393','#636e72','#fdcb6e','#00b894','#6c5ce7','#d63031','#0984e3','#a29bfe'];

// Build { horseIndex: selfieDataUrl } map for Race3D
function buildSelfieMap(horses) {
  const map = {};
  (horses || []).forEach((h, i) => {
    if (h.playerId && playerSelfies[h.playerId]) {
      map[i] = playerSelfies[h.playerId];
    } else if (h.jockeySelfie) {
      map[i] = h.jockeySelfie;
    }
  });
  return map;
}

function renderTVHorseRacing(state) {
  const el = document.getElementById('tvHorseracingContent');
  const horses = state.horses || [];
  const isRacing = state.phase === 'racing';
  const isStarting = state.phase === 'starting';

  // Sound triggers
  if (state.phase !== lastRacePhase) {
    if (state.phase === 'loading') CasinoAudio.startingBell();
    if (state.phase === 'racing') {
      CasinoAudio.gallop();
      CasinoAudio.startCrowd();
    }
    if (state.phase === 'result') {
      CasinoAudio.stopGallop();
      CasinoAudio.setCrowdIntensity(1.0); // Crowd roars at finish
      CasinoAudio.raceFinish();
      const anyWin = Object.values(state.bets || {}).some(b => b.won);
      setTimeout(() => { if (anyWin) CasinoAudio.bigWin(); }, 800);
      setTimeout(() => CasinoAudio.stopCrowd(), 4000); // Crowd dies down after 4s
    }
    if (state.phase === 'betting') {
      CasinoAudio.stopCrowd();
    }
    lastRacePhase = state.phase;
  }

  // Dynamic crowd intensity during race — builds as race progresses
  if (state.phase === 'racing' && state.livePositions) {
    const leaderPos = horses.reduce((max, h) => Math.max(max, h.position || 0), 0);
    const intensity = Math.min(1, leaderPos / 100);
    // Ramp up crowd noise as horses approach finish
    CasinoAudio.setCrowdIntensity(intensity * intensity); // exponential ramp
  }

  // Spoken commentary
  if (state.speak && state.speak !== lastSpokenText) {
    lastSpokenText = state.speak;
    CasinoAudio.speak(state.speak);
  }

  // Phase transitions
  if (state.phase !== lastRacePhase) {
    // Entering betting: dispose any previous scene and clear the panel
    if (state.phase === 'betting') {
      lastSpokenText = null;
      if (typeof Race3D !== 'undefined' && Race3D.isInitialized()) {
        Race3D.stopRendering();
        Race3D.dispose();
      }
      el.innerHTML = '';
    }
    // Leaving betting: dispose the preview scene before the track scene takes over
    if (lastRacePhase === 'betting' && state.phase !== 'betting') {
      if (typeof Race3D !== 'undefined' && Race3D.isInitialized()) {
        Race3D.stopRendering();
        Race3D.dispose();
      }
      el.innerHTML = ''; // clear betting HTML so track HTML rebuilds cleanly
    }
    lastRacePhase = state.phase;
  }

  // ── Sky Racing split-screen betting board ──
  if (state.phase === 'betting') {
    const sorted = [...horses].sort((a, b) => a.scratched ? 1 : b.scratched ? -1 : a.odds - b.odds);
    const trackNames = ['FLEMINGTON','RANDWICK','MOONEE VALLEY','CAULFIELD','ROSEHILL','EAGLE FARM','DOOMBEN','MORPHETTVILLE','ASCOT','SANDOWN'];
    const trackName = trackNames[(state.raceNumber || 1) % trackNames.length];
    const condition = state.trackCondition || 'GOOD 4';

    // Build the shell ONCE — preserve the 3D canvas across updates
    if (!el.querySelector('#racePreview3d')) {
      el.innerHTML = `
        <div class="sky-full">
          <div class="sky-header-bar">
            <div class="sky-hdr-left">
              <span class="sky-hdr-tab">TAB</span>
              <span class="sky-hdr-racenum">${state.raceNumber || 1}</span>
              <div class="sky-hdr-venue">
                <div class="sky-hdr-venue-name">${trackName} &nbsp;${state.distance || 1600}m</div>
                <div class="sky-hdr-venue-sub">RACE ${state.raceNumber || 1} &bull; ${condition}</div>
              </div>
            </div>
            <div class="sky-hdr-right">
              <div class="sky-hdr-timer" id="skyBetTimer">${state.timer > 0 ? '-0:' + String(state.timer).padStart(2,'0') : 'OFF'}</div>
              <div class="sky-hdr-brand">SKY<span>1</span></div>
            </div>
          </div>
          <div class="sky-split">
            <div class="sky-odds-panel">
              <div class="sky-odds-header">
                <span class="sky-oh-num">#</span>
                <span class="sky-oh-name">TAB</span>
                <span class="sky-oh-odds">WIN</span>
                <span class="sky-oh-style">STYLE</span>
                <span class="sky-oh-barrier">GATE</span>
              </div>
              <div class="sky-odds-scroll" id="skyOddsScroll" style="--scroll-dist: ${sorted.length > 10 ? -(sorted.length - 10) * 30 + 'px' : '0px'}"></div>
              <div id="skyBetsStrip"></div>
            </div>
            <div class="sky-preview-panel">
              <div class="sky-preview-3d" id="racePreview3d"></div>
              <div class="sky-preview-info" id="skyPreviewInfo"></div>
            </div>
          </div>
          <div class="sky-ticker">
            ${[1,2,3,4].map(n => {
              const rn = (state.raceNumber||1) + n;
              const tn = trackNames[(rn) % trackNames.length];
              return `<span class="sky-tick-item"><strong>${rn}</strong> ${tn} <span class="sky-tick-time">${n*3} MIN</span></span>`;
            }).join('')}
          </div>
        </div>
      `;
      // Init 3D preview
      const preview = document.getElementById('racePreview3d');
      if (preview && typeof Race3D !== 'undefined') {
        Race3D.init(preview);
        Race3D.startRendering();
      }
    }

    // ── Update dynamic parts only (no innerHTML on parent) ──
    const timerEl = document.getElementById('skyBetTimer');
    if (timerEl) {
      timerEl.textContent = state.timer > 0 ? '-0:' + String(state.timer).padStart(2,'0') : 'OFF';
      timerEl.className = 'sky-hdr-timer' + (state.timer <= 5 ? ' urgent' : '');
    }

    const oddsEl = document.getElementById('skyOddsScroll');
    if (oddsEl) {
      oddsEl.innerHTML = sorted.map((h, i) => {
        const origIdx = horses.indexOf(h);
        const barrier = origIdx + 1;
        const betOnThis = Object.values(state.bets||{}).filter(b=>b.horseId===h.id).length;
        if (h.scratched) return `
          <div class="sky-odds-row sky-scr">
            <span class="sky-or-num">${origIdx+1}</span>
            <span class="sky-or-odds" style="color:#888">SCR</span>
            <span class="sky-or-name"><s>${h.name}</s></span>
            <span class="sky-or-barrier">(${barrier})</span>
          </div>`;
        return `
          <div class="sky-odds-row ${i === 0 ? 'sky-fav' : ''} ${betOnThis > 0 ? 'sky-backed' : ''}">
            <span class="sky-or-num">${origIdx+1}</span>
            <span class="sky-or-odds ${h.odds < h.baseOdds ? 'odds-short' : h.odds > h.baseOdds ? 'odds-drift' : ''}">${h.odds.toFixed(2)}</span>
            <span class="sky-or-name" style="color:${h.color}">${h.name}${h.jockey ? `<br><span class="sky-or-jockey">${h.jockey}</span>` : ''}</span>
            <span class="sky-or-style">${h.styleDesc || ''}${h.temperament ? `<br><span class="sky-or-temp">${h.temperament}</span>` : ''}</span>
            <span class="sky-or-barrier">(${barrier})</span>
          </div>`;
      }).join('');
    }

    const betsEl = document.getElementById('skyBetsStrip');
    if (betsEl) {
      if (Object.keys(state.bets||{}).length > 0) {
        betsEl.innerHTML = `<div class="sky-bets-strip">${Object.entries(state.bets).map(([pid, bet]) => {
          const p = players.find(pl => pl.id === pid);
          const horse = horses.find(h => h.id === bet.horseId);
          return `<span class="sky-bet-tag">${p?.name||'?'} → #${horses.indexOf(horse)+1} $${bet.amount}</span>`;
        }).join('')}</div>`;
      } else {
        betsEl.innerHTML = '';
      }
    }

    const infoEl = document.getElementById('skyPreviewInfo');
    if (infoEl) infoEl.textContent = state.commentary || '';

    if (typeof Race3D !== 'undefined' && Race3D.isInitialized()) {
      Race3D.updateHorses(horses, 'betting');
      Race3D.setHorseSelfies(buildSelfieMap(horses));
    }
    return;
  }

  // ── 3D Track + Sky Racing sidebar ──
  const commentary = state.commentary || '';
  const isLoading = state.phase === 'loading';
  const showTrack = isRacing || isStarting || isLoading || state.phase === 'result';
  if (!showTrack) return;

  const runOrder = [...horses].sort((a, b) => (b.position||0) - (a.position||0));
  const laneCount = horses.length;

  // Build HTML — only rebuild the overlay/sidebar, not the 3D canvas
  const track3dEl = el.querySelector('.sky-track-3d');
  if (!track3dEl) {
    el.innerHTML = `
      <div class="sky-broadcast">
        <div class="sky-topbar">
          <div class="sky-status" id="skyStatus"></div>
          <div class="sky-title">TV CASINO RACING</div>
          <div class="sky-race-info">${state.distance || ''}m &bull; ${state.trackCondition || ''} &bull; ${horses.filter(h=>!h.scratched).length} RUNNERS</div>
        </div>
        <div class="sky-main">
          <div class="sky-track-area">
            <div class="sky-track-3d" id="raceTrack3d"></div>
            <div class="sky-commentary" id="skyCommentary"></div>
          </div>
          <div class="sky-sidebar" id="skySidebar"></div>
        </div>
        <div id="skyResultArea"></div>
      </div>
    `;
    // Init 3D scene
    const container3d = document.getElementById('raceTrack3d');
    if (container3d && typeof Race3D !== 'undefined') {
      Race3D.init(container3d);
      Race3D.startRendering();
    }
  }

  // Update status
  const statusEl = document.getElementById('skyStatus');
  if (statusEl) {
    const leaderPos = Math.max(...horses.map(h => h.position || 0), 0);
    const progressPct = Math.min(100, Math.round(leaderPos));
    statusEl.innerHTML = isRacing ? `<span class="live-dot"></span> LIVE
      <span class="race-progress-bar"><span class="race-progress-fill" style="width:${progressPct}%"></span></span>
      <span class="race-progress-pct">${progressPct}%</span>` :
      isLoading ? 'LOADING' : isStarting ? '<span class="live-dot"></span> STARTING' : 'FINAL';
  }

  // Update commentary
  const commEl = document.getElementById('skyCommentary');
  if (commEl) commEl.textContent = commentary;

  // Update 3D horses
  if (typeof Race3D !== 'undefined' && Race3D.isInitialized()) {
    Race3D.updateHorses(horses, state.phase);
    Race3D.setHorseSelfies(buildSelfieMap(horses));
  }

  // Update sidebar — show live positions with margins
  const sbEl = document.getElementById('skySidebar');
  if (sbEl) {
    const livePos = state.livePositions || [];
    sbEl.innerHTML = `
      <div class="sky-sb-header">${isRacing ? 'LIVE POSITIONS' : state.phase === 'result' ? 'FINAL RESULT' : 'POSITIONS'}</div>
      ${runOrder.slice(0, Math.min(12, laneCount)).map((h, pos) => {
        const origIdx = horses.indexOf(h);
        const isWinner = state.winner === h.id;
        const lp = livePos.find(p => p.id === h.id);
        const margin = lp && pos > 0 ? lp.margin : null;
        const marginText = margin !== null && margin !== undefined ? (
          margin < 0.5 ? 'NOSE' : margin < 1.5 ? 'SH' : margin < 3 ? '1L' : margin < 6 ? `${Math.round(margin/2.5)}L` : `${Math.round(margin/2.5)}L`
        ) : '';
        const isSecond = state.phase === 'result' && state.places && state.places[1] === h.id;
        const isThird = state.phase === 'result' && state.places && state.places[2] === h.id;
        const isBlocked = lp?.blocked;
        const effort = lp?.effort || 50;
        return `
        <div class="sky-runner ${isWinner ? 'sky-runner-winner' : ''} ${isSecond ? 'sky-runner-second' : ''} ${isThird ? 'sky-runner-third' : ''} ${pos === 0 && isRacing ? 'sky-runner-lead' : ''} ${isBlocked ? 'sky-runner-blocked' : ''}">
          <span class="sky-r-pos">${pos + 1}</span>
          <span class="sky-r-silk" style="background:${h.color}">${origIdx+1}</span>
          <span class="sky-r-name">${h.name.length > 14 ? h.name.substring(0,12)+'..' : h.name}${isBlocked && isRacing ? ' <span class="sky-blocked-tag">BOXED</span>' : ''}</span>
          ${marginText && pos > 0 ? `<span class="sky-r-margin">${marginText}</span>` : ''}
          ${isRacing ? `<span class="sky-r-effort" title="Effort"><span class="sky-effort-bar" style="width:${effort}%"></span></span>` : ''}
          <span class="sky-r-odds">$${(h.lockedOdds||h.odds).toFixed(2)}</span>
        </div>`;
      }).join('')}
      ${laneCount > 12 ? `<div class="sky-runner" style="opacity:0.5;justify-content:center;font-size:10px">+${laneCount-12} more</div>` : ''}
    `;
  }

  // Update result area
  const resultEl = document.getElementById('skyResultArea');
  if (resultEl) {
    if (state.phase === 'result' && state.winner) {
      const winHorse = horses.find(h=>h.id===state.winner);
      const winIdx = horses.indexOf(winHorse);
      const margins = state.margins || [];
      const marginDesc = (m) => !m ? '' : m < 0.5 ? 'NOSE' : m < 1.5 ? 'SH' : m < 3 ? '1L' : `${Math.round(m/2.5)}L`;
      resultEl.innerHTML = `
        <div class="sky-result-bar">
          <span class="sky-result-pos">1ST</span>
          <span class="sky-result-silk" style="background:${winHorse?.color}">${winIdx+1}</span>
          <span class="sky-result-name">${winHorse?.name}</span>
          <span class="sky-result-odds">$${(winHorse?.lockedOdds||winHorse?.odds||0).toFixed(2)}</span>
          ${state.places && state.places[1] ? `
            <span class="sky-result-sep">|</span>
            <span class="sky-result-pos" style="background:#888">2ND</span>
            <span class="sky-result-name" style="font-size:12px">${horses.find(h=>h.id===state.places[1])?.name}</span>
            <span class="sky-result-margin">${marginDesc(margins[1])}</span>
            <span class="sky-result-sep">|</span>
            <span class="sky-result-pos" style="background:#a0522d">3RD</span>
            <span class="sky-result-name" style="font-size:12px">${horses.find(h=>h.id===state.places[2])?.name}</span>
            <span class="sky-result-margin">${marginDesc(margins[2])}</span>
          ` : ''}
        </div>
        <div class="tv-bets-list" style="margin-top:4px;justify-content:center">
          ${Object.entries(state.bets || {}).map(([pid, bet]) => {
            const p = players.find(pl => pl.id === pid);
            return `
              <div class="tv-bet-card" style="border-color:${bet.won ? 'var(--green)' : 'var(--red)'}">
                <div class="player-name">${p?.name || 'Player'}</div>
                <div class="bet-info" style="color:${bet.won ? 'var(--green)' : 'var(--red)'}">
                  ${bet.won ? `WON $${bet.winAmount}!` : `Lost $${bet.amount}`}
                </div>
              </div>`;
          }).join('')}
        </div>
      `;
    } else {
      resultEl.innerHTML = '';
    }
  }

  if (state.phase === 'result' && state.winner) showConfetti();
}
