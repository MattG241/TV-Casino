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

// ── Auto-connect: get room code from URL or prompt ──────────────────────

function init() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('room');
  if (code) {
    connectToRoom(code);
  }
  // Show connection URL
  const url = window.location.hostname + ':' + window.location.port;
  document.getElementById('tvUrl').textContent = url;
}

function connectToRoom(code) {
  roomCode = code.toUpperCase();
  document.getElementById('tvRoomCode').textContent = roomCode;
  socket.emit('tv:connect', { code: roomCode });
}

// Listen for room code input via keyboard (for TV remote)
let codeBuffer = '';
document.addEventListener('keydown', (e) => {
  if (roomCode) return;
  if (e.key === 'Enter' && codeBuffer.length === 4) {
    connectToRoom(codeBuffer);
    codeBuffer = '';
  } else if (e.key === 'Backspace') {
    codeBuffer = codeBuffer.slice(0, -1);
  } else if (/^[a-zA-Z0-9]$/.test(e.key) && codeBuffer.length < 4) {
    codeBuffer += e.key.toUpperCase();
  }
  document.getElementById('tvRoomCode').textContent = codeBuffer || '----';
});

init();

// ── Socket Events ───────────────────────────────────────────────────────

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
  players = data;
  renderPlayers();
});

socket.on('game:started', ({ game }) => {
  currentGame = game;
  showTVScreen('tv' + capitalize(game));
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
    const betEntries = Object.entries(state.bets || {});
    el.innerHTML = `
      <div class="tv-timer" ${state.timer <= 5 ? 'class="urgent"' : ''}>${state.timer}</div>
      <div class="tv-status">Place your bets!</div>
      <div class="tv-roulette-wheel">
        <div class="center">?</div>
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
      ${renderTVHistory(state.history)}
    `;
  } else if (state.phase === 'spinning') {
    el.innerHTML = `
      <div class="tv-roulette-wheel spinning">
        <div class="center">?</div>
      </div>
      <div class="tv-status" style="font-size:36px;color:var(--gold)">Spinning...</div>
    `;
  } else if (state.phase === 'result' && state.result) {
    el.innerHTML = `
      <div class="tv-result-display">
        <div class="tv-result-number ${state.result.color}">${state.result.number}</div>
        <div style="font-size:28px;text-transform:uppercase;color:var(--text-dim)">${state.result.color}</div>
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
      ${renderTVHistory(state.history)}
    `;
    const winners = Object.entries(state.bets || {}).some(([, bets]) => bets.some(b => b.won));
    if (winners) showConfetti();
  }
}

function renderTVHistory(history) {
  if (!history || history.length === 0) return '';
  return `<div class="tv-history" style="justify-content:center;margin-top:20px">
    ${history.slice(0, 15).map(h =>
      `<div class="tv-history-num ${h.color}">${h.number}</div>`
    ).join('')}
  </div>`;
}

// ── TV SLOTS ────────────────────────────────────────────────────────────

function renderTVSlots(state) {
  const el = document.getElementById('tvSlotsContent');
  const results = Object.entries(state.results || {});
  const latestResult = results.length > 0 ? results[results.length - 1] : null;

  if (latestResult) {
    const [pid, result] = latestResult;
    const p = players.find(pl => pl.id === pid);
    el.innerHTML = `
      <div class="tv-slots-machine">
        <div class="tv-slots-title">LUCKY SLOTS</div>
        <div style="text-align:center;font-size:20px;margin-bottom:16px;color:var(--text-dim)">
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
          <div style="text-align:center;font-size:24px;color:var(--text-dim);margin-top:20px">No win this time</div>
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

function renderTVBlackjack(state) {
  const el = document.getElementById('tvBlackjackContent');
  const dealerHand = state.dealerHand || [];
  const dealerVal = dealerHand.every(c => c.rank !== 'hidden') ? handValueCalc(dealerHand) : '?';

  if (state.phase === 'betting') {
    const betters = Object.keys(state.bets || {});
    el.innerHTML = `
      <div class="tv-bj-table">
        <div style="text-align:center;font-size:32px;font-weight:800;color:var(--gold)">BLACKJACK</div>
        <div class="tv-status">Place your bets!</div>
        <div style="text-align:center;margin-top:16px;font-size:20px;color:var(--text-dim)">
          ${betters.length} player(s) ready
        </div>
      </div>
    `;
    return;
  }

  const playerHands = Object.entries(state.hands || {});

  el.innerHTML = `
    <div class="tv-bj-table">
      <div class="tv-dealer-area">
        <div class="tv-hand-label">Dealer ${dealerVal !== '?' ? `(${dealerVal})` : ''}</div>
        <div class="tv-cards-row">${dealerHand.map(c => renderTVCard(c)).join('')}</div>
      </div>

      <div style="border-top:2px solid rgba(255,255,255,0.1);margin:20px 0"></div>

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
                <div style="font-size:16px;font-weight:700;margin-bottom:8px">
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

function renderTVPoker(state) {
  const el = document.getElementById('tvPokerContent');
  const community = state.community || [];
  const isShowdown = state.phase === 'result' || state.phase === 'showdown';

  el.innerHTML = `
    <div class="tv-poker-table">
      <div class="tv-pot">Pot: $${state.pot || 0}</div>

      <div class="tv-community-cards">
        ${community.length > 0 ? community.map(c => renderTVCard(c)).join('') :
          `<div style="color:rgba(255,255,255,0.3);font-size:20px">
            ${state.phase === 'preflop' ? 'Pre-flop' : 'Waiting...'}
          </div>`}
      </div>

      <div style="font-size:18px;color:var(--text-dim);margin:8px 0;text-transform:uppercase">
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
              <div style="font-size:28px">${AVATARS[p?.avatar] || '😎'}</div>
              <div style="font-size:16px;font-weight:700">${p?.name || 'Player'}</div>
              <div style="color:var(--gold);font-size:14px">$${p?.chips?.toLocaleString() || 0}</div>
              ${roundBet > 0 ? `<div style="color:var(--green);font-size:13px">Bet: $${roundBet}</div>` : ''}
              ${isFolded ? '<div style="color:var(--red);font-size:12px">FOLDED</div>' : ''}
              ${isWinner ? '<div style="color:var(--green);font-size:16px;font-weight:800">WINNER!</div>' : ''}
              ${hand ? `
                <div style="display:flex;gap:4px;margin-top:4px;justify-content:center">
                  ${Array.isArray(hand) ? hand.map(c => renderTVCard(c)).join('') :
                    `<div style="font-size:11px;color:var(--text-dim)">${state.handBacks?.[pid] || 2} cards</div>`}
                </div>
              ` : `
                <div style="display:flex;gap:2px;margin-top:4px;justify-content:center">
                  ${!isFolded ? '<div class="tv-card hidden" style="width:36px;height:50px;font-size:16px"></div><div class="tv-card hidden" style="width:36px;height:50px;font-size:16px"></div>' : ''}
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

function renderTVHorseRacing(state) {
  const el = document.getElementById('tvHorseracingContent');
  const horses = state.horses || [];

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
      <div class="tv-bets-list" style="margin-top:16px;justify-content:center">
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
      <div style="text-align:center;font-size:28px;color:var(--gold);margin-top:16px;font-weight:800">
        AND THEY'RE OFF! 🏁
      </div>
    ` : ''}
  `;

  if (state.phase === 'result' && state.winner) showConfetti();
}
