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
let mySelfie = null;      // base64 JPEG dataURL
let myHorseName = '';
let pendingRoomCode = '';
let selfieStream = null;

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
      roomCode, playerId: myId, playerName: myName, avatar: selectedAvatar,
      selfie: mySelfie, horseName: myHorseName, ts: Date.now()
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
    myName = s.playerName || 'Player';
    selectedAvatar = s.avatar || 0;
    mySelfie = s.selfie || null;
    myHorseName = s.horseName || '';
    socket.emit('room:rejoin', { code: s.roomCode, existingPlayerId: s.playerId, selfie: mySelfie, horseName: myHorseName });
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
  pendingRoomCode = code;
  showScreen('selfieScreen');
  initSelfieCamera();
}

// ── Selfie Flow ──────────────────────────────────────────────────────────

function initSelfieCamera() {
  const video = document.getElementById('selfieVideo');
  const img = document.getElementById('selfieImg');
  const snapBtn = document.getElementById('selfieSnapBtn');
  const retakeBtn = document.getElementById('selfieRetakeBtn');
  video.style.display = 'block';
  img.style.display = 'none';
  snapBtn.style.display = '';
  retakeBtn.style.display = 'none';

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast('Camera not available — skip photo');
    return;
  }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 240, height: 240 }, audio: false })
    .then(stream => {
      selfieStream = stream;
      video.srcObject = stream;
    })
    .catch(() => {
      showToast('Camera permission denied — skip photo');
    });
}

function stopSelfieCamera() {
  if (selfieStream) {
    selfieStream.getTracks().forEach(t => t.stop());
    selfieStream = null;
  }
}

function captureSelfie() {
  const video = document.getElementById('selfieVideo');
  const canvas = document.getElementById('selfieCanvas');
  const img = document.getElementById('selfieImg');
  const snapBtn = document.getElementById('selfieSnapBtn');
  const retakeBtn = document.getElementById('selfieRetakeBtn');

  const size = 240;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Draw video frame, cropped square, then clip to circle
  const vw = video.videoWidth || size;
  const vh = video.videoHeight || size;
  const side = Math.min(vw, vh);
  const sx = (vw - side) / 2;
  const sy = (vh - side) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(video, sx, sy, side, side, 0, 0, size, size);
  ctx.restore();

  mySelfie = canvas.toDataURL('image/jpeg', 0.65);

  // Show preview
  img.src = mySelfie;
  img.style.display = 'block';
  video.style.display = 'none';
  snapBtn.style.display = 'none';
  retakeBtn.style.display = '';
  stopSelfieCamera();
}

function retakeSelfie() {
  mySelfie = null;
  initSelfieCamera();
}

function skipSelfie() {
  mySelfie = null;
  stopSelfieCamera();
  doJoinRoom();
}

function completeSelfie() {
  myHorseName = (document.getElementById('horseNameInput').value.trim() || myName + "'s Horse").substring(0, 20);
  stopSelfieCamera();
  doJoinRoom();
}

function doJoinRoom() {
  socket.emit('room:join', {
    code: pendingRoomCode,
    playerName: myName,
    avatar: selectedAvatar,
    selfie: mySelfie,
    horseName: myHorseName,
  });
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
    document.querySelectorAll('#myChips, #gameChips').forEach(el => {
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

// lobby:vote-start = between races, go back to lobby
socket.on('lobby:vote-start', () => {
  currentGame = null;
  endGameRequested = false;
  showScreen('lobbyScreen');
  document.getElementById('displayRoomCode').textContent = roomCode;
});

// ── Game State Handler ──────────────────────────────────────────────────

socket.on('game:state', ({ game, state }) => {
  if (game === 'horseracing') renderHorseRacing(state);
});

socket.on('game:timer', ({ timer }) => {
  const el = document.querySelector('.timer-text');
  if (el) el.textContent = timer > 0 ? `${timer}s remaining` : "Time's up!";
  const fill = document.querySelector('.timer-fill');
  if (fill) {
    const maxTime = 15;
    fill.style.width = `${(timer / maxTime) * 100}%`;
  }
});

socket.on('game:error', ({ message }) => showToast(message));

// ── HORSE RACING RENDERER ───────────────────────────────────────────────

let hrSelectedHorse = null;
let hrBetAmount = 25;
let hrBetType = 'win'; // 'win', 'place', 'trifecta'
let hrExpandedHorse = null;
let hrTrifecta = [null, null, null];
let hrTrifectaSlot = 0;

function renderHorseRacing(state) {
  const el = document.getElementById('horseracingContent');
  const horses = state.horses || [];
  const myBet = state.bets?.[myId];

  // Auto-select the player's own horse if they haven't picked yet
  if (state.phase === 'betting' && !hrSelectedHorse && !myBet) {
    const myHorse = horses.find(h => h.playerId === myId);
    if (myHorse) hrSelectedHorse = myHorse.id;
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
          const isMyHorse = h.playerId === myId;

          return `
          <div class="sb-runner ${isSel ? 'sb-selected' : ''} ${isInTri ? 'sb-tri-selected' : ''} ${isMyHorse ? 'sb-my-horse' : ''}">
            <div class="sb-r-main" onclick="hrExpandedHorse = hrExpandedHorse===${h.id} ? null : ${h.id}; renderHorseRacing(window._hrState)">
              <span class="sb-r-num" style="background:${h.color}">${origIdx+1}</span>
              <div class="sb-r-info">
                <div class="sb-r-name-row">
                  <span class="sb-r-name">${isMyHorse ? '⭐ ' : ''}${h.name}</span>
                  ${isFav ? '<span class="sb-fav-tag">FAV</span>' : ''}
                  ${isMyHorse ? '<span class="sb-my-horse-tag">YOUR HORSE</span>' : ''}
                  ${isInTri ? '<span class="sb-tri-tag">' + triLabels[triSlotIdx] + '</span>' : ''}
                </div>
                <div class="sb-r-sub">(${h.barrier || origIdx+1}) ${h.weight || 57}kg ${h.jockey || ''}</div>
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
