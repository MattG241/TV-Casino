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
let isTVHost = false;

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

// Fullscreen prompt - click to enter fullscreen and dismiss
const fsPrompt = document.getElementById('fullscreenPrompt');
if (fsPrompt) {
  fsPrompt.addEventListener('click', () => {
    goFullscreen();
    fsPrompt.classList.add('hidden');
    CasinoAudio.startMusic();
  });
}

// Double-click anywhere to toggle fullscreen
document.addEventListener('dblclick', (e) => {
  if (e.target.closest('.tv-sound-toggle')) return;
  if (e.target.closest('.tv-game-card')) return;
  toggleFullscreen();
});

// Sound toggle button
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
  // TV always creates a room on load
  socket.emit('tv:create');
}

function getBaseUrl() {
  const proto = window.location.protocol;
  const host = window.location.host;
  return `${proto}//${host}`;
}

function showJoinInfo() {
  const baseUrl = getBaseUrl();
  const joinUrl = `${baseUrl}/?room=${roomCode}`;

  // Update room code displays
  document.getElementById('tvRoomCode').textContent = roomCode;
  const joinCodeEl = document.getElementById('tvJoinCode');
  if (joinCodeEl) joinCodeEl.textContent = roomCode;

  // Update join URL text
  const urlEl = document.getElementById('tvJoinUrl');
  if (urlEl) urlEl.textContent = joinUrl;

  // Render QR code
  const canvas = document.getElementById('qrCanvas');
  if (canvas && typeof QRCode !== 'undefined') {
    QRCode.render(canvas, joinUrl);
  }
}

// Game selection from TV (keyboard 1-5 or click)
function selectGame(game) {
  if (!isTVHost) return;
  socket.emit('tv:select-game', { game });
}

// Keyboard shortcuts for game selection
document.addEventListener('keydown', (e) => {
  if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); return; }

  // Game selection shortcuts when on game select screen
  const gameSelectEl = document.getElementById('tvGameSelect');
  if (gameSelectEl && gameSelectEl.classList.contains('active')) {
    const games = ['roulette', 'slots', 'blackjack', 'poker', 'horseracing'];
    const num = parseInt(e.key);
    if (num >= 1 && num <= 5) selectGame(games[num - 1]);
  }

  // Escape to go back to game selection
  if (e.key === 'Escape' && currentGame) {
    backToGameSelect();
  }
});

function backToGameSelect() {
  if (!isTVHost) return;
  currentGame = null;
  showTVScreen('tvGameSelect');
}

init();

// ── Socket Events ───────────────────────────────────────────────────────

// TV created a room
socket.on('tv:created', (data) => {
  roomCode = data.code;
  players = data.players;
  isTVHost = true;
  showJoinInfo();
  renderPlayers();
});

// TV joined an existing room (fallback)
socket.on('tv:connected', (data) => {
  roomCode = data.code;
  players = data.players;
  document.getElementById('tvRoomCode').textContent = roomCode;
  renderPlayers();
  if (data.currentGame) {
    currentGame = data.currentGame;
    showTVScreen('tv' + capitalize(data.currentGame));
  }
  CasinoAudio.playerJoin();
});

socket.on('room:error', (data) => {
  document.getElementById('tvRoomCode').textContent = 'ERROR';
});

socket.on('players:update', (data) => {
  const prevCount = players.length;
  players = data;
  renderPlayers();
  if (data.length > prevCount) CasinoAudio.playerJoin();

  // When first player joins and we're on waiting screen, switch to game select
  const waitingEl = document.getElementById('tvWaiting');
  if (waitingEl && waitingEl.classList.contains('active') && players.length > 0) {
    showTVScreen('tvGameSelect');
  }

  // Update waiting screen player count
  const pw = document.getElementById('tvPlayersWaiting');
  if (pw) {
    pw.textContent = players.length > 0
      ? `${players.length} player${players.length > 1 ? 's' : ''} connected`
      : 'Waiting for players...';
  }
});

socket.on('game:started', ({ game }) => {
  currentGame = game;
  showTVScreen('tv' + capitalize(game));
  CasinoAudio.gameStart();
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

// ── Helpers ─────────────────────────────────────────────────────────────

function capitalize(s) {
  if (s === 'horseracing') return 'Horseracing';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function showTVScreen(id) {
  document.querySelectorAll('.tv-screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function renderPlayers() {
  const el = document.getElementById('tvPlayers');
  el.innerHTML = players.map(p => `
    <div class="tv-player" id="tvPlayer_${p.id}">
      <div class="avatar">${AVATARS[p.avatar] || '😎'}</div>
      <div class="name">${p.name}</div>
      <div class="chips">$${p.chips.toLocaleString()}</div>
      ${p.isHost ? '<div class="host-badge">HOST</div>' : ''}
    </div>
  `).join('');
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
          <div class="tv-roulette-wheel">
            <div class="center">?</div>
          </div>
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
          <div class="tv-roulette-wheel spinning">
            <div class="center">?</div>
          </div>
          <div class="tv-status" style="font-size:28px;color:var(--gold);margin-top:8px">Spinning...</div>
        </div>
      </div>
    `;
  } else if (state.phase === 'result' && state.result) {
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
          ${result.reels.map((reel, ri) => `
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
    if (state.phase === 'flop' || state.phase === 'turn' || state.phase === 'river') CasinoAudio.card();
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

      <div style="font-size:14px;color:var(--text-dim);margin:4px 0;text-transform:uppercase">
        ${state.phase}
      </div>

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
                  ${Array.isArray(hand) ? hand.map(c => renderTVCard(c)).join('') :
                    `<div style="font-size:10px;color:var(--text-dim)">${state.handBacks?.[pid] || 2} cards</div>`}
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

function renderTVHorseRacing(state) {
  const el = document.getElementById('tvHorseracingContent');
  const horses = state.horses || [];

  if (state.phase !== lastRacePhase) {
    if (state.phase === 'racing') CasinoAudio.gallop();
    if (state.phase === 'result') {
      CasinoAudio.raceFinish();
      const anyWin = Object.values(state.bets || {}).some(b => b.won);
      setTimeout(() => { if (anyWin) CasinoAudio.bigWin(); }, 500);
    }
    lastRacePhase = state.phase;
  }

  el.innerHTML = `
    ${state.phase === 'betting' ? `
      <div class="tv-timer" ${state.timer <= 5 ? 'style="color:var(--red)"' : ''}>${state.timer}</div>
      <div class="tv-status">Pick your horse!</div>
    ` : ''}

    <div class="tv-race-track">
      ${horses.map(h => `
        <div class="tv-horse-lane">
          <div class="tv-horse-info" style="color:${h.color}">
            <div class="tv-horse-name">${h.name}</div>
            <div class="tv-horse-odds">${h.odds}:1</div>
          </div>
          <div class="tv-track-lane">
            <div class="tv-finish-line"></div>
            <div class="tv-horse-marker ${state.phase === 'racing' ? 'racing' : ''}"
              style="left:calc(${Math.min(h.position || 0, 92)}% - 18px)">🏇</div>
          </div>
        </div>
      `).join('')}
    </div>

    ${state.phase === 'result' && state.winner ? `
      <div class="tv-race-result" style="color:${horses.find(h=>h.id===state.winner)?.color || 'var(--gold)'}">
        🏆 ${horses.find(h=>h.id===state.winner)?.name} WINS! 🏆
      </div>
      <div class="tv-bets-list" style="margin-top:6px;justify-content:center">
        ${Object.entries(state.bets || {}).map(([pid, bet]) => {
          const p = players.find(pl => pl.id === pid);
          return `
            <div class="tv-bet-card" style="border-color:${bet.won ? 'var(--green)' : 'var(--red)'}">
              <div class="player-name">${p?.name || 'Player'}</div>
              <div class="bet-info" style="color:${bet.won ? 'var(--green)' : 'var(--red)'}">
                ${bet.won ? `WON $${bet.winAmount}!` : `Lost $${bet.amount}`}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : state.phase === 'racing' ? `
      <div style="text-align:center;font-size:22px;color:var(--gold);margin-top:6px;font-weight:800">
        AND THEY'RE OFF! 🏁
      </div>
    ` : ''}
  `;

  if (state.phase === 'result' && state.winner) showConfetti();
}
