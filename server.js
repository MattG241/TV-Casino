const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

// Prevent crashes from unhandled errors
process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

app.get('/tv', (req, res) => res.sendFile(__dirname + '/public/tv.html'));

// ── TTS Proxy — for browsers without speechSynthesis (Amazon Fire TV etc) ───
app.get('/api/tts', (req, res) => {
  const text = (req.query.text || '').substring(0, 200);
  if (!text) return res.status(400).send('No text');
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=en-AU&client=tw-ob&ttsspeed=1`;
  const headers = { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://translate.google.com/' };
  const request = https.get(url, { headers, timeout: 5000 }, (upstream) => {
    if (upstream.statusCode !== 200) {
      upstream.resume(); // drain
      if (!res.headersSent) res.status(502).send('TTS upstream error');
      return;
    }
    res.set({ 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=3600' });
    upstream.pipe(res);
    upstream.on('error', () => { if (!res.headersSent) res.status(502).end(); });
  });
  request.on('error', () => { if (!res.headersSent) res.status(502).send('TTS fetch failed'); });
  request.on('timeout', () => { request.destroy(); if (!res.headersSent) res.status(504).send('TTS timeout'); });
});

// ── Game State ──────────────────────────────────────────────────────────────

const rooms = new Map();

function createRoom(hostName) {
  const code = Math.random().toString(36).substring(2, 6).toUpperCase();
  const room = {
    code,
    players: [],
    currentGame: null,
    gameState: null,
    tvSocket: null,
    hostId: null,
  };
  rooms.set(code, room);
  return room;
}

function getRoom(code) {
  return rooms.get(code?.toUpperCase());
}

function broadcastToRoom(room, event, data) {
  room.players.forEach(p => {
    try { if (p.socket && p.socket.connected) p.socket.emit(event, data); } catch (e) {}
  });
  try { if (room.tvSocket && room.tvSocket.connected) room.tvSocket.emit(event, data); } catch (e) {}
}

function playerList(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    chips: p.chips,
    isHost: p.id === room.hostId,
    avatar: p.avatar,
    isAI: p.isAI || false,
    selfie: p.selfie || null,
    horseName: p.horseName || null,
  }));
}

// ── Deck Helpers ────────────────────────────────────────────────────────────

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function createDeck() {
  const deck = [];
  for (const suit of SUITS)
    for (const rank of RANKS)
      deck.push({ suit, rank });
  return shuffle(deck);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function cardValue(card) {
  if (['J','Q','K'].includes(card.rank)) return 10;
  if (card.rank === 'A') return 11;
  return parseInt(card.rank);
}

function handValue(hand) {
  let total = hand.reduce((s, c) => s + cardValue(c), 0);
  let aces = hand.filter(c => c.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

// ── Poker Helpers ───────────────────────────────────────────────────────────

function evaluatePokerHand(cards) {
  if (cards.length < 5) return { rank: 0, name: 'Incomplete', kickers: [] };
  const allCombos = getCombinations(cards, 5);
  let best = { rank: -1, name: 'High Card', kickers: [] };
  for (const combo of allCombos) {
    const result = evaluateFiveCards(combo);
    if (result.rank > best.rank) {
      best = result;
    } else if (result.rank === best.rank) {
      // Compare kickers for same rank
      const rk = result.kickers || [];
      const bk = best.kickers || [];
      for (let i = 0; i < Math.max(rk.length, bk.length); i++) {
        if ((rk[i] || 0) > (bk[i] || 0)) { best = result; break; }
        if ((rk[i] || 0) < (bk[i] || 0)) break;
      }
    }
  }
  return best;
}

function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = getCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

function evaluateFiveCards(cards) {
  const rankOrder = '23456789TJQKA';
  const values = cards.map(c => c.rank === '10' ? 'T' : c.rank)
    .map(r => rankOrder.indexOf(r)).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);
  const isWheel = values[0] === 12 && values[1] === 3 && values[2] === 2 && values[3] === 1 && values[4] === 0;
  const isStraight = values.every((v, i) => i === 0 || values[i-1] - v === 1) || isWheel;
  const straightHigh = isWheel ? 3 : values[0]; // A-2-3-4-5 straight high is 5 (index 3)

  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const groups = Object.entries(counts)
    .map(([v, c]) => [parseInt(v), c])
    .sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  // Kickers: sorted by group count desc, then value desc
  const kickers = groups.map(g => g[0]);

  if (isFlush && isStraight && values[0] === 12 && values[1] === 11) return { rank: 9, name: 'Royal Flush', kickers: [12] };
  if (isFlush && isStraight) return { rank: 8, name: 'Straight Flush', kickers: [straightHigh] };
  if (groups[0][1] === 4) return { rank: 7, name: 'Four of a Kind', kickers };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { rank: 6, name: 'Full House', kickers };
  if (isFlush) return { rank: 5, name: 'Flush', kickers: values };
  if (isStraight) return { rank: 4, name: 'Straight', kickers: [straightHigh] };
  if (groups[0][1] === 3) return { rank: 3, name: 'Three of a Kind', kickers };
  if (groups[0][1] === 2 && groups[1][1] === 2) return { rank: 2, name: 'Two Pair', kickers };
  if (groups[0][1] === 2) return { rank: 1, name: 'One Pair', kickers };
  return { rank: 0, name: 'High Card', kickers: values };
}

// ── Horse Name Generator ────────────────────────────────────────────────────

const HORSE_ADJECTIVES = [
  'Angry', 'Lazy', 'Sneaky', 'Dramatic', 'Confused', 'Fancy', 'Grumpy',
  'Cheeky', 'Wobbly', 'Sassy', 'Cranky', 'Dizzy', 'Funky', 'Salty',
  'Spicy', 'Moody', 'Clumsy', 'Nerdy', 'Savage', 'Sleepy', 'Rowdy',
  'Shady', 'Frisky', 'Jolly', 'Breezy', 'Gassy', 'Hangry', 'Bougie',
  'Reckless', 'Bizarre', 'Chaotic', 'Dapper', 'Sketchy', 'Petty',
  'Majestic', 'Unhinged', 'Legendary', 'Absolute', 'Sir', 'Lord',
  'Captain', 'Professor', 'Doctor', 'General', 'Duke', 'Baron',
];

const HORSE_NOUNS = [
  'Biscuit', 'Noodle', 'Tornado', 'Waffle', 'Pickle', 'Nugget',
  'Pancake', 'Thunder', 'Muffin', 'Burrito', 'Pretzel', 'Taco',
  'Pudding', 'Crumpet', 'Sausage', 'Chaos', 'Danger', 'Mayhem',
  'Trouble', 'Disaster', 'Fury', 'Wombat', 'Penguin', 'Llama',
  'Badger', 'Chicken', 'Lobster', 'Pigeon', 'Squirrel', 'Walrus',
  'Beans', 'Legs', 'Sparkles', 'Glitter', 'Baguette', 'Cabbage',
  'Banana', 'Potato', 'Gravy', 'Mustard', 'Ketchup', 'Biscotti',
  'Velocity', 'Lightning', 'Rocket', 'Turbo', 'Nitro', 'Express',
];

function generateHorseName(usedNames) {
  let name;
  let attempts = 0;
  do {
    const adj = HORSE_ADJECTIVES[Math.floor(Math.random() * HORSE_ADJECTIVES.length)];
    const noun = HORSE_NOUNS[Math.floor(Math.random() * HORSE_NOUNS.length)];
    name = `${adj} ${noun}`;
    attempts++;
  } while (usedNames.has(name) && attempts < 50);
  usedNames.add(name);
  return name;
}

// ── Dynamic Odds System ─────────────────────────────────────────────────────

function generateBaseOdds(count) {
  // Generate realistic base odds for N horses
  const odds = [];
  // 1-2 favourites (2-4), 2-3 mid-range (5-8), rest longshots (9-25)
  const favourites = 1 + Math.floor(Math.random() * 2);
  const midRange = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < count; i++) {
    if (i < favourites) odds.push(2 + Math.random() * 2);
    else if (i < favourites + midRange) odds.push(4.5 + Math.random() * 4);
    else odds.push(9 + Math.random() * 16);
  }
  // Round to 1 decimal
  const rounded = odds.map(o => Math.round(o * 10) / 10);
  // Shuffle
  for (let i = rounded.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rounded[i], rounded[j]] = [rounded[j], rounded[i]];
  }
  return rounded;
}

function recalculateOdds(horses, bets) {
  // Dynamic odds based on betting pool
  // More money on a horse = lower odds (shorter price)
  const betTotals = {};
  let totalPool = 0;
  for (const horse of horses) betTotals[horse.id] = 0;

  for (const bet of Object.values(bets)) {
    betTotals[bet.horseId] = (betTotals[bet.horseId] || 0) + bet.amount;
    totalPool += bet.amount;
  }

  if (totalPool === 0) return; // no bets, keep base odds

  for (const horse of horses) {
    const betOnThis = betTotals[horse.id] || 0;
    const betFraction = betOnThis / totalPool;

    if (betFraction > 0) {
      // Shorten odds when more money comes in
      // Blend between base odds and implied odds from pool
      const impliedOdds = Math.max(1.5, (1 / betFraction) * 0.9);
      horse.odds = Math.round(((horse.baseOdds * 0.4) + (impliedOdds * 0.6)) * 10) / 10;
    } else {
      // Drift odds slightly up when no money on this horse
      horse.odds = Math.round((horse.baseOdds * 1.15) * 10) / 10;
    }
    // Clamp
    horse.odds = Math.max(1.5, Math.min(50, horse.odds));
  }
}

// ── Game Engines ────────────────────────────────────────────────────────────

const games = {
  // ── ROULETTE ──
  roulette: {
    start(room) {
      if (room.currentGame !== 'roulette') return;
      room.gameState = {
        phase: 'betting',
        bets: {},
        result: null,
        timer: 20,
        history: room.gameState?.history || [],
      };
      broadcastToRoom(room, 'game:state', { game: 'roulette', state: room.gameState });
      startBettingTimer(room, 20);
    },
    placeBet(room, playerId, bet) {
      if (!room.gameState || room.gameState.phase !== 'betting') return;
      const player = room.players.find(p => p.id === playerId);
      if (!player) return;
      const amount = parseInt(bet.amount);
      if (!amount || amount <= 0 || amount > player.chips) return;
      bet.amount = amount;
      if (!room.gameState.bets[playerId]) room.gameState.bets[playerId] = [];
      if (room.gameState.bets[playerId].length >= 10) return;
      room.gameState.bets[playerId].push(bet);
      player.chips -= amount;
      // Throttle broadcasts
      clearTimeout(room._betBroadcastTimeout);
      room._betBroadcastTimeout = setTimeout(() => {
        if (room.currentGame !== 'roulette' || !room.gameState || room.gameState.phase !== 'betting') return;
        broadcastToRoom(room, 'game:state', { game: 'roulette', state: room.gameState });
        broadcastToRoom(room, 'players:update', playerList(room));
      }, 200);
    },
    spin(room) {
      if (!room.gameState || room.gameState.phase !== 'betting') return;
      // Cancel any pending bet broadcast
      clearTimeout(room._betBroadcastTimeout);
      room.gameState.phase = 'spinning';
      room.gameState.timer = null;
      const number = Math.floor(Math.random() * 37);
      const RED = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
      const color = number === 0 ? 'green' : RED.includes(number) ? 'red' : 'black';
      console.log(`[ROULETTE] Spinning... result will be ${number} ${color}`);
      broadcastToRoom(room, 'game:state', { game: 'roulette', state: room.gameState });

      const spinState = room.gameState;

      setTimeout(() => {
        if (room.gameState !== spinState || room.currentGame !== 'roulette') return;
        room.gameState.phase = 'result';
        room.gameState.result = { number, color };

        for (const [pid, bets] of Object.entries(room.gameState.bets)) {
          const player = room.players.find(p => p.id === pid);
          if (!player) continue;
          for (const bet of bets) {
            let win = 0;
            if (bet.type === 'number' && bet.value === number) win = bet.amount * 36;
            else if (bet.type === 'color' && bet.value === color && color !== 'green') win = bet.amount * 2;
            else if (bet.type === 'even' && number !== 0 && number % 2 === 0) win = bet.amount * 2;
            else if (bet.type === 'odd' && number % 2 === 1) win = bet.amount * 2;
            else if (bet.type === '1-18' && number >= 1 && number <= 18) win = bet.amount * 2;
            else if (bet.type === '19-36' && number >= 19 && number <= 36) win = bet.amount * 2;
            else if (bet.type === '1st12' && number >= 1 && number <= 12) win = bet.amount * 3;
            else if (bet.type === '2nd12' && number >= 13 && number <= 24) win = bet.amount * 3;
            else if (bet.type === '3rd12' && number >= 25 && number <= 36) win = bet.amount * 3;
            player.chips += win;
            bet.won = win > 0;
            bet.winAmount = win;
          }
        }
        room.gameState.history.unshift({ number, color });
        if (room.gameState.history.length > 20) room.gameState.history.pop();
        broadcastToRoom(room, 'game:state', { game: 'roulette', state: room.gameState });
        broadcastToRoom(room, 'players:update', playerList(room));

        setTimeout(() => {
          if (rooms.has(room.code) && room.gameState === spinState && room.currentGame === 'roulette') {
            games.roulette.start(room);
          }
        }, 5000);
      }, 4000);
    },
  },

  // ── SLOTS (Multiplayer Spin-Together) ──
  slots: {
    SYMBOLS: ['cherry', 'lemon', 'orange', 'plum', 'bell', 'bar', 'seven', 'diamond', 'wild'],
    WEIGHTS:  [22, 18, 16, 13, 10, 7, 3, 2, 9],
    PAYOUTS: { cherry: 5, lemon: 8, orange: 10, plum: 15, bell: 25, bar: 50, seven: 100, diamond: 250 },
    // 5 paylines: middle row, top row, bottom row, diagonal \, diagonal /
    PAYLINES: [
      [[0,1],[1,1],[2,1]], // middle
      [[0,0],[1,0],[2,0]], // top
      [[0,2],[1,2],[2,2]], // bottom
      [[0,0],[1,1],[2,2]], // diagonal \
      [[0,2],[1,1],[2,0]], // diagonal /
    ],

    weightedRandom() {
      const totalWeight = this.WEIGHTS.reduce((a, b) => a + b, 0);
      let r = Math.random() * totalWeight;
      for (let i = 0; i < this.SYMBOLS.length; i++) {
        r -= this.WEIGHTS[i];
        if (r <= 0) return this.SYMBOLS[i];
      }
      return this.SYMBOLS[0];
    },

    start(room) {
      room.gameState = {
        phase: 'betting',       // betting → spinning → results → betting...
        bets: {},               // { playerId: amount }
        results: {},            // { playerId: { reels, paylines, totalWin, betAmount } }
        roundNumber: (room.gameState?.roundNumber || 0) + 1,
        jackpot: room.gameState?.jackpot || 500,
        timer: 15,
        history: room.gameState?.history || [],     // last 10 round summaries
        leaderboard: room.gameState?.leaderboard || {}, // { playerId: netWinnings }
        bonusRound: false,
        freeSpins: {},          // { playerId: count }
      };
      broadcastToRoom(room, 'game:state', { game: 'slots', state: room.gameState });
      // Start betting timer
      this._startBettingTimer(room);
    },

    _startBettingTimer(room) {
      if (room._slotsTimer) clearInterval(room._slotsTimer);
      room._slotsTimer = setInterval(() => {
        if (!room.gameState || room.currentGame !== 'slots') {
          clearInterval(room._slotsTimer);
          return;
        }
        room.gameState.timer--;
        broadcastToRoom(room, 'game:timer', { timer: room.gameState.timer });
        if (room.gameState.timer <= 0) {
          clearInterval(room._slotsTimer);
          this.spinAll(room);
        }
      }, 1000);
    },

    placeBet(room, playerId, amount) {
      if (!room.gameState || room.gameState.phase !== 'betting') return;
      const player = room.players.find(p => p.id === playerId);
      if (!player) return;
      amount = parseInt(amount);
      if (!amount || amount <= 0 || amount > player.chips) return;

      // Refund previous bet if changing
      if (room.gameState.bets[playerId]) {
        player.chips += room.gameState.bets[playerId];
      }
      player.chips -= amount;
      room.gameState.bets[playerId] = amount;
      broadcastToRoom(room, 'game:state', { game: 'slots', state: room.gameState });
      broadcastToRoom(room, 'players:update', playerList(room));

      // If all players have bet, start spinning immediately
      const playersWithChips = room.players.filter(p => p.chips > 0 || room.gameState.bets[p.id]);
      if (Object.keys(room.gameState.bets).length >= playersWithChips.length && playersWithChips.length > 0) {
        clearInterval(room._slotsTimer);
        // Small delay so last player sees their bet registered
        setTimeout(() => this.spinAll(room), 1000);
      }
    },

    generateReels() {
      return [
        [this.weightedRandom(), this.weightedRandom(), this.weightedRandom()],
        [this.weightedRandom(), this.weightedRandom(), this.weightedRandom()],
        [this.weightedRandom(), this.weightedRandom(), this.weightedRandom()],
      ];
    },

    evaluateReels(reels, betAmount) {
      const results = { paylines: [], totalWin: 0, totalMultiplier: 0, jackpotWin: false };

      for (let lineIdx = 0; lineIdx < this.PAYLINES.length; lineIdx++) {
        const line = this.PAYLINES[lineIdx];
        const symbols = line.map(([r, s]) => reels[r][s]);

        // Wild substitution: wild matches any symbol
        const nonWild = symbols.filter(s => s !== 'wild');
        let effectiveSymbols = symbols;
        if (nonWild.length > 0 && nonWild.length < 3) {
          const mainSym = nonWild[0];
          effectiveSymbols = symbols.map(s => s === 'wild' ? mainSym : s);
        } else if (nonWild.length === 0) {
          effectiveSymbols = ['diamond', 'diamond', 'diamond']; // 3 wilds = best payout
        }

        let multiplier = 0;
        if (effectiveSymbols[0] === effectiveSymbols[1] && effectiveSymbols[1] === effectiveSymbols[2]) {
          const sym = effectiveSymbols[0];
          multiplier = this.PAYOUTS[sym] || 5;
          // Wild multiplier bonus: each wild symbol doubles the payout
          const wildCount = symbols.filter(s => s === 'wild').length;
          if (wildCount > 0 && wildCount < 3) multiplier *= (1 + wildCount);
        } else if (effectiveSymbols[0] === effectiveSymbols[1] || effectiveSymbols[1] === effectiveSymbols[2]) {
          multiplier = 2;
        }

        if (multiplier > 0) {
          const lineWin = betAmount * multiplier;
          results.paylines.push({ lineIdx, symbols, multiplier, win: lineWin });
          results.totalWin += lineWin;
          results.totalMultiplier += multiplier;
        }
      }

      // Jackpot: 3 diamonds on middle line
      const midLine = this.PAYLINES[0].map(([r, s]) => reels[r][s]);
      if (midLine.every(s => s === 'diamond')) {
        results.jackpotWin = true;
      }

      return results;
    },

    spinAll(room) {
      if (!room.gameState || room.gameState.phase !== 'betting') return;
      room.gameState.phase = 'spinning';
      room.gameState.timer = null;
      broadcastToRoom(room, 'game:state', { game: 'slots', state: room.gameState });

      // After spin animation delay, reveal results
      setTimeout(() => {
        if (!room.gameState || room.currentGame !== 'slots') return;
        room.gameState.phase = 'results';
        const results = {};
        let jackpotWinner = null;

        // Contribute to jackpot from all bets
        const totalBets = Object.values(room.gameState.bets).reduce((a, b) => a + b, 0);
        room.gameState.jackpot += Math.floor(totalBets * 0.05); // 5% of bets go to jackpot

        for (const [pid, betAmount] of Object.entries(room.gameState.bets)) {
          const player = room.players.find(p => p.id === pid);
          if (!player) continue;

          const reels = this.generateReels();
          const evalResult = this.evaluateReels(reels, betAmount);

          // Award winnings
          player.chips += evalResult.totalWin;

          // Jackpot check
          if (evalResult.jackpotWin) {
            player.chips += room.gameState.jackpot;
            evalResult.jackpotAmount = room.gameState.jackpot;
            jackpotWinner = pid;
          }

          // Track leaderboard (net winnings)
          if (!room.gameState.leaderboard[pid]) room.gameState.leaderboard[pid] = 0;
          room.gameState.leaderboard[pid] += evalResult.totalWin - betAmount;

          // Free spins: ~5% chance to win 3 free spins
          if (Math.random() < 0.05) {
            room.gameState.freeSpins[pid] = (room.gameState.freeSpins[pid] || 0) + 3;
            evalResult.freeSpinsWon = 3;
          }

          results[pid] = {
            reels,
            paylines: evalResult.paylines,
            totalWin: evalResult.totalWin,
            totalMultiplier: evalResult.totalMultiplier,
            betAmount,
            jackpotWin: evalResult.jackpotWin,
            jackpotAmount: evalResult.jackpotAmount || 0,
            freeSpinsWon: evalResult.freeSpinsWon || 0,
          };
        }

        // Reset jackpot if won
        if (jackpotWinner) room.gameState.jackpot = 500;

        // Round history
        const roundSummary = {
          round: room.gameState.roundNumber,
          players: Object.entries(results).map(([pid, r]) => ({
            id: pid,
            name: room.players.find(p => p.id === pid)?.name || '?',
            bet: r.betAmount,
            win: r.totalWin,
            net: r.totalWin - r.betAmount,
          })),
          jackpotWinner,
        };
        room.gameState.history.unshift(roundSummary);
        if (room.gameState.history.length > 10) room.gameState.history.pop();

        // Bonus round: ~8% chance after round 3+
        if (room.gameState.roundNumber >= 3 && Math.random() < 0.08) {
          room.gameState.bonusRound = true;
        }

        room.gameState.results = results;
        broadcastToRoom(room, 'game:state', { game: 'slots', state: room.gameState });
        broadcastToRoom(room, 'players:update', playerList(room));

        // Auto-advance to next round
        setTimeout(() => {
          if (rooms.has(room.code) && room.currentGame === 'slots') {
            this.start(room);
          }
        }, 6000);
      }, 3000); // 3 second spin animation
    },

    // Free spin for a player (uses existing bet amount)
    freeSpin(room, playerId) {
      if (!room.gameState) return;
      const freeCount = room.gameState.freeSpins?.[playerId] || 0;
      if (freeCount <= 0) return;

      room.gameState.freeSpins[playerId] = freeCount - 1;
      const lastBet = room.gameState.results?.[playerId]?.betAmount || 10;
      const reels = this.generateReels();
      const evalResult = this.evaluateReels(reels, lastBet);

      const player = room.players.find(p => p.id === playerId);
      if (player) player.chips += evalResult.totalWin;

      // Send as a personal result update
      room.gameState.results[playerId] = {
        reels,
        paylines: evalResult.paylines,
        totalWin: evalResult.totalWin,
        totalMultiplier: evalResult.totalMultiplier,
        betAmount: 0, // free spin
        jackpotWin: false,
        jackpotAmount: 0,
        freeSpinsWon: 0,
        isFreeSpin: true,
      };
      broadcastToRoom(room, 'game:state', { game: 'slots', state: room.gameState });
      broadcastToRoom(room, 'players:update', playerList(room));
    },
  },

  // ── BLACKJACK ──
  blackjack: {
    start(room) {
      if (room.currentGame !== 'blackjack') return;
      room.gameState = {
        phase: 'betting',
        deck: createDeck(),
        hands: {},
        dealerHand: [],
        bets: {},
        results: {},
        turnOrder: [],
        currentTurn: -1,
      };
      broadcastToRoom(room, 'game:state', { game: 'blackjack', state: sanitizeBJ(room.gameState) });
    },
    placeBet(room, playerId, amount) {
      if (!room.gameState || room.gameState.phase !== 'betting') return;
      const player = room.players.find(p => p.id === playerId);
      amount = parseInt(amount);
      if (!player || !amount || amount <= 0 || amount > player.chips) return;
      if (room.gameState.bets[playerId]) return; // already bet
      player.chips -= amount;
      room.gameState.bets[playerId] = amount;
      broadcastToRoom(room, 'game:state', { game: 'blackjack', state: sanitizeBJ(room.gameState) });
      broadcastToRoom(room, 'players:update', playerList(room));

      // Auto-deal if all players with chips have bet
      const playersWithChips = room.players.filter(p => p.chips > 0 || room.gameState.bets[p.id]);
      if (Object.keys(room.gameState.bets).length >= playersWithChips.length) {
        this.deal(room);
      }
    },
    deal(room) {
      const gs = room.gameState;
      gs.phase = 'playing';
      gs.turnOrder = Object.keys(gs.bets);

      for (const pid of gs.turnOrder) {
        gs.hands[pid] = [gs.deck.pop(), gs.deck.pop()];
      }
      gs.dealerHand = [gs.deck.pop(), gs.deck.pop()];
      gs.currentTurn = 0;

      // Check for natural blackjacks
      for (const pid of gs.turnOrder) {
        if (handValue(gs.hands[pid]) === 21) {
          gs.results[pid] = 'blackjack';
        }
      }
      this.advanceTurn(room);
    },
    advanceTurn(room) {
      const gs = room.gameState;
      while (gs.currentTurn < gs.turnOrder.length) {
        const pid = gs.turnOrder[gs.currentTurn];
        if (!gs.results[pid]) break;
        gs.currentTurn++;
      }
      if (gs.currentTurn >= gs.turnOrder.length) {
        this.dealerPlay(room);
        return;
      }
      broadcastToRoom(room, 'game:state', { game: 'blackjack', state: sanitizeBJ(gs) });
    },
    hit(room, playerId) {
      const gs = room.gameState;
      if (!gs || gs.phase !== 'playing' || gs.turnOrder[gs.currentTurn] !== playerId) return;
      if (gs.deck.length === 0) gs.deck = createDeck();
      gs.hands[playerId].push(gs.deck.pop());
      if (handValue(gs.hands[playerId]) > 21) {
        gs.results[playerId] = 'bust';
        gs.currentTurn++;
        this.advanceTurn(room);
      } else if (handValue(gs.hands[playerId]) === 21) {
        // Stand automatically on 21
        gs.currentTurn++;
        this.advanceTurn(room);
      } else {
        broadcastToRoom(room, 'game:state', { game: 'blackjack', state: sanitizeBJ(gs) });
      }
    },
    stand(room, playerId) {
      const gs = room.gameState;
      if (!gs || gs.phase !== 'playing' || gs.turnOrder[gs.currentTurn] !== playerId) return;
      gs.currentTurn++;
      this.advanceTurn(room);
    },
    doubleDown(room, playerId) {
      const gs = room.gameState;
      if (!gs || gs.phase !== 'playing' || gs.turnOrder[gs.currentTurn] !== playerId) return;
      const player = room.players.find(p => p.id === playerId);
      if (!player || player.chips < gs.bets[playerId]) return;
      player.chips -= gs.bets[playerId];
      gs.bets[playerId] *= 2;
      if (gs.deck.length === 0) gs.deck = createDeck();
      gs.hands[playerId].push(gs.deck.pop());
      if (handValue(gs.hands[playerId]) > 21) {
        gs.results[playerId] = 'bust';
      }
      gs.currentTurn++;
      this.advanceTurn(room);
      broadcastToRoom(room, 'players:update', playerList(room));
    },
    dealerPlay(room) {
      const gs = room.gameState;
      gs.phase = 'dealer';
      broadcastToRoom(room, 'game:state', { game: 'blackjack', state: sanitizeBJ(gs, true) });

      const dealerDraw = () => {
        if (handValue(gs.dealerHand) < 17) {
          if (gs.deck.length === 0) gs.deck = createDeck();
          gs.dealerHand.push(gs.deck.pop());
          broadcastToRoom(room, 'game:state', { game: 'blackjack', state: sanitizeBJ(gs, true) });
          setTimeout(dealerDraw, 1000);
        } else {
          games.blackjack.resolve(room);
        }
      };
      setTimeout(dealerDraw, 1000);
    },
    resolve(room) {
      const gs = room.gameState;
      gs.phase = 'result';
      const dealerVal = handValue(gs.dealerHand);
      const dealerBust = dealerVal > 21;

      for (const pid of gs.turnOrder) {
        const player = room.players.find(p => p.id === pid);
        if (!player) continue;
        const pVal = handValue(gs.hands[pid]);

        if (gs.results[pid] === 'bust') {
          // Already lost
        } else if (gs.results[pid] === 'blackjack') {
          player.chips += Math.floor(gs.bets[pid] * 2.5);
          gs.results[pid] = 'blackjack_win';
        } else if (dealerBust || pVal > dealerVal) {
          player.chips += gs.bets[pid] * 2;
          gs.results[pid] = 'win';
        } else if (pVal === dealerVal) {
          player.chips += gs.bets[pid];
          gs.results[pid] = 'push';
        } else {
          gs.results[pid] = 'lose';
        }
      }
      broadcastToRoom(room, 'game:state', { game: 'blackjack', state: sanitizeBJ(gs, true) });
      broadcastToRoom(room, 'players:update', playerList(room));

      setTimeout(() => {
        if (rooms.has(room.code) && room.currentGame === 'blackjack') games.blackjack.start(room);
      }, 5000);
    },
  },

  // ── POKER (Texas Hold'em) ──
  poker: {
    // ── AI PLAYER NAMES & PERSONALITIES ──
    AI_NAMES: ['Ace McGraw', 'Lucky Lou', 'Poker Pete', 'Card Shark', 'Bluff King', 'The Dealer', 'Wild Card', 'High Roller'],
    AI_AVATARS: [6, 7, 8, 9, 10, 11, 12, 13],

    // Add AI player to room if only 1 human player
    ensureAIPlayer(room) {
      const humanPlayers = room.players.filter(p => !p.isAI && p.chips > 0);
      const aiPlayers = room.players.filter(p => p.isAI);
      if (humanPlayers.length === 1 && aiPlayers.length === 0) {
        const nameIdx = Math.floor(Math.random() * this.AI_NAMES.length);
        const aiPlayer = {
          id: 'ai-' + uuidv4().slice(0, 8),
          name: this.AI_NAMES[nameIdx],
          chips: 1000,
          avatar: this.AI_AVATARS[nameIdx % this.AI_AVATARS.length],
          isAI: true,
          socket: null,
          // AI personality: aggression 0-1, bluffFreq 0-1, tightness 0-1
          aiPersonality: {
            aggression: 0.3 + Math.random() * 0.5,
            bluffFreq: 0.1 + Math.random() * 0.2,
            tightness: 0.3 + Math.random() * 0.4,
          },
        };
        room.players.push(aiPlayer);
        broadcastToRoom(room, 'players:update', playerList(room));
        console.log(`[POKER] AI player "${aiPlayer.name}" joined room ${room.code}`);
      }
    },

    // Remove AI players when multiple humans are present
    removeAIPlayers(room) {
      const humanPlayers = room.players.filter(p => !p.isAI);
      if (humanPlayers.length >= 2) {
        room.players = room.players.filter(p => !p.isAI);
        broadcastToRoom(room, 'players:update', playerList(room));
      }
    },

    // Evaluate AI hand strength (0-1 scale)
    evaluateAIHandStrength(holeCards, communityCards) {
      if (communityCards.length === 0) {
        // Preflop: evaluate hole cards only
        return this.preflopStrength(holeCards);
      }
      // Postflop: evaluate best hand from available cards
      const allCards = [...holeCards, ...communityCards];
      const result = evaluatePokerHand(allCards);
      // Normalize rank 0-9 to 0-1, with bonus for higher sub-ranks
      return Math.min(1, (result.rank / 9) * 0.8 + 0.2);
    },

    preflopStrength(cards) {
      const rankOrder = '23456789TJQKA';
      const r1 = rankOrder.indexOf(cards[0].rank === '10' ? 'T' : cards[0].rank);
      const r2 = rankOrder.indexOf(cards[1].rank === '10' ? 'T' : cards[1].rank);
      const high = Math.max(r1, r2);
      const low = Math.min(r1, r2);
      const isPair = r1 === r2;
      const isSuited = cards[0].suit === cards[1].suit;
      const gap = high - low;

      let strength = 0;
      if (isPair) {
        strength = 0.5 + (high / 12) * 0.5; // Pairs: 0.5-1.0
      } else {
        strength = (high + low) / 24; // Base from card ranks
        if (isSuited) strength += 0.06;
        if (gap <= 2) strength += 0.04; // Connected cards
        if (high >= 10) strength += 0.08; // Broadway cards
      }
      return Math.min(1, Math.max(0, strength));
    },

    // AI decision-making
    getAIAction(room, aiPlayer) {
      const gs = room.gameState;
      const hand = gs.hands[aiPlayer.id];
      const personality = aiPlayer.aiPersonality;
      const handStrength = this.evaluateAIHandStrength(hand, gs.community);
      const currentPlayerBet = gs.roundBets[aiPlayer.id] || 0;
      const toCall = gs.currentBet - currentPlayerBet;
      const potOdds = toCall > 0 ? toCall / (gs.pot + toCall) : 0;

      // Add some randomness to make AI less predictable
      const noise = (Math.random() - 0.5) * 0.15;
      const effectiveStrength = Math.min(1, Math.max(0, handStrength + noise));

      // Decision logic
      if (toCall === 0) {
        // No bet to call - check or raise
        if (effectiveStrength > 0.7 + (1 - personality.aggression) * 0.2) {
          // Strong hand - raise
          const raiseSize = Math.floor(gs.pot * (0.5 + personality.aggression * 0.5));
          const raiseTotal = gs.currentBet + Math.max(gs.bigBlind, raiseSize);
          return { action: 'raise', amount: Math.min(raiseTotal, aiPlayer.chips + currentPlayerBet) };
        }
        if (effectiveStrength > 0.4 && Math.random() < personality.bluffFreq) {
          // Medium hand with bluff attempt
          const raiseTotal = gs.currentBet + gs.bigBlind * 2;
          return { action: 'raise', amount: Math.min(raiseTotal, aiPlayer.chips + currentPlayerBet) };
        }
        return { action: 'check' };
      }

      // There's a bet to call
      if (effectiveStrength > 0.8) {
        // Very strong hand - raise
        if (Math.random() < personality.aggression) {
          if (effectiveStrength > 0.9 && aiPlayer.chips <= gs.pot * 1.5) {
            return { action: 'allin' };
          }
          const raiseTotal = gs.currentBet + Math.floor(gs.pot * (0.5 + personality.aggression));
          return { action: 'raise', amount: Math.min(raiseTotal, aiPlayer.chips + currentPlayerBet) };
        }
        return { action: 'call' };
      }

      if (effectiveStrength > 0.5) {
        // Decent hand - call if pot odds are right
        if (potOdds < effectiveStrength * 0.8) {
          return { action: 'call' };
        }
        // Occasionally bluff-raise
        if (Math.random() < personality.bluffFreq * 0.5) {
          const raiseTotal = gs.currentBet + gs.bigBlind * 2;
          return { action: 'raise', amount: Math.min(raiseTotal, aiPlayer.chips + currentPlayerBet) };
        }
        return { action: 'call' };
      }

      if (effectiveStrength > 0.3) {
        // Marginal hand - call small bets, fold big ones
        if (toCall <= gs.bigBlind * 2) return { action: 'call' };
        if (Math.random() < personality.bluffFreq) return { action: 'call' };
        return { action: 'fold' };
      }

      // Weak hand - mostly fold, occasional bluff
      if (Math.random() < personality.bluffFreq * 0.3) {
        const raiseTotal = gs.currentBet + gs.bigBlind * 3;
        return { action: 'raise', amount: Math.min(raiseTotal, aiPlayer.chips + currentPlayerBet) };
      }
      if (toCall <= gs.bigBlind && Math.random() < 0.3) return { action: 'call' };
      return { action: 'fold' };
    },

    // Schedule AI action with a natural delay
    scheduleAIAction(room) {
      const gs = room.gameState;
      if (!gs || gs.phase === 'result' || gs.phase === 'showdown') return;
      const currentPlayerId = gs.turnOrder[gs.currentTurn];
      const aiPlayer = room.players.find(p => p.id === currentPlayerId && p.isAI);
      if (!aiPlayer) return;

      // Clear any existing AI timer
      if (room._aiActionTimer) clearTimeout(room._aiActionTimer);

      // Delay 1-3 seconds to feel natural
      const delay = 1000 + Math.random() * 2000;
      room._aiActionTimer = setTimeout(() => {
        // Verify still AI's turn
        if (!room.gameState || room.gameState.phase === 'result' || room.gameState.phase === 'showdown') return;
        if (room.gameState.turnOrder[room.gameState.currentTurn] !== aiPlayer.id) return;

        const decision = this.getAIAction(room, aiPlayer);
        console.log(`[POKER AI] ${aiPlayer.name}: ${decision.action}${decision.amount ? ' $' + decision.amount : ''}`);
        this.action(room, aiPlayer.id, decision.action, decision.amount);
      }, delay);
    },

    start(room) {
      if (room.currentGame !== 'poker') return;

      // Add AI if only 1 human player, remove if 2+
      this.ensureAIPlayer(room);
      this.removeAIPlayers(room);

      const activePlayers = room.players.filter(p => p.chips > 0).map(p => p.id);
      if (activePlayers.length < 2) {
        broadcastToRoom(room, 'game:error', { message: 'Need at least 2 players for poker' });
        return;
      }
      const deck = createDeck();
      const hands = {};
      activePlayers.forEach(pid => {
        hands[pid] = [deck.pop(), deck.pop()];
      });

      const prevDealerIdx = room.gameState?.dealerIdx;
      room.gameState = {
        phase: 'preflop',
        deck,
        hands,
        community: [],
        pot: 0,
        bets: {},
        currentBet: 20,
        activePlayers: [...activePlayers],
        foldedPlayers: [],
        turnOrder: [...activePlayers],
        currentTurn: 0,
        roundBets: {},
        smallBlind: 10,
        bigBlind: 20,
        dealerIdx: prevDealerIdx != null ? (prevDealerIdx + 1) % activePlayers.length : 0,
        lastRaiser: null,
        hasActed: {},
      };

      // Post blinds
      const gs = room.gameState;

      // Heads-up rule: dealer posts SB and acts first preflop, BB acts second
      const isHeadsUp = gs.turnOrder.length === 2;
      const sbIdx = isHeadsUp ? gs.dealerIdx : (gs.dealerIdx + 1) % gs.turnOrder.length;
      const bbIdx = isHeadsUp ? (gs.dealerIdx + 1) % gs.turnOrder.length : (gs.dealerIdx + 2) % gs.turnOrder.length;

      const sbPlayer = room.players.find(p => p.id === gs.turnOrder[sbIdx]);
      const bbPlayer = room.players.find(p => p.id === gs.turnOrder[bbIdx]);

      if (sbPlayer) {
        const sbAmount = Math.min(gs.smallBlind, sbPlayer.chips);
        sbPlayer.chips -= sbAmount;
        gs.pot += sbAmount;
        gs.roundBets[gs.turnOrder[sbIdx]] = sbAmount;
      }
      if (bbPlayer) {
        const bbAmount = Math.min(gs.bigBlind, bbPlayer.chips);
        bbPlayer.chips -= bbAmount;
        gs.pot += bbAmount;
        gs.roundBets[gs.turnOrder[bbIdx]] = bbAmount;
        gs.currentBet = bbAmount;
      }

      // Preflop: action starts left of BB (or SB in heads-up since dealer=SB acts first)
      if (isHeadsUp) {
        gs.currentTurn = sbIdx; // Dealer/SB acts first preflop in heads-up
      } else {
        gs.currentTurn = (bbIdx + 1) % gs.turnOrder.length;
      }

      broadcastPlayerHands(room);
      broadcastToRoom(room, 'players:update', playerList(room));

      // Trigger AI if it's AI's turn
      this.scheduleAIAction(room);
    },

    action(room, playerId, action, amount) {
      const gs = room.gameState;
      if (!gs || gs.phase === 'result' || gs.phase === 'showdown') return;
      if (gs.turnOrder[gs.currentTurn] !== playerId) return;
      const player = room.players.find(p => p.id === playerId);
      if (!player) return;

      const currentPlayerBet = gs.roundBets[playerId] || 0;

      if (action === 'fold') {
        gs.foldedPlayers.push(playerId);
        gs.activePlayers = gs.activePlayers.filter(id => id !== playerId);
        if (gs.activePlayers.length === 1) {
          this.endHand(room, gs.activePlayers[0]);
          return;
        }
      } else if (action === 'call') {
        const callAmount = Math.min(gs.currentBet - currentPlayerBet, player.chips);
        player.chips -= callAmount;
        gs.pot += callAmount;
        gs.roundBets[playerId] = (gs.roundBets[playerId] || 0) + callAmount;
      } else if (action === 'raise') {
        const raiseTotal = Math.min(amount, player.chips + currentPlayerBet);
        const raiseAmount = raiseTotal - currentPlayerBet;
        player.chips -= raiseAmount;
        gs.pot += raiseAmount;
        gs.roundBets[playerId] = raiseTotal;
        gs.currentBet = raiseTotal;
        gs.lastRaiser = playerId;
      } else if (action === 'check') {
        if (currentPlayerBet < gs.currentBet) return;
      } else if (action === 'allin') {
        const allInAmount = player.chips;
        player.chips = 0;
        gs.pot += allInAmount;
        gs.roundBets[playerId] = (gs.roundBets[playerId] || 0) + allInAmount;
        if (gs.roundBets[playerId] > gs.currentBet) {
          gs.currentBet = gs.roundBets[playerId];
          gs.lastRaiser = playerId;
        }
      }

      // Mark player as having acted this round
      gs.hasActed[playerId] = true;

      // Advance turn
      gs.currentTurn = (gs.currentTurn + 1) % gs.turnOrder.length;
      // Skip folded/all-in players
      let loops = 0;
      while (loops < gs.turnOrder.length) {
        const tid = gs.turnOrder[gs.currentTurn];
        if (gs.foldedPlayers.includes(tid) || (room.players.find(p => p.id === tid)?.chips === 0)) {
          gs.currentTurn = (gs.currentTurn + 1) % gs.turnOrder.length;
          loops++;
        } else break;
      }

      // Check if betting round is complete
      const activeBettors = gs.activePlayers.filter(pid => {
        const p = room.players.find(p2 => p2.id === pid);
        return p && p.chips > 0;
      });
      const allMatched = activeBettors.every(pid => (gs.roundBets[pid] || 0) >= gs.currentBet);
      const allActed = activeBettors.every(pid => gs.hasActed[pid]);

      if ((allMatched && allActed) || activeBettors.length === 0) {
        this.nextPhase(room);
      } else {
        broadcastPlayerHands(room);
        broadcastToRoom(room, 'players:update', playerList(room));
        // Trigger AI if it's AI's turn
        this.scheduleAIAction(room);
      }
    },

    nextPhase(room) {
      const gs = room.gameState;
      gs.roundBets = {};
      gs.currentBet = 0;
      gs.lastRaiser = null;
      gs.hasActed = {};

      // Check if all active players are all-in (no more betting possible)
      const activeBettors = gs.activePlayers.filter(pid => {
        const p = room.players.find(p2 => p2.id === pid);
        return p && p.chips > 0;
      });
      const skipToShowdown = activeBettors.length <= 1;

      // Deal remaining community cards if skipping
      if (skipToShowdown) {
        // Run out the board
        while (gs.community.length < 5 && gs.deck.length > 1) {
          gs.deck.pop(); // burn
          gs.community.push(gs.deck.pop());
        }
        this.showdown(room);
        return;
      }

      // Start from first active player after dealer
      gs.currentTurn = 0;
      for (let i = 0; i < gs.turnOrder.length; i++) {
        const pid = gs.turnOrder[i];
        const p = room.players.find(p2 => p2.id === pid);
        if (!gs.foldedPlayers.includes(pid) && p && p.chips > 0) {
          gs.currentTurn = i;
          break;
        }
      }

      if (gs.phase === 'preflop') {
        gs.phase = 'flop';
        gs.deck.pop(); // burn
        gs.community.push(gs.deck.pop(), gs.deck.pop(), gs.deck.pop());
      } else if (gs.phase === 'flop') {
        gs.phase = 'turn';
        gs.deck.pop();
        gs.community.push(gs.deck.pop());
      } else if (gs.phase === 'turn') {
        gs.phase = 'river';
        gs.deck.pop();
        gs.community.push(gs.deck.pop());
      } else if (gs.phase === 'river') {
        this.showdown(room);
        return;
      }
      broadcastPlayerHands(room);
      broadcastToRoom(room, 'players:update', playerList(room));
      // Trigger AI if it's AI's turn
      this.scheduleAIAction(room);
    },

    showdown(room) {
      const gs = room.gameState;
      gs.phase = 'showdown';
      let bestResult = null;
      let winner = null;
      gs.handResults = {};

      for (const pid of gs.activePlayers) {
        const allCards = [...gs.hands[pid], ...gs.community];
        const result = evaluatePokerHand(allCards);
        gs.handResults[pid] = result;
        if (!bestResult || this.compareHands(result, bestResult) > 0) {
          bestResult = result;
          winner = pid;
        }
      }
      this.endHand(room, winner);
    },

    // Compare two poker hand results. Returns >0 if a wins, <0 if b wins, 0 if tie
    compareHands(a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      // Same rank - compare kickers
      const aKickers = a.kickers || [];
      const bKickers = b.kickers || [];
      for (let i = 0; i < Math.max(aKickers.length, bKickers.length); i++) {
        const ak = aKickers[i] || 0;
        const bk = bKickers[i] || 0;
        if (ak !== bk) return ak - bk;
      }
      return 0; // True tie
    },

    endHand(room, winnerId) {
      const gs = room.gameState;
      gs.phase = 'result';
      gs.winner = winnerId;
      const winner = room.players.find(p => p.id === winnerId);
      if (winner) winner.chips += gs.pot;

      // Clear AI timer
      if (room._aiActionTimer) clearTimeout(room._aiActionTimer);

      // Reveal all hands for TV
      broadcastToRoom(room, 'game:state', {
        game: 'poker',
        state: {
          ...gs,
          allHands: gs.hands,
          handResults: gs.handResults || {},
        },
      });
      broadcastToRoom(room, 'players:update', playerList(room));

      setTimeout(() => {
        if (rooms.has(room.code) && room.currentGame === 'poker') games.poker.start(room);
      }, 5000);
    },
  },

  // ── HORSE RACING ──
  horseracing: {
    // Running style definitions: how each style behaves at different race stages
    _STYLES: {
      frontRunner:  { early: 1.25, mid: 1.05, late: 0.82, desc: 'Front Runner' },
      stalker:      { early: 1.05, mid: 1.15, late: 1.00, desc: 'Stalker' },
      midPack:      { early: 0.95, mid: 1.10, late: 1.10, desc: 'Mid-Pack' },
      closer:       { early: 0.80, mid: 0.95, late: 1.35, desc: 'Closer' },
      onePace:      { early: 1.00, mid: 1.00, late: 1.00, desc: 'One Pacer' },
    },

    // ── HORSE PERSONALITY TRAITS ──────────────────────────────────────────
    _TEMPERAMENTS: [
      { name: 'Calm',       gateBonus: 1.0,  crowdPenalty: 0,    consistency: 0.9,  bravery: 0.7  },
      { name: 'Nervous',    gateBonus: 0.85, crowdPenalty: 0.03, consistency: 0.6,  bravery: 0.4  },
      { name: 'Aggressive', gateBonus: 1.1,  crowdPenalty: 0,    consistency: 0.7,  bravery: 1.0  },
      { name: 'Lazy',       gateBonus: 0.9,  crowdPenalty: 0,    consistency: 0.75, bravery: 0.3  },
      { name: 'Keen',       gateBonus: 1.15, crowdPenalty: 0,    consistency: 0.8,  bravery: 0.8  },
      { name: 'Relaxed',    gateBonus: 0.95, crowdPenalty: 0,    consistency: 0.85, bravery: 0.6  },
    ],

    // ── JOCKEY AI SKILL LEVELS ────────────────────────────────────────────
    _JOCKEY_NAMES: [
      'J. Williams', 'M. Walker', 'D. Lane', 'J. McDonald', 'C. Brown',
      'H. Bowman', 'K. McEvoy', 'B. Avdulla', 'T. Berry', 'R. Moore',
      'L. Dettori', 'J. Moreira', 'Z. Purton', 'W. Pike', 'D. Oliver',
      'C. Newitt', 'M. Zahra', 'B. Melham', 'J. Allen', 'L. King',
    ],

    start(room) {
      if (room.currentGame !== 'horseracing') return;
      const ALL_COLORS = ['#c0392b','#2980b9','#d4a843','#1a1a2e','#27ae60','#8e44ad','#e67e22','#16a085','#e84393','#636e72','#fdcb6e','#00b894','#6c5ce7','#d63031','#0984e3','#a29bfe'];
      const humanPlayers = room.players.filter(p => !p.isAI);
      const numAI = Math.max(4, 4 + Math.floor(Math.random() * 9)); // 4-12 AI horses
      const numHorses = Math.min(16, humanPlayers.length + numAI);
      const colors = ALL_COLORS.slice(0, numHorses);
      const usedNames = new Set(humanPlayers.filter(p => p.horseName).map(p => p.horseName));
      const baseOdds = generateBaseOdds(numHorses);
      const DISTANCES = [1000, 1100, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 3200];
      const distance = DISTANCES[Math.floor(Math.random() * DISTANCES.length)];

      // Track race number
      if (!room._raceNumber) room._raceNumber = 0;
      room._raceNumber++;

      // Assign running styles weighted by odds (favourites more likely frontrunner/stalker)
      const styleKeys = Object.keys(this._STYLES);
      const usedJockeys = new Set();
      // Reserve jockey name slots for human players
      humanPlayers.forEach(p => usedJockeys.add(p.name));
      const horses = colors.map((color, i) => {
        // First N entries are assigned to human players
        const playerOwner = i < humanPlayers.length ? humanPlayers[i] : null;

        let style;
        if (baseOdds[i] < 5) {
          style = styleKeys[Math.floor(Math.random() * 2)];
        } else if (baseOdds[i] < 10) {
          style = styleKeys[Math.floor(Math.random() * styleKeys.length)];
        } else {
          style = ['closer', 'midPack', 'onePace'][Math.floor(Math.random() * 3)];
        }

        // Assign temperament — favourites tend to be calmer
        const temps = this._TEMPERAMENTS;
        let temp;
        if (baseOdds[i] < 5) {
          temp = temps[Math.random() < 0.6 ? 0 : Math.floor(Math.random() * 2)]; // Calm or Calm/Nervous
        } else {
          temp = temps[Math.floor(Math.random() * temps.length)];
        }

        // Assign jockey — player horses use the player as jockey
        let jockey;
        if (playerOwner) {
          jockey = playerOwner.name;
        } else {
          const jockeyPool = this._JOCKEY_NAMES.filter(j => !usedJockeys.has(j));
          if (baseOdds[i] < 5 && jockeyPool.length > 3) {
            jockey = jockeyPool[Math.floor(Math.random() * 3)]; // top 3 available
          } else {
            jockey = jockeyPool[Math.floor(Math.random() * jockeyPool.length)] || 'A. Rider';
          }
          usedJockeys.add(jockey);
        }

        // Jockey skill (0.7-1.0) — better jockeys get higher skill
        const jockeyIdx = this._JOCKEY_NAMES.indexOf(jockey);
        const jockeySkill = jockeyIdx >= 0 ? 0.85 + (1 - jockeyIdx / this._JOCKEY_NAMES.length) * 0.15 : 0.8;

        // Generate weight (54-62kg based on odds — favourites carry more weight)
        const baseWeight = 54 + Math.round((10 - Math.min(baseOdds[i], 10)) * 0.8);
        const weight = baseWeight + Math.floor(Math.random() * 3) - 1;

        // Generate career stats based on odds tier
        const careerStarts = 8 + Math.floor(Math.random() * 30);
        let winRate;
        if (baseOdds[i] < 5) winRate = 0.22 + Math.random() * 0.18;
        else if (baseOdds[i] < 10) winRate = 0.12 + Math.random() * 0.12;
        else winRate = 0.03 + Math.random() * 0.08;
        const careerWins = Math.max(0, Math.round(careerStarts * winRate));
        const careerSeconds = Math.max(0, Math.round(careerStarts * (winRate * 0.7 + Math.random() * 0.05)));
        const careerThirds = Math.max(0, Math.round(careerStarts * (winRate * 0.5 + Math.random() * 0.04)));

        // Place odds (~35% of win odds, min 1.10)
        const placeOdds = Math.round(Math.max(1.1, baseOdds[i] * 0.35) * 100) / 100;

        // Horse name: use player's horseName if they set one, else generate
        const horseName = playerOwner?.horseName
          ? playerOwner.horseName
          : generateHorseName(usedNames); // generateHorseName adds to usedNames automatically

        return {
          id: i + 1,
          name: horseName,
          color,
          baseOdds: baseOdds[i],
          odds: baseOdds[i],
          placeOdds,
          position: 0,
          gateLoaded: false,
          scratched: false,
          style,
          styleDesc: this._STYLES[style].desc,
          weight,
          career: { starts: careerStarts, wins: careerWins, seconds: careerSeconds, thirds: careerThirds },
          stamina: 0.75 + Math.random() * 0.5,
          energy: 1.0,
          momentum: 0,
          topSpeed: 0.85 + Math.random() * 0.3,
          // ── AI attributes ──
          temperament: temp.name,
          gateBonus: temp.gateBonus,
          consistency: temp.consistency,
          bravery: temp.bravery,
          jockey,
          jockeySkill,
          // ── Player association (if human player owns this horse) ──
          playerId: playerOwner?.id || null,
          jockeySelfie: playerOwner?.selfie || null,
          // ── AI state (updated each tick) ──
          ai: {
            effort: 0.5,          // 0=cruising, 1=full effort. Jockey controls this
            targetPos: null,      // where jockey wants to be in the field
            patience: 0.5 + Math.random() * 0.5, // how long jockey waits before pushing
            moveStarted: false,   // has the jockey made their move?
            blocked: false,       // stuck behind other horses
            lane: 0,              // -1=inside, 0=middle, 1=outside (for traffic)
            nervous: 0,           // nervousness level (0-1) builds with crowd/traffic
            heartRate: 0.5,       // simulated heart rate (affects energy burn)
          },
        };
      });

      // ── FORM GUIDE — carry race history between races ──
      if (!room._horseFormHistory) room._horseFormHistory = {};
      for (const horse of horses) {
        const existing = room._horseFormHistory[horse.name];
        if (existing) {
          horse.form = existing.slice(-5);
        } else {
          const formLen = 2 + Math.floor(Math.random() * 3);
          horse.form = [];
          for (let f = 0; f < formLen; f++) {
            if (horse.baseOdds < 5) horse.form.push([1,1,2,2,3,4][Math.floor(Math.random() * 6)]);
            else if (horse.baseOdds < 10) horse.form.push([2,3,4,5,6,7][Math.floor(Math.random() * 6)]);
            else horse.form.push([3,5,6,7,8,9,10][Math.floor(Math.random() * 7)]);
          }
        }
        const recentWins = horse.form.filter(f => f <= 2).length;
        horse.formBonus = recentWins * 0.015;
      }

      // ── BARRIER DRAW ──
      const barriers = Array.from({length: numHorses}, (_, i) => i + 1);
      for (let i = barriers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [barriers[i], barriers[j]] = [barriers[j], barriers[i]];
      }
      horses.forEach((h, i) => { h.barrier = barriers[i]; });

      // Real-ish race duration scaling
      const raceDuration = Math.round(distance * 0.015);
      const totalTicks = raceDuration * 10;
      const baseSpeed = 100 / totalTicks;

      // Track conditions affect the race
      const CONDITIONS = [
        { name: 'FIRM 1', factor: 1.05, favours: 'frontRunner' },
        { name: 'GOOD 3', factor: 1.0, favours: null },
        { name: 'GOOD 4', factor: 0.98, favours: null },
        { name: 'SOFT 5', factor: 0.94, favours: 'closer' },
        { name: 'SOFT 6', factor: 0.90, favours: 'closer' },
        { name: 'HEAVY 8', factor: 0.85, favours: 'closer' },
      ];
      const trackCondition = CONDITIONS[Math.floor(Math.random() * CONDITIONS.length)];

      // ── TRACK BIAS ──
      const BIASES = [
        { name: 'Inside', factor: 0.03 },
        { name: 'Neutral', factor: 0 },
        { name: 'Neutral', factor: 0 },
        { name: 'Outside', factor: -0.02 },
      ];
      const trackBias = BIASES[Math.floor(Math.random() * BIASES.length)];

      const midBarrier = (numHorses + 1) / 2;
      for (const horse of horses) {
        const barrierPosition = (midBarrier - horse.barrier) / midBarrier;
        horse.barrierEdge = barrierPosition * trackBias.factor;
      }

      room.gameState = {
        phase: 'betting',
        horses,
        bets: {},
        timer: 25,
        winner: null,
        raceNumber: room._raceNumber,
        distance,
        raceDuration,
        baseSpeed,
        trackCondition: trackCondition.name,
        trackFactor: trackCondition.factor,
        trackFavours: trackCondition.favours,
        trackBias: trackBias.name,
        commentary: `Race ${room._raceNumber} — ${distance}m — ${trackCondition.name} — ${horses.filter(h=>!h.scratched).length} runners`,
        speak: `Race ${room._raceNumber}. ${distance} meters. Track rated ${trackCondition.name.replace(/(\d)/, ' $1')}. ${numHorses} runners.${trackBias.name !== 'Neutral' ? ` Track bias favouring ${trackBias.name.toLowerCase()} runners.` : ''} Place your bets now.`,
      };

      // Random late scratching (15% chance per race, max 1-2 horses, never scratch all)
      if (numHorses > 5 && Math.random() < 0.15) {
        const scratchCount = Math.random() < 0.7 ? 1 : 2;
        const scratchable = horses.filter(h => h.baseOdds > 5);
        for (let s = 0; s < scratchCount && scratchable.length > 0; s++) {
          const idx = Math.floor(Math.random() * scratchable.length);
          const scratched = scratchable.splice(idx, 1)[0];
          scratched.scratched = true;
          const delay = 3000 + Math.random() * 8000;
          setTimeout(() => {
            if (!room.gameState || room.gameState.phase !== 'betting') return;
            room.gameState.commentary = `LATE SCRATCHING: ${scratched.name} (${scratched.id}) has been withdrawn!`;
            room.gameState.speak = `Late scratching. Number ${scratched.id}, ${scratched.name}, has been scratched from the race.`;
            for (const [pid, bet] of Object.entries(room.gameState.bets)) {
              if (bet.horseId === scratched.id) {
                const player = room.players.find(p => p.id === pid);
                if (player) {
                  player.chips += bet.amount;
                  delete room.gameState.bets[pid];
                  broadcastToRoom(room, 'players:update', playerList(room));
                }
              }
            }
            broadcastToRoom(room, 'game:state', { game: 'horseracing', state: room.gameState });
          }, delay);
        }
      }
      broadcastToRoom(room, 'game:state', { game: 'horseracing', state: room.gameState });
      startBettingTimer(room, 25);

      // Fluctuate odds every 2s — gentler drift
      room._oddsInterval = setInterval(() => {
        if (!room.gameState || room.gameState.phase !== 'betting') {
          clearInterval(room._oddsInterval);
          room._oddsInterval = null;
          return;
        }
        for (const horse of room.gameState.horses) {
          if (horse.scratched) continue;
          // Gentler random drift (±0.3 instead of ±0.6)
          const drift = (Math.random() - 0.5) * 0.3;
          horse.odds = Math.round(Math.max(1.5, Math.min(50, horse.odds + drift)) * 10) / 10;
          horse.placeOdds = Math.round(Math.max(1.1, horse.odds * 0.35) * 100) / 100;
        }
        recalculateOdds(room.gameState.horses, room.gameState.bets);
        broadcastToRoom(room, 'game:state', { game: 'horseracing', state: room.gameState });
      }, 2000);
    },

    placeBet(room, playerId, horseId, amount, betType, trifectaSelections) {
      if (!room.gameState || room.gameState.phase !== 'betting') return;
      const player = room.players.find(p => p.id === playerId);
      amount = parseInt(amount);
      if (!player || !amount || amount <= 0 || amount > player.chips) return;
      if (room.gameState.bets[playerId]) return;

      betType = betType || 'win';
      const horse = room.gameState.horses.find(h => h.id === horseId);

      if (betType === 'trifecta') {
        if (!trifectaSelections || trifectaSelections.length !== 3) return;
        if (new Set(trifectaSelections).size !== 3) return;
        if (!trifectaSelections.every(id => room.gameState.horses.find(h => h.id === id && !h.scratched))) return;
        const triH = trifectaSelections.map(id => room.gameState.horses.find(h => h.id === id));
        const trifectaOdds = Math.round(triH[0].odds * triH[1].odds * triH[2].odds * 0.08 * 100) / 100;
        player.chips -= amount;
        room.gameState.bets[playerId] = { horseId: trifectaSelections[0], amount, betType: 'trifecta', trifecta: trifectaSelections, lockedAtOdds: trifectaOdds };
      } else if (betType === 'place') {
        const lockedAtOdds = horse ? horse.placeOdds : 1;
        player.chips -= amount;
        room.gameState.bets[playerId] = { horseId, amount, betType: 'place', lockedAtOdds };
      } else {
        const lockedAtOdds = horse ? horse.odds : 1;
        player.chips -= amount;
        room.gameState.bets[playerId] = { horseId, amount, betType: 'win', lockedAtOdds };
      }

      recalculateOdds(room.gameState.horses, room.gameState.bets);
      broadcastToRoom(room, 'game:state', { game: 'horseracing', state: room.gameState });
      broadcastToRoom(room, 'players:update', playerList(room));
    },

    race(room) {
      const gs = room.gameState;
      if (!gs) return;

      // Stop odds fluctuation
      if (room._oddsInterval) { clearInterval(room._oddsInterval); room._oddsInterval = null; }
      if (room._raceInterval) clearInterval(room._raceInterval);

      // Lock in final odds
      for (const horse of gs.horses) horse.lockedOdds = horse.odds;

      // ── PHASE: Loading into barriers ──
      gs.phase = 'loading';
      gs.commentary = 'The horses are being loaded into the starting barriers...';
      gs.speak = 'The horses are now being loaded into the starting barriers.';
      broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });

      // Load horses one by one
      let loadIdx = 0;
      const loadInterval = setInterval(() => {
        if (room.currentGame !== 'horseracing' || room.gameState !== gs) {
          clearInterval(loadInterval);
          return;
        }
        if (loadIdx < gs.horses.length) {
          gs.horses[loadIdx].gateLoaded = true;
          gs.commentary = `Number ${loadIdx + 1}, ${gs.horses[loadIdx].name}, is loaded.`;
          gs.speak = `Number ${loadIdx + 1}, ${gs.horses[loadIdx].name}, loaded.`;
          broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });
          loadIdx++;
        } else {
          clearInterval(loadInterval);
          gs.commentary = 'All horses are loaded. Starter ready...';
          gs.speak = 'All horses are loaded. The starter is ready.';
          broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });

          setTimeout(() => {
            if (room.currentGame !== 'horseracing' || room.gameState !== gs) return;
            gs.phase = 'starting';
            gs.commentary = 'The gates are about to open!';
            gs.speak = null;
            broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });

            setTimeout(() => {
              if (room.currentGame !== 'horseracing' || room.gameState !== gs) return;
              gs.phase = 'racing';
              gs.commentary = "AND THEY'RE OFF!";
              gs.speak = "And they're off! The field breaks cleanly from the barriers!";
              broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });
              games.horseracing._startRace(room, gs);
            }, 2000);
          }, 1500);
        }
      }, 800);
    },

    // ── JOCKEY AI: Decides effort level, lane choice, when to make a move ──
    _jockeyDecision(horse, raceProgress, sorted, activeHorses, gs) {
      const ai = horse.ai;
      const style = this._STYLES[horse.style] || this._STYLES.onePace;
      const myRank = sorted.findIndex(h => h.id === horse.id);
      const totalRunners = activeHorses.length;
      const leader = sorted[0];
      const gapToLeader = leader ? leader.position - horse.position : 0;
      const isLongRace = gs.distance >= 2000;

      // ── NERVOUSNESS — builds from traffic and tight spaces ──
      const nearbyHorses = activeHorses.filter(h => h.id !== horse.id && Math.abs(h.position - horse.position) < 3);
      if (nearbyHorses.length >= 3) {
        ai.nervous = Math.min(1, ai.nervous + 0.01); // packed tight
      } else {
        ai.nervous = Math.max(0, ai.nervous - 0.005);
      }

      // Nervous horses lose composure in traffic
      if (horse.temperament === 'Nervous' && nearbyHorses.length >= 2) {
        ai.nervous = Math.min(1, ai.nervous + 0.015);
      }

      // ── TRAFFIC / BLOCKED — check if horse directly ahead with no way around ──
      const horsesJustAhead = activeHorses.filter(h =>
        h.id !== horse.id &&
        h.position > horse.position &&
        h.position - horse.position < 2 &&
        Math.abs((h.ai?.lane || 0) - ai.lane) < 1
      );
      ai.blocked = horsesJustAhead.length >= 2;

      // ── LANE CHOICE — jockey picks inside/outside based on traffic ──
      if (ai.blocked && raceProgress > 0.4) {
        // Try to go wide to get around traffic
        ai.lane = Math.min(1, ai.lane + 0.1);
      } else if (!ai.blocked && ai.lane > 0) {
        // Save ground — drift back inside when clear
        ai.lane = Math.max(-0.5, ai.lane - 0.05);
      }

      // ── JOCKEY EFFORT DECISION ──
      // Phase 1: Early race (0-30%) — settle into position
      if (raceProgress < 0.3) {
        if (horse.style === 'frontRunner') {
          // Front runners push for the lead early
          ai.effort = 0.8 + horse.jockeySkill * 0.15;
        } else if (horse.style === 'closer') {
          // Closers cruise, save energy — good jockeys are more patient
          ai.effort = 0.3 + (1 - ai.patience) * 0.15;
        } else if (horse.style === 'stalker') {
          // Stalkers sit 2nd-4th, not too hard, not too easy
          const wantedPos = Math.min(3, Math.ceil(totalRunners * 0.25));
          ai.effort = myRank < wantedPos ? 0.5 : 0.65;
        } else {
          ai.effort = 0.5;
        }

      // Phase 2: Mid race (30-65%) — positioning, patience
      } else if (raceProgress < 0.65) {
        if (horse.style === 'frontRunner') {
          // Maintain lead, but skilled jockeys rate the pace to save energy
          ai.effort = gapToLeader < 1 ? 0.75 : 0.6 + (1 - horse.jockeySkill) * 0.15;
        } else if (horse.style === 'closer') {
          // Still waiting — good jockeys are patient
          ai.effort = 0.4 + (1 - ai.patience) * 0.2;
        } else if (horse.style === 'stalker') {
          // Start winding up in second half
          ai.effort = 0.6 + raceProgress * 0.3;
        } else {
          ai.effort = 0.55 + raceProgress * 0.2;
        }

      // Phase 3: Business end (65-85%) — the move
      } else if (raceProgress < 0.85) {
        if (!ai.moveStarted) {
          // Decision point: when to make the move
          const shouldMove =
            horse.style === 'frontRunner' || // front runners already going
            horse.style === 'stalker' || // stalkers always move here
            (horse.style === 'closer' && raceProgress > (0.65 + ai.patience * 0.15)) ||
            (horse.style === 'midPack' && raceProgress > 0.70) ||
            (horse.style === 'onePace' && raceProgress > 0.70);

          if (shouldMove) {
            ai.moveStarted = true;
          }
        }

        if (ai.moveStarted) {
          // Full effort — ask the horse for everything
          const skillBonus = horse.jockeySkill * 0.1;
          ai.effort = 0.85 + skillBonus;

          // Brave horses respond better when asked to go
          if (horse.bravery > 0.7) {
            ai.effort += 0.05;
          }

          // Blocked horses can't exert full effort
          if (ai.blocked) {
            ai.effort *= 0.7; // stuck in traffic!
          }
        } else {
          // Still waiting — cruising
          ai.effort = 0.55;
        }

      // Phase 4: Final sprint (85-100%) — everything left in the tank
      } else {
        ai.moveStarted = true;
        const desperation = myRank > 0 ? Math.min(0.15, myRank * 0.03) : 0;
        ai.effort = 0.92 + horse.jockeySkill * 0.08 + desperation;

        // Lazy horses don't respond to the whip as well
        if (horse.temperament === 'Lazy') ai.effort *= 0.88;
        // Aggressive horses give extra in a fight
        if (horse.temperament === 'Aggressive' && gapToLeader < 3) ai.effort *= 1.08;
        // Nervous horses can crack under pressure
        if (ai.nervous > 0.6) ai.effort *= (1 - ai.nervous * 0.15);

        if (ai.blocked) ai.effort *= 0.75;
      }

      // Clamp effort
      ai.effort = Math.max(0.2, Math.min(1.0, ai.effort));

      // ── HEART RATE — tracks cumulative exertion, affects energy burn ──
      const targetHR = 0.3 + ai.effort * 0.7;
      ai.heartRate += (targetHR - ai.heartRate) * 0.1;
    },

    _startRace(room, gs) {
      let tickCount = 0;
      let lastLeaderId = null;
      let leadChangeCount = 0;
      let lastCommentTick = -30;
      const styles = this._STYLES;

      // Gate break — some horses jump better than others
      for (const horse of gs.horses) {
        if (horse.scratched) continue;
        const gateJump = horse.gateBonus * (0.85 + Math.random() * 0.3);
        horse.momentum = (gs.baseSpeed || 0.7) * gateJump * 0.5;
      }

      const interval = setInterval(() => {
        if (room.currentGame !== 'horseracing' || !room.gameState || room.gameState !== gs) {
          clearInterval(interval);
          room._raceInterval = null;
          return;
        }

        let leaderId = null;
        let leaderPos = -1;
        let secondPos = -1;
        let thirdPos = -1;
        let finished = false;

        const activeHorses = gs.horses.filter(h => !h.scratched);
        const avgPos = activeHorses.length > 0 ? activeHorses.reduce((s, h) => s + h.position, 0) / activeHorses.length : 0;
        const raceProgress = avgPos / 100;

        // Sort horses by position for AI awareness
        const sorted = [...activeHorses].sort((a, b) => b.position - a.position);

        for (const horse of gs.horses) {
          if (horse.scratched) continue;

          const spd = gs.baseSpeed || 0.7;
          const style = styles[horse.style] || styles.onePace;
          const ai = horse.ai;

          // ── JOCKEY AI DECISION ──
          games.horseracing._jockeyDecision(horse, raceProgress, sorted, activeHorses, gs);

          // ── RUNNING STYLE STAGE MULTIPLIER ──
          let stageMult;
          if (raceProgress < 0.3) stageMult = style.early;
          else if (raceProgress < 0.7) stageMult = style.mid;
          else stageMult = style.late;

          // ── TRACK CONDITION ──
          let trackBonus = 1.0;
          if (gs.trackFavours === horse.style) trackBonus = 1.06;

          // ── ENERGY / STAMINA ──
          // Energy burn rate is proportional to effort AND heart rate
          const burnRate = (0.0005 + ai.heartRate * 0.0012 + ai.effort * 0.0008) / horse.stamina;
          horse.energy = Math.max(0.3, horse.energy - burnRate);

          // ── CONSISTENCY — inconsistent horses have bigger random variance ──
          const consistencyFactor = horse.consistency;
          const randomVar = (Math.random() - 0.45) * spd * (1.2 - consistencyFactor * 0.6);

          // ── CORE SPEED CALCULATION ──
          // effort directly scales the style multiplier — cruising at 50% effort means
          // you only get half the benefit of your style
          const effortScale = 0.5 + ai.effort * 0.5; // effort 0→0.5x, effort 1→1.0x
          const styledSpeed = spd * stageMult * effortScale * horse.topSpeed * horse.energy * trackBonus * (gs.trackFactor || 1.0);

          // ── ODDS EDGE (ability) ──
          const oddsEdge = (10 - horse.baseOdds) * spd * 0.022;

          // ── JOCKEY SKILL BONUS — better jockeys extract more from the horse ──
          const jockeyBonus = spd * (horse.jockeySkill - 0.8) * 0.15;

          // ── FORM FITNESS BONUS ──
          const formBonus = (horse.formBonus || 0) * spd;

          // ── BARRIER/TRACK BIAS EDGE ──
          const barrierBonus = raceProgress < 0.3 ? (horse.barrierEdge || 0) * spd : (horse.barrierEdge || 0) * spd * 0.3;

          // ── TRAFFIC PENALTY — running wide costs ground ──
          const lanePenalty = Math.abs(ai.lane) * spd * 0.04;

          // ── NERVOUSNESS PENALTY ──
          const nervePenalty = ai.nervous * spd * 0.1;

          // ── MOMENTUM — smooth acceleration/deceleration ──
          const targetSpeed = styledSpeed + randomVar + oddsEdge + jockeyBonus + formBonus + barrierBonus - lanePenalty - nervePenalty;
          horse.momentum += (targetSpeed - horse.momentum) * 0.25;

          // ── SURGE — dramatic finishing kick when jockey asks ──
          let surge = 0;
          if (ai.moveStarted && ai.effort > 0.85 && horse.energy > 0.45) {
            // Closer's powerful finishing kick
            if (horse.style === 'closer' && raceProgress > 0.75 && Math.random() < 0.05) {
              surge = spd * 3.0 * horse.bravery;
            }
            // General acceleration when jockey pushes
            else if (Math.random() < 0.03) {
              surge = spd * 1.8 * horse.bravery;
            }
          }

          // ── FINAL POSITION UPDATE ──
          horse.position += Math.max(0, horse.momentum + surge);

          // Track positions for ranking
          if (horse.position > leaderPos) {
            thirdPos = secondPos;
            secondPos = leaderPos;
            leaderPos = horse.position;
            leaderId = horse.id;
          } else if (horse.position > secondPos) {
            thirdPos = secondPos;
            secondPos = horse.position;
          } else if (horse.position > thirdPos) {
            thirdPos = horse.position;
          }

          if (horse.position >= 100) {
            horse.position = 100;
            if (!finished) { gs.winner = horse.id; finished = true; }
          }
        }

        gs.leader = leaderId;
        const gap = leaderPos - secondPos;
        const rearGap = leaderPos - (activeHorses.length > 0 ? Math.min(...activeHorses.map(h => h.position)) : 0);

        // Compute live race positions for display
        gs.livePositions = sorted.map((h, i) => ({
          id: h.id,
          pos: i + 1,
          margin: i === 0 ? 0 : (sorted[0].position - h.position).toFixed(1),
          effort: h.ai?.effort ? Math.round(h.ai.effort * 100) : 50,
          blocked: h.ai?.blocked || false,
        }));

        // Lead change detection
        if (leaderId !== lastLeaderId && lastLeaderId !== null && tickCount > 10) {
          leadChangeCount++;
          const newLeader = gs.horses.find(h => h.id === leaderId);
          if (newLeader && (tickCount - lastCommentTick) > 15) {
            // AI-aware commentary for lead changes
            const wasBlocked = newLeader.ai?.blocked;
            const isCloser = newLeader.style === 'closer';
            const texts = [
              `${newLeader.name} takes the lead!`,
              isCloser ? `${newLeader.name} has unleashed a brilliant finishing run!` : `${newLeader.name} surges to the front!`,
              `${newLeader.jockey || 'The jockey'} has timed the run perfectly on ${newLeader.name}!`,
            ];
            gs.commentary = texts[Math.floor(Math.random() * texts.length)];
            gs.speak = gs.commentary;
            lastCommentTick = tickCount;
          }
        }
        lastLeaderId = leaderId;

        // Dynamic AI-aware commentary
        const commentInterval = 40;
        if ((tickCount - lastCommentTick) >= commentInterval && !gs.speak) {
          const leader = gs.horses.find(h => h.id === leaderId);
          if (leader) {
            const lines = games.horseracing._getCommentary(avgPos, leader, gap, rearGap, gs.horses, gs.distance, sorted);
            gs.commentary = lines.text;
            if (lines.speak) gs.speak = lines.speak;
            lastCommentTick = tickCount;
          }
        } else if (tickCount % 5 === 0) {
          gs.speak = null;
        }

        tickCount++;
        broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });

        if (finished) {
          clearInterval(interval);
          room._raceInterval = null;
          gs.phase = 'result';
          const winHorse = gs.horses.find(h => h.id === gs.winner);

          // Final positions
          const finalSorted = [...gs.horses].filter(h => !h.scratched).sort((a, b) => b.position - a.position);
          gs.places = finalSorted.map(h => h.id);
          gs.margins = finalSorted.map((h, i) => i === 0 ? 0 : +(finalSorted[0].position - h.position).toFixed(1));

          // Save form history for next race
          if (!room._horseFormHistory) room._horseFormHistory = {};
          finalSorted.forEach((h, pos) => {
            if (!room._horseFormHistory[h.name]) room._horseFormHistory[h.name] = [];
            room._horseFormHistory[h.name].push(pos + 1);
            if (room._horseFormHistory[h.name].length > 5) room._horseFormHistory[h.name].shift();
          });

          if (winHorse) {
            const second = finalSorted[1];
            const margin = gs.margins[1] || 0;
            const marginDesc = margin < 0.5 ? 'by a nose' : margin < 1.5 ? 'by a short head' : margin < 3 ? 'by a length' : margin < 6 ? 'by two lengths' : 'by a commanding margin';
            const jockeyCredit = winHorse.jockey ? ` ${winHorse.jockey} in the saddle.` : '';
            gs.commentary = `${winHorse.name} wins ${marginDesc}!`;
            gs.speak = `And it's ${winHorse.name} who takes the victory ${marginDesc} at odds of ${(winHorse.lockedOdds||winHorse.odds).toFixed(1)} to one!${jockeyCredit}${second ? ` ${second.name} in second.` : ''}`;
          }

          // Determine top 3 for place/trifecta payouts
          const top3Ids = finalSorted.slice(0, 3).map(h => h.id);

          for (const [pid, bet] of Object.entries(gs.bets)) {
            const player = room.players.find(p => p.id === pid);
            if (!player) continue;

            if (bet.betType === 'trifecta') {
              if (bet.trifecta && bet.trifecta[0] === top3Ids[0] && bet.trifecta[1] === top3Ids[1] && bet.trifecta[2] === top3Ids[2]) {
                const payoutOdds = bet.lockedAtOdds || 50;
                player.chips += Math.round(bet.amount * payoutOdds);
                bet.won = true;
                bet.winAmount = Math.round(bet.amount * payoutOdds);
              }
            } else if (bet.betType === 'place') {
              if (top3Ids.includes(bet.horseId)) {
                const payoutOdds = bet.lockedAtOdds || 1.5;
                player.chips += Math.round(bet.amount * payoutOdds);
                bet.won = true;
                bet.winAmount = Math.round(bet.amount * payoutOdds);
              }
            } else {
              // Win bet
              if (winHorse && bet.horseId === gs.winner) {
                const payoutOdds = bet.lockedAtOdds || winHorse.lockedOdds || winHorse.odds || 1;
                player.chips += Math.round(bet.amount * payoutOdds);
                bet.won = true;
                bet.winAmount = Math.round(bet.amount * payoutOdds);
              }
            }
          }
          broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });
          broadcastToRoom(room, 'players:update', playerList(room));

          setTimeout(() => {
            if (rooms.has(room.code) && room.currentGame === 'horseracing') games.horseracing.start(room);
          }, 8000);
        }
      }, 100);
      room._raceInterval = interval;
    },

    _getCommentary(avgPos, leader, gap, rearGap, horses, distance, sorted) {
      const activeHorses = horses.filter(h => !h.scratched);
      const second = sorted && sorted[1];
      const third = sorted && sorted[2];
      const tail = sorted && sorted[sorted.length - 1];
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

      // Find interesting AI-driven situations
      const blockedHorse = activeHorses.find(h => h.ai?.blocked);
      const movingCloser = activeHorses.find(h => h.style === 'closer' && h.ai?.moveStarted);
      const nervousHorse = activeHorses.find(h => h.ai?.nervous > 0.5);
      const wideRunner = activeHorses.find(h => h.ai?.lane > 0.5);
      const highEffort = activeHorses.find(h => h.ai?.effort > 0.9 && h.id !== leader?.id);

      if (avgPos < 15) {
        // Check for bad gate breaks
        const slowStarter = activeHorses.find(h => h.gateBonus < 0.9 && sorted.indexOf(h) > activeHorses.length * 0.7);
        return { text: pick([
          "The field is settling into their stride after a clean break.",
          "They're jostling for position in the early stages.",
          `${leader.name} has jumped well and leads them out.`,
          leader.jockey ? `${leader.jockey} has ${leader.name} in front early.` : "A good start, the field is well bunched early.",
          "The jockeys are letting them find their rhythm.",
          `${leader.name} shows early speed from the gates.`,
          slowStarter ? `${slowStarter.name} was slow out of the gates — giving away ground early.` : "All away cleanly from the barriers.",
          leader.temperament === 'Keen' ? `${leader.name} is very keen early — the jockey trying to restrain.` : "The pace looks honest from the start.",
        ]) };
      } else if (avgPos < 30) {
        if (gap > 6) return { text: `${leader.name} has sprinted clear — opening up a big lead early!`, speak: `${leader.name} has gone right to the front and opened up a significant lead.` };
        const closer = activeHorses.find(h => h.style === 'closer');
        return { text: pick([
          `${leader.name} leads them along at a solid tempo.`,
          "The pack is tightly bunched as they settle in.",
          second ? `${second.name} is tracking ${leader.name} in second.` : "Compact field early on.",
          closer ? `${closer.jockey || 'The jockey'} is nursing ${closer.name} at the back — saving for later.` : "All runners travelling well.",
          `The pace is honest as they approach the first turn.`,
          `${leader.name} controls the tempo from the front.`,
          nervousHorse ? `${nervousHorse.name} is racing a bit keenly — might burn out.` : "Everyone settled in nicely.",
          second?.jockey ? `${second.jockey} has ${second.name} tracking perfectly in the box seat.` : "Good positions throughout.",
        ]) };
      } else if (avgPos < 50) {
        return { text: pick([
          "They're into the back straight now!",
          "The jockeys are positioning for the run home.",
          `${leader.name} continues to lead as they pass the halfway mark.`,
          second ? `${second.name} is breathing down ${leader.name}'s neck!` : "The leader looks comfortable.",
          "The tempo is starting to quicken now.",
          blockedHorse ? `${blockedHorse.name} is stuck behind a wall of horses — needs to find clear running!` : "A few runners are starting to improve their positions.",
          rearGap > 15 ? `The field is starting to spread out now.` : "They remain tightly bunched through the middle stages.",
          wideRunner ? `${wideRunner.name} has been forced three-wide — losing ground.` : "All running their races.",
          tail ? `${tail.name} has dropped to the back — a lot of ground to make up.` : "Tight field.",
        ]), speak: `Halfway through, ${leader.name} leads the field.` };
      } else if (avgPos < 75) {
        if (gap < 2) return { text: pick([
          "It's incredibly tight at the front! Anyone's race!",
          `${leader.name} and ${second?.name || 'the second horse'} are locked together!`,
          "You couldn't split them at the top! This is sensational!",
        ]), speak: "It's neck and neck! This could go to any of them!" };
        return { text: pick([
          "They're turning for home — this is where it matters!",
          "The whips are coming out as they round the final bend!",
          `${leader.jockey || 'The jockey'} is asking ${leader.name} for everything now!`,
          second ? `${second.name} is winding up on the outside!` : "The field is starting to string out.",
          movingCloser ? `${movingCloser.name} is starting to wind up — the closer making their move!` : "The closers are starting to make their move!",
          `It's all about who has the most left in the tank now!`,
          third ? `${third.name} is finishing hard from the back of the field!` : "The pace is telling now.",
          blockedHorse ? `${blockedHorse.name} is trapped in traffic — ${blockedHorse.jockey || 'the jockey'} looking for a gap!` : "Clear running for the leaders.",
          highEffort ? `${highEffort.jockey || 'The jockey'} is asking ${highEffort.name} to go now!` : "The tempo is lifting dramatically!",
        ]), speak: "They're turning for home!" };
      } else {
        const closerMaking = activeHorses.find(h => h.style === 'closer' && h.position > avgPos + 5);
        const tiring = activeHorses.find(h => h.energy < 0.45 && sorted.indexOf(h) < 3);
        return { text: pick([
          "Into the final furlong! The crowd is on their feet!",
          "It's a sprint to the finish line!",
          "The whips are out! They're giving everything!",
          `${leader.jockey || 'The jockey'} is driving ${leader.name} with hands and heels!`,
          gap < 2 ? "Photo finish! They can't be separated!" : `${leader.name} is holding on grimly!`,
          closerMaking ? `${closerMaking.name} is storming home like a freight train!` : "The leader is staying strong!",
          `The crowd roars as they hit the final ${distance < 1400 ? '100' : '200'} metres!`,
          second ? `${second.jockey || second.name} is throwing everything at the leader!` : "The finish line is in sight!",
          `What a race this has been! Down to the wire!`,
          tiring ? `${tiring.name} is tiring badly — the early speed taking its toll!` : "They're giving everything right to the line!",
          blockedHorse ? `${blockedHorse.name} has finally found clear air but it might be too late!` : "Full effort from every runner!",
          movingCloser ? `Here comes ${movingCloser.name}! The late charger is swooping!` : "Desperate finish!",
        ]), speak: pick([
          "Down the final stretch! Here they come!",
          `${leader.name} is fighting to hold on!`,
          gap < 2 ? "This is going to be desperately close!" : `${leader.name} is powering to the line!`,
          closerMaking ? `${closerMaking.name} is flying home!` : "Flat out to the finish!",
        ]) };
      }
    },
  },
};

function sanitizeBJ(gs, showDealer = false) {
  return {
    ...gs,
    deck: undefined,
    dealerHand: showDealer || gs.phase === 'result'
      ? gs.dealerHand
      : [gs.dealerHand[0], { suit: 'hidden', rank: 'hidden' }],
  };
}

function broadcastPlayerHands(room) {
  const gs = room.gameState;
  if (!gs) return;
  const isReveal = gs.phase === 'result' || gs.phase === 'showdown';
  const base = {
    phase: gs.phase,
    community: gs.community,
    pot: gs.pot,
    currentBet: gs.currentBet,
    currentTurn: gs.currentTurn,
    turnOrder: gs.turnOrder,
    activePlayers: gs.activePlayers,
    foldedPlayers: gs.foldedPlayers,
    roundBets: gs.roundBets,
    winner: gs.winner,
    allHands: isReveal ? gs.hands : undefined,
    handResults: isReveal ? gs.handResults : undefined,
    dealerIdx: gs.dealerIdx,
    bigBlind: gs.bigBlind,
  };
  // Send each player only their own hand
  room.players.forEach(p => {
    try {
      if (p.socket && p.socket.connected) {
        p.socket.emit('game:state', { game: 'poker', state: { ...base, myHand: gs.hands[p.id] || null } });
      }
    } catch (e) {}
  });
  // TV gets all hands during showdown, otherwise just community
  try {
    if (room.tvSocket && room.tvSocket.connected) {
      room.tvSocket.emit('game:state', {
        game: 'poker',
        state: { ...base, handBacks: Object.fromEntries(gs.turnOrder.map(pid => [pid, gs.hands[pid]?.length || 0])) },
      });
    }
  } catch (e) {}
}

function countVotes(room) {
  const counts = { horseracing: 0 };
  if (room.votes) {
    for (const g of Object.values(room.votes)) {
      if (counts[g] !== undefined) counts[g]++;
    }
  }
  return counts;
}

function finishVoting(room) {
  if (!room.votes || Object.keys(room.votes).length === 0) return;

  // Count votes
  const counts = { roulette: 0, slots: 0, blackjack: 0, poker: 0, horseracing: 0 };
  for (const g of Object.values(room.votes)) {
    if (counts[g] !== undefined) counts[g]++;
  }

  // Find winner (most votes, random tiebreak)
  let maxVotes = 0;
  let winners = [];
  for (const [game, count] of Object.entries(counts)) {
    if (count > maxVotes) { maxVotes = count; winners = [game]; }
    else if (count === maxVotes && count > 0) winners.push(game);
  }

  const winningGame = winners[Math.floor(Math.random() * winners.length)];
  console.log(`[VOTE] Winner: ${winningGame} with ${maxVotes} votes`);

  broadcastToRoom(room, 'vote:winner', { game: winningGame });

  // Start the game after a short delay
  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    room.currentGame = winningGame;
    room.votes = {};
    broadcastToRoom(room, 'game:started', { game: winningGame });
    if (games[winningGame]) games[winningGame].start(room);
  }, 2500);
}

function startBettingTimer(room, seconds) {
  // Clear any existing timer
  if (room._timerInterval) clearInterval(room._timerInterval);
  let timer = seconds;
  const interval = setInterval(() => {
    if (!room.gameState || !rooms.has(room.code)) {
      clearInterval(interval);
      room._timerInterval = null;
      return;
    }
    timer--;
    room.gameState.timer = timer;
    broadcastToRoom(room, 'game:timer', { timer });
    if (timer <= 0) {
      clearInterval(interval);
      room._timerInterval = null;
      if (room.currentGame === 'roulette') games.roulette.spin(room);
      else if (room.currentGame === 'horseracing') games.horseracing.race(room);
    }
  }, 1000);
  room._timerInterval = interval;
}

// ── Socket.IO ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerId = null;

  socket.on('room:create', (data) => {
    if (!data || typeof data !== 'object') return;
    const { playerName, avatar } = data;
    if (typeof playerName !== 'string') return;
    const room = createRoom(playerName);
    playerId = uuidv4();
    const player = { id: playerId, name: playerName, chips: 1000, socket, avatar: avatar || 0 };
    room.players.push(player);
    room.hostId = playerId;
    currentRoom = room;
    socket.emit('room:created', { code: room.code, playerId, players: playerList(room) });
  });

  socket.on('room:join', (data) => {
    if (!data || typeof data !== 'object') return;
    const { code, playerName, avatar, selfie, horseName } = data;
    const room = getRoom(code);
    if (!room) return socket.emit('room:error', { message: 'Room not found' });
    if (room.players.length >= 8) return socket.emit('room:error', { message: 'Room is full' });
    playerId = uuidv4();
    const selfieData = typeof selfie === 'string' && selfie.startsWith('data:image') && selfie.length < 120000 ? selfie : null;
    const player = { id: playerId, name: playerName, chips: 1000, socket, avatar: avatar || 0, selfie: selfieData, horseName: (horseName || '').substring(0, 20) || null };
    room.players.push(player);
    currentRoom = room;
    socket.emit('room:joined', { code: room.code, playerId, players: playerList(room), currentGame: room.currentGame });
    broadcastToRoom(room, 'players:update', playerList(room));
    if (room.currentGame && room.gameState) {
      socket.emit('game:started', { game: room.currentGame });
      socket.emit('game:state', { game: room.currentGame, state: room.gameState });
    }
  });

  // Rejoin — reconnect a returning player to their existing session
  socket.on('room:rejoin', (data) => {
    if (!data || typeof data !== 'object') return;
    const { code, existingPlayerId, selfie, horseName } = data;
    const room = getRoom(code);
    if (!room) return socket.emit('room:error', { message: 'Room not found' });
    const existing = room.players.find(p => p.id === existingPlayerId);
    if (!existing) return socket.emit('room:error', { message: 'Session expired' });
    // Reattach socket and refresh selfie/horseName in case they changed
    existing.socket = socket;
    if (selfie && typeof selfie === 'string' && selfie.startsWith('data:image') && selfie.length < 120000) {
      existing.selfie = selfie;
    }
    if (horseName && typeof horseName === 'string') {
      existing.horseName = horseName.substring(0, 20);
    }
    if (existing._disconnectTimer) { clearTimeout(existing._disconnectTimer); delete existing._disconnectTimer; }
    playerId = existingPlayerId;
    currentRoom = room;
    socket.emit('room:joined', {
      code: room.code, playerId, players: playerList(room), currentGame: room.currentGame,
    });
    broadcastToRoom(room, 'players:update', playerList(room));
    if (room.currentGame && room.gameState) {
      socket.emit('game:started', { game: room.currentGame });
      socket.emit('game:state', { game: room.currentGame, state: room.gameState });
    }
  });

  // TV creates and hosts the room
  socket.on('tv:create', () => {
    const room = createRoom('TV');
    room.tvSocket = socket;
    room.tvHostSocket = socket; // TV is the host for game selection
    currentRoom = room;
    socket.emit('tv:created', { code: room.code, players: playerList(room) });
  });

  socket.on('tv:connect', (data) => {
    if (!data || typeof data !== 'object') return;
    const { code } = data;
    const room = getRoom(code);
    if (!room) return socket.emit('room:error', { message: 'Room not found' });
    room.tvSocket = socket;
    currentRoom = room;
    socket.emit('tv:connected', { code: room.code, players: playerList(room), currentGame: room.currentGame });
    if (room.currentGame && room.gameState) {
      socket.emit('game:started', { game: room.currentGame });
      socket.emit('game:state', { game: room.currentGame, state: room.gameState });
    }
  });

  // Player signals everyone is in — start horse racing immediately
  socket.on('lobby:ready', () => {
    if (!currentRoom) return;
    currentRoom.readyPlayers = new Set();
    currentRoom.currentGame = 'horseracing';
    broadcastToRoom(currentRoom, 'game:started', { game: 'horseracing' });
    games.horseracing.start(currentRoom);
  });


  // Player wants to end the current game and go back to lobby
  socket.on('game:end-request', () => {
    if (!currentRoom) return;
    if (!currentRoom.readyPlayers) currentRoom.readyPlayers = new Set();
    currentRoom.readyPlayers.add(playerId);
    broadcastToRoom(currentRoom, 'lobby:ready-update', {
      readyCount: currentRoom.readyPlayers.size,
      totalCount: currentRoom.players.length,
    });
    // When all players are ready, end the game and go to voting
    if (currentRoom.readyPlayers.size >= currentRoom.players.length) {
      // Clear all game timers and intervals
      if (currentRoom._timerInterval) {
        clearInterval(currentRoom._timerInterval);
        currentRoom._timerInterval = null;
      }
      if (currentRoom._raceInterval) {
        clearInterval(currentRoom._raceInterval);
        currentRoom._raceInterval = null;
      }
      if (currentRoom._oddsInterval) {
        clearInterval(currentRoom._oddsInterval);
        currentRoom._oddsInterval = null;
      }
      clearTimeout(currentRoom._betBroadcastTimeout);
      currentRoom.currentGame = null;
      currentRoom.gameState = null;
      currentRoom.readyPlayers = new Set();
      // Signal clients to return to lobby between races
      broadcastToRoom(currentRoom, 'lobby:vote-start');
    }
  });

  // TV selects game (when TV is host) - kept as fallback
  socket.on('tv:select-game', (data) => {
    if (!data || typeof data !== 'object') return;
    const { game } = data;
    if (!currentRoom || currentRoom.tvHostSocket !== socket) return;
    currentRoom.currentGame = game;
    broadcastToRoom(currentRoom, 'game:started', { game });
    if (games[game]) games[game].start(currentRoom);
  });

  socket.on('game:select', (data) => {
    if (!data || typeof data !== 'object') return;
    const { game } = data;
    if (!currentRoom || playerId !== currentRoom.hostId) return;
    currentRoom.currentGame = game;
    broadcastToRoom(currentRoom, 'game:started', { game });
    if (games[game]) games[game].start(currentRoom);
  });

  // Game actions
  socket.on('roulette:bet', (bet) => {
    if (!bet || typeof bet !== 'object') return;
    if (currentRoom?.currentGame === 'roulette') games.roulette.placeBet(currentRoom, playerId, bet);
  });

  // Client requests current game state (fallback for missed updates)
  socket.on('game:request-state', () => {
    if (currentRoom?.currentGame && currentRoom.gameState) {
      socket.emit('game:state', { game: currentRoom.currentGame, state: currentRoom.gameState });
    }
  });

  socket.on('slots:bet', (data) => {
    if (!data || typeof data !== 'object') return;
    if (currentRoom?.currentGame === 'slots') games.slots.placeBet(currentRoom, playerId, data.amount);
  });

  socket.on('slots:free-spin', () => {
    if (currentRoom?.currentGame === 'slots') games.slots.freeSpin(currentRoom, playerId);
  });

  // Legacy support
  socket.on('slots:spin', (data) => {
    if (!data || typeof data !== 'object') return;
    if (currentRoom?.currentGame === 'slots') games.slots.placeBet(currentRoom, playerId, data.amount);
  });

  socket.on('blackjack:bet', (data) => {
    if (!data || typeof data !== 'object') return;
    if (currentRoom?.currentGame === 'blackjack') games.blackjack.placeBet(currentRoom, playerId, data.amount);
  });

  socket.on('blackjack:hit', () => {
    if (currentRoom?.currentGame === 'blackjack') games.blackjack.hit(currentRoom, playerId);
  });

  socket.on('blackjack:stand', () => {
    if (currentRoom?.currentGame === 'blackjack') games.blackjack.stand(currentRoom, playerId);
  });

  socket.on('blackjack:double', () => {
    if (currentRoom?.currentGame === 'blackjack') games.blackjack.doubleDown(currentRoom, playerId);
  });

  socket.on('poker:action', (data) => {
    if (!data || typeof data !== 'object') return;
    if (currentRoom?.currentGame === 'poker') games.poker.action(currentRoom, playerId, data.action, data.amount);
  });

  socket.on('horseracing:bet', (data) => {
    if (!data || typeof data !== 'object') return;
    if (currentRoom?.currentGame === 'horseracing') games.horseracing.placeBet(currentRoom, playerId, data.horseId, data.amount, data.betType, data.trifecta);
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = currentRoom; // capture reference
    const pid = playerId;

    // TV socket — remove immediately
    if (room.tvSocket === socket) {
      room.tvSocket = null;
    }

    // Player — keep slot for 2 minutes to allow rejoin (phone sleep/tab switch)
    const player = room.players.find(p => p.id === pid);
    if (player) {
      player._disconnectTimer = setTimeout(() => {
        // Room may have been deleted already
        if (!rooms.has(room.code)) return;
        room.players = room.players.filter(p => p.id !== pid);
        if (room.readyPlayers) room.readyPlayers.delete(pid);
        if (room.votes) delete room.votes[pid];
        if (room.players.length === 0 && !room.tvSocket) {
          if (room._timerInterval) clearInterval(room._timerInterval);
          if (room._voteTimerInterval) clearInterval(room._voteTimerInterval);
          if (room._raceInterval) clearInterval(room._raceInterval);
          if (room._oddsInterval) clearInterval(room._oddsInterval);
          clearTimeout(room._betBroadcastTimeout);
          rooms.delete(room.code);
        } else {
          if (room.hostId === pid && room.players.length > 0) {
            room.hostId = room.players[0].id;
          }
          broadcastToRoom(room, 'players:update', playerList(room));
        }
      }, 120000); // 2 minute grace period
    }
  });
});

// ── Periodic cleanup — prevent memory leaks from abandoned rooms ─────────────
setInterval(() => {
  for (const [code, room] of rooms) {
    const hasTV = room.tvSocket && room.tvSocket.connected;
    const hasPlayers = room.players.some(p => p.socket && p.socket.connected);
    if (!hasTV && !hasPlayers) {
      // Clean up all intervals
      if (room._timerInterval) clearInterval(room._timerInterval);
      if (room._voteTimerInterval) clearInterval(room._voteTimerInterval);
      if (room._raceInterval) clearInterval(room._raceInterval);
      if (room._oddsInterval) clearInterval(room._oddsInterval);
      clearTimeout(room._betBroadcastTimeout);
      room.players.forEach(p => { if (p._disconnectTimer) clearTimeout(p._disconnectTimer); });
      rooms.delete(code);
      console.log(`[CLEANUP] Room ${code} removed (no connections)`);
    }
  }
}, 30000); // every 30 seconds

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎰 TV Casino running on http://localhost:${PORT}`);
  console.log(`📺 TV View: http://localhost:${PORT}/tv`);
  console.log(`📱 Open on your phone to play!\n`);
});
