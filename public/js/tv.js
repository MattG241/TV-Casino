// ── TV Casino - TV Display ──────────────────────────────────────────────

const socket = io();

const AVATARS = ['😎', '🤠', '👑', '🎩', '🦊', '🐺', '🦁', '🐲', '💀', '🤖', '👽', '🎭'];
const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SLOT_SYMBOLS = {
  cherry: '🍒', lemon: '🍋', orange: '🍊', plum: '🍇',
  bell: '🔔', bar: '📊', seven: '7️⃣', diamond: '💎'
};
const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

let roomCode = '';
let players = [];
let currentGame = null;
let lastRoulettePhase = null;
let floatingPositions = {};
let floatAnimFrameId = null;

// ── Fullscreen Management ────────────────────────────────────────────────

function goFullscreen() {
  const el = document.documentElement;
  const rfs = el.requestFullscreen || el.webkitRequestFullscreen ||
              el.mozRequestFullScreen || el.msRequestFullscreen;
  if (rfs) rfs.call(el).catch(() => {});
}

function exitFullscreen() {
  const efs = document.exitFullscreen || document.webkitExitFullscreen ||
              document.mozCancelFullScreen || document.msExitFullscreen;
  if (efs && document.fullscreenElement) efs.call(document).catch(() => {});
}

function toggleFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    exitFullscreen();
  } else {
    goFullscreen();
  }
}

const fsPrompt = document.getElementById('fullscreenPrompt');
if (fsPrompt) {
  fsPrompt.addEventListener('click', () => {
    goFullscreen();
    fsPrompt.classList.add('hidden');
    CasinoAudio.startMusic();
  });
}

document.addEventListener('dblclick', (e) => {
  if (e.target.closest('.tv-sound-toggle')) return;
  toggleFullscreen();
});

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
  socket.emit('tv:create');
}

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

document.addEventListener('keydown', (e) => {
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
});

init();

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
  renderPlayers();
  updateFloatingPlayers();
  if (data.length > prevCount) CasinoAudio.playerJoin();
});

// ── Voting ──────────────────────────────────────────────────────────────

socket.on('lobby:vote-start', () => {
  showTVScreen('tvVoting');
  CasinoAudio.gameStart();
  // Reset
  document.querySelectorAll('.tv-vote-card').forEach(c => c.classList.remove('winner'));
  ['roulette','slots','blackjack','poker','horseracing'].forEach(g => {
    const count = document.getElementById(`tvVoteCount-${g}`);
    const fill = document.getElementById(`tvVoteFill-${g}`);
    if (count) count.textContent = '0';
    if (fill) fill.style.width = '0%';
  });
});

socket.on('vote:update', ({ votes, timer }) => {
  const total = Object.values(votes).reduce((a, b) => a + b, 0) || 1;
  for (const [game, count] of Object.entries(votes)) {
    const countEl = document.getElementById(`tvVoteCount-${game}`);
    const fillEl = document.getElementById(`tvVoteFill-${game}`);
    if (countEl) countEl.textContent = count;
    if (fillEl) fillEl.style.width = `${(count / total) * 100}%`;
  }
  const timerEl = document.getElementById('tvVoteTimer');
  if (timerEl && timer !== undefined && timer !== null) {
    timerEl.textContent = timer > 0 ? `${timer}s` : "Time's up!";
    timerEl.style.color = timer <= 5 ? 'var(--red)' : 'var(--gold)';
  }
  if (timer <= 5 && timer > 0) CasinoAudio.urgentTick();
});

socket.on('vote:winner', ({ game }) => {
  document.querySelectorAll('.tv-vote-card').forEach(c => c.classList.remove('winner'));
  const card = document.querySelector(`.tv-vote-card[data-game="${game}"]`);
  if (card) card.classList.add('winner');
  CasinoAudio.bigWin();
  showConfetti();
});

// ── Game Events ─────────────────────────────────────────────────────────

socket.on('game:started', ({ game }) => {
  currentGame = game;
  showTVScreen('tv' + capitalize(game));
  CasinoAudio.gameStart();
  renderPlayers(); // render players bar in game screen
});

socket.on('game:state', ({ game, state }) => {
  if (game === 'roulette') renderTVRoulette(state);
  else if (game === 'slots') renderTVSlots(state);
  else if (game === 'blackjack') renderTVBlackjack(state);
  else if (game === 'poker') renderTVPoker(state);
  else if (game === 'horseracing') renderTVHorseRacing(state);
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

socket.on('lobby:ready-update', ({ readyCount, totalCount }) => {
  // Could show a "players ready" indicator on TV during games
  // For now this is handled by the vote-start event when all ready
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

function renderTVCard(card) {
  if (!card || card.rank === 'hidden') return '<div class="tv-card hidden"></div>';
  const suit = SUIT_SYMBOLS[card.suit] || '';
  return `<div class="tv-card ${card.suit}">
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${suit}</span>
  </div>`;
}

function handValueCalc(hand) {
  let total = 0, aces = 0;
  for (const c of hand) {
    if (!c || c.rank === 'hidden') continue;
    if (['J','Q','K'].includes(c.rank)) total += 10;
    else if (c.rank === 'A') { total += 11; aces++; }
    else total += parseInt(c.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
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

// ── TV ROULETTE ─────────────────────────────────────────────────────────

function renderTVRoulette(state) {
  const el = document.getElementById('tvRouletteContent');

  if (state.phase === 'betting') {
    if (lastRoulettePhase !== 'betting') CasinoAudio.chip();
    lastRoulettePhase = 'betting';
    const betEntries = Object.entries(state.bets || {});
    el.innerHTML = `
      <div class="tv-timer" ${state.timer <= 5 ? 'style="color:var(--red)"' : ''}>${state.timer || ''}</div>
      <div class="tv-status">Place your bets!</div>
      <div class="tv-roulette-layout">
        <div class="tv-roulette-center">
          <div class="tv-roulette-wheel"><div class="center">?</div></div>
        </div>
        ${betEntries.length > 0 ? `
          <div class="tv-bets-list">
            ${betEntries.map(([pid, bets]) => {
              const p = players.find(pl => pl.id === pid);
              return bets.map(b => `
                <div class="tv-bet-card">
                  <div class="player-name">${p?.name || 'Player'}</div>
                  <div class="bet-info">$${b.amount} on ${b.value !== undefined ? b.value : b.type}</div>
                </div>
              `).join('');
            }).join('')}
          </div>
        ` : ''}
      </div>
      ${renderTVHistory(state.history)}
    `;
  } else if (state.phase === 'spinning') {
    if (lastRoulettePhase !== 'spinning') CasinoAudio.spin();
    lastRoulettePhase = 'spinning';
    el.innerHTML = `
      <div class="tv-roulette-layout">
        <div class="tv-roulette-center">
          <div class="tv-roulette-wheel spinning"><div class="center">?</div></div>
          <div class="tv-status" style="font-size:28px;color:var(--gold);margin-top:8px">Spinning...</div>
        </div>
      </div>
    `;
    clearTimeout(window._tvSpinTimeout);
    window._tvSpinTimeout = setTimeout(() => { socket.emit('game:request-state'); }, 7000);
  } else if (state.phase === 'result' && state.result) {
    clearTimeout(window._tvSpinTimeout);
    if (lastRoulettePhase !== 'result') {
      CasinoAudio.ballLand();
      const winners = Object.entries(state.bets || {}).some(([, bets]) => bets.some(b => b.won));
      setTimeout(() => { if (winners) CasinoAudio.bigWin(); else CasinoAudio.lose(); }, 400);
    }
    lastRoulettePhase = 'result';
    el.innerHTML = `
      <div class="tv-roulette-layout">
        <div class="tv-roulette-center">
          <div class="tv-result-display">
            <div class="tv-result-number ${state.result.color}">${state.result.number}</div>
            <div class="tv-result-color">${state.result.color}</div>
          </div>
        </div>
        <div class="tv-bets-list">
          ${Object.entries(state.bets || {}).map(([pid, bets]) => {
            const p = players.find(pl => pl.id === pid);
            return bets.map(b => `
              <div class="tv-bet-card" style="border-color:${b.won ? 'var(--green)' : 'var(--red)'}">
                <div class="player-name">${p?.name || 'Player'}</div>
                <div class="bet-info" style="color:${b.won ? 'var(--green)' : 'var(--red)'}">
                  ${b.won ? `WON $${b.winAmount}` : `Lost $${b.amount}`}
                </div>
              </div>
            `).join('');
          }).join('')}
        </div>
      </div>
      ${renderTVHistory(state.history)}
    `;
    const winners = Object.entries(state.bets || {}).some(([, bets]) => bets.some(b => b.won));
    if (winners) showConfetti();
  }
}

function renderTVHistory(history) {
  if (!history || history.length === 0) return '';
  return `<div class="tv-history">
    ${history.slice(0, 15).map(h =>
      `<div class="tv-history-num ${h.color}">${h.number}</div>`
    ).join('')}
  </div>`;
}

// ── TV SLOTS ────────────────────────────────────────────────────────────

let lastSlotsResult = null;

function renderTVSlots(state) {
  const el = document.getElementById('tvSlotsContent');
  const results = Object.entries(state.results || {});
  const latestResult = results.length > 0 ? results[results.length - 1] : null;

  if (latestResult) {
    const [pid, result] = latestResult;
    const p = players.find(pl => pl.id === pid);

    if (lastSlotsResult !== pid + JSON.stringify(result.reels)) {
      lastSlotsResult = pid + JSON.stringify(result.reels);
      CasinoAudio.slotSpin();
      setTimeout(() => {
        CasinoAudio.slotStop();
        if (result.winAmount > 0) setTimeout(() => CasinoAudio.win(), 300);
      }, 800);
    }

    el.innerHTML = `
      <div class="tv-slots-machine">
        <div class="tv-slots-title">LUCKY SLOTS</div>
        <div style="text-align:center;font-size:16px;margin-bottom:8px;color:var(--text-dim)">
          ${p?.name || 'Player'} spins!
        </div>
        <div class="tv-reels">
          ${result.reels.map(reel => `
            <div class="tv-reel">
              ${reel.map((sym, si) => `
                <div class="tv-slot-symbol ${si === 1 ? 'middle' : ''}">${SLOT_SYMBOLS[sym]}</div>
              `).join('')}
            </div>
          `).join('')}
        </div>
        ${result.winAmount > 0 ? `
          <div class="tv-win-display">${p?.name} WINS $${result.winAmount}! (${result.multiplier}x)</div>
        ` : `
          <div style="text-align:center;font-size:18px;color:var(--text-dim);margin-top:8px">No win this time</div>
        `}
      </div>
    `;
    if (result.winAmount > 0) showConfetti();
  } else {
    el.innerHTML = `
      <div class="tv-slots-machine">
        <div class="tv-slots-title">LUCKY SLOTS</div>
        <div class="tv-reels">
          ${[0,1,2].map(() => `
            <div class="tv-reel">
              <div class="tv-slot-symbol">🍒</div>
              <div class="tv-slot-symbol middle">❓</div>
              <div class="tv-slot-symbol">🍋</div>
            </div>
          `).join('')}
        </div>
        <div class="tv-status">Waiting for players to spin...</div>
      </div>
    `;
  }
}

// ── TV BLACKJACK ────────────────────────────────────────────────────────

let lastBJPhase = null;

function renderTVBlackjack(state) {
  const el = document.getElementById('tvBlackjackContent');
  const dealerHand = state.dealerHand || [];
  const dealerVal = dealerHand.every(c => c.rank !== 'hidden') ? handValueCalc(dealerHand) : '?';

  if (state.phase === 'betting') {
    if (lastBJPhase !== 'betting') CasinoAudio.chip();
    lastBJPhase = 'betting';
    const betters = Object.keys(state.bets || {});
    el.innerHTML = `
      <div class="tv-bj-table">
        <div style="text-align:center;font-size:26px;font-weight:800;color:var(--gold)">BLACKJACK</div>
        <div class="tv-status">Place your bets!</div>
        <div style="text-align:center;margin-top:8px;font-size:16px;color:var(--text-dim)">
          ${betters.length} player(s) ready
        </div>
      </div>
    `;
    return;
  }

  if (state.phase !== lastBJPhase) {
    if (state.phase === 'playing') CasinoAudio.card();
    else if (state.phase === 'result') {
      const anyWin = Object.values(state.results || {}).some(r => r === 'win' || r === 'blackjack_win');
      if (anyWin) CasinoAudio.win(); else CasinoAudio.lose();
    }
    lastBJPhase = state.phase;
  }

  const playerHands = Object.entries(state.hands || {});

  el.innerHTML = `
    <div class="tv-bj-table">
      <div class="tv-dealer-area">
        <div class="tv-hand-label">Dealer ${dealerVal !== '?' ? `(${dealerVal})` : ''}</div>
        <div class="tv-cards-row">${dealerHand.map(c => renderTVCard(c)).join('')}</div>
      </div>
      <div style="border-top:2px solid rgba(255,255,255,0.1);margin:8px 0"></div>
      <div class="tv-players-area">
        <div class="tv-hand-label">Players</div>
        <div class="tv-player-hands">
          ${playerHands.map(([pid, hand]) => {
            const p = players.find(pl => pl.id === pid);
            const val = handValueCalc(hand);
            const result = state.results?.[pid];
            const isActive = state.turnOrder?.[state.currentTurn] === pid;
            let cls = '';
            if (isActive && !result) cls = 'active';
            if (result === 'bust') cls = 'bust';
            if (result === 'win' || result === 'blackjack_win') cls = 'win';
            if (result === 'lose') cls = 'lose';

            return `
              <div class="tv-player-hand ${cls}">
                <div style="font-size:14px;font-weight:700;margin-bottom:4px">
                  ${AVATARS[p?.avatar] || '😎'} ${p?.name || 'Player'}
                </div>
                <div class="tv-cards-row">${hand.map(c => renderTVCard(c)).join('')}</div>
                <div class="tv-hand-value">${val}</div>
                ${result ? `
                  <div class="tv-bj-result" style="color:${
                    result.includes('win') || result === 'blackjack_win' ? 'var(--green)' :
                    result === 'push' ? 'var(--gold)' : 'var(--red)'}">
                    ${result === 'blackjack_win' ? 'BLACKJACK!' :
                      result === 'win' ? 'WIN!' :
                      result === 'bust' ? 'BUST' :
                      result === 'push' ? 'PUSH' : 'LOSE'}
                  </div>
                ` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  if (state.phase === 'result') {
    const anyWin = Object.values(state.results || {}).some(r => r === 'win' || r === 'blackjack_win');
    if (anyWin) showConfetti();
  }
}

// ── TV POKER ────────────────────────────────────────────────────────────

let lastPokerPhase = null;

function renderTVPoker(state) {
  const el = document.getElementById('tvPokerContent');
  const community = state.community || [];
  const isShowdown = state.phase === 'result' || state.phase === 'showdown';

  if (state.phase !== lastPokerPhase) {
    if (['flop','turn','river'].includes(state.phase)) CasinoAudio.card();
    if (state.phase === 'result' && state.winner) CasinoAudio.bigWin();
    lastPokerPhase = state.phase;
  }

  el.innerHTML = `
    <div class="tv-poker-table">
      <div class="tv-pot">Pot: $${state.pot || 0}</div>
      <div class="tv-community-cards">
        ${community.length > 0 ? community.map(c => renderTVCard(c)).join('') :
          `<div style="color:rgba(255,255,255,0.3);font-size:16px">
            ${state.phase === 'preflop' ? 'Pre-flop' : 'Waiting...'}
          </div>`}
      </div>
      <div style="font-size:14px;color:var(--text-dim);margin:4px 0;text-transform:uppercase">${state.phase}</div>
      <div class="tv-poker-players">
        ${(state.turnOrder || []).map((pid, idx) => {
          const p = players.find(pl => pl.id === pid);
          const isActive = state.currentTurn === idx && !state.foldedPlayers?.includes(pid);
          const isFolded = state.foldedPlayers?.includes(pid);
          const isWinner = state.winner === pid;
          const hand = isShowdown && state.allHands?.[pid];
          const roundBet = state.roundBets?.[pid] || 0;

          return `
            <div class="tv-poker-seat ${isActive ? 'active' : ''} ${isFolded ? 'folded' : ''} ${isWinner ? 'winner' : ''}">
              <div style="font-size:22px">${AVATARS[p?.avatar] || '😎'}</div>
              <div style="font-size:13px;font-weight:700">${p?.name || 'Player'}</div>
              <div style="color:var(--gold);font-size:12px">$${p?.chips?.toLocaleString() || 0}</div>
              ${roundBet > 0 ? `<div style="color:var(--green);font-size:11px">Bet: $${roundBet}</div>` : ''}
              ${isFolded ? '<div style="color:var(--red);font-size:11px">FOLDED</div>' : ''}
              ${isWinner ? '<div style="color:var(--green);font-size:14px;font-weight:800">WINNER!</div>' : ''}
              ${hand ? `
                <div style="display:flex;gap:3px;margin-top:2px;justify-content:center">
                  ${Array.isArray(hand) ? hand.map(c => renderTVCard(c)).join('') : ''}
                </div>
              ` : `
                <div style="display:flex;gap:2px;margin-top:2px;justify-content:center">
                  ${!isFolded ? '<div class="tv-card hidden" style="width:28px;height:40px;font-size:14px"></div><div class="tv-card hidden" style="width:28px;height:40px;font-size:14px"></div>' : ''}
                </div>
              `}
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;

  if (state.phase === 'result' && state.winner) showConfetti();
}

// ── TV HORSE RACING ─────────────────────────────────────────────────────

let lastRacePhase = null;
let lastSpokenText = null;
const SILK_COLORS = ['#c0392b','#2980b9','#d4a843','#1a1a2e','#27ae60','#8e44ad','#e67e22','#16a085','#e84393','#636e72','#fdcb6e','#00b894','#6c5ce7','#d63031','#0984e3','#a29bfe'];

function renderTVHorseRacing(state) {
  const el = document.getElementById('tvHorseracingContent');
  const horses = state.horses || [];
  const isRacing = state.phase === 'racing';
  const isStarting = state.phase === 'starting';

  // Sound triggers
  if (state.phase !== lastRacePhase) {
    if (state.phase === 'loading') CasinoAudio.startingBell(); // bugle when loading
    if (state.phase === 'racing') CasinoAudio.gallop();
    if (state.phase === 'result') {
      CasinoAudio.stopGallop();
      CasinoAudio.raceFinish();
      const anyWin = Object.values(state.bets || {}).some(b => b.won);
      setTimeout(() => { if (anyWin) CasinoAudio.bigWin(); }, 800);
    }
    lastRacePhase = state.phase;
  }

  // Spoken commentary
  if (state.speak && state.speak !== lastSpokenText) {
    lastSpokenText = state.speak;
    CasinoAudio.speak(state.speak);
  }

  // Reset phase tracking on new race
  if (state.phase === 'betting' && lastRacePhase !== 'betting') {
    lastRacePhase = 'betting';
    lastSpokenText = null;
    // Dispose old 3D scene for fresh start
    if (typeof Race3D !== 'undefined' && Race3D.isInitialized()) {
      Race3D.stopRendering();
      Race3D.dispose();
    }
    // Force rebuild of betting HTML on new race
    el.innerHTML = '';
  }

  // ── Sky Racing split-screen betting board ──
  if (state.phase === 'betting') {
    const sorted = [...horses].sort((a, b) => a.scratched ? 1 : b.scratched ? -1 : a.odds - b.odds);
    const trackNames = ['FLEMINGTON','RANDWICK','MOONEE VALLEY','CAULFIELD','ROSEHILL','EAGLE FARM','DOOMBEN','MORPHETTVILLE','ASCOT','SANDOWN'];
    const trackName = trackNames[(state.raceNumber || 1) % trackNames.length];
    const conditions = ['GOOD 4','SOFT 5','GOOD 3','FIRM 1','SOFT 6','HEAVY 8'];
    const condition = conditions[Math.floor((state.raceNumber || 0) * 3.7) % conditions.length];

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
                <span class="sky-oh-barrier">BARRIER</span>
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
            <span class="sky-or-name" style="color:${h.color}">${h.name}</span>
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
          <div class="sky-race-info">${horses.length} RUNNERS</div>
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
    statusEl.innerHTML = isRacing ? '<span class="live-dot"></span> LIVE' :
      isLoading ? 'LOADING' : isStarting ? 'STARTING' : 'FINAL';
  }

  // Update commentary
  const commEl = document.getElementById('skyCommentary');
  if (commEl) commEl.textContent = commentary;

  // Update 3D horses
  if (typeof Race3D !== 'undefined' && Race3D.isInitialized()) {
    Race3D.updateHorses(horses, state.phase);
  }

  // Update sidebar
  const sbEl = document.getElementById('skySidebar');
  if (sbEl) {
    sbEl.innerHTML = `
      <div class="sky-sb-header">POS</div>
      ${runOrder.slice(0, Math.min(10, laneCount)).map((h, pos) => {
        const origIdx = horses.indexOf(h);
        const isWinner = state.winner === h.id;
        return `
        <div class="sky-runner ${isWinner ? 'sky-runner-winner' : ''} ${pos === 0 && isRacing ? 'sky-runner-lead' : ''}">
          <span class="sky-r-silk" style="background:${h.color}">${origIdx+1}</span>
          <span class="sky-r-name">${h.name.length > 14 ? h.name.substring(0,12)+'..' : h.name}</span>
          <span class="sky-r-odds">$${(h.lockedOdds||h.odds).toFixed(2)}</span>
        </div>`;
      }).join('')}
      ${laneCount > 10 ? `<div class="sky-runner" style="opacity:0.5;justify-content:center;font-size:10px">+${laneCount-10} more</div>` : ''}
    `;
  }

  // Update result area
  const resultEl = document.getElementById('skyResultArea');
  if (resultEl) {
    if (state.phase === 'result' && state.winner) {
      const winHorse = horses.find(h=>h.id===state.winner);
      const winIdx = horses.indexOf(winHorse);
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
            <span class="sky-result-sep">|</span>
            <span class="sky-result-pos" style="background:#a0522d">3RD</span>
            <span class="sky-result-name" style="font-size:12px">${horses.find(h=>h.id===state.places[2])?.name}</span>
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
