// ── TV Casino - Audio Engine ─────────────────────────────────────────────
// Uses Web Audio API for synthesized casino sounds - no external files needed

const CasinoAudio = (() => {
  let ctx = null;
  let enabled = true;
  let musicGain = null;
  let sfxGain = null;
  let musicOsc = null;
  let musicPlaying = false;

  // Pre-load TTS voices (Chrome loads them async)
  let ttsVoices = [];
  let ttsReady = false;
  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    ttsVoices = speechSynthesis.getVoices();
    if (ttsVoices.length > 0) {
      ttsReady = true;
    }
  }
  // Load immediately and on voiceschanged event
  if (typeof window !== 'undefined') {
    loadVoices();
    if ('speechSynthesis' in window) {
      speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }
  }

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

    // Starting bugle — plays the real MP3
    startingBell() {
      if (!enabled) return;
      if (!this._bugleEl) {
        this._bugleEl = new Audio('/audio/bugle.mp3');
        this._bugleEl.volume = 0.7;
      }
      this._bugleEl.currentTime = 0;
      this._bugleEl.play().catch(() => {});
    },

    // Horse race gallop — uses MP3 loop with Web Audio API fallback
    gallop() {
      if (!enabled) return;
      this._gallopActive = true;

      // Try MP3 first
      if (!this._gallopEl) {
        this._gallopEl = new Audio('/audio/gallop.mp3');
        this._gallopEl.loop = true;
        this._gallopEl.volume = 0.5;
      }
      this._gallopEl.currentTime = 0;
      this._gallopEl.play().catch(() => {
        // Fallback to synthesized gallop
        this._gallopSynth();
      });
    },

    // Synthesized gallop fallback
    _gallopSynth() {
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
      if (this._gallopEl) {
        this._gallopEl.pause();
        this._gallopEl.currentTime = 0;
      }
    },

    // Crowd ambience — builds with race excitement
    _crowdSource: null,
    _crowdGain: null,
    startCrowd() {
      if (!enabled) return;
      const c = getCtx();
      // Generate crowd noise buffer (2 seconds, looped)
      const bufferSize = c.sampleRate * 2;
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        // Crowd noise — bandpassed random noise with rhythmic modulation
        data[i] = (Math.random() * 2 - 1) * (0.5 + 0.5 * Math.sin(i / (c.sampleRate * 0.3)));
      }
      this._crowdSource = c.createBufferSource();
      this._crowdSource.buffer = buffer;
      this._crowdSource.loop = true;
      this._crowdGain = c.createGain();
      this._crowdGain.gain.value = 0.03; // Start quiet
      const filter = c.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 800;
      filter.Q.value = 0.5;
      this._crowdSource.connect(filter);
      filter.connect(this._crowdGain);
      this._crowdGain.connect(sfxGain);
      this._crowdSource.start();
    },

    setCrowdIntensity(level) {
      // level 0-1, ramps crowd volume
      if (this._crowdGain) {
        const target = 0.02 + level * 0.15;
        this._crowdGain.gain.setTargetAtTime(target, getCtx().currentTime, 0.3);
      }
    },

    stopCrowd() {
      if (this._crowdSource) {
        try { this._crowdSource.stop(); } catch(e) {}
        this._crowdSource = null;
      }
      this._crowdGain = null;
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

    // Spoken race commentary — Web Speech API with audio fallback for Fire TV
    speak(text) {
      if (!enabled || !text) return;

      // Try Web Speech API first
      if ('speechSynthesis' in window && ttsReady) {
        speechSynthesis.cancel();
        setTimeout(() => {
          try {
            const utter = new SpeechSynthesisUtterance(text);
            utter.rate = 1.15;
            utter.pitch = 0.85;
            utter.volume = 0.9;
            const voices = ttsVoices.length > 0 ? ttsVoices : speechSynthesis.getVoices();
            const preferred = voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('male'))
              || voices.find(v => v.lang === 'en-AU')
              || voices.find(v => v.lang === 'en-GB')
              || voices.find(v => v.lang.startsWith('en-'))
              || voices.find(v => v.lang.startsWith('en'));
            if (preferred) utter.voice = preferred;
            utter.onerror = () => this._speakViaAudio(text); // fallback on error
            speechSynthesis.speak(utter);
            let keepAlive = setInterval(() => {
              if (!speechSynthesis.speaking) { clearInterval(keepAlive); return; }
              speechSynthesis.pause();
              speechSynthesis.resume();
            }, 10000);
            utter.onend = () => clearInterval(keepAlive);
          } catch (e) {
            this._speakViaAudio(text);
          }
        }, 100);
      } else {
        // No speechSynthesis (Fire TV, etc) — use server TTS proxy
        this._speakViaAudio(text);
      }
    },

    // Audio element fallback — streams TTS from server proxy
    _speakViaAudio(text) {
      if (!enabled || !text) return;
      if (this._ttsAudio) {
        this._ttsAudio.pause();
        this._ttsAudio = null;
      }
      const audio = new Audio(`/api/tts?text=${encodeURIComponent(text.substring(0, 200))}`);
      audio.volume = 0.9;
      audio.play().catch(() => {});
      this._ttsAudio = audio;
    },

    stopSpeech() {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      if (this._ttsAudio) { this._ttsAudio.pause(); this._ttsAudio = null; }
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
