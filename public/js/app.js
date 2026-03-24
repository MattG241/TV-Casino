// ── TV Casino Mobile App ────────────────────────────────────────────────

const socket = io();

// ── State ───────────────────────────────────────────────────────────────

let myId = null;
let myName = '';
let myChips = 1000;
let roomCode = '';
let isHost = false;
let selectedAvatar = 0;
let currentGame = null;
let players = [];

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

// ── Room Management ─────────────────────────────────────────────────────

function createRoom() {
  myName = document.getElementById('playerName').value.trim() || 'Player';
  socket.emit('room:create', { playerName: myName, avatar: selectedAvatar });
}

function joinRoom() {
  myName = document.getElementById('playerName').value.trim() || 'Player';
  const code = document.getElementById('roomCode').value.trim().toUpperCase();
  if (code.length !== 4) return showToast('Enter a 4-letter code');
  socket.emit('room:join', { code, playerName: myName, avatar: selectedAvatar });
}

socket.on('room:created', (data) => {
  myId = data.playerId;
  roomCode = data.code;
  isHost = true;
  players = data.players;
  enterRoom();
});

socket.on('room:joined', (data) => {
  myId = data.playerId;
  roomCode = data.code;
  isHost = false;
  players = data.players;
  enterRoom();
  if (data.currentGame) {
    currentGame = data.currentGame;
    showGameUI(currentGame);
  }
});

socket.on('room:error', (data) => showToast(data.message));

function enterRoom() {
  showScreen('roomScreen');
  document.getElementById('displayRoomCode').textContent = roomCode;
  updatePlayers(players);
  updateSelectLabel();
}

function updateSelectLabel() {
  const label = document.getElementById('selectLabel');
  if (isHost) {
    label.textContent = 'Choose a game to play';
    document.querySelectorAll('.game-card').forEach(c => c.style.opacity = '1');
  } else {
    label.textContent = 'Waiting for host to pick a game...';
    document.querySelectorAll('.game-card').forEach(c => c.style.opacity = '0.5');
  }
}

socket.on('players:update', (data) => {
  players = data;
  updatePlayers(data);
  const me = data.find(p => p.id === myId);
  if (me) {
    myChips = me.chips;
    document.getElementById('myChips').textContent = myChips.toLocaleString();
    isHost = me.isHost;
  }
});

function updatePlayers(list) {
  const bar = document.getElementById('playersBar');
  bar.innerHTML = list.map(p => `
    <div class="player-chip ${p.isHost ? 'is-host' : ''}">
      <div class="avatar">${AVATARS[p.avatar] || '😎'}</div>
      <div class="name">${p.name}${p.id === myId ? ' (you)' : ''}</div>
      <div class="chips">$${p.chips.toLocaleString()}</div>
    </div>
  `).join('');
}

// ── Game Selection ──────────────────────────────────────────────────────

function selectGame(game) {
  if (!isHost) return showToast('Only the host can pick games');
  socket.emit('game:select', { game });
}

socket.on('game:started', ({ game }) => {
  currentGame = game;
  showGameUI(game);
});

function showGameUI(game) {
  document.getElementById('gameSelection').style.display = 'none';
  document.getElementById('gameArea').style.display = 'block';
  document.querySelectorAll('#gameArea .screen').forEach(s => s.classList.remove('active'));
  document.getElementById(game + 'Game').classList.add('active');
}

function backToLobby() {
  if (isHost) {
    document.getElementById('gameArea').style.display = 'none';
    document.getElementById('gameSelection').style.display = 'block';
    currentGame = null;
  } else {
    showToast('Only the host can switch games');
  }
}

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
  if (el) el.textContent = timer > 0 ? `${timer}s remaining` : 'Time\'s up!';
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
  } else if (state.phase === 'result' && state.result) {
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

function placeRouletteBet(type, value) {
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
    el.innerHTML = `
      <div class="timer-bar"><div class="timer-fill" style="width:${(state.timer/15)*100}%"></div></div>
      <div class="timer-text">${state.timer}s to place bets</div>

      <div class="horse-select-grid">
        ${horses.map(h => `
          <div class="horse-select-btn ${hrSelectedHorse === h.id ? 'selected' : ''}"
            onclick="hrSelectedHorse=${h.id}; renderHorseRacing(window._hrState)"
            style="border-left: 4px solid ${h.color}">
            <div class="horse-select-name">${h.name}</div>
            <div class="horse-select-odds">${h.odds}:1 odds</div>
          </div>
        `).join('')}
      </div>

      ${!myBet ? `
        <div class="bet-controls">
          <div class="bet-amount-display">$${hrBetAmount}</div>
          <div class="quick-amounts">
            ${[10,25,50,100].map(v => `
              <button class="chip-btn chip-${v} ${hrBetAmount === v ? 'selected' : ''}"
                onclick="hrBetAmount=${v}; renderHorseRacing(window._hrState)">${v}</button>
            `).join('')}
          </div>
          <button class="btn btn-gold btn-block" onclick="placeHorseBet()"
            ${!hrSelectedHorse ? 'disabled style="opacity:0.5"' : ''}>
            ${hrSelectedHorse ? `BET ON ${horses.find(h=>h.id===hrSelectedHorse)?.name}` : 'SELECT A HORSE'}
          </button>
        </div>
      ` : `
        <div class="status-msg success">
          Bet $${myBet.amount} on ${horses.find(h=>h.id===myBet.horseId)?.name}
        </div>
      `}
    `;
  } else {
    el.innerHTML = `
      <div class="race-track">
        ${horses.map(h => `
          <div class="horse-lane">
            <div class="horse-info" style="color:${h.color}">
              <div class="horse-name">${h.name}</div>
              <div class="horse-odds">${h.odds}:1</div>
            </div>
            <div class="track-lane">
              <div class="finish-line"></div>
              <div class="horse-marker ${state.phase === 'racing' ? 'racing' : ''}"
                style="left:calc(${Math.min(h.position, 95)}% - 12px)">🏇</div>
            </div>
          </div>
        `).join('')}
      </div>

      ${state.phase === 'result' ? `
        <div style="text-align:center;margin-top:12px">
          <div style="font-size:20px;font-weight:800;color:var(--gold)">
            ${horses.find(h=>h.id===state.winner)?.name} wins!
          </div>
          ${myBet?.won ? `
            <div class="win-display">You won $${myBet.winAmount}!</div>
          ` : myBet ? `
            <div style="color:var(--red);margin-top:4px">Your horse didn't win</div>
          ` : ''}
        </div>
      ` : `
        <div style="text-align:center;font-size:16px;color:var(--gold);margin-top:12px;font-weight:700">
          AND THEY'RE OFF! 🏁
        </div>
      `}
    `;
  }
  window._hrState = state;
}

function placeHorseBet() {
  if (!hrSelectedHorse) return showToast('Select a horse first');
  socket.emit('horseracing:bet', { horseId: hrSelectedHorse, amount: hrBetAmount });
}
