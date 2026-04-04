// ── TV Casino Mobile App ────────────────────────────────────────────────

const socket = io();

// ── State ───────────────────────────────────────────────────────────────

let myId = null;
let myName = '';
let myChips = 1000;
let roomCode = '';
let selectedAvatar = 0;
let currentGame = null;
let players = [];
let myVote = null;

const AVATARS = ['😎', '🤠', '👑', '🎩', '🦊', '🐺', '🦁', '🐲', '💀', '🤖', '👽', '🎭'];
const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SLOT_SYMBOLS = {
  cherry: '🍒', lemon: '🍋', orange: '🍊', plum: '🍇',
  bell: '🔔', bar: '📊', seven: '7️⃣', diamond: '💎', wild: '⭐'
};

// ── Init ────────────────────────────────────────────────────────────────

function init() {
  const picker = document.getElementById('avatarPicker');
  AVATARS.forEach((a, i) => {
    const el = document.createElement('div');
    el.className = `avatar-option${i === 0 ? ' selected' : ''}`;
    el.textContent = a;
    el.onclick = () => {
      document.querySelectorAll('.avatar-option').forEach(e => e.classList.remove('selected'));
      el.classList.add('selected');
      selectedAvatar = i;
    };
    picker.appendChild(el);
  });

  // Auto-fill room code from URL param (from QR code scan)
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get('room');
  if (roomParam) {
    const codeInput = document.getElementById('roomCode');
    if (codeInput) codeInput.value = roomParam.toUpperCase();
  }
}

init();

// ── Navigation ──────────────────────────────────────────────────────────

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showToast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Session Persistence ─────────────────────────────────────────────────

function saveSession() {
  try {
    localStorage.setItem('tvCasinoSession', JSON.stringify({
      roomCode, playerId: myId, playerName: myName, avatar: selectedAvatar, ts: Date.now()
    }));
  } catch (e) {}
}

function clearSession() {
  try { localStorage.removeItem('tvCasinoSession'); } catch (e) {}
}

function tryRejoin() {
  try {
    const raw = localStorage.getItem('tvCasinoSession');
    if (!raw) return false;
    const s = JSON.parse(raw);
    // Expire after 2 hours
    if (Date.now() - s.ts > 2 * 60 * 60 * 1000) { clearSession(); return false; }
    if (!s.roomCode || !s.playerId) return false;
    socket.emit('room:rejoin', { code: s.roomCode, existingPlayerId: s.playerId });
    myName = s.playerName || 'Player';
    selectedAvatar = s.avatar || 0;
    return true;
  } catch (e) { return false; }
}

// Auto-rejoin on socket reconnect (phone sleep / tab switch)
socket.on('connect', () => {
  if (myId && roomCode) {
    // We were already connected — rejoin same session
    socket.emit('room:rejoin', { code: roomCode, existingPlayerId: myId });
  }
});

// Also rejoin when returning to the app (visibility change)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && myId && roomCode) {
    if (!socket.connected) {
      socket.connect();
    } else {
      socket.emit('room:rejoin', { code: roomCode, existingPlayerId: myId });
    }
  }
});

// Try rejoin on initial page load
if (!tryRejoin()) {
  // No stored session — show join screen as normal
}

// ── Room Management ─────────────────────────────────────────────────────

function joinRoom() {
  myName = document.getElementById('playerName').value.trim() || 'Player';
  const code = document.getElementById('roomCode').value.trim().toUpperCase();
  if (code.length !== 4) return showToast('Enter a 4-letter code');
  socket.emit('room:join', { code, playerName: myName, avatar: selectedAvatar });
}

socket.on('room:joined', (data) => {
  myId = data.playerId;
  roomCode = data.code;
  players = data.players;
  saveSession();
  enterLobby();
  if (data.currentGame) {
    currentGame = data.currentGame;
    showGameUI(currentGame);
  }
});

socket.on('room:error', (data) => {
  clearSession();
  showToast(data.message);
});

function enterLobby() {
  showScreen('lobbyScreen');
  document.getElementById('displayRoomCode').textContent = roomCode;
  updatePlayers(players);
  updateLobbyCount();
}

function updateLobbyCount() {
  const el = document.getElementById('lobbyPlayerCount');
  if (el) {
    el.textContent = `${players.length} player${players.length !== 1 ? 's' : ''} in the room`;
  }
}

socket.on('players:update', (data) => {
  players = data;
  updatePlayers(data);
  updateLobbyCount();
  const me = data.find(p => p.id === myId);
  if (me) {
    myChips = me.chips;
    // Update chips on all screens
    document.querySelectorAll('#myChips, #voteChips, #gameChips').forEach(el => {
      el.textContent = myChips.toLocaleString();
    });
  }
});

function updatePlayers(list) {
  const bars = document.querySelectorAll('#playersBar, #gamePlayersBar');
  const html = list.map(p => `
    <div class="player-chip">
      <div class="avatar">${AVATARS[p.avatar] || '😎'}</div>
      <div class="name">${p.name}${p.id === myId ? ' (you)' : ''}</div>
      <div class="chips">$${p.chips.toLocaleString()}</div>
    </div>
  `).join('');
  bars.forEach(bar => bar.innerHTML = html);
}

// ── Everyone's In ───────────────────────────────────────────────────────

function everyonesIn() {
  socket.emit('lobby:ready');
}

socket.on('lobby:vote-start', () => {
  showScreen('voteScreen');
  document.getElementById('voteRoomCode').textContent = roomCode;
  myVote = null;
  // Reset vote cards
  document.querySelectorAll('.vote-card').forEach(c => {
    c.classList.remove('voted', 'winner');
  });
});

// ── Game Voting ─────────────────────────────────────────────────────────

function voteForGame(game) {
  if (myVote) return; // already voted
  myVote = game;
  socket.emit('game:vote', { game });
  showToast(`Voted for ${game}!`);
  // Highlight voted card
  document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('voted'));
  const card = document.querySelector(`#vote-${game}`)?.closest('.vote-card');
  if (card) card.classList.add('voted');
}

socket.on('vote:update', ({ votes, timer }) => {
  // Update vote counts
  for (const [game, count] of Object.entries(votes)) {
    const el = document.getElementById(`vote-${game}`);
    if (el) el.textContent = count;
  }
  // Update timer
  if (timer !== undefined && timer !== null) {
    const fill = document.getElementById('voteTimerFill');
    const text = document.getElementById('voteTimerText');
    if (fill) fill.style.width = `${(timer / 30) * 100}%`;
    if (text) text.textContent = timer > 0 ? `${timer}s remaining` : "Time's up!";
  }
});

socket.on('vote:winner', ({ game }) => {
  // Highlight winning game
  document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('winner'));
  const el = document.getElementById(`vote-${game}`);
  if (el) el.closest('.vote-card').classList.add('winner');
  showToast(`${game.charAt(0).toUpperCase() + game.slice(1)} wins!`);
});

// ── Game Events ─────────────────────────────────────────────────────────

socket.on('game:started', ({ game }) => {
  currentGame = game;
  showGameUI(game);
});

function showGameUI(game) {
  showScreen('gameScreen');
  document.getElementById('gameRoomCode').textContent = roomCode;
  document.querySelectorAll('.game-view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById(game + 'Game');
  if (view) view.classList.add('active');
  // Reset end game button state
  const endBtn = document.getElementById('endGameBtn');
  if (endBtn) {
    endBtn.classList.remove('requested');
    endBtn.textContent = 'END GAME';
  }
  const endStatus = document.getElementById('endGameStatus');
  if (endStatus) endStatus.textContent = '';
}

// ── End Game ────────────────────────────────────────────────────────────

let endGameRequested = false;

function requestEndGame() {
  if (endGameRequested) return;
  endGameRequested = true;
  socket.emit('game:end-request');
  const btn = document.getElementById('endGameBtn');
  if (btn) {
    btn.classList.add('requested');
    btn.textContent = 'WAITING...';
  }
}

socket.on('lobby:ready-update', ({ readyCount, totalCount }) => {
  const el = document.getElementById('endGameStatus');
  if (el) {
    el.textContent = `${readyCount}/${totalCount} ready to move on`;
  }
});

// lobby:vote-start can come from "everyone's in" OR from all players ending the game
socket.on('lobby:vote-start', () => {
  currentGame = null;
  myVote = null;
  endGameRequested = false;
  showScreen('voteScreen');
  document.getElementById('voteRoomCode').textContent = roomCode;
  document.querySelectorAll('.vote-card').forEach(c => c.classList.remove('voted', 'winner'));
  ['roulette', 'slots', 'blackjack', 'poker', 'horseracing'].forEach(g => {
    const el = document.getElementById(`vote-${g}`);
    if (el) el.textContent = '0';
  });
  const fill = document.getElementById('voteTimerFill');
  const text = document.getElementById('voteTimerText');
  if (fill) fill.style.width = '100%';
  if (text) text.textContent = '';
});

// ── Game State Handler ──────────────────────────────────────────────────

socket.on('game:state', ({ game, state }) => {
  if (game === 'roulette') renderRoulette(state);
  else if (game === 'slots') renderSlots(state);
  else if (game === 'blackjack') renderBlackjack(state);
  else if (game === 'poker') renderPoker(state);
  else if (game === 'horseracing') renderHorseRacing(state);
});

socket.on('game:timer', ({ timer }) => {
  const el = document.querySelector('.timer-text');
  if (el) el.textContent = timer > 0 ? `${timer}s remaining` : "Time's up!";
  const fill = document.querySelector('.timer-fill');
  if (fill) {
    const maxTime = currentGame === 'roulette' ? 20 : 15;
    fill.style.width = `${(timer / maxTime) * 100}%`;
  }
});

socket.on('game:error', ({ message }) => showToast(message));

// ── ROULETTE RENDERER ───────────────────────────────────────────────────

let rouletteBetAmount = 10;
let rouletteSelectedBet = null;

const RED_NUMBERS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

function renderRoulette(state) {
  const el = document.getElementById('rouletteContent');

  if (state.phase === 'betting') {
    el.innerHTML = `
      <div class="timer-bar"><div class="timer-fill" style="width:${(state.timer/20)*100}%"></div></div>
      <div class="timer-text">${state.timer}s remaining</div>

      <div class="bet-amount-selector">
        ${[5,10,25,50,100].map(v => `
          <button class="chip-btn chip-${v} ${rouletteBetAmount === v ? 'selected' : ''}"
            onclick="rouletteBetAmount=${v}; renderRoulette(window._rouletteState)">${v}</button>
        `).join('')}
      </div>

      <div class="bet-options">
        <button class="bet-btn color-red ${rouletteSelectedBet === 'red' ? 'selected' : ''}"
          onclick="placeRouletteBet('color','red')">RED</button>
        <button class="bet-btn color-green"
          onclick="placeRouletteBet('number', 0)">0</button>
        <button class="bet-btn color-black ${rouletteSelectedBet === 'black' ? 'selected' : ''}"
          onclick="placeRouletteBet('color','black')">BLACK</button>
        <button class="bet-btn" onclick="placeRouletteBet('odd')">ODD</button>
        <button class="bet-btn" onclick="placeRouletteBet('even')">EVEN</button>
        <button class="bet-btn" onclick="placeRouletteBet('1-18')">1-18</button>
        <button class="bet-btn" onclick="placeRouletteBet('19-36')">19-36</button>
        <button class="bet-btn" onclick="placeRouletteBet('1st12')">1st 12</button>
        <button class="bet-btn" onclick="placeRouletteBet('2nd12')">2nd 12</button>
        <button class="bet-btn" onclick="placeRouletteBet('3rd12')">3rd 12</button>
      </div>

      <div class="number-grid">
        ${Array.from({length:37}, (_,i) => {
          const color = i === 0 ? 'green' : RED_NUMBERS.includes(i) ? 'red' : 'black';
          return `<button class="num-btn ${color}" onclick="placeRouletteBet('number',${i})">${i}</button>`;
        }).join('')}
      </div>

      ${state.bets[myId] ? `
        <div class="status-msg success">
          You have ${state.bets[myId].length} bet(s) placed
        </div>` : ''}

      ${renderRouletteHistory(state.history)}
    `;
  } else if (state.phase === 'spinning') {
    el.innerHTML = `
      <div style="text-align:center;padding:40px">
        <div style="font-size:48px;animation:spin 0.5s linear infinite">🎡</div>
        <div style="font-size:20px;margin-top:16px;color:var(--gold)">Spinning...</div>
      </div>
    `;
    // Fallback: if stuck on spinning for 7s, request fresh state from server
    clearTimeout(window._spinTimeout);
    window._spinTimeout = setTimeout(() => {
      socket.emit('game:request-state');
    }, 7000);
  } else if (state.phase === 'result' && state.result) {
    clearTimeout(window._spinTimeout);
    const myBets = state.bets[myId] || [];
    const totalWin = myBets.reduce((s, b) => s + (b.winAmount || 0), 0);
    el.innerHTML = `
      <div class="roulette-result">
        <div style="font-size:14px;color:var(--text-dim)">Result</div>
        <div class="result-number ${state.result.color}">${state.result.number}</div>
        <div style="font-size:16px;text-transform:uppercase;color:var(--text-dim)">${state.result.color}</div>
        ${totalWin > 0 ? `<div class="win-display">You won $${totalWin}!</div>` :
          myBets.length > 0 ? `<div style="color:var(--red);font-size:18px;margin-top:8px">Better luck next time</div>` : ''}
      </div>
      ${renderRouletteHistory(state.history)}
    `;
  }
  window._rouletteState = state;
}

function renderRouletteHistory(history) {
  if (!history || history.length === 0) return '';
  return `<div class="history-strip">${history.map(h =>
    `<div class="history-num ${h.color}">${h.number}</div>`
  ).join('')}</div>`;
}

let _lastBetTime = 0;
function placeRouletteBet(type, value) {
  // Throttle: min 300ms between bets
  const now = Date.now();
  if (now - _lastBetTime < 300) return;
  _lastBetTime = now;
  socket.emit('roulette:bet', { type, value, amount: rouletteBetAmount });
  rouletteSelectedBet = type === 'color' ? value : type;
  showToast(`Bet $${rouletteBetAmount} on ${value !== undefined ? value : type}`);
}

// ── SLOTS RENDERER ──────────────────────────────────────────────────────

const SLOT_SYMBOL_NAMES = { cherry:'🍒', lemon:'🍋', orange:'🍊', plum:'🍇', bell:'🔔', bar:'📊', seven:'7️⃣', diamond:'💎', wild:'⭐' };
let slotsBetAmount = 10;
let slotsHasBet = false;

function renderSlots(state) {
  const el = document.getElementById('slotsContent');
  const myResult = state.results?.[myId];
  const myBet = state.bets?.[myId];
  const phase = state.phase || 'betting';
  const freeSpins = state.freeSpins?.[myId] || 0;
  const jackpot = state.jackpot || 500;

  // Reels display
  let reelsHTML = '';
  if (myResult && (phase === 'results' || myResult.isFreeSpin)) {
    const winLines = (myResult.paylines || []).map(p => p.lineIdx);
    reelsHTML = myResult.reels.map((reel, ri) => `
      <div class="slot-reel ${phase === 'spinning' ? 'spinning' : ''}">
        ${reel.map((sym, si) => {
          const isWinning = winLines.some(li => {
            const lines = [[0,1],[1,1],[2,1],[0,0],[1,0],[2,0],[0,2],[1,2],[2,2],[0,0],[1,1],[2,2],[0,2],[1,1],[2,0]];
            // Check payline definitions
            const PAYLINES = [[[0,1],[1,1],[2,1]],[[0,0],[1,0],[2,0]],[[0,2],[1,2],[2,2]],[[0,0],[1,1],[2,2]],[[0,2],[1,1],[2,0]]];
            if (li < PAYLINES.length) return PAYLINES[li].some(([r,s]) => r === ri && s === si);
            return false;
          });
          return `<div class="slot-symbol ${si === 1 ? 'middle' : ''} ${isWinning ? 'winner' : ''}">${SLOT_SYMBOL_NAMES[sym] || sym}</div>`;
        }).join('')}
      </div>
    `).join('');
  } else if (phase === 'spinning') {
    reelsHTML = [0,1,2].map(() => `
      <div class="slot-reel spinning">
        <div class="slot-symbol">🍒</div>
        <div class="slot-symbol middle">⭐</div>
        <div class="slot-symbol">💎</div>
      </div>
    `).join('');
  } else {
    reelsHTML = [0,1,2].map(() => `
      <div class="slot-reel">
        <div class="slot-symbol">🍒</div>
        <div class="slot-symbol middle">❓</div>
        <div class="slot-symbol">🍋</div>
      </div>
    `).join('');
  }

  // Other players' results
  const otherResults = Object.entries(state.results || {}).filter(([pid]) => pid !== myId);
  const otherResultsHTML = otherResults.length > 0 && phase === 'results' ? `
    <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,0.06);padding-top:10px">
      <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">Other Players</div>
      ${otherResults.map(([pid, r]) => {
        const p = players.find(pl => pl.id === pid);
        return `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
          <span>${p?.name || 'Player'}</span>
          <span style="color:${r.totalWin > 0 ? 'var(--green)' : 'var(--text-dim)'}">${r.totalWin > 0 ? '+$' + r.totalWin : 'No win'}</span>
        </div>`;
      }).join('')}
    </div>
  ` : '';

  // Leaderboard
  const lb = Object.entries(state.leaderboard || {}).sort((a,b) => b[1] - a[1]).slice(0, 5);
  const leaderboardHTML = lb.length > 0 ? `
    <div style="margin-top:10px;border-top:1px solid rgba(255,255,255,0.06);padding-top:8px">
      <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">Session Leaderboard</div>
      ${lb.map(([pid, net], i) => {
        const p = players.find(pl => pl.id === pid);
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
        return `<div style="display:flex;justify-content:space-between;padding:2px 0;font-size:12px">
          <span>${medal} ${p?.name || 'Player'}${pid === myId ? ' (You)' : ''}</span>
          <span style="color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">$${net >= 0 ? '+' : ''}${net}</span>
        </div>`;
      }).join('')}
    </div>
  ` : '';

  el.innerHTML = `
    <div class="slots-machine">
      <div style="font-size:20px;font-weight:800;color:var(--gold);text-align:center;margin-bottom:4px">
        LUCKY SLOTS
      </div>
      <div style="text-align:center;font-size:12px;color:var(--text-dim);margin-bottom:10px">
        Round ${state.roundNumber || 1} • 5 Paylines • Wilds ⭐
      </div>

      <!-- Progressive Jackpot -->
      <div style="text-align:center;background:linear-gradient(135deg,rgba(212,168,67,0.15),rgba(212,168,67,0.05));
                  border:1px solid rgba(212,168,67,0.3);border-radius:8px;padding:6px 12px;margin-bottom:10px">
        <div style="font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:2px">Progressive Jackpot</div>
        <div style="font-size:22px;font-weight:900;color:var(--gold)">$${jackpot.toLocaleString()}</div>
        <div style="font-size:9px;color:var(--text-dim)">3x 💎 on middle line wins jackpot</div>
      </div>

      <div class="slots-display">${reelsHTML}</div>

      ${myResult && phase === 'results' ? `
        ${myResult.jackpotWin ? `
          <div class="win-display" style="font-size:28px;color:#ff0">🎰 JACKPOT! $${myResult.jackpotAmount}! 🎰</div>
        ` : ''}
        ${myResult.totalWin > 0 ? `
          <div class="win-display">WIN! $${myResult.totalWin}${myResult.paylines?.length > 1 ? ' (' + myResult.paylines.length + ' lines!)' : ''}</div>
          ${myResult.paylines?.map(pl => `
            <div style="text-align:center;font-size:11px;color:var(--green)">
              Line ${pl.lineIdx + 1}: ${pl.symbols.map(s => SLOT_SYMBOL_NAMES[s]).join(' ')} → ${pl.multiplier}x ($${pl.win})
            </div>
          `).join('')}
        ` : `
          <div style="text-align:center;color:var(--text-dim);margin-top:12px">No win this round</div>
        `}
        ${myResult.freeSpinsWon > 0 ? `
          <div style="text-align:center;color:var(--gold);font-weight:700;margin-top:6px">🎁 Won ${myResult.freeSpinsWon} FREE SPINS!</div>
        ` : ''}
      ` : phase === 'spinning' ? `
        <div style="text-align:center;color:var(--gold);margin-top:12px;font-weight:700" class="animate-pulse">
          Spinning...
        </div>
      ` : ''}

      ${otherResultsHTML}
      ${leaderboardHTML}
    </div>

    ${phase === 'betting' ? `
      <div class="bet-controls">
        ${freeSpins > 0 ? `
          <button class="btn btn-purple btn-block" onclick="socket.emit('slots:free-spin')" style="margin-bottom:8px">
            🎁 USE FREE SPIN (${freeSpins} left)
          </button>
        ` : ''}
        <div class="bet-label">Bet Amount ${myBet ? '(Bet placed!)' : ''}</div>
        <div class="bet-amount-display">$${slotsBetAmount}</div>
        <div class="quick-amounts">
          ${[5,10,25,50,100].map(v => `
            <button class="chip-btn chip-${v} ${slotsBetAmount === v ? 'selected' : ''}"
              onclick="slotsBetAmount=${v}; renderSlots(window._slotsState)">${v}</button>
          `).join('')}
        </div>
        <button class="btn btn-gold btn-block slots-lever" onclick="spinSlots()" ${myBet ? 'style="opacity:0.5"' : ''}>
          ${myBet ? 'WAITING FOR OTHERS...' : 'PLACE BET & SPIN!'}
        </button>
        <div style="text-align:center;font-size:11px;color:var(--text-dim);margin-top:6px">
          ${Object.keys(state.bets || {}).length} / ${players.length} players ready
          ${state.timer ? ' • ' + state.timer + 's' : ''}
        </div>
      </div>
    ` : phase === 'results' ? `
      <div style="text-align:center;color:var(--text-dim);font-size:13px;margin-top:12px">
        Next round starting soon...
      </div>
    ` : ''}
  `;
  window._slotsState = state;
}

function spinSlots() {
  socket.emit('slots:bet', { amount: slotsBetAmount });
}

// ── BLACKJACK RENDERER ──────────────────────────────────────────────────

let bjBetAmount = 25;

function renderBlackjack(state) {
  const el = document.getElementById('blackjackContent');

  if (state.phase === 'betting') {
    const hasBet = state.bets && state.bets[myId];
    el.innerHTML = `
      <div class="bj-table">
        <div style="text-align:center;font-size:20px;font-weight:700;color:var(--gold)">BLACKJACK</div>
        <div style="text-align:center;color:rgba(255,255,255,0.6);margin-top:8px">Place your bet</div>
      </div>
      ${!hasBet ? `
        <div class="bet-controls">
          <div class="bet-amount-display">$${bjBetAmount}</div>
          <div class="quick-amounts">
            ${[10,25,50,100,250].map(v => `
              <button class="chip-btn chip-${Math.min(v,100)} ${bjBetAmount === v ? 'selected' : ''}"
                onclick="bjBetAmount=${v}; renderBlackjack(window._bjState)">${v}</button>
            `).join('')}
          </div>
          <button class="btn btn-gold btn-block" onclick="placeBJBet()">DEAL ME IN</button>
        </div>
      ` : `
        <div class="status-msg waiting">Waiting for other players to bet...</div>
      `}
    `;
  } else {
    const myHand = state.hands?.[myId] || [];
    const dealerHand = state.dealerHand || [];
    const isMyTurn = state.turnOrder && state.turnOrder[state.currentTurn] === myId;
    const myResult = state.results?.[myId];
    const myVal = handValueClient(myHand);
    const dealerVal = dealerHand.every(c => c.rank !== 'hidden') ? handValueClient(dealerHand) : '?';

    el.innerHTML = `
      <div class="bj-table">
        <div class="hand-area">
          <div class="hand-label">Dealer ${dealerVal !== '?' ? `(${dealerVal})` : ''}</div>
          <div class="cards-row">${dealerHand.map(c => renderCard(c)).join('')}</div>
        </div>

        <div style="border-top:1px solid rgba(255,255,255,0.1);margin:12px 0"></div>

        <div class="hand-area">
          <div class="hand-label">Your Hand (${myVal})</div>
          <div class="cards-row">${myHand.map(c => renderCard(c)).join('')}</div>
          ${myResult ? `
            <div class="bj-result ${myResult.includes('win') || myResult === 'blackjack_win' ? 'win' :
              myResult === 'push' ? 'push' : 'lose'}">
              ${myResult === 'blackjack_win' ? 'BLACKJACK!' :
                myResult === 'win' ? 'YOU WIN!' :
                myResult === 'bust' ? 'BUST!' :
                myResult === 'push' ? 'PUSH' :
                myResult === 'lose' ? 'DEALER WINS' : myResult.toUpperCase()}
            </div>
          ` : ''}
        </div>

        ${isMyTurn && !myResult ? `
          <div class="bj-actions">
            <button class="btn btn-green" onclick="socket.emit('blackjack:hit')" style="flex:1">HIT</button>
            <button class="btn btn-red" onclick="socket.emit('blackjack:stand')" style="flex:1">STAND</button>
            ${myHand.length === 2 ? `
              <button class="btn btn-purple" onclick="socket.emit('blackjack:double')" style="flex:1">DOUBLE</button>
            ` : ''}
          </div>
        ` : !myResult ? `
          <div class="status-msg waiting">
            ${state.phase === 'dealer' ? 'Dealer is playing...' : 'Waiting for your turn...'}
          </div>
        ` : ''}
      </div>
    `;
  }
  window._bjState = state;
}

function placeBJBet() {
  socket.emit('blackjack:bet', { amount: bjBetAmount });
}

function handValueClient(hand) {
  let total = 0, aces = 0;
  for (const c of hand) {
    if (c.rank === 'hidden') continue;
    if (['J','Q','K'].includes(c.rank)) total += 10;
    else if (c.rank === 'A') { total += 11; aces++; }
    else total += parseInt(c.rank);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function renderCard(card) {
  if (card.rank === 'hidden') return '<div class="card hidden"></div>';
  const suit = SUIT_SYMBOLS[card.suit] || '';
  return `<div class="card ${card.suit}">
    <span class="card-rank">${card.rank}</span>
    <span class="card-suit">${suit}</span>
  </div>`;
}

// ── POKER RENDERER ──────────────────────────────────────────────────────

let pokerRaiseAmount = 40;

function renderPoker(state) {
  const el = document.getElementById('pokerContent');
  const myHand = state.myHand || [];
  const community = state.community || [];
  const isMyTurn = state.turnOrder && state.turnOrder[state.currentTurn] === myId;
  const isFolded = state.foldedPlayers?.includes(myId);
  const myRoundBet = state.roundBets?.[myId] || 0;
  const toCall = (state.currentBet || 0) - myRoundBet;
  const isResult = state.phase === 'result' || state.phase === 'showdown';
  const bigBlind = state.bigBlind || 20;
  const minRaise = (state.currentBet || 0) + bigBlind;
  const maxRaise = myChips + myRoundBet;

  // Build opponent info section
  const opponents = (state.turnOrder || [])
    .filter(pid => pid !== myId)
    .map(pid => {
      const p = players.find(pl => pl.id === pid);
      const isTurn = state.currentTurn === state.turnOrder.indexOf(pid);
      const folded = state.foldedPlayers?.includes(pid);
      const isWinner = state.winner === pid;
      const opHand = isResult && state.allHands?.[pid];
      const handResult = isResult && state.handResults?.[pid];
      const roundBet = state.roundBets?.[pid] || 0;
      const aiTag = p?.isAI ? ' <span style="color:var(--text-dim);font-size:10px">[AI]</span>' : '';
      return `
        <div class="poker-opponent ${isTurn ? 'active-turn' : ''} ${folded ? 'folded' : ''} ${isWinner ? 'winner' : ''}"
             style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;
                    ${isTurn ? 'background:rgba(255,215,0,0.15);border:1px solid rgba(255,215,0,0.3)' : 'background:rgba(255,255,255,0.03)'}">
          <span style="font-size:20px">${AVATARS[p?.avatar] || '😎'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${p?.name || 'Player'}${aiTag}
            </div>
            <div style="font-size:11px;color:var(--gold)">$${p?.chips?.toLocaleString() || 0}${roundBet > 0 ? ` <span style="color:var(--green)">(bet $${roundBet})</span>` : ''}</div>
          </div>
          ${folded ? '<span style="color:var(--red);font-size:11px;font-weight:700">FOLDED</span>' : ''}
          ${isWinner ? '<span style="color:var(--green);font-size:11px;font-weight:700">WINNER</span>' : ''}
          ${opHand && Array.isArray(opHand) ? `
            <div style="display:flex;gap:2px">${opHand.map(c => renderCard(c)).join('')}</div>
            ${handResult ? `<span style="font-size:10px;color:var(--gold)">${handResult.name}</span>` : ''}
          ` : ''}
        </div>`;
    }).join('');

  el.innerHTML = `
    <div class="poker-table">
      <div class="pot-display">Pot: $${state.pot || 0}</div>

      ${opponents ? `
        <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px">${opponents}</div>
      ` : ''}

      <div class="hand-label" style="text-align:center">Community Cards</div>
      <div class="community-cards">
        ${community.length > 0 ? community.map(c => renderCard(c)).join('') :
          '<div style="color:rgba(255,255,255,0.3);font-size:14px;padding:20px">Waiting for flop...</div>'}
      </div>

      <div style="border-top:1px solid rgba(255,255,255,0.1);margin:16px 0"></div>

      <div class="hand-label">Your Hand</div>
      <div class="cards-row" style="justify-content:center">
        ${myHand.length > 0 ? myHand.map(c => renderCard(c)).join('') :
          '<div style="color:rgba(255,255,255,0.3)">No cards yet</div>'}
      </div>
      ${isResult && state.handResults?.[myId] ? `
        <div style="text-align:center;font-size:12px;color:var(--gold);margin-top:4px">${state.handResults[myId].name}</div>
      ` : ''}

      ${isResult ? `
        <div class="bj-result ${state.winner === myId ? 'win' : 'lose'}">
          ${state.winner === myId ? `YOU WIN $${state.pot}!` :
            `${players.find(p => p.id === state.winner)?.name || 'Opponent'} wins${state.handResults?.[state.winner] ? ' with ' + state.handResults[state.winner].name : ''}`}
        </div>
      ` : isFolded ? `
        <div class="status-msg" style="background:rgba(255,255,255,0.05);color:var(--text-dim)">You folded</div>
      ` : isMyTurn ? `
        <div style="text-align:center;color:var(--gold);font-weight:700;margin:8px 0">YOUR TURN</div>
        <div class="poker-actions">
          <button class="btn btn-red btn-sm" onclick="pokerAction('fold')">FOLD</button>
          ${toCall > 0 ? `
            <button class="btn btn-green btn-sm" onclick="pokerAction('call')">CALL $${toCall}</button>
          ` : `
            <button class="btn btn-green btn-sm" onclick="pokerAction('check')">CHECK</button>
          `}
          ${maxRaise > minRaise ? `
            <button class="btn btn-gold btn-sm" onclick="pokerAction('raise', pokerRaiseAmount)">RAISE $${pokerRaiseAmount}</button>
          ` : ''}
          <button class="btn btn-purple btn-sm" onclick="pokerAction('allin')">ALL IN</button>
        </div>
        ${maxRaise > minRaise ? `
          <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
            <span style="font-size:12px;color:var(--text-dim)">$${minRaise}</span>
            <input type="range" class="raise-slider" min="${minRaise}" max="${maxRaise}"
              value="${pokerRaiseAmount}" oninput="pokerRaiseAmount=parseInt(this.value);this.nextElementSibling.textContent='$'+this.value">
            <span style="font-size:12px;color:var(--text-dim)">$${pokerRaiseAmount}</span>
          </div>
        ` : ''}
      ` : `
        <div class="status-msg waiting">
          ${state.phase} - Waiting for ${players.find(p => p.id === state.turnOrder?.[state.currentTurn])?.name || 'other player'}...
        </div>
      `}
    </div>

    <div style="font-size:12px;color:var(--text-dim);text-align:center;margin-top:8px">
      Phase: ${state.phase} | Players: ${state.activePlayers?.length || 0} active
    </div>
  `;
}

function pokerAction(action, amount) {
  socket.emit('poker:action', { action, amount });
}

// ── HORSE RACING RENDERER ───────────────────────────────────────────────

let hrSelectedHorse = null;
let hrBetAmount = 25;
let hrBetType = 'win'; // 'win', 'place', 'trifecta'
let hrExpandedHorse = null;
let hrTrifecta = [null, null, null];
let hrTrifectaSlot = 0;
let hrEntrySubmitted = false;
let hrHorseName = '';
let hrSelfieData = null;
let hrCameraStream = null;

function hrRandomName() {
  const adj = ['Midnight','Golden','Silver','Thunder','Shadow','Royal','Wild','Lucky','Iron','Crimson','Blazing','Cosmic','Diamond','Velvet','Mystic','Storm','Noble','Dark','Flying','Brave'][Math.floor(Math.random()*20)];
  const noun = ['Express','Fury','Spirit','Lightning','Arrow','Dream','Champion','Warrior','Legend','Phoenix','Bullet','Rocket','Dancer','Rebel','Phantom','Comet','Blaze','Knight','Star','Wind'][Math.floor(Math.random()*20)];
  return adj + ' ' + noun;
}

function hrStartCamera() {
  const video = document.getElementById('hrSelfieVideo');
  const canvas = document.getElementById('hrSelfieCanvas');
  if (!video) return;

  // Use front-facing camera
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 320 } }, audio: false })
    .then(stream => {
      hrCameraStream = stream;
      video.srcObject = stream;
      video.play();
      video.style.display = 'block';
      if (canvas) canvas.style.display = 'none';
      const btn = document.getElementById('hrCaptureBtn');
      if (btn) { btn.textContent = 'TAKE SELFIE'; btn.onclick = hrCaptureSelfie; }
    })
    .catch(() => {
      showToast('Camera access denied');
    });
}

function hrCaptureSelfie() {
  const video = document.getElementById('hrSelfieVideo');
  const canvas = document.getElementById('hrSelfieCanvas');
  if (!video || !canvas) return;

  canvas.width = 200;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  // Center-crop the video to a square
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const size = Math.min(vw, vh);
  const sx = (vw - size) / 2;
  const sy = (vh - size) / 2;
  // Mirror horizontally for front camera
  ctx.save();
  ctx.translate(200, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, sx, sy, size, size, 0, 0, 200, 200);
  ctx.restore();

  hrSelfieData = canvas.toDataURL('image/jpeg', 0.7);

  // Stop camera
  if (hrCameraStream) {
    hrCameraStream.getTracks().forEach(t => t.stop());
    hrCameraStream = null;
  }
  video.style.display = 'none';
  canvas.style.display = 'block';

  const btn = document.getElementById('hrCaptureBtn');
  if (btn) { btn.textContent = 'RETAKE'; btn.onclick = hrStartCamera; }
}

function hrSubmitEntry() {
  const nameInput = document.getElementById('hrHorseNameInput');
  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) return showToast('Enter a horse name!');
  if (!hrSelfieData) return showToast('Take a selfie first!');

  socket.emit('horseracing:entry', { horseName: name, selfie: hrSelfieData });
  hrEntrySubmitted = true;
  hrHorseName = name;

  // Stop camera if still running
  if (hrCameraStream) {
    hrCameraStream.getTracks().forEach(t => t.stop());
    hrCameraStream = null;
  }

  renderHorseRacing(window._hrState);
}

function renderHorseRacing(state) {
  const el = document.getElementById('horseracingContent');
  const horses = state.horses || [];
  const myBet = state.bets?.[myId];

  // Reset entry state on new naming phase
  if (state.phase === 'naming' && !window._hrNamingStarted) {
    hrEntrySubmitted = false;
    hrHorseName = '';
    hrSelfieData = null;
    window._hrNamingStarted = true;
  }
  if (state.phase !== 'naming') {
    window._hrNamingStarted = false;
  }

  // ── NAMING PHASE: Enter horse name + take selfie ──
  if (state.phase === 'naming') {
    const myEntry = state.playerHorses?.[myId];
    const alreadyDone = state.namingComplete?.[myId] || hrEntrySubmitted;
    const activePlayers = Object.keys(state.playerHorses || {});
    const doneCount = Object.keys(state.namingComplete || {}).length;

    if (alreadyDone) {
      el.innerHTML = `
        <div class="hr-naming-screen">
          <div class="hr-naming-header">
            <div class="hr-naming-title">JOCKEY REGISTRATION</div>
            <div class="sb-timer-pill ${state.timer <= 5 ? 'sb-timer-urgent' : ''}">
              <span class="sb-timer-num">${state.timer}s</span>
            </div>
          </div>
          <div class="hr-entry-confirmed">
            <div class="hr-entry-tick">&#10003;</div>
            <div class="hr-entry-name">${hrHorseName || myEntry?.horseName || 'Your Horse'}</div>
            ${hrSelfieData ? '<img class="hr-entry-selfie-preview" src="'+hrSelfieData+'" alt="Your jockey face">' : ''}
            <div class="hr-entry-wait">Waiting for other jockeys... (${doneCount}/${activePlayers.length})</div>
          </div>
        </div>`;
    } else {
      // Don't rebuild camera elements if they already exist (preserves video stream)
      const existingVideo = el.querySelector('#hrSelfieVideo');
      if (!existingVideo) {
        el.innerHTML = `
          <div class="hr-naming-screen">
            <div class="hr-naming-header">
              <div class="hr-naming-title">JOCKEY REGISTRATION</div>
              <div class="sb-timer-pill ${state.timer <= 5 ? 'sb-timer-urgent' : ''}">
                <span class="sb-timer-num">${state.timer}s</span>
              </div>
            </div>
            <div class="hr-naming-subtitle">Name your horse and take a selfie to ride it!</div>

            <div class="hr-name-section">
              <label class="hr-label">HORSE NAME</label>
              <div class="hr-name-row">
                <input type="text" id="hrHorseNameInput" class="hr-name-input" placeholder="e.g. Thunder Express" maxlength="24" autocomplete="off" value="${hrHorseName}">
                <button class="hr-random-btn" onclick="document.getElementById('hrHorseNameInput').value = hrRandomName()">&#127922; RANDOM</button>
              </div>
            </div>

            <div class="hr-selfie-section">
              <label class="hr-label">YOUR JOCKEY FACE</label>
              <div class="hr-selfie-box">
                <video id="hrSelfieVideo" class="hr-selfie-video" playsinline autoplay muted style="display:none"></video>
                <canvas id="hrSelfieCanvas" class="hr-selfie-canvas" style="display:none"></canvas>
                <div id="hrSelfiePrompt" class="hr-selfie-prompt">
                  <div class="hr-selfie-icon">&#128247;</div>
                  <div>Tap below to open camera</div>
                </div>
              </div>
              <button id="hrCaptureBtn" class="hr-capture-btn" onclick="hrStartCamera()">OPEN CAMERA</button>
            </div>

            <button class="hr-submit-entry-btn" onclick="hrSubmitEntry()">LOCK IN & RIDE!</button>
            <div class="hr-naming-progress">${doneCount}/${activePlayers.length} jockeys registered</div>
          </div>`;
      } else {
        // Just update timer and progress
        const timerEl = el.querySelector('.sb-timer-num');
        if (timerEl) timerEl.textContent = state.timer + 's';
        const progEl = el.querySelector('.hr-naming-progress');
        if (progEl) progEl.textContent = `${doneCount}/${activePlayers.length} jockeys registered`;
      }
    }
    window._hrState = state;
    return;
  }

  if (state.phase === 'betting') {
    const sorted = [...horses].sort((a,b) => a.scratched ? 1 : b.scratched ? -1 : a.odds - b.odds);
    const fav = sorted.find(h => !h.scratched);
    const activeCount = horses.filter(h => !h.scratched).length;
    const isTri = hrBetType === 'trifecta';
    const triLabels = ['1ST', '2ND', '3RD'];
    const triNames = hrTrifecta.map(id => id ? horses.find(h=>h.id===id)?.name?.split(' ').pop() : '---');

    el.innerHTML = `
      <div class="sb-venue-header">
        <div class="sb-venue-top">
          <div class="sb-venue-icon">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#00c853" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          </div>
          <div class="sb-venue-info">
            <div class="sb-venue-name">Sandown</div>
            <div class="sb-venue-meta">
              <span class="sb-race-badge">R${state.raceNumber || ''}</span>
              <span>R1</span><span>R2</span><span>R3</span><span>R4</span>
            </div>
          </div>
          <div class="sb-timer-pill ${state.timer <= 5 ? 'sb-timer-urgent' : ''}">
            <svg viewBox="0 0 36 36" width="28" height="28">
              <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="2.5"/>
              <circle cx="18" cy="18" r="15" fill="none" stroke="${state.timer <= 5 ? '#ff1744' : '#00c853'}" stroke-width="2.5"
                stroke-dasharray="${2*Math.PI*15}" stroke-dashoffset="${2*Math.PI*15*(1 - state.timer/25)}"
                stroke-linecap="round" transform="rotate(-90 18 18)" style="transition:stroke-dashoffset 1s linear"/>
            </svg>
            <span class="sb-timer-num">${state.timer}s</span>
          </div>
        </div>
        <div class="sb-race-detail">
          R${state.raceNumber} Sportsbet Race Preview Hcp &middot; ${state.distance}m &middot; ${state.trackCondition}${state.trackBias && state.trackBias !== 'Neutral' ? ' &middot; ' + state.trackBias + ' bias' : ''} &middot; ${activeCount} runners
        </div>
      </div>

      <div class="sb-offers-bar">
        <span class="sb-offers-icon">&#9733;</span> My Offers on this Race
      </div>

      <div class="sb-bet-tabs">
        <button class="sb-tab ${hrBetType==='win'||hrBetType==='place' ? 'sb-tab-active' : ''}" onclick="hrBetType='win'; hrTrifecta=[null,null,null]; hrTrifectaSlot=0; renderHorseRacing(window._hrState)">Win or Place</button>
        <button class="sb-tab ${hrBetType==='trifecta' ? 'sb-tab-active' : ''}" onclick="hrBetType='trifecta'; hrSelectedHorse=null; hrTrifecta=[null,null,null]; hrTrifectaSlot=0; renderHorseRacing(window._hrState)">Trifecta</button>
      </div>

      ${isTri ? `
        <div class="sb-trifecta-bar">
          ${hrTrifecta.map((id, si) => `
            <div class="sb-tri-slot ${hrTrifectaSlot === si ? 'sb-tri-active' : ''} ${id ? 'sb-tri-filled' : ''}"
              onclick="hrTrifectaSlot=${si}; renderHorseRacing(window._hrState)">
              <div class="sb-tri-label">${triLabels[si]}</div>
              <div class="sb-tri-pick">${triNames[si]}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="sb-runner-header">
        <span class="sb-rh-left">Race overview by Best Bets</span>
        <span class="sb-rh-win">Win</span>
        <span class="sb-rh-place">Place</span>
      </div>

      <div class="sb-race-card">
        ${sorted.map((h, si) => {
          const origIdx = horses.indexOf(h);
          if (h.scratched) return `
            <div class="sb-runner sb-scratched">
              <div class="sb-r-main">
                <span class="sb-r-num" style="background:#555">${origIdx+1}</span>
                <div class="sb-r-info"><span class="sb-r-name"><s>${h.name}</s></span></div>
                <span class="sb-r-scr">SCR</span>
              </div>
            </div>`;

          const isFav = h === fav;
          const isExpanded = hrExpandedHorse === h.id;
          const career = h.career || { starts: 0, wins: 0, seconds: 0, thirds: 0 };
          const isSel = (!isTri && hrSelectedHorse === h.id);
          const triSlotIdx = hrTrifecta.indexOf(h.id);
          const isInTri = triSlotIdx >= 0;
          const winOdds = h.odds.toFixed(2);
          const placeOdds = (h.placeOdds || Math.max(1.1, h.odds * 0.35)).toFixed(2);
          const isWinSel = isSel && hrBetType === 'win';
          const isPlaceSel = isSel && hrBetType === 'place';

          return `
          <div class="sb-runner ${isSel ? 'sb-selected' : ''} ${isInTri ? 'sb-tri-selected' : ''}">
            <div class="sb-r-main" onclick="hrExpandedHorse = hrExpandedHorse===${h.id} ? null : ${h.id}; renderHorseRacing(window._hrState)">
              <span class="sb-r-num" style="background:${h.color}">${origIdx+1}</span>
              <div class="sb-r-info">
                <div class="sb-r-name-row">
                  <span class="sb-r-name">${h.name}</span>
                  ${isFav ? '<span class="sb-fav-tag">FAV</span>' : ''}
                  ${isInTri ? '<span class="sb-tri-tag">' + triLabels[triSlotIdx] + '</span>' : ''}
                </div>
                <div class="sb-r-sub">(${h.barrier || origIdx+1}) ${h.weight || 57}kg ${h.playerName ? '<span style="color:#ffd700">&#127941; ' + h.playerName + '</span>' : (h.jockey || '')}</div>
                <div class="sb-r-form-line">
                  ${h.form && h.form.length > 0 ? h.form.map(f => '<span class="sb-form-num ' + (f===1?'sb-f1':f===2?'sb-f2':f===3?'sb-f3':'') + '">' + f + '</span>').join('') : '<span class="sb-no-form">No form</span>'}
                  <span class="sb-r-style-tag">${h.styleDesc || ''}</span>
                </div>
              </div>
              <div class="sb-r-odds-group">
                <button class="sb-odds-btn ${isWinSel ? 'sb-odds-active' : ''} ${h.odds < h.baseOdds ? 'sb-odds-short' : h.odds > h.baseOdds ? 'sb-odds-drift' : ''}"
                  onclick="event.stopPropagation(); ${isTri ? 'hrSelectTrifecta('+h.id+')' : "hrBetType='win'; hrSelectedHorse="+h.id}; renderHorseRacing(window._hrState)">
                  $${winOdds}
                </button>
                <button class="sb-odds-btn sb-odds-place ${isPlaceSel ? 'sb-odds-active' : ''}"
                  onclick="event.stopPropagation(); ${isTri ? 'hrSelectTrifecta('+h.id+')' : "hrBetType='place'; hrSelectedHorse="+h.id}; renderHorseRacing(window._hrState)">
                  $${placeOdds}
                </button>
              </div>
            </div>
            ${isExpanded ? `
              <div class="sb-r-expanded">
                <div class="sb-form-table">
                  <div class="sb-form-row sb-form-head">
                    <span></span><span>Starts</span><span>1st</span><span>2nd</span><span>3rd</span><span>Win%</span>
                  </div>
                  <div class="sb-form-row">
                    <span>Career</span>
                    <span>${career.starts}</span>
                    <span>${career.wins}</span>
                    <span>${career.seconds}</span>
                    <span>${career.thirds}</span>
                    <span>${career.starts > 0 ? Math.round(career.wins/career.starts*100) : 0}%</span>
                  </div>
                  <div class="sb-form-row">
                    <span>Distance</span>
                    <span>${Math.max(1, career.starts - Math.floor(Math.random()*5))}</span>
                    <span>${Math.max(0, career.wins - Math.floor(Math.random()*2))}</span>
                    <span>${Math.max(0, career.seconds - Math.floor(Math.random()*2))}</span>
                    <span>${career.thirds}</span>
                    <span>-</span>
                  </div>
                  <div class="sb-form-row">
                    <span>${state.trackCondition?.split(' ')[0] || 'Track'}</span>
                    <span>${Math.max(1, Math.floor(career.starts * 0.6))}</span>
                    <span>${Math.max(0, Math.floor(career.wins * 0.6))}</span>
                    <span>${Math.max(0, Math.floor(career.seconds * 0.5))}</span>
                    <span>${Math.max(0, Math.floor(career.thirds * 0.5))}</span>
                    <span>-</span>
                  </div>
                </div>
                <div class="sb-r-temperament">${h.temperament || ''} &middot; ${h.styleDesc || ''}</div>
              </div>
            ` : ''}
          </div>`;
        }).join('')}
      </div>

      ${!myBet ? `
        <div class="sb-bet-slip">
          <div class="sb-slip-header">
            <span>Bet Slip</span>
            ${hrSelectedHorse || hrTrifecta.some(t=>t) ? '<span class="sb-slip-clear" onclick="hrSelectedHorse=null; hrTrifecta=[null,null,null]; hrTrifectaSlot=0; renderHorseRacing(window._hrState)">Clear</span>' : ''}
          </div>
          ${hrSelectedHorse && !isTri ? (() => {
            const selH = horses.find(h=>h.id===hrSelectedHorse);
            const betOdds = hrBetType === 'place' ? (selH?.placeOdds||1.5) : (selH?.odds||1);
            return '<div class="sb-slip-selection">' +
              '<div class="sb-slip-type">' + (hrBetType === 'place' ? 'PLACE' : 'WIN') + '</div>' +
              '<div class="sb-slip-horse">' + (selH?.name||'') + ' — $' + betOdds.toFixed(2) + '</div>' +
              '</div>' +
              '<div class="sb-chip-row">' +
              [10,25,50,100,250].map(v =>
                '<button class="sb-chip ' + (hrBetAmount === v ? 'sb-chip-active' : '') + '" onclick="hrBetAmount=' + v + '; renderHorseRacing(window._hrState)">$' + v + '</button>'
              ).join('') +
              '</div>' +
              '<button class="sb-place-bet" onclick="placeHorseBet()">Add to Bet Slip &middot; $' + hrBetAmount + ' returns $' + (hrBetAmount * betOdds).toFixed(0) + '</button>';
          })() : ''}
          ${isTri && hrTrifecta.every(t=>t) ? (() => {
            const triH = hrTrifecta.map(id => horses.find(h=>h.id===id));
            const triOdds = Math.round(triH[0].odds * triH[1].odds * triH[2].odds * 0.08 * 100) / 100;
            return '<div class="sb-slip-selection">' +
              '<div class="sb-slip-type">TRIFECTA</div>' +
              '<div class="sb-slip-horse">' + triH.map((h,i) => (i+1)+'. '+h.name).join(' / ') + '</div>' +
              '<div class="sb-slip-odds">@ $' + triOdds.toFixed(2) + '</div>' +
              '</div>' +
              '<div class="sb-chip-row">' +
              [5,10,25,50,100].map(v =>
                '<button class="sb-chip ' + (hrBetAmount === v ? 'sb-chip-active' : '') + '" onclick="hrBetAmount=' + v + '; renderHorseRacing(window._hrState)">$' + v + '</button>'
              ).join('') +
              '</div>' +
              '<button class="sb-place-bet" onclick="placeHorseBet()">Add to Bet Slip &middot; $' + hrBetAmount + ' returns $' + (hrBetAmount * triOdds).toFixed(0) + '</button>';
          })() : isTri ? '<div class="sb-slip-hint">Select 1st, 2nd, 3rd to complete trifecta</div>' : ''}
          ${!hrSelectedHorse && !isTri ? '<div class="sb-slip-hint">Select a runner to add to bet slip</div>' : ''}
        </div>
      ` : `
        <div class="sb-bet-confirmed">
          <div class="sb-bet-tick">&#10003;</div>
          <div class="sb-bet-info">
            <div class="sb-bet-type-label">${(myBet.betType || 'win').toUpperCase()}</div>
            <div class="sb-bet-horse-name">${myBet.betType === 'trifecta' ? myBet.trifecta?.map(id => horses.find(h=>h.id===id)?.name).join(' / ') : horses.find(h=>h.id===myBet.horseId)?.name}</div>
            <div class="sb-bet-detail">$${myBet.amount} @ $${myBet.lockedAtOdds ? myBet.lockedAtOdds.toFixed(2) : '?'} &middot; Returns $${myBet.lockedAtOdds ? Math.round(myBet.amount * myBet.lockedAtOdds) : '?'}</div>
          </div>
        </div>
      `}
    `;
  } else {
    const commentary = state.commentary || '';
    const isRacing = state.phase === 'racing';
    const isStarting = state.phase === 'starting';
    const isLoading = state.phase === 'loading';
    const atGate = isStarting || isLoading;
    const leaderPos = Math.max(...horses.map(h => h.position || 0), 0);
    const progressPct = Math.min(100, Math.round(leaderPos));

    const myHorse = myBet ? horses.find(h => h.id === myBet.horseId) : null;
    const myPos = myHorse && state.livePositions ? state.livePositions.find(lp => lp.id === myHorse.id) : null;

    const activeHorses = horses.filter(h => !h.scratched);
    let displayHorses;
    if (isRacing && activeHorses.length > 8) {
      const topIds = (state.livePositions || []).slice(0, 6).map(lp => lp.id);
      if (myBet && !topIds.includes(myBet.horseId)) topIds.push(myBet.horseId);
      displayHorses = horses.filter(h => topIds.includes(h.id) || !h.scratched && horses.indexOf(h) < 6);
      displayHorses = displayHorses.slice(0, 8);
    } else {
      displayHorses = horses;
    }

    el.innerHTML = `
      <div class="hr-race-live-header">
        <div class="hr-live-left">
          <span class="hr-live-badge ${isRacing ? 'hr-live-on' : ''}">
            ${isLoading ? 'LOADING' : isStarting ? 'GATES' : isRacing ? 'LIVE' : 'RESULT'}
          </span>
          <span class="hr-live-race">R${state.raceNumber || ''} &middot; ${state.distance || ''}m</span>
        </div>
        ${isRacing ? '<div class="hr-live-progress"><div class="hr-live-progress-fill" style="width:'+progressPct+'%"></div><span class="hr-live-pct">'+progressPct+'%</span></div>' : ''}
      </div>

      ${myHorse && (isRacing || atGate) ? `
        <div class="hr-my-status ${myPos && myPos.pos <= 3 ? 'hr-my-podium' : ''}">
          <span class="hr-my-silk" style="background:${myHorse.color}">${horses.indexOf(myHorse)+1}</span>
          <div class="hr-my-info">
            <div class="hr-my-name">${myHorse.name}</div>
            <div class="hr-my-detail">${myPos ? 'Position: '+myPos.pos+(myPos.pos===1?'st':myPos.pos===2?'nd':myPos.pos===3?'rd':'th')+(myPos.margin > 0 ? ' &middot; '+myPos.margin+'L behind' : ' &middot; LEADING') : 'At the gates'}</div>
          </div>
          <div class="hr-my-bet-info">$${myBet.amount}<br><span style="font-size:9px;opacity:0.7">@ $${myBet.lockedAtOdds?.toFixed(2) || '?'}</span></div>
        </div>
      ` : ''}

      ${commentary ? '<div class="race-commentary">'+commentary+'</div>' : ''}

      <div class="race-track">
        ${displayHorses.map((h) => {
          const i = horses.indexOf(h);
          const isMyHorse = myBet && myBet.horseId === h.id;
          const pos = state.livePositions?.find(lp => lp.id === h.id);
          return `
          <div class="horse-lane ${isMyHorse ? 'my-horse-lane' : ''}">
            <div class="horse-info">
              <div class="horse-number-badge" style="background:${h.color}">${i + 1}</div>
              <div>
                <div class="horse-name" style="color:${h.color}">${h.name}</div>
                <div class="horse-odds">${pos ? '#'+pos.pos : ''}</div>
              </div>
            </div>
            <div class="track-lane" style="background:linear-gradient(90deg, ${isMyHorse ? '#2a2500' : '#2a1f0f'}, ${isMyHorse ? '#4a3800' : '#3d2b1a'})">
              <div class="finish-line"></div>
              <div class="horse-marker ${isRacing ? 'racing' : ''} ${state.winner === h.id ? 'winner' : ''} ${atGate ? 'at-gate' : ''} ${isMyHorse && isRacing ? 'my-horse-marker' : ''}"
                style="left:calc(${atGate ? 2 : Math.min(h.position || 0, 93)}% - 10px); ${isLoading && !h.gateLoaded ? 'opacity:0.3' : ''}">
                <svg viewBox="0 0 28 20" width="28" height="20">
                  <path d="M4 16 L7 10 L9 11 L11 6 L14 5 L18 4 L22 4 L25 5 L27 4 L27 6 L25 7 L23 9 L22 14 L24 16 L22 16 L20 12 L16 11 L13 13 L11 16 L9 16 L12 11 L9 14 L7 16 Z"
                    fill="${h.color}" stroke="${isMyHorse ? '#ffd700' : 'rgba(0,0,0,0.3)'}" stroke-width="${isMyHorse ? '1' : '0.3'}"/>
                  <circle cx="26" cy="5.5" r="1" fill="#fff"/>
                  <text x="15" y="10" text-anchor="middle" font-size="7" font-weight="bold" fill="#fff" stroke="#000" stroke-width="0.3">${i+1}</text>
                </svg>
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>

      ${state.phase === 'result' ? `
        <div class="hr-result-card">
          <div class="hr-result-header">RACE ${state.raceNumber || ''} RESULT</div>
          <div class="hr-result-places">
            ${(state.places || []).slice(0, 3).map((pid, pi) => {
              const ph = horses.find(hh => hh.id === pid);
              const margin = state.margins?.[pi] || 0;
              const marginTxt = pi === 0 ? '' : margin < 0.5 ? 'Nose' : margin < 1.5 ? 'Short Head' : margin < 3 ? '1 Length' : Math.round(margin/2.5) + ' Lengths';
              const labels = ['1ST', '2ND', '3RD'];
              const bgColors = ['rgba(255,215,0,0.15)', 'rgba(192,192,192,0.1)', 'rgba(160,82,45,0.1)'];
              const borderColors = ['var(--gold)', '#999', '#a0522d'];
              return '<div class="sb-result-place" style="background:'+bgColors[pi]+';border-left:3px solid '+borderColors[pi]+'">' +
                '<span class="sb-result-label" style="color:'+borderColors[pi]+'">'+labels[pi]+'</span>' +
                '<span class="sb-result-silk" style="background:'+(ph?.color)+'">'+((ph ? horses.indexOf(ph)+1 : ''))+'</span>' +
                '<div class="sb-result-info"><div class="sb-result-name">'+(ph?.name||'')+'</div><div class="sb-result-jockey">'+(ph?.jockey||'')+' &middot; ('+(ph?.barrier||'')+') '+(ph?.weight||'')+'kg</div></div>' +
                '<div class="sb-result-right"><div class="sb-result-margin">'+marginTxt+'</div><div class="sb-result-odds">Win $'+((ph?.lockedOdds||ph?.odds||0).toFixed(2))+' / Pl $'+((ph?.placeOdds||(ph?.odds*0.35)||0).toFixed(2))+'</div></div>' +
                '</div>';
            }).join('')}
          </div>
          ${myBet ? `
            <div class="sb-result-mybet ${myBet.won ? 'sb-result-win' : 'sb-result-loss'}">
              <div class="sb-result-bet-type">${(myBet.betType || 'win').toUpperCase()} BET</div>
              ${myBet.won
                ? '<div class="sb-win-amount">+$'+myBet.winAmount+'</div><div class="sb-win-sub">Paid $'+(myBet.lockedAtOdds?.toFixed(2)||'?')+'</div>'
                : '<div class="sb-loss-msg">'+(myBet.betType === 'trifecta' ? 'Trifecta did not land' : 'Finished '+(state.livePositions?.find(lp=>lp.id===myBet.horseId)?.pos||'?')+(['st','nd','rd'][((state.livePositions?.find(lp=>lp.id===myBet.horseId)?.pos||4)-1)]||'th'))+'</div>'
              }
            </div>
          ` : ''}
        </div>
      ` : ''}
    `;
  }
  window._hrState = state;
}

function hrSelectTrifecta(horseId) {
  const existing = hrTrifecta.indexOf(horseId);
  if (existing >= 0) {
    hrTrifecta[existing] = null;
    hrTrifectaSlot = existing;
    return;
  }
  hrTrifecta[hrTrifectaSlot] = horseId;
  for (let i = 0; i < 3; i++) {
    const next = (hrTrifectaSlot + 1 + i) % 3;
    if (!hrTrifecta[next]) { hrTrifectaSlot = next; break; }
  }
}

function placeHorseBet() {
  if (hrBetType === 'trifecta') {
    if (!hrTrifecta.every(t => t)) return showToast('Select 1st, 2nd and 3rd');
    socket.emit('horseracing:bet', { horseId: hrTrifecta[0], amount: hrBetAmount, betType: 'trifecta', trifecta: hrTrifecta });
  } else {
    if (!hrSelectedHorse) return showToast('Select a horse first');
    socket.emit('horseracing:bet', { horseId: hrSelectedHorse, amount: hrBetAmount, betType: hrBetType });
  }
}
