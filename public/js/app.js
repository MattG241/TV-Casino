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
  bell: '🔔', bar: '📊', seven: '7️⃣', diamond: '💎'
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

let slotsBetAmount = 10;

function renderSlots(state) {
  const el = document.getElementById('slotsContent');
  const myResult = state.results?.[myId];

  let reelsHTML = '';
  if (myResult) {
    reelsHTML = myResult.reels.map((reel, ri) => `
      <div class="slot-reel">
        ${reel.map((sym, si) => `
          <div class="slot-symbol ${si === 1 ? 'middle' : ''}">${SLOT_SYMBOLS[sym]}</div>
        `).join('')}
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

  el.innerHTML = `
    <div class="slots-machine">
      <div style="font-size:20px;font-weight:800;color:var(--gold);text-align:center;margin-bottom:12px">
        LUCKY SLOTS
      </div>
      <div class="slots-display">${reelsHTML}</div>
      ${myResult && myResult.winAmount > 0 ? `
        <div class="win-display">WIN! $${myResult.winAmount} (${myResult.multiplier}x)</div>
      ` : myResult ? `
        <div style="text-align:center;color:var(--text-dim);margin-top:12px">No win - try again!</div>
      ` : ''}
    </div>

    <div class="bet-controls">
      <div class="bet-label">Bet Amount</div>
      <div class="bet-amount-display">$${slotsBetAmount}</div>
      <div class="quick-amounts">
        ${[5,10,25,50,100].map(v => `
          <button class="chip-btn chip-${v} ${slotsBetAmount === v ? 'selected' : ''}"
            onclick="slotsBetAmount=${v}; renderSlots(window._slotsState)">${v}</button>
        `).join('')}
      </div>
      <button class="btn btn-gold btn-block slots-lever" onclick="spinSlots()">
        PULL THE LEVER!
      </button>
    </div>
  `;
  window._slotsState = state;
}

function spinSlots() {
  socket.emit('slots:spin', { amount: slotsBetAmount });
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

  el.innerHTML = `
    <div class="poker-table">
      <div class="pot-display">Pot: $${state.pot || 0}</div>

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

      ${state.phase === 'result' || state.phase === 'showdown' ? `
        <div class="bj-result ${state.winner === myId ? 'win' : 'lose'}">
          ${state.winner === myId ? `YOU WIN $${state.pot}!` : 'Better luck next hand'}
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
          <button class="btn btn-gold btn-sm" onclick="pokerAction('raise', pokerRaiseAmount)">RAISE $${pokerRaiseAmount}</button>
          <button class="btn btn-purple btn-sm" onclick="pokerAction('allin')">ALL IN</button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
          <span style="font-size:12px;color:var(--text-dim)">$${state.currentBet || 0}</span>
          <input type="range" class="raise-slider" min="${(state.currentBet || 0) + 20}" max="${myChips}"
            value="${pokerRaiseAmount}" oninput="pokerRaiseAmount=parseInt(this.value);this.nextElementSibling.textContent='$'+this.value">
          <span style="font-size:12px;color:var(--text-dim)">$${pokerRaiseAmount}</span>
        </div>
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

function renderHorseRacing(state) {
  const el = document.getElementById('horseracingContent');
  const horses = state.horses || [];
  const myBet = state.bets?.[myId];

  if (state.phase === 'betting') {
    const sorted = [...horses].sort((a,b) => a.scratched ? 1 : b.scratched ? -1 : a.odds - b.odds);
    const fav = sorted.find(h => !h.scratched);
    el.innerHTML = `
      <div class="race-header-info">
        <div class="race-header-left">
          <span class="race-num-badge">R${state.raceNumber || ''}</span>
          <span class="race-dist">${state.distance || ''}m</span>
          <span class="race-condition">${state.trackCondition || ''}${state.trackBias && state.trackBias !== 'Neutral' ? ' · ' + state.trackBias + ' bias' : ''}</span>
        </div>
        <div class="race-header-right">
          <span class="race-runners">${horses.filter(h=>!h.scratched).length} runners</span>
        </div>
      </div>

      <div class="hr-timer-ring">
        <svg viewBox="0 0 60 60" width="48" height="48">
          <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="4"/>
          <circle cx="30" cy="30" r="26" fill="none" stroke="${state.timer <= 5 ? 'var(--red)' : 'var(--gold)'}" stroke-width="4"
            stroke-dasharray="${2*Math.PI*26}" stroke-dashoffset="${2*Math.PI*26*(1 - state.timer/25)}"
            stroke-linecap="round" transform="rotate(-90 30 30)" style="transition:stroke-dashoffset 1s linear"/>
          <text x="30" y="34" text-anchor="middle" fill="${state.timer <= 5 ? 'var(--red)' : '#fff'}" font-size="16" font-weight="900">${state.timer}</text>
        </svg>
        <span class="hr-timer-label">PLACE BETS</span>
      </div>

      <div class="hr-race-card">
        ${sorted.map((h, si) => {
          const origIdx = horses.indexOf(h);
          if (h.scratched) return `
            <div class="hr-runner hr-scratched">
              <span class="hr-r-num" style="background:#666">${origIdx+1}</span>
              <div class="hr-r-details"><span class="hr-r-name"><s>${h.name}</s></span></div>
              <span class="hr-r-scr">SCR</span>
            </div>`;
          const isSel = hrSelectedHorse === h.id;
          const isFav = h === fav;
          return `
          <div class="hr-runner ${isSel ? 'hr-selected' : ''} ${isFav ? 'hr-fav' : ''}"
            onclick="hrSelectedHorse=${h.id}; renderHorseRacing(window._hrState)">
            <span class="hr-r-num" style="background:${h.color}">${origIdx+1}</span>
            <div class="hr-r-details">
              <div class="hr-r-name">${h.name}${isFav ? ' <span class="hr-fav-tag">FAV</span>' : ''}</div>
              <div class="hr-r-sub">${h.jockey || ''} · B${h.barrier || origIdx+1} <span class="hr-r-style">${h.styleDesc || ''}</span></div>
              ${h.form && h.form.length > 0 ? `<div class="hr-r-form">${h.form.map(f => `<span class="hr-form-dot ${f===1?'hr-f1':f===2?'hr-f2':f===3?'hr-f3':f<=5?'hr-f5':''}">${f}</span>`).join('')}</div>` : ''}
            </div>
            <div class="hr-r-odds-col">
              <div class="hr-r-odds ${h.odds < h.baseOdds ? 'odds-short' : h.odds > h.baseOdds ? 'odds-drift' : ''}">$${h.odds.toFixed(2)}</div>
            </div>
          </div>`;
        }).join('')}
      </div>

      ${!myBet ? `
        <div class="hr-bet-panel">
          <div class="hr-chip-row">
            ${[10,25,50,100,250].map(v => `
              <button class="hr-chip ${hrBetAmount === v ? 'hr-chip-active' : ''}"
                onclick="hrBetAmount=${v}; renderHorseRacing(window._hrState)">$${v}</button>
            `).join('')}
          </div>
          <button class="hr-place-bet ${!hrSelectedHorse ? 'disabled' : ''}" onclick="placeHorseBet()"
            ${!hrSelectedHorse ? 'disabled' : ''}>
            ${hrSelectedHorse ?
              `BET $${hrBetAmount} ON ${horses.find(h=>h.id===hrSelectedHorse)?.name?.split(' ')[1] || horses.find(h=>h.id===hrSelectedHorse)?.name} @ $${horses.find(h=>h.id===hrSelectedHorse)?.odds.toFixed(2)}`
              : 'TAP A HORSE TO BET'}
          </button>
        </div>
      ` : `
        <div class="hr-bet-confirmed">
          <div class="hr-bet-tick">✓</div>
          <div class="hr-bet-info">
            <div class="hr-bet-horse">${horses.find(h=>h.id===myBet.horseId)?.name}</div>
            <div class="hr-bet-detail">$${myBet.amount} @ $${myBet.lockedAtOdds ? myBet.lockedAtOdds.toFixed(2) : '?'} · Potential win: $${myBet.lockedAtOdds ? Math.round(myBet.amount * myBet.lockedAtOdds) : '?'}</div>
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

    // Show my horse status prominently at top
    const myHorse = myBet ? horses.find(h => h.id === myBet.horseId) : null;
    const myPos = myHorse && state.livePositions ? state.livePositions.find(lp => lp.id === myHorse.id) : null;

    // Only show top runners + my horse during race to avoid scroll
    const activeHorses = horses.filter(h => !h.scratched);
    let displayHorses;
    if (isRacing && activeHorses.length > 8) {
      const topIds = (state.livePositions || []).slice(0, 6).map(lp => lp.id);
      if (myBet && !topIds.includes(myBet.horseId)) topIds.push(myBet.horseId);
      displayHorses = horses.filter(h => topIds.includes(h.id) || h.scratched === false && horses.indexOf(h) < 6);
      // Limit to max 8
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
          <span class="hr-live-race">R${state.raceNumber || ''} · ${state.distance || ''}m</span>
        </div>
        ${isRacing ? `<div class="hr-live-progress">
          <div class="hr-live-progress-fill" style="width:${progressPct}%"></div>
          <span class="hr-live-pct">${progressPct}%</span>
        </div>` : ''}
      </div>

      ${myHorse && (isRacing || atGate) ? `
        <div class="hr-my-status ${myPos && myPos.pos <= 3 ? 'hr-my-podium' : ''}">
          <span class="hr-my-silk" style="background:${myHorse.color}">${horses.indexOf(myHorse)+1}</span>
          <div class="hr-my-info">
            <div class="hr-my-name">${myHorse.name}</div>
            <div class="hr-my-detail">${myPos ? `Position: ${myPos.pos}${myPos.pos===1?'st':myPos.pos===2?'nd':myPos.pos===3?'rd':'th'}${myPos.margin > 0 ? ' · '+myPos.margin+'L behind' : ' · LEADING'}` : 'At the gates'}</div>
          </div>
          <div class="hr-my-bet-info">$${myBet.amount}<br><span style="font-size:9px;opacity:0.7">@ $${myBet.lockedAtOdds?.toFixed(2) || '?'}</span></div>
        </div>
      ` : ''}

      ${commentary ? `<div class="race-commentary">${commentary}</div>` : ''}

      <div class="race-track">
        ${displayHorses.map((h, di) => {
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
              return `<div class="hr-result-place" style="background:${bgColors[pi]};border-left:3px solid ${borderColors[pi]}">
                <span class="hr-result-label" style="color:${borderColors[pi]}">${labels[pi]}</span>
                <span class="hr-result-silk" style="background:${ph?.color}">${horses.indexOf(ph)+1}</span>
                <span class="hr-result-name">${ph?.name || ''}</span>
                <span class="hr-result-margin">${marginTxt}</span>
                <span class="hr-result-odds">$${(ph?.lockedOdds||ph?.odds||0).toFixed(2)}</span>
              </div>`;
            }).join('')}
          </div>
          ${myBet ? `
            <div class="hr-result-mybet ${myBet.won ? 'hr-result-win' : 'hr-result-loss'}">
              ${myBet.won
                ? `<div class="hr-win-amount">+$${myBet.winAmount}</div><div class="hr-win-sub">Winner! Paid $${myBet.lockedAtOdds?.toFixed(2) || '?'}</div>`
                : `<div class="hr-loss-msg">Your horse finished ${state.livePositions?.find(lp=>lp.id===myBet.horseId)?.pos || '?'}${['st','nd','rd'][((state.livePositions?.find(lp=>lp.id===myBet.horseId)?.pos||4)-1)]||'th'}</div>`
              }
            </div>
          ` : ''}
        </div>
      ` : ''}
    `;
  }
  window._hrState = state;
}

function placeHorseBet() {
  if (!hrSelectedHorse) return showToast('Select a horse first');
  socket.emit('horseracing:bet', { horseId: hrSelectedHorse, amount: hrBetAmount });
}
