// ── TV Casino - Audio Engine ─────────────────────────────────────────────
// Uses Web Audio API for synthesized casino sounds - no external files needed

const CasinoAudio = (() => {
  let ctx = null;
  let enabled = true;
  let musicGain = null;
  let sfxGain = null;
  let musicOsc = null;
  let musicPlaying = false;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.3;
      sfxGain.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.08;
      musicGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function playTone(freq, duration, type = 'sine', gainVal = 0.3, delay = 0) {
    if (!enabled) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, c.currentTime + delay);
    gain.gain.linearRampToValueAtTime(gainVal, c.currentTime + delay + 0.02);
    gain.gain.linearRampToValueAtTime(0, c.currentTime + delay + duration);
    osc.connect(gain);
    gain.connect(sfxGain);
    osc.start(c.currentTime + delay);
    osc.stop(c.currentTime + delay + duration + 0.05);
  }

  function playNoise(duration, gainVal = 0.1) {
    if (!enabled) return;
    const c = getCtx();
    const bufferSize = c.sampleRate * duration;
    const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const source = c.createBufferSource();
    source.buffer = buffer;
    const gain = c.createGain();
    gain.gain.setValueAtTime(gainVal, c.currentTime);
    gain.gain.linearRampToValueAtTime(0, c.currentTime + duration);
    const filter = c.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 3000;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(sfxGain);
    source.start();
  }

  return {
    toggle() {
      enabled = !enabled;
      if (!enabled && musicPlaying) this.stopMusic();
      return enabled;
    },

    isEnabled() { return enabled; },

    // Casino chip/coin sound
    chip() {
      playTone(2400, 0.06, 'square', 0.15);
      playTone(3200, 0.04, 'square', 0.1, 0.05);
    },

    // Bet placed
    bet() {
      playTone(880, 0.08, 'sine', 0.2);
      playTone(1100, 0.06, 'sine', 0.15, 0.06);
    },

    // Card dealt
    card() {
      playNoise(0.05, 0.15);
    },

    // Roulette wheel spinning
    spin() {
      if (!enabled) return;
      const c = getCtx();
      // Clicking sound that slows down
      for (let i = 0; i < 30; i++) {
        const delay = i * (0.05 + i * 0.004);
        if (delay > 4) break;
        playTone(1800 - i * 30, 0.03, 'square', 0.08 - i * 0.002, delay);
      }
    },

    // Roulette ball landing
    ballLand() {
      playTone(600, 0.1, 'sine', 0.25);
      playTone(800, 0.08, 'sine', 0.2, 0.08);
      playTone(1000, 0.15, 'sine', 0.15, 0.14);
    },

    // Slot reel spinning
    slotSpin() {
      if (!enabled) return;
      for (let i = 0; i < 15; i++) {
        playTone(400 + Math.random() * 200, 0.04, 'square', 0.06, i * 0.06);
      }
    },

    // Slot reel stop
    slotStop() {
      playTone(300, 0.08, 'square', 0.2);
      playTone(200, 0.1, 'square', 0.15, 0.06);
    },

    // Win - ascending arpeggio
    win() {
      const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        playTone(freq, 0.2, 'sine', 0.25, i * 0.12);
        playTone(freq * 1.5, 0.15, 'triangle', 0.1, i * 0.12);
      });
    },

    // Big win - fanfare
    bigWin() {
      const notes = [523, 659, 784, 1047, 1319, 1568]; // C major scale up
      notes.forEach((freq, i) => {
        playTone(freq, 0.3, 'sine', 0.3, i * 0.1);
        playTone(freq * 0.5, 0.3, 'triangle', 0.15, i * 0.1);
      });
      // Sparkle
      for (let i = 0; i < 10; i++) {
        playTone(2000 + Math.random() * 2000, 0.08, 'sine', 0.08, 0.6 + i * 0.05);
      }
    },

    // Lose sound
    lose() {
      playTone(400, 0.2, 'sine', 0.2);
      playTone(300, 0.3, 'sine', 0.2, 0.15);
      playTone(250, 0.4, 'sine', 0.15, 0.3);
    },

    // Timer tick
    tick() {
      playTone(1000, 0.03, 'square', 0.1);
    },

    // Urgent timer
    urgentTick() {
      playTone(1500, 0.06, 'square', 0.2);
      playTone(1200, 0.06, 'square', 0.15, 0.08);
    },

    // Player join
    playerJoin() {
      playTone(660, 0.1, 'sine', 0.2);
      playTone(880, 0.15, 'sine', 0.2, 0.08);
    },

    // Game start
    gameStart() {
      const notes = [440, 554, 660, 880];
      notes.forEach((f, i) => playTone(f, 0.15, 'triangle', 0.2, i * 0.08));
    },

    // Starting bell / siren
    startingBell() {
      if (!enabled) return;
      // Three ascending bell tones then a long ring
      playTone(800, 0.3, 'sine', 0.25);
      playTone(800, 0.3, 'sine', 0.25, 0.5);
      playTone(800, 0.3, 'sine', 0.25, 1.0);
      // Long sustained bell
      playTone(1200, 0.8, 'sine', 0.35, 1.5);
      playTone(1200, 0.8, 'triangle', 0.15, 1.5);
      // Crowd roar (noise burst)
      setTimeout(() => playNoise(1.5, 0.12), 1800);
    },

    // Horse race gallop — continuous loop
    gallop() {
      if (!enabled) return;
      this._gallopActive = true;
      const doGallop = () => {
        if (!this._gallopActive || !enabled) return;
        for (let i = 0; i < 25; i++) {
          playTone(120 + Math.random() * 60, 0.035, 'square', 0.08, i * 0.12);
          playTone(180 + Math.random() * 40, 0.025, 'square', 0.05, i * 0.12 + 0.05);
        }
        setTimeout(doGallop, 3000);
      };
      doGallop();
    },

    stopGallop() {
      this._gallopActive = false;
    },

    // Horse race finish — trumpet fanfare
    raceFinish() {
      this._gallopActive = false;
      if (!enabled) return;
      // Bugle call
      const notes = [392, 523, 659, 784, 659, 784, 1047];
      const durs = [0.15, 0.15, 0.15, 0.3, 0.15, 0.15, 0.5];
      let t = 0;
      notes.forEach((f, i) => {
        playTone(f, durs[i], 'sawtooth', 0.15, t);
        playTone(f * 2, durs[i] * 0.5, 'sine', 0.05, t);
        t += durs[i] + 0.05;
      });
      // Crowd cheer
      setTimeout(() => playNoise(2, 0.1), 600);
    },

    // Spoken race commentary via Web Speech API
    speak(text) {
      if (!enabled || !text) return;
      if (!('speechSynthesis' in window)) return;
      // Cancel any ongoing speech
      speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.1;
      utter.pitch = 0.9;
      utter.volume = 0.8;
      // Try to pick a male English voice
      const voices = speechSynthesis.getVoices();
      const preferred = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('male'))
        || voices.find(v => v.lang.startsWith('en-GB'))
        || voices.find(v => v.lang.startsWith('en'));
      if (preferred) utter.voice = preferred;
      speechSynthesis.speak(utter);
    },

    stopSpeech() {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    },

    // Poker fold
    fold() {
      playTone(300, 0.15, 'sine', 0.15);
      playTone(250, 0.2, 'sine', 0.1, 0.1);
    },

    // Background music from MP3 file
    startMusic() {
      if (!enabled || musicPlaying) return;
      musicPlaying = true;

      if (!this._musicEl) {
        this._musicEl = new Audio('/audio/music.mp3');
        this._musicEl.loop = true;
        this._musicEl.volume = 0.15;
      }
      this._musicEl.play().catch(() => {});
    },

    stopMusic() {
      musicPlaying = false;
      if (this._musicEl) {
        this._musicEl.pause();
      }
    },
  };
})();
