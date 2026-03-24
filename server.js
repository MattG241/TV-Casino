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

// ── Game Engines ────────────────────────────────────────────────────────────

const games = {
  // ── ROULETTE ──
  roulette: {
    start(room) {
      room.gameState = {
        phase: 'betting', // betting -> spinning -> result
        bets: {},
        result: null,
        timer: 20,
        history: room.gameState?.history || [],
      };
      broadcastToRoom(room, 'game:state', { game: 'roulette', state: room.gameState });
      startBettingTimer(room, 20);
    },
    placeBet(room, playerId, bet) {
      if (room.gameState.phase !== 'betting') return;
      const player = room.players.find(p => p.id === playerId);
      if (!player) return;
      // Validate bet amount
      const amount = parseInt(bet.amount);
      if (!amount || amount <= 0 || amount > player.chips) return;
      bet.amount = amount;
      // Cap at 10 bets per player per round
      if (!room.gameState.bets[playerId]) room.gameState.bets[playerId] = [];
      if (room.gameState.bets[playerId].length >= 10) return;
      room.gameState.bets[playerId].push(bet);
      player.chips -= amount;
      // Throttle broadcasts - max once per 200ms
      clearTimeout(room._betBroadcastTimeout);
      room._betBroadcastTimeout = setTimeout(() => {
        broadcastToRoom(room, 'game:state', { game: 'roulette', state: room.gameState });
        broadcastToRoom(room, 'players:update', playerList(room));
      }, 200);
    },
    spin(room) {
      if (room.gameState.phase === 'spinning') return; // prevent double-spin
      room.gameState.phase = 'spinning';
      room.gameState.timer = null;
      const number = Math.floor(Math.random() * 37); // 0-36
      const RED = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
      const color = number === 0 ? 'green' : RED.includes(number) ? 'red' : 'black';
      console.log(`[ROULETTE] Spinning... result will be ${number} ${color}`);
      broadcastToRoom(room, 'game:state', { game: 'roulette', state: room.gameState });

      // Store the spin result and a reference to this gameState
      const spinState = room.gameState;

      setTimeout(() => {
        // Use the stored reference to ensure we update the right state
        if (room.gameState !== spinState) {
          console.log('[ROULETTE] gameState was replaced, skipping result');
          return;
        }
        console.log(`[ROULETTE] Showing result: ${number} ${color}`);
        room.gameState.phase = 'result';
        room.gameState.result = { number, color };

        // Calculate winnings
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
        console.log(`[ROULETTE] Result broadcast complete. Next round in 5s.`);

        setTimeout(() => {
          if (room.gameState === spinState) {
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
      if (room.gameState.phase !== 'betting') return;
      const player = room.players.find(p => p.id === playerId);
      if (!player || amount > player.chips || amount <= 0) return;
      player.chips -= amount;
      room.gameState.bets[playerId] = amount;
      broadcastToRoom(room, 'game:state', { game: 'blackjack', state: sanitizeBJ(room.gameState) });
      broadcastToRoom(room, 'players:update', playerList(room));

      // Auto-deal if all players have bet
      const activePlayers = room.players.filter(p => p.chips >= 0);
      if (Object.keys(room.gameState.bets).length >= activePlayers.length) {
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
      if (gs.phase !== 'playing' || gs.turnOrder[gs.currentTurn] !== playerId) return;
      gs.hands[playerId].push(gs.deck.pop());
      if (handValue(gs.hands[playerId]) > 21) {
        gs.results[playerId] = 'bust';
        gs.currentTurn++;
        this.advanceTurn(room);
      } else if (handValue(gs.hands[playerId]) === 21) {
        gs.results[playerId] = '21';
        gs.currentTurn++;
        this.advanceTurn(room);
      } else {
        broadcastToRoom(room, 'game:state', { game: 'blackjack', state: sanitizeBJ(gs) });
      }
    },
    stand(room, playerId) {
      const gs = room.gameState;
      if (gs.phase !== 'playing' || gs.turnOrder[gs.currentTurn] !== playerId) return;
      gs.currentTurn++;
      this.advanceTurn(room);
    },
    doubleDown(room, playerId) {
      const gs = room.gameState;
      if (gs.phase !== 'playing' || gs.turnOrder[gs.currentTurn] !== playerId) return;
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

      setTimeout(() => games.blackjack.start(room), 5000);
    },
  },

  // ── POKER (Texas Hold'em) ──
  poker: {
    start(room) {
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
      if (!gs || gs.turnOrder[gs.currentTurn] !== playerId) return;
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

      if (allMatched && loops >= gs.turnOrder.length - gs.foldedPlayers.length - 1 || activeBettors.length === 0) {
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
      gs.currentTurn = 0;

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

      for (const pid of gs.activePlayers) {
        const allCards = [...gs.hands[pid], ...gs.community];
        const result = evaluatePokerHand(allCards);
        gs.hands[pid].result = result;
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

      setTimeout(() => games.poker.start(room), 5000);
    },
  },

  // ── HORSE RACING ──
  horseracing: {
    start(room) {
      const horses = [
        { id: 1, name: 'Thunder Bolt', color: '#e74c3c', odds: 3, position: 0 },
        { id: 2, name: 'Silver Arrow', color: '#3498db', odds: 4, position: 0 },
        { id: 3, name: 'Golden Star', color: '#f1c40f', odds: 5, position: 0 },
        { id: 4, name: 'Dark Knight', color: '#2c3e50', odds: 6, position: 0 },
        { id: 5, name: 'Wild Spirit', color: '#27ae60', odds: 8, position: 0 },
        { id: 6, name: 'Lucky Charm', color: '#9b59b6', odds: 10, position: 0 },
      ];
      room.gameState = {
        phase: 'betting',
        horses,
        bets: {},
        timer: 15,
        winner: null,
      };
      broadcastToRoom(room, 'game:state', { game: 'horseracing', state: room.gameState });
      startBettingTimer(room, 15);
    },
    placeBet(room, playerId, horseId, amount) {
      if (room.gameState.phase !== 'betting') return;
      const player = room.players.find(p => p.id === playerId);
      if (!player || amount > player.chips || amount <= 0) return;
      player.chips -= amount;
      room.gameState.bets[playerId] = { horseId, amount };
      broadcastToRoom(room, 'game:state', { game: 'horseracing', state: room.gameState });
      broadcastToRoom(room, 'players:update', playerList(room));
    },
    race(room) {
      const gs = room.gameState;
      gs.phase = 'racing';
      broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });

      const interval = setInterval(() => {
        let finished = false;
        for (const horse of gs.horses) {
          // Each horse has a speed based loosely on odds (lower odds = slightly faster)
          const baseSpeed = 2 + Math.random() * 4;
          const oddsBonus = (12 - horse.odds) * 0.15;
          horse.position += baseSpeed + oddsBonus + (Math.random() * 2 - 1);
          if (horse.position >= 100) {
            horse.position = 100;
            if (!finished) {
              gs.winner = horse.id;
              finished = true;
            }
          }
        }
        broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });

        if (finished) {
          clearInterval(interval);
          gs.phase = 'result';

          // Payouts
          for (const [pid, bet] of Object.entries(gs.bets)) {
            const player = room.players.find(p => p.id === pid);
            if (!player) continue;
            if (bet.horseId === gs.winner) {
              const horse = gs.horses.find(h => h.id === gs.winner);
              player.chips += bet.amount * horse.odds;
              bet.won = true;
              bet.winAmount = bet.amount * horse.odds;
            }
          }
          broadcastToRoom(room, 'game:state', { game: 'horseracing', state: gs });
          broadcastToRoom(room, 'players:update', playerList(room));

          setTimeout(() => games.horseracing.start(room), 5000);
        }
      }, 100);
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
    currentRoom.votes = {};
    currentRoom.voteTimer = null;
    currentRoom._voteTimerInterval = null;
    broadcastToRoom(currentRoom, 'lobby:vote-start');
  });

  // Player votes for a game
  socket.on('game:vote', ({ game }) => {
    if (!currentRoom || !game) return;
    if (!currentRoom.votes) currentRoom.votes = {};
    currentRoom.votes[playerId] = game;

    // Count votes
    const counts = { roulette: 0, slots: 0, blackjack: 0, poker: 0, horseracing: 0 };
    for (const g of Object.values(currentRoom.votes)) {
      if (counts[g] !== undefined) counts[g]++;
    }

    // Start 30s timer on first vote
    if (Object.keys(currentRoom.votes).length === 1 && !currentRoom._voteTimerInterval) {
      currentRoom.voteTimer = 30;
      currentRoom._voteTimerInterval = setInterval(() => {
        currentRoom.voteTimer--;
        broadcastToRoom(currentRoom, 'vote:update', { votes: counts, timer: currentRoom.voteTimer });
        if (currentRoom.voteTimer <= 0) {
          clearInterval(currentRoom._voteTimerInterval);
          currentRoom._voteTimerInterval = null;
          finishVoting(currentRoom);
        }
      }, 1000);
    }

    broadcastToRoom(currentRoom, 'vote:update', { votes: counts, timer: currentRoom.voteTimer });

    // If everyone has voted, finish immediately
    if (Object.keys(currentRoom.votes).length >= currentRoom.players.length) {
      if (currentRoom._voteTimerInterval) {
        clearInterval(currentRoom._voteTimerInterval);
        currentRoom._voteTimerInterval = null;
      }
      setTimeout(() => finishVoting(currentRoom), 1500);
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
    if (currentRoom.players.length === 0) {
      if (currentRoom._timerInterval) clearInterval(currentRoom._timerInterval);
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
