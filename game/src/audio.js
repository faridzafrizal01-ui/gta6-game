// Procedural WebAudio sound: no audio files, everything is synthesized.
// Engine hum, siren, gunshots, pickups, UI clicks and a low-key bass groove.
export class SoundManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenLfo = null;
    this.musicTimer = null;
    this.musicStep = 0;
    this.musicOn = false;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  _tone(freq, dur, type, vol, slideTo) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol || 0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g); g.connect(this.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }

  _noise(dur, vol, lowpass) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    let node = src;
    if (lowpass) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = lowpass;
      src.connect(f); node = f;
    }
    node.connect(g); g.connect(this.master);
    src.start(t0);
  }

  click() { this._tone(660, 0.07, 'square', 0.08); }
  pickup() { this._tone(880, 0.12, 'sine', 0.18); this._tone(1318, 0.18, 'sine', 0.14); }
  cash() { this._tone(1046, 0.1, 'triangle', 0.16); setTimeout(() => this._tone(1568, 0.16, 'triangle', 0.16), 90); }
  shoot() { this._noise(0.14, 0.5, 2800); this._tone(160, 0.1, 'square', 0.22, 60); }
  empty() { this._tone(220, 0.06, 'square', 0.1); }
  reload() { this._tone(500, 0.05, 'square', 0.1); setTimeout(() => this._tone(700, 0.05, 'square', 0.1), 120); }
  hit() { this._tone(180, 0.12, 'sawtooth', 0.2, 90); }
  crash() { this._noise(0.3, 0.4, 900); this._tone(90, 0.25, 'sawtooth', 0.25, 40); }
  mission() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._tone(f, 0.22, 'triangle', 0.2), i * 110)); }
  fail() { [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.3, 'sawtooth', 0.14), i * 160)); }
  phone() { this._tone(1200, 0.12, 'sine', 0.12); setTimeout(() => this._tone(1200, 0.12, 'sine', 0.12), 200); }

  engine(on, speed01) {
    if (!this.ctx) return;
    if (on && !this.engineOsc) {
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 60;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 420;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.0;
      this.engineOsc.connect(f); f.connect(this.engineGain); this.engineGain.connect(this.master);
      this.engineOsc.start();
    }
    if (this.engineOsc) {
      const target = on ? 0.05 + speed01 * 0.09 : 0;
      this.engineGain.gain.setTargetAtTime(this.muted ? 0 : target, this.ctx.currentTime, 0.1);
      this.engineOsc.frequency.setTargetAtTime(55 + speed01 * 130, this.ctx.currentTime, 0.08);
    }
  }

  siren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenOsc) {
      this.sirenOsc = this.ctx.createOscillator();
      this.sirenOsc.type = 'triangle';
      this.sirenOsc.frequency.value = 750;
      this.sirenLfo = this.ctx.createOscillator();
      this.sirenLfo.type = 'square';
      this.sirenLfo.frequency.value = 0.55;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 220;
      this.sirenLfo.connect(lfoGain); lfoGain.connect(this.sirenOsc.frequency);
      this.sirenGain = this.ctx.createGain();
      this.sirenGain.gain.value = 0.0;
      this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
      this.sirenOsc.start(); this.sirenLfo.start();
    }
    if (this.sirenGain) {
      this.sirenGain.gain.setTargetAtTime(on && !this.muted ? 0.045 : 0, this.ctx.currentTime, 0.2);
    }
  }

  startMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    // A slow minor-key bass groove: A1 / F1 / C2 / G1, one bar each, 100 BPM.
    const roots = [55, 43.65, 65.41, 49];
    const stepDur = 60 / 100 / 2;
    const playStep = () => {
      if (!this.musicOn) return;
      const step = this.musicStep++;
      const bar = Math.floor(step / 8) % 4;
      const root = roots[bar];
      if (step % 2 === 0 && !this.muted) {
        const t0 = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = root * (step % 8 === 6 ? 1.5 : 1);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.14, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + stepDur * 1.8);
        osc.connect(g); g.connect(this.master);
        osc.start(t0); osc.stop(t0 + stepDur * 2);
        if (step % 4 === 2) {
          const hat = this.ctx.createOscillator();
          hat.type = 'square'; hat.frequency.value = 6000;
          const hg = this.ctx.createGain();
          hg.gain.setValueAtTime(0.02, t0);
          hg.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
          hat.connect(hg); hg.connect(this.master);
          hat.start(t0); hat.stop(t0 + 0.06);
        }
      }
      this.musicTimer = setTimeout(playStep, stepDur * 1000);
    };
    playStep();
  }

  stopMusic() { this.musicOn = false; if (this.musicTimer) clearTimeout(this.musicTimer); }
}
