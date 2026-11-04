// Music and sound effects, all made in the browser from plucked strings, oscillators and noise, so
// there are no audio files to load. Browsers only allow sound after the player clicks or presses a
// key, so nothing is built or played before then.
(function (root) {
'use strict';
const STORE_KEY = 'tf.sound';
const prefs = { music: .6, sfx: .7, muted: false };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(STORE_KEY)) || {}); } catch (e) { /* storage is optional */ }
const savePrefs = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch (e) { /* storage is optional */ } };

const freq = m => 440 * 2 ** ((m - 69) / 12);
const seeded = s => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

let ctx = null, bus = null, bank = null;
let scene = { region: 0, boss: false };

// ---------------------------------------------------------------- sound sources made once
// A plucked string (Karplus-Strong): a burst of noise circulating in a short delay that loses a
// little of its brightness on every pass, which is how a real string dies away.
function pluckBuffer(c, secs, decay, soft, seed) {
  const sr = c.sampleRate, n = Math.floor(sr * secs), buf = c.createBuffer(1, n, sr), d = buf.getChannelData(0);
  const p = Math.round(sr / 220), line = new Float32Array(p), r = seeded(seed);
  let last = 0, mean = 0;
  for (let i = 0; i < p; i++) { last += (r() * 2 - 1 - last) * soft; line[i] = last; mean += last / p; }
  for (let i = 0; i < p; i++) line[i] -= mean;
  let j = 0, prev = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    const x = line[j];
    d[i] = x; peak = Math.max(peak, Math.abs(x));
    line[j] = (x + prev) * .5 * decay;
    prev = x;
    j = (j + 1) % p;
  }
  const fade = Math.floor(n * .08);
  for (let i = 0; i < n; i++) d[i] = d[i] / peak * Math.min(1, (n - i) / fade);
  return buf;
}
function noiseBuffer(c, secs, seed) {
  const n = Math.floor(c.sampleRate * secs), buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0), r = seeded(seed);
  for (let i = 0; i < n; i++) d[i] = r() * 2 - 1;
  return buf;
}
// A short recording of an imaginary stone hall, which is what gives everything its space.
function hallBuffer(c, secs) {
  const n = Math.floor(c.sampleRate * secs), buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch), r = seeded(77 + ch);
    let low = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n, env = (1 - t) ** 3.2 * Math.min(1, i / (c.sampleRate * .012));
      low += (r() * 2 - 1 - low) * (.55 - t * .4);
      d[i] = low * env;
    }
  }
  return buf;
}
function build(c) {
  const master = c.createGain(), limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -9; limiter.ratio.value = 12; limiter.attack.value = .004; limiter.release.value = .18;
  master.connect(limiter); limiter.connect(c.destination);
  const music = c.createGain(), sfx = c.createGain(), verbIn = c.createGain(), verb = c.createConvolver(), verbOut = c.createGain();
  music.connect(master); sfx.connect(master);
  verb.buffer = hallBuffer(c, 2.6);
  verbIn.connect(verb); verb.connect(verbOut); verbOut.gain.value = .42; verbOut.connect(master);
  bus = { master, music, sfx, verb: verbIn };
  bank = {
    harp: pluckBuffer(c, 3.6, .9968, .62, 11),
    lute: pluckBuffer(c, 2, .9925, .8, 23),
    noise: noiseBuffer(c, 3, 5),
    base: c.sampleRate / (Math.round(c.sampleRate / 220) + .5),
  };
  applyLevels(0);
}
function applyLevels(glide = .12) {
  if (!bus) return;
  const t = ctx.currentTime;
  const set = (p, v) => { p.cancelScheduledValues(t); p.setTargetAtTime(v, t, Math.max(.001, glide)); };
  set(bus.master.gain, prefs.muted ? 0 : 1);
  set(bus.music.gain, prefs.music * 1.75);
  set(bus.sfx.gain, prefs.sfx * 2);
}

// ---------------------------------------------------------------- small building blocks
function out(node, gain, pan, send, dest) {
  const g = ctx.createGain(), p = ctx.createStereoPanner();
  g.gain.value = gain; p.pan.value = pan;
  node.connect(g); g.connect(p); p.connect(dest);
  if (send) { const s = ctx.createGain(); s.gain.value = send; p.connect(s); s.connect(bus.verb); }
  return g;
}
function envelope(param, t, peak, attack, hold, release) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setValueAtTime(peak, t + attack + hold);
  param.exponentialRampToValueAtTime(.0005, t + attack + hold + release);
}
function pluck(buffer, m, t, gain, pan, send, dest, cutoff) {
  const s = ctx.createBufferSource(); s.buffer = buffer; s.playbackRate.value = freq(m) / bank.base;
  let last = s;
  if (cutoff) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; s.connect(f); last = f; }
  out(last, gain, pan, send, dest);
  s.start(t);
}
function noiseAt(t, dur, type, from, to, q, peak, pan, send, dest) {
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = bank.noise; s.loop = true;
  f.type = type; f.Q.value = q; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  envelope(g.gain, t, 1, .004, dur * .2, dur * .8);
  s.connect(f); f.connect(g);
  out(g, peak, pan, send, dest);
  s.start(t, (t * 7.3) % 2.5, dur + .1);
}
function tone(t, dur, type, from, to, peak, pan, send, dest, attack = .003) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(from, t);
  if (to !== from) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  envelope(g.gain, t, 1, attack, 0, dur);
  o.connect(g);
  out(g, peak, pan, send, dest);
  o.start(t); o.stop(t + attack + dur + .02);
}

// ---------------------------------------------------------------- instruments
const harp = (m, t, vel = 1, pan = 0) => pluck(bank.harp, m, t, .21 * vel, pan, .34, bus.music, 3400);
const lute = (m, t, vel = 1) => pluck(bank.lute, m, t, .27 * vel, -.16, .22, bus.music, 2600);
function flute(m, t, dur, vel = 1) {
  const f = freq(m), o = ctx.createOscillator(), over = ctx.createOscillator(), vib = ctx.createOscillator(), vibAmount = ctx.createGain();
  const body = ctx.createGain(), overGain = ctx.createGain(), tone_ = ctx.createBiquadFilter();
  o.type = 'triangle'; o.frequency.value = f; over.type = 'sine'; over.frequency.value = f * 2;
  // Vibrato comes in only after the note has settled, as a player's would.
  vib.frequency.value = 5.1; vibAmount.gain.setValueAtTime(0, t); vibAmount.gain.linearRampToValueAtTime(f * .0055, t + Math.min(.5, dur * .6));
  vib.connect(vibAmount); vibAmount.connect(o.frequency);
  overGain.gain.value = .14; over.connect(overGain); overGain.connect(body); o.connect(body);
  tone_.type = 'lowpass'; tone_.frequency.value = 3000; body.connect(tone_);
  const amp = ctx.createGain(); tone_.connect(amp);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(1, t + .07);
  amp.gain.setTargetAtTime(.74, t + .07, .25);
  amp.gain.setValueAtTime(.74, t + Math.max(.08, dur - .04));
  amp.gain.exponentialRampToValueAtTime(.0005, t + dur + .16);
  out(amp, .075 * vel, .2, .62, bus.music);
  for (const n of [o, over, vib]) { n.start(t); n.stop(t + dur + .2); }
  noiseAt(t, Math.min(.14, dur), 'bandpass', f * 1.6, f * 1.2, 1.2, .012 * vel, .2, .3, bus.music);
}
function pad(chord, t, dur) {
  const lp = ctx.createBiquadFilter(), amp = ctx.createGain();
  lp.type = 'lowpass'; lp.Q.value = .3; lp.frequency.setValueAtTime(420, t); lp.frequency.linearRampToValueAtTime(680, t + dur * .55); lp.frequency.linearRampToValueAtTime(400, t + dur);
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(1, t + .9);
  amp.gain.setValueAtTime(1, t + dur - .3);
  amp.gain.linearRampToValueAtTime(0, t + dur + .9);
  lp.connect(amp);
  out(amp, .05, 0, .5, bus.music);
  for (const m of chord.slice(0, 3)) for (const d of [-5, 6]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq(m); o.detune.value = d;
    o.connect(lp); o.start(t); o.stop(t + dur + 1);
  }
}
function bassNote(m, t) {
  const lp = ctx.createBiquadFilter(), o = ctx.createOscillator(), g = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = 420;
  o.type = 'triangle'; o.frequency.value = freq(m);
  envelope(g.gain, t, 1, .008, .02, 1);
  o.connect(lp); lp.connect(g);
  out(g, .26, 0, .08, bus.music);
  o.start(t); o.stop(t + 1.1);
}
function drum(t, vel = 1, pan = 0) {
  tone(t, .3, 'sine', 118, 52, .27 * vel, pan, .2, bus.music);
  noiseAt(t, .035, 'lowpass', 1100, 500, .5, .05 * vel, pan, .2, bus.music);
}
function taiko(t, vel = 1) {
  tone(t, .55, 'sine', 92, 40, .5 * vel, 0, .55, bus.music);
  noiseAt(t, .05, 'lowpass', 900, 300, .7, .1 * vel, 0, .4, bus.music);
}
function horn(m, t, dur, vel = 1) {
  const lp = ctx.createBiquadFilter(), amp = ctx.createGain();
  lp.type = 'lowpass'; lp.Q.value = 1.1;
  lp.frequency.setValueAtTime(180, t); lp.frequency.linearRampToValueAtTime(760, t + .16); lp.frequency.linearRampToValueAtTime(380, t + dur);
  envelope(amp.gain, t, 1, .1, dur - .1, .4);
  lp.connect(amp);
  out(amp, .1 * vel, 0, .6, bus.music);
  for (const d of [-7, 4, 11]) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq(m); o.detune.value = d;
    o.connect(lp); o.start(t); o.stop(t + dur + .5);
  }
}

// ---------------------------------------------------------------- the score
// An original piece in a lilting 6/8, in the old minor mode with its falling cadence. It runs 16
// bars at a time through six arrangements, about two and a half minutes before it repeats, and
// each region of the map plays it in its own key.
const EIGHTH = .25, BAR = 6, BARS = 16;
const DM = [50, 57, 62, 65], C = [48, 55, 60, 64], BB = [46, 53, 58, 62], A = [45, 52, 57, 61], F = [41, 48, 53, 57], GM = [43, 50, 55, 58];
const CHORDS = [DM, C, BB, A, DM, F, C, A, BB, F, GM, DM, BB, C, A, DM];
const R = null;
// [note, length in eighths], one line per bar.
const THEME_A = [
  [69, 2], [74, 1], [77, 2], [76, 1],
  [76, 2], [74, 1], [72, 3],
  [74, 2], [72, 1], [70, 2], [69, 1],
  [69, 3], [R, 1], [73, 1], [76, 1],
  [77, 3], [76, 1], [74, 2],
  [72, 2], [69, 1], [72, 3],
  [76, 2], [79, 1], [76, 1], [74, 1], [72, 1],
  [69, 5], [R, 1],
  [74, 2], [77, 1], [74, 2], [70, 1],
  [72, 3], [69, 3],
  [70, 2], [74, 1], [79, 2], [77, 1],
  [77, 1], [76, 1], [74, 4],
  [77, 2], [74, 1], [70, 3],
  [76, 2], [72, 1], [67, 3],
  [69, 2], [73, 1], [76, 2], [79, 1],
  [77, 2], [76, 1], [74, 3],
];
const THEME_B = [
  [77, 3], [74, 3],
  [76, 3], [72, 3],
  [74, 3], [70, 3],
  [73, 3], [69, 3],
  [69, 2], [74, 1], [77, 3],
  [81, 3], [77, 3],
  [79, 2], [76, 1], [72, 3],
  [76, 6],
  [77, 3], [74, 3],
  [72, 2], [77, 1], [81, 3],
  [79, 2], [77, 1], [74, 3],
  [69, 6],
  [74, 2], [70, 1], [77, 3],
  [76, 2], [79, 1], [76, 3],
  [73, 2], [76, 1], [81, 3],
  [74, 6],
];
const timed = theme => { let at = 0; return theme.flatMap(([m, len]) => { const e = m === R ? [] : [[at, m, len]]; at += len; return e; }); };
const LINE_A = timed(THEME_A), LINE_B = timed(THEME_B);
const FIGURES = { full: [0, 1, 2, 3, 2, 1], turn: [0, 2, 1, 3, 1, 2], open: [0, R, 2, R, 3, R] };
const PASSES = [
  { figure: 'full' },
  { figure: 'full', lead: 'flute', line: LINE_A },
  { figure: 'full', bass: true, drums: true, lead: 'lute', line: LINE_A, shift: -12 },
  { figure: 'turn', bass: true, drums: true, lead: 'flute', line: LINE_B },
  { figure: 'open', lead: 'lute', line: LINE_B, soft: true },
  { figure: 'open', soft: true },
];
const REGION_KEY = [0, 2, -2, 3, -5];

let passIndex = 0, stepInPass = 0, keyNow = 0, nextT = 0, timer = null, wind = null, jitter = seeded(909);
function scoreStep(t) {
  const pass = PASSES[passIndex], i = stepInPass, beat = i % BAR, bar = Math.floor(i / BAR), key = keyNow, chord = CHORDS[bar];
  const up = m => m + key, boss = scene.boss;
  const figure = FIGURES[boss ? 'full' : pass.figure], tone_ = figure[beat];
  if (tone_ !== R) {
    const accent = beat === 0 ? 1 : beat === 3 ? .82 : .66;
    harp(up(chord[tone_]), t + (jitter() - .5) * .012, (pass.soft ? .78 : 1) * accent * (.92 + jitter() * .16), (tone_ - 1.5) * .22);
  }
  if (beat === 0 && bar % 2 === 0 && !boss) pad([up(chord[0]), up(chord[1]), up(chord[3])], t, EIGHTH * BAR * 2);
  if (pass.bass || boss) { if (beat === 0) bassNote(up(chord[0] - 12), t); else if (beat === 3 && bar % 2 === 1) bassNote(up(chord[1] - 12), t); }
  if (pass.drums && !boss) { if (beat === 0) drum(t, .85); else if (beat === 3) drum(t, .5, -.1); else if (beat === 5 && bar % 4 === 3) drum(t, .4, .1); }
  if (boss) {
    if (beat === 0) taiko(t, 1); else if (beat === 3) taiko(t, .72); else if (beat === 5) taiko(t, .5);
    if (beat === 0 && bar % 2 === 0) horn(up(chord[0] - 12), t, EIGHTH * BAR * 1.6);
  }
  if (pass.line) for (const [at, m, len] of pass.line) if (at === i) {
    const note = up(m + (pass.shift || 0));
    if (pass.lead === 'flute') flute(note, t, len * EIGHTH * .94);
    else lute(note, t, pass.soft ? .7 : 1);
  }
  stepInPass++;
  if (stepInPass >= BARS * BAR) {
    stepInPass = 0;
    passIndex = (passIndex + 1) % PASSES.length;
    keyNow = REGION_KEY[scene.region] || 0;
  }
}
function startWind() {
  const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), lfo = ctx.createOscillator(), lfoAmount = ctx.createGain(), swell = ctx.createOscillator(), swellAmount = ctx.createGain(), g = ctx.createGain();
  s.buffer = bank.noise; s.loop = true;
  bp.type = 'bandpass'; bp.frequency.value = 460; bp.Q.value = .8;
  lfo.frequency.value = .07; lfoAmount.gain.value = 170; lfo.connect(lfoAmount); lfoAmount.connect(bp.frequency);
  g.gain.value = .017; swell.frequency.value = .11; swellAmount.gain.value = .008; swell.connect(swellAmount); swellAmount.connect(g.gain);
  s.connect(bp); bp.connect(g); g.connect(bus.music);
  s.start(); lfo.start(); swell.start();
  return { stop: () => { for (const n of [s, lfo, swell]) n.stop(); } };
}
function schedule() {
  if (!ctx || ctx.state !== 'running') return;
  // A long stall, such as a sleeping laptop, skips ahead instead of playing everything at once.
  if (nextT < ctx.currentTime) nextT = ctx.currentTime + .1;
  while (nextT < ctx.currentTime + .8) { scoreStep(nextT); nextT += EIGHTH; }
}

// ---------------------------------------------------------------- sound effects
const quiet = {};
function allowed(name, gapMs) {
  const now = performance.now();
  if (quiet[name] && now - quiet[name] < gapMs) return false;
  quiet[name] = now;
  return true;
}
const chord = (notes, t, gap, vel, pan = 0) => notes.forEach((m, i) => pluck(bank.harp, m, t + i * gap, .3 * vel, pan, .5, bus.sfx, 5200));
const EFFECTS = {
  hit(t, p) { tone(t, .07, 'triangle', 190 + Math.random() * 40, 90, .13, p, .05, bus.sfx); noiseAt(t, .04, 'bandpass', 1500 + Math.random() * 500, 800, 1, .09, p, .05, bus.sfx); },
  crit(t, p) { tone(t, .12, 'triangle', 170, 62, .24, p, .15, bus.sfx); noiseAt(t, .07, 'bandpass', 2200, 700, .9, .18, p, .15, bus.sfx); tone(t, .18, 'square', 1320 + Math.random() * 120, 1180, .018, p, .4, bus.sfx); },
  slash(t, p) { noiseAt(t, .13, 'bandpass', 3400, 800, 1.4, .11, p, .15, bus.sfx); },
  claw(t, p) { noiseAt(t, .1, 'bandpass', 2100, 1000, 2, .1, p, .1, bus.sfx); tone(t, .09, 'triangle', 150, 80, .12, p, .05, bus.sfx); },
  arrow(t, p) { pluck(bank.lute, 76 + Math.random() * 3, t, .09, p, .1, bus.sfx, 4200); noiseAt(t + .015, .15, 'highpass', 2400, 5200, .7, .03, p, .1, bus.sfx); },
  bolt(t, p) { tone(t, .24, 'sawtooth', 280, 1250, .022, p, .4, bus.sfx); tone(t, .24, 'sine', 560, 1500, .05, p, .4, bus.sfx); noiseAt(t, .1, 'highpass', 3400, 6000, 1, .025, p, .3, bus.sfx); },
  orb(t, p) { tone(t, .3, 'sine', 160, 430, .09, p, .4, bus.sfx); noiseAt(t, .3, 'bandpass', 520, 1700, 1.2, .06, p, .35, bus.sfx); },
  boom(t, p) { tone(t, .5, 'sine', 96, 34, .4, p, .4, bus.sfx); noiseAt(t, .32, 'lowpass', 1500, 180, .6, .2, p, .4, bus.sfx); },
  heal(t, p) { chord([84, 88, 91], t, .07, .34, p); },
  fall(t) { tone(t, 1.3, 'sine', 70, 28, .5, 0, .6, bus.sfx); noiseAt(t, .9, 'lowpass', 1100, 90, .5, .22, 0, .6, bus.sfx); chord([50, 45, 38], t + .05, .14, .7); },
  level(t) { chord([74, 77, 81, 86], t, .07, .62); },
  bossDown(t) { chord([62, 69, 74, 77, 81, 86], t, .085, .8); tone(t, 1.2, 'triangle', freq(62), freq(62), .08, 0, .6, bus.sfx, .08); tone(t + .17, 1.2, 'triangle', freq(69), freq(69), .06, 0, .6, bus.sfx, .08); },
  wipe(t) { [57, 53, 50].forEach((m, i) => tone(t + i * .24, .55, 'triangle', freq(m), freq(m) * .98, .09, 0, .55, bus.sfx, .03)); },
  chest(t) { tone(t, .08, 'square', 118, 74, .05, 0, .1, bus.sfx); noiseAt(t, .06, 'bandpass', 700, 300, 2, .12, 0, .1, bus.sfx); noiseAt(t + .1, .05, 'bandpass', 900, 480, 2, .08, 0, .15, bus.sfx); },
  loot(t, p, grade = 0) {
    const notes = [74, 79, 81, 86, 88, 93, 98, 100].slice(0, Math.min(8, 2 + grade));
    chord(notes, t + .12, Math.max(.05, .09 - grade * .005), .36 + grade * .05);
  },
  coin(t) { tone(t, .11, 'square', 1975, 1975, .012, .1, .25, bus.sfx); tone(t + .07, .22, 'square', 2637, 2637, .012, .1, .3, bus.sfx); },
  burn(t) { noiseAt(t, 1, 'lowpass', 300, 3000, .7, .13, 0, .6, bus.sfx); tone(t, 1.1, 'sine', 62, 40, .4, 0, .5, bus.sfx); chord([62, 69, 74, 81], t + .45, .11, .8); },
};
const GAPS = { hit: 65, crit: 90, slash: 90, claw: 90, arrow: 90, bolt: 110, orb: 130, boom: 150, heal: 240, coin: 150, loot: 90 };
function fx(name, pan = 0, arg) {
  if (!ctx || ctx.state !== 'running' || prefs.muted || prefs.sfx <= 0) return;
  const play = EFFECTS[name];
  if (!play || !allowed(name, GAPS[name] || 60)) return;
  play(ctx.currentTime + .004, Math.max(-.7, Math.min(.7, pan)), arg);
}

// ---------------------------------------------------------------- starting and stopping
function unlock() {
  try {
    if (!ctx) {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx({ latencyHint: 'playback' });
      build(ctx);
      wind = startWind();
      keyNow = REGION_KEY[scene.region] || 0;
      nextT = ctx.currentTime + .25;
      timer = setInterval(schedule, 250);
    }
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
  } catch (e) { /* the game plays on in silence */ }
}
// Sound stops with the tab, so a game left running in the background never surprises anyone.
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend(); else { ctx.resume(); nextT = 0; }
});
const firstTouch = () => { unlock(); removeEventListener('pointerdown', firstTouch, true); removeEventListener('keydown', firstTouch, true); };
addEventListener('pointerdown', firstTouch, true);
addEventListener('keydown', firstTouch, true);

// Renders a stretch of the score without playing it, so its levels can be measured in a test.
async function renderPreview(seconds, at = {}) {
  const live = { ctx, bus, bank, passIndex, stepInPass, keyNow, nextT, scene };
  const c = new OfflineAudioContext(2, Math.ceil(44100 * seconds), 44100);
  ctx = c; build(c); startWind();
  scene = { region: at.region || 0, boss: !!at.boss };
  passIndex = at.pass || 0; stepInPass = 0; keyNow = REGION_KEY[scene.region] || 0;
  for (let t = .05; t < seconds - .2; t += EIGHTH) scoreStep(t);
  if (at.effects) for (const [name, when, arg] of at.effects) EFFECTS[name](when, 0, arg);
  const rendered = await c.startRendering();
  ({ ctx, bus, bank, passIndex, stepInPass, keyNow, nextT, scene } = live);
  return rendered;
}

root.Sound = {
  fx, renderPreview,
  scene(region, boss) { scene = { region: region || 0, boss: !!boss }; },
  get prefs() { return { ...prefs }; },
  get running() { return !!ctx && ctx.state === 'running'; },
  setMusic(v) { prefs.music = v; savePrefs(); applyLevels(); },
  setSfx(v) { prefs.sfx = v; savePrefs(); applyLevels(); },
  setMuted(v) { prefs.muted = !!v; savePrefs(); unlock(); applyLevels(); },
};
void timer; void wind;
})(typeof window !== 'undefined' ? window : globalThis);
