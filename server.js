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
  }));
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

// ── Game Engine ────────────────────────────────────────────────────────────

const games = {

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
      const numHorses = 4 + Math.floor(Math.random() * 13); // 4 to 16
      const colors = ALL_COLORS.slice(0, numHorses);
      const usedNames = new Set();
      const baseOdds = generateBaseOdds(numHorses);
      const DISTANCES = [1000, 1100, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 3200];
      const distance = DISTANCES[Math.floor(Math.random() * DISTANCES.length)];

      // Track race number
      if (!room._raceNumber) room._raceNumber = 0;
      room._raceNumber++;

      // Assign running styles weighted by odds (favourites more likely frontrunner/stalker)
      const styleKeys = Object.keys(this._STYLES);
      const usedJockeys = new Set();
      const horses = colors.map((color, i) => {
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

        // Assign jockey — better jockeys on shorter-odds horses
        let jockey;
        const jockeyPool = this._JOCKEY_NAMES.filter(j => !usedJockeys.has(j));
        if (baseOdds[i] < 5 && jockeyPool.length > 3) {
          jockey = jockeyPool[Math.floor(Math.random() * 3)]; // top 3 available
        } else {
          jockey = jockeyPool[Math.floor(Math.random() * jockeyPool.length)] || 'A. Rider';
        }
        usedJockeys.add(jockey);

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

        return {
          id: i + 1,
          name: generateHorseName(usedNames),
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

function startBettingTimer(room, seconds) {
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
      if (room.currentGame === 'horseracing') games.horseracing.race(room);
    }
  }, 1000);
  room._timerInterval = interval;
}

// ── Socket.IO ───────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  let currentRoom = null;
  let playerId = null;

  socket.on('room:join', (data) => {
    if (!data || typeof data !== 'object') return;
    const { code, playerName, avatar } = data;
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

  // Rejoin — reconnect a returning player to their existing session
  socket.on('room:rejoin', (data) => {
    if (!data || typeof data !== 'object') return;
    const { code, existingPlayerId } = data;
    const room = getRoom(code);
    if (!room) return socket.emit('room:error', { message: 'Room not found' });
    const existing = room.players.find(p => p.id === existingPlayerId);
    if (!existing) return socket.emit('room:error', { message: 'Session expired' });
    existing.socket = socket;
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
    room.tvHostSocket = socket;
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

  // Player signals everyone is in - start horse racing directly
  socket.on('lobby:ready', () => {
    if (!currentRoom) return;
    if (currentRoom.currentGame) return; // already in a game
    currentRoom.currentGame = 'horseracing';
    broadcastToRoom(currentRoom, 'game:started', { game: 'horseracing' });
    games.horseracing.start(currentRoom);
  });

  // Horse racing bet
  socket.on('horseracing:bet', (data) => {
    if (!data || typeof data !== 'object') return;
    if (currentRoom?.currentGame === 'horseracing') games.horseracing.placeBet(currentRoom, playerId, data.horseId, data.amount, data.betType, data.trifecta);
  });

  // Client requests current game state (fallback for missed updates)
  socket.on('game:request-state', () => {
    if (currentRoom?.currentGame && currentRoom.gameState) {
      socket.emit('game:state', { game: currentRoom.currentGame, state: currentRoom.gameState });
    }
  });

  // Player wants to end the current game — new meeting
  socket.on('game:end-request', () => {
    if (!currentRoom) return;
    if (!currentRoom.readyPlayers) currentRoom.readyPlayers = new Set();
    currentRoom.readyPlayers.add(playerId);
    broadcastToRoom(currentRoom, 'lobby:ready-update', {
      readyCount: currentRoom.readyPlayers.size,
      totalCount: currentRoom.players.length,
    });
    // When all players agree, start a fresh meeting
    if (currentRoom.readyPlayers.size >= currentRoom.players.length) {
      // Clear all timers
      if (currentRoom._timerInterval) { clearInterval(currentRoom._timerInterval); currentRoom._timerInterval = null; }
      if (currentRoom._raceInterval) { clearInterval(currentRoom._raceInterval); currentRoom._raceInterval = null; }
      if (currentRoom._oddsInterval) { clearInterval(currentRoom._oddsInterval); currentRoom._oddsInterval = null; }
      clearTimeout(currentRoom._betBroadcastTimeout);
      currentRoom.readyPlayers = new Set();
      // Start a new race
      games.horseracing.start(currentRoom);
    }
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = currentRoom;
    const pid = playerId;

    // TV socket — remove immediately
    if (room.tvSocket === socket) {
      room.tvSocket = null;
    }

    // Player — keep slot for 2 minutes to allow rejoin (phone sleep/tab switch)
    const player = room.players.find(p => p.id === pid);
    if (player) {
      player._disconnectTimer = setTimeout(() => {
        if (!rooms.has(room.code)) return;
        room.players = room.players.filter(p => p.id !== pid);
        if (room.readyPlayers) room.readyPlayers.delete(pid);
        if (room.players.length === 0 && !room.tvSocket) {
          if (room._timerInterval) clearInterval(room._timerInterval);
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
      }, 120000);
    }
  });
});

// ── Periodic cleanup — prevent memory leaks from abandoned rooms ─────────────
setInterval(() => {
  for (const [code, room] of rooms) {
    const hasTV = room.tvSocket && room.tvSocket.connected;
    const hasPlayers = room.players.some(p => p.socket && p.socket.connected);
    if (!hasTV && !hasPlayers) {
      if (room._timerInterval) clearInterval(room._timerInterval);
      if (room._raceInterval) clearInterval(room._raceInterval);
      if (room._oddsInterval) clearInterval(room._oddsInterval);
      clearTimeout(room._betBroadcastTimeout);
      room.players.forEach(p => { if (p._disconnectTimer) clearTimeout(p._disconnectTimer); });
      rooms.delete(code);
      console.log(`[CLEANUP] Room ${code} removed (no connections)`);
    }
  }
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🏇 Race Day running on http://localhost:${PORT}`);
  console.log(`📺 TV View: http://localhost:${PORT}/tv`);
  console.log(`📱 Open on your phone to play!\n`);
});
