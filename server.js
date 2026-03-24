const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static('public'));

app.get('/tv', (req, res) => res.sendFile(__dirname + '/public/tv.html'));

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
  room.players.forEach(p => p.socket.emit(event, data));
  if (room.tvSocket) room.tvSocket.emit(event, data);
}

function playerList(room) {
  return room.players.map(p => ({
    id: p.id,
    name: p.name,
    chips: p.chips,
    isHost: p.id === room.hostId,
    avatar: p.avatar,
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
  if (cards.length < 5) return { rank: 0, name: 'Incomplete' };
  const allCombos = getCombinations(cards, 5);
  let best = { rank: 0, name: 'High Card', kickers: [] };
  for (const combo of allCombos) {
    const result = evaluateFiveCards(combo);
    if (result.rank > best.rank) best = result;
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
  const isStraight = values.every((v, i) => i === 0 || values[i-1] - v === 1)
    || (values[0] === 12 && values[1] === 3 && values[2] === 2 && values[3] === 1 && values[4] === 0);

  const counts = {};
  values.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const groups = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (isFlush && isStraight && values[0] === 12) return { rank: 9, name: 'Royal Flush' };
  if (isFlush && isStraight) return { rank: 8, name: 'Straight Flush' };
  if (groups[0][1] === 4) return { rank: 7, name: 'Four of a Kind' };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { rank: 6, name: 'Full House' };
  if (isFlush) return { rank: 5, name: 'Flush' };
  if (isStraight) return { rank: 4, name: 'Straight' };
  if (groups[0][1] === 3) return { rank: 3, name: 'Three of a Kind' };
  if (groups[0][1] === 2 && groups[1][1] === 2) return { rank: 2, name: 'Two Pair' };
  if (groups[0][1] === 2) return { rank: 1, name: 'One Pair' };
  return { rank: 0, name: 'High Card' };
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
          if (room.gameState === spinState && room.currentGame === 'roulette') {
            games.roulette.start(room);
          }
        }, 5000);
      }, 4000);
    },
  },

  // ── SLOTS ──
  slots: {
    start(room) {
      room.gameState = { phase: 'ready', results: {} };
      broadcastToRoom(room, 'game:state', { game: 'slots', state: room.gameState });
    },
    spin(room, playerId, betAmount) {
      const player = room.players.find(p => p.id === playerId);
      if (!player) return;
      const amount = parseInt(betAmount);
      if (!amount || amount <= 0 || amount > player.chips) return;
      // Throttle: 1 spin per second per player
      const now = Date.now();
      if (!room._lastSpin) room._lastSpin = {};
      if (room._lastSpin[playerId] && now - room._lastSpin[playerId] < 1000) return;
      room._lastSpin[playerId] = now;
      player.chips -= amount;
      betAmount = amount;

      const SYMBOLS = ['cherry', 'lemon', 'orange', 'plum', 'bell', 'bar', 'seven', 'diamond'];
      const WEIGHTS = [25, 20, 18, 15, 10, 7, 3, 2]; // weighted probabilities
      const totalWeight = WEIGHTS.reduce((a, b) => a + b, 0);

      function weightedRandom() {
        let r = Math.random() * totalWeight;
        for (let i = 0; i < SYMBOLS.length; i++) {
          r -= WEIGHTS[i];
          if (r <= 0) return SYMBOLS[i];
        }
        return SYMBOLS[0];
      }

      const reels = [
        [weightedRandom(), weightedRandom(), weightedRandom()],
        [weightedRandom(), weightedRandom(), weightedRandom()],
        [weightedRandom(), weightedRandom(), weightedRandom()],
      ];

      // Check middle row for wins
      const middle = [reels[0][1], reels[1][1], reels[2][1]];
      let multiplier = 0;

      if (middle[0] === middle[1] && middle[1] === middle[2]) {
        const sym = middle[0];
        const PAYOUTS = { cherry: 5, lemon: 8, orange: 10, plum: 15, bell: 25, bar: 50, seven: 100, diamond: 250 };
        multiplier = PAYOUTS[sym] || 5;
      } else if (middle[0] === middle[1] || middle[1] === middle[2]) {
        multiplier = 2;
      }

      const winAmount = betAmount * multiplier;
      player.chips += winAmount;

      room.gameState.results[playerId] = { reels, middle, multiplier, winAmount, betAmount };
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
          gs.dealerHand.push(gs.deck.pop());
          broadcastToRoom(room, 'game:state', { game: 'blackjack', state: sanitizeBJ(gs, true) });
          setTimeout(dealerDraw, 1000);
        } else {
          this.resolve(room);
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
        if (room.currentGame === 'blackjack') games.blackjack.start(room);
      }, 5000);
    },
  },

  // ── POKER (Texas Hold'em) ──
  poker: {
    start(room) {
      if (room.currentGame !== 'poker') return;
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
        dealerIdx: room.gameState?.dealerIdx != null ? (room.gameState.dealerIdx + 1) % activePlayers.length : 0,
      };

      // Post blinds
      const gs = room.gameState;
      const sbIdx = (gs.dealerIdx + 1) % gs.turnOrder.length;
      const bbIdx = (gs.dealerIdx + 2) % gs.turnOrder.length;
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
      gs.currentTurn = (bbIdx + 1) % gs.turnOrder.length;

      broadcastPlayerHands(room);
      broadcastToRoom(room, 'players:update', playerList(room));
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
      } else if (action === 'check') {
        if (currentPlayerBet < gs.currentBet) return;
      } else if (action === 'allin') {
        const allInAmount = player.chips;
        player.chips = 0;
        gs.pot += allInAmount;
        gs.roundBets[playerId] = (gs.roundBets[playerId] || 0) + allInAmount;
        if (gs.roundBets[playerId] > gs.currentBet) gs.currentBet = gs.roundBets[playerId];
      }

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

      if ((allMatched && loops >= gs.turnOrder.length - gs.foldedPlayers.length - 1) || activeBettors.length === 0) {
        this.nextPhase(room);
      } else {
        broadcastPlayerHands(room);
        broadcastToRoom(room, 'players:update', playerList(room));
      }
    },
    nextPhase(room) {
      const gs = room.gameState;
      gs.roundBets = {};
      gs.currentBet = 0;
      // Start from first non-folded, non-allin player
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
    },
    showdown(room) {
      const gs = room.gameState;
      gs.phase = 'showdown';
      let bestRank = -1;
      let winner = null;
      gs.handResults = {};

      for (const pid of gs.activePlayers) {
        const allCards = [...gs.hands[pid], ...gs.community];
        const result = evaluatePokerHand(allCards);
        gs.handResults[pid] = result;
        if (result.rank > bestRank) {
          bestRank = result.rank;
          winner = pid;
        }
      }
      this.endHand(room, winner);
    },
    endHand(room, winnerId) {
      const gs = room.gameState;
      gs.phase = 'result';
      gs.winner = winnerId;
      const winner = room.players.find(p => p.id === winnerId);
      if (winner) winner.chips += gs.pot;

      // Reveal all hands for TV
      broadcastToRoom(room, 'game:state', {
        game: 'poker',
        state: {
          ...gs,
          allHands: gs.hands,
        },
      });
      broadcastToRoom(room, 'players:update', playerList(room));

      setTimeout(() => {
        if (room.currentGame === 'poker') games.poker.start(room);
      }, 5000);
    },
  },

  // ── HORSE RACING ──
  horseracing: {
    start(room) {
      if (room.currentGame !== 'horseracing') return;
      const ALL_COLORS = ['#c0392b','#2980b9','#d4a843','#1a1a2e','#27ae60','#8e44ad','#e67e22','#16a085','#e84393','#636e72','#fdcb6e','#00b894','#6c5ce7','#d63031','#0984e3','#a29bfe'];
      const numHorses = 4 + Math.floor(Math.random() * 13); // 4 to 16
      const colors = ALL_COLORS.slice(0, numHorses);
      const usedNames = new Set();
      const baseOdds = generateBaseOdds(numHorses);
      const horses = colors.map((color, i) => ({
        id: i + 1,
        name: generateHorseName(usedNames),
        color,
        baseOdds: baseOdds[i],
        odds: baseOdds[i],
        position: 0,
        gateLoaded: false,
      }));
      room.gameState = {
        phase: 'betting',
        horses,
        bets: {},
        timer: 25,
        winner: null,
        commentary: 'The runners are being paraded before the race.',
        speak: 'Welcome to the races. The runners are being paraded. Place your bets now.',
      };
      broadcastToRoom(room, 'game:state', { game: 'horseracing', state: room.gameState });
      startBettingTimer(room, 25);

      // Fluctuate odds every 2s
      room._oddsInterval = setInterval(() => {
        if (!room.gameState || room.gameState.phase !== 'betting') {
          clearInterval(room._oddsInterval);
          room._oddsInterval = null;
          return;
        }
        for (const horse of room.gameState.horses) {
          const drift = (Math.random() - 0.5) * 0.6;
          horse.odds = Math.round(Math.max(1.5, Math.min(50, horse.odds + drift)) * 10) / 10;
        }
        recalculateOdds(room.gameState.horses, room.gameState.bets);
        broadcastToRoom(room, 'game:state', { game: 'horseracing', state: room.gameState });
      }, 2000);
    },
    placeBet(room, playerId, horseId, amount) {
      if (!room.gameState || room.gameState.phase !== 'betting') return;
      const player = room.players.find(p => p.id === playerId);
      amount = parseInt(amount);
      if (!player || !amount || amount <= 0 || amount > player.chips) return;
      if (room.gameState.bets[playerId]) return;
      player.chips -= amount;
      room.gameState.bets[playerId] = { horseId, amount };
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
          // All loaded — pause then start
          gs.commentary = 'All horses are loaded. Starter ready...';
          gs.speak = 'All horses are loaded. The starter is ready.';
          broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });

          setTimeout(() => {
            if (room.currentGame !== 'horseracing' || room.gameState !== gs) return;
            gs.phase = 'starting';
            gs.commentary = 'The gates are about to open!';
            gs.speak = null;
            broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });

            // ── PHASE: Gates open ──
            setTimeout(() => {
              if (room.currentGame !== 'horseracing' || room.gameState !== gs) return;
              gs.phase = 'racing';
              gs.commentary = "AND THEY'RE OFF!";
              gs.speak = "And they're off! The field breaks cleanly from the barriers!";
              broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });
              this._startRace(room, gs);
            }, 2000);
          }, 1500);
        }
      }, 800);
    },

    _startRace(room, gs) {
      let tickCount = 0;
      let lastLeaderId = null;
      let leadChangeCount = 0;

      const interval = setInterval(() => {
        if (room.currentGame !== 'horseracing' || !room.gameState || room.gameState !== gs) {
          clearInterval(interval);
          room._raceInterval = null;
          return;
        }

        let leaderId = null;
        let leaderPos = -1;
        let secondPos = -1;
        let finished = false;

        for (const horse of gs.horses) {
          // Slower movement for longer race (~15-20 seconds)
          const randomBurst = Math.random() * 2.5;
          const oddsEdge = (10 - horse.baseOdds) * 0.04;
          const surge = Math.random() < 0.06 ? (Math.random() * 4) : 0;
          horse.position += 0.8 + randomBurst + oddsEdge + surge;

          if (horse.position > leaderPos) {
            secondPos = leaderPos;
            leaderPos = horse.position;
            leaderId = horse.id;
          } else if (horse.position > secondPos) {
            secondPos = horse.position;
          }

          if (horse.position >= 100) {
            horse.position = 100;
            if (!finished) { gs.winner = horse.id; finished = true; }
          }
        }

        gs.leader = leaderId;
        const gap = leaderPos - secondPos;

        // Lead change detection
        if (leaderId !== lastLeaderId && lastLeaderId !== null) {
          leadChangeCount++;
          const newLeader = gs.horses.find(h => h.id === leaderId);
          gs.commentary = `${newLeader.name} takes the lead!`;
          gs.speak = `${newLeader.name} takes the lead!`;
        }
        lastLeaderId = leaderId;

        // Dynamic commentary based on race progress
        const avgPos = gs.horses.reduce((s, h) => s + h.position, 0) / gs.horses.length;
        if (tickCount % 15 === 10 && !gs.speak) {
          const leader = gs.horses.find(h => h.id === leaderId);
          const lines = this._getCommentary(avgPos, leader, gap, gs.horses);
          gs.commentary = lines.text;
          if (lines.speak) gs.speak = lines.speak;
        } else if (tickCount % 5 === 0) {
          gs.speak = null; // clear speak so it doesn't repeat
        }

        tickCount++;
        broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });

        if (finished) {
          clearInterval(interval);
          room._raceInterval = null;
          gs.phase = 'result';
          const winHorse = gs.horses.find(h => h.id === gs.winner);
          gs.commentary = `${winHorse.name} wins the race!`;
          gs.speak = `And it's ${winHorse.name} who takes the victory at odds of ${winHorse.lockedOdds} to one!`;

          // Determine places for all horses
          const sorted = [...gs.horses].sort((a, b) => b.position - a.position);
          gs.places = sorted.map(h => h.id);

          for (const [pid, bet] of Object.entries(gs.bets)) {
            const player = room.players.find(p => p.id === pid);
            if (!player) continue;
            if (bet.horseId === gs.winner) {
              const payoutOdds = winHorse.lockedOdds || winHorse.odds;
              player.chips += Math.round(bet.amount * payoutOdds);
              bet.won = true;
              bet.winAmount = Math.round(bet.amount * payoutOdds);
            }
          }
          broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });
          broadcastToRoom(room, 'players:update', playerList(room));

          setTimeout(() => {
            if (room.currentGame === 'horseracing') games.horseracing.start(room);
          }, 8000);
        }
      }, 100);
      room._raceInterval = interval;
    },

    _getCommentary(avgPos, leader, gap, horses) {
      if (avgPos < 20) {
        const lines = [
          "The field is bunching up early on!",
          "Settling into their stride now.",
          "A clean start as they head down the track.",
        ];
        return { text: lines[Math.floor(Math.random() * lines.length)] };
      } else if (avgPos < 40) {
        if (gap > 8) return { text: `${leader.name} has opened up a big lead!`, speak: `${leader.name} is pulling away from the field!` };
        return { text: "The pack is tightly bunched going through the first turn!" };
      } else if (avgPos < 60) {
        const lines = [
          "They're into the back straight now!",
          "The jockeys are positioning for the final push!",
          `${leader.name} continues to lead as they pass the halfway mark.`,
        ];
        return { text: lines[Math.floor(Math.random() * lines.length)], speak: `Halfway through, ${leader.name} leads the field.` };
      } else if (avgPos < 80) {
        if (gap < 3) return { text: "It's incredibly tight at the front! Anyone's race!", speak: "It's neck and neck! This could go to any of them!" };
        return { text: "Rounding the final bend now!", speak: "They're turning for home!" };
      } else {
        const lines = [
          "Into the final furlong! The crowd is on their feet!",
          "It's a sprint to the finish line!",
          "The whips are out! They're giving everything!",
          `${leader.name} is being pushed all the way to the line!`,
        ];
        return { text: lines[Math.floor(Math.random() * lines.length)], speak: "Down the final stretch! Here they come!" };
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
  // Send each player only their own hand
  room.players.forEach(p => {
    p.socket.emit('game:state', {
      game: 'poker',
      state: {
        phase: gs.phase,
        community: gs.community,
        pot: gs.pot,
        currentBet: gs.currentBet,
        currentTurn: gs.currentTurn,
        turnOrder: gs.turnOrder,
        activePlayers: gs.activePlayers,
        foldedPlayers: gs.foldedPlayers,
        roundBets: gs.roundBets,
        myHand: gs.hands[p.id] || null,
        winner: gs.winner,
        allHands: gs.phase === 'result' || gs.phase === 'showdown' ? gs.hands : undefined,
        dealerIdx: gs.dealerIdx,
      },
    });
  });
  // TV gets all hands during showdown, otherwise just community
  if (room.tvSocket) {
    room.tvSocket.emit('game:state', {
      game: 'poker',
      state: {
        phase: gs.phase,
        community: gs.community,
        pot: gs.pot,
        currentBet: gs.currentBet,
        currentTurn: gs.currentTurn,
        turnOrder: gs.turnOrder,
        activePlayers: gs.activePlayers,
        foldedPlayers: gs.foldedPlayers,
        roundBets: gs.roundBets,
        allHands: gs.phase === 'result' || gs.phase === 'showdown' ? gs.hands : undefined,
        handBacks: Object.fromEntries(gs.turnOrder.map(pid => [pid, gs.hands[pid]?.length || 0])),
        winner: gs.winner,
        dealerIdx: gs.dealerIdx,
      },
    });
  }
}

function countVotes(room) {
  const counts = { roulette: 0, slots: 0, blackjack: 0, poker: 0, horseracing: 0 };
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

  socket.on('room:create', ({ playerName, avatar }) => {
    const room = createRoom(playerName);
    playerId = uuidv4();
    const player = { id: playerId, name: playerName, chips: 1000, socket, avatar: avatar || 0 };
    room.players.push(player);
    room.hostId = playerId;
    currentRoom = room;
    socket.emit('room:created', { code: room.code, playerId, players: playerList(room) });
  });

  socket.on('room:join', ({ code, playerName, avatar }) => {
    const room = getRoom(code);
    if (!room) return socket.emit('room:error', { message: 'Room not found' });
    if (room.players.length >= 8) return socket.emit('room:error', { message: 'Room is full' });
    playerId = uuidv4();
    const player = { id: playerId, name: playerName, chips: 1000, socket, avatar: avatar || 0 };
    room.players.push(player);
    currentRoom = room;
    socket.emit('room:joined', { code: room.code, playerId, players: playerList(room), currentGame: room.currentGame });
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

  socket.on('tv:connect', ({ code }) => {
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

  // Player signals everyone is in - start voting
  socket.on('lobby:ready', () => {
    if (!currentRoom) return;
    // Clear any existing vote timer
    if (currentRoom._voteTimerInterval) {
      clearInterval(currentRoom._voteTimerInterval);
      currentRoom._voteTimerInterval = null;
    }
    currentRoom.votes = {};
    currentRoom.voteTimer = null;
    currentRoom.readyPlayers = new Set();
    broadcastToRoom(currentRoom, 'lobby:vote-start');
  });

  // Player votes for a game
  socket.on('game:vote', ({ game }) => {
    if (!currentRoom || !game) return;
    if (!currentRoom.votes) currentRoom.votes = {};
    currentRoom.votes[playerId] = game;

    const counts = countVotes(currentRoom);

    // Start 30s timer on first vote
    if (Object.keys(currentRoom.votes).length === 1 && !currentRoom._voteTimerInterval) {
      currentRoom.voteTimer = 30;
      currentRoom._voteTimerInterval = setInterval(() => {
        currentRoom.voteTimer--;
        // Recount votes each tick so counts stay fresh
        const freshCounts = countVotes(currentRoom);
        broadcastToRoom(currentRoom, 'vote:update', { votes: freshCounts, timer: currentRoom.voteTimer });
        if (currentRoom.voteTimer <= 0) {
          clearInterval(currentRoom._voteTimerInterval);
          currentRoom._voteTimerInterval = null;
          finishVoting(currentRoom);
        }
      }, 1000);
    }

    broadcastToRoom(currentRoom, 'vote:update', { votes: counts, timer: currentRoom.voteTimer });

    // If everyone has voted, finish immediately
    if (currentRoom.players.length > 0 && Object.keys(currentRoom.votes).length >= currentRoom.players.length) {
      if (currentRoom._voteTimerInterval) {
        clearInterval(currentRoom._voteTimerInterval);
        currentRoom._voteTimerInterval = null;
      }
      setTimeout(() => finishVoting(currentRoom), 1500);
    }
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
      currentRoom.votes = {};
      currentRoom.readyPlayers = new Set();
      if (currentRoom._voteTimerInterval) {
        clearInterval(currentRoom._voteTimerInterval);
        currentRoom._voteTimerInterval = null;
      }
      currentRoom.voteTimer = null;
      broadcastToRoom(currentRoom, 'lobby:vote-start');
    }
  });

  // TV selects game (when TV is host) - kept as fallback
  socket.on('tv:select-game', ({ game }) => {
    if (!currentRoom || currentRoom.tvHostSocket !== socket) return;
    currentRoom.currentGame = game;
    broadcastToRoom(currentRoom, 'game:started', { game });
    if (games[game]) games[game].start(currentRoom);
  });

  socket.on('game:select', ({ game }) => {
    if (!currentRoom || playerId !== currentRoom.hostId) return;
    currentRoom.currentGame = game;
    broadcastToRoom(currentRoom, 'game:started', { game });
    if (games[game]) games[game].start(currentRoom);
  });

  // Game actions
  socket.on('roulette:bet', (bet) => {
    if (currentRoom?.currentGame === 'roulette') games.roulette.placeBet(currentRoom, playerId, bet);
  });

  // Client requests current game state (fallback for missed updates)
  socket.on('game:request-state', () => {
    if (currentRoom?.currentGame && currentRoom.gameState) {
      socket.emit('game:state', { game: currentRoom.currentGame, state: currentRoom.gameState });
    }
  });

  socket.on('slots:spin', ({ amount }) => {
    if (currentRoom?.currentGame === 'slots') games.slots.spin(currentRoom, playerId, amount);
  });

  socket.on('blackjack:bet', ({ amount }) => {
    if (currentRoom?.currentGame === 'blackjack') games.blackjack.placeBet(currentRoom, playerId, amount);
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

  socket.on('poker:action', ({ action, amount }) => {
    if (currentRoom?.currentGame === 'poker') games.poker.action(currentRoom, playerId, action, amount);
  });

  socket.on('horseracing:bet', ({ horseId, amount }) => {
    if (currentRoom?.currentGame === 'horseracing') games.horseracing.placeBet(currentRoom, playerId, horseId, amount);
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    currentRoom.players = currentRoom.players.filter(p => p.id !== playerId);
    if (currentRoom.tvSocket === socket) currentRoom.tvSocket = null;
    // Clean up from ready/vote sets
    if (currentRoom.readyPlayers) currentRoom.readyPlayers.delete(playerId);
    if (currentRoom.votes) delete currentRoom.votes[playerId];
    if (currentRoom.players.length === 0 && !currentRoom.tvSocket) {
      if (currentRoom._timerInterval) clearInterval(currentRoom._timerInterval);
      if (currentRoom._voteTimerInterval) clearInterval(currentRoom._voteTimerInterval);
      if (currentRoom._raceInterval) clearInterval(currentRoom._raceInterval);
      if (currentRoom._oddsInterval) clearInterval(currentRoom._oddsInterval);
      clearTimeout(currentRoom._betBroadcastTimeout);
      rooms.delete(currentRoom.code);
    } else {
      if (currentRoom.hostId === playerId && currentRoom.players.length > 0) {
        currentRoom.hostId = currentRoom.players[0].id;
      }
      broadcastToRoom(currentRoom, 'players:update', playerList(currentRoom));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎰 TV Casino running on http://localhost:${PORT}`);
  console.log(`📺 TV View: http://localhost:${PORT}/tv`);
  console.log(`📱 Open on your phone to play!\n`);
});
