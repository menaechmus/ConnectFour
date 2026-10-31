// Sound effects, made on the spot with the Web Audio API so the game ships no
// audio files. Every effect is built from two ingredients, as in Cribbage: a
// burst of filtered noise (the click of plastic) and a short tone (the knock
// of a disc landing, a chime). The fanfare for a win is a brass ensemble of its
// own, in fanfare.js.

import { playFanfare } from './fanfare.js';

const noiseByContext = new WeakMap();

function noiseFor(context) {
  let buffer = noiseByContext.get(context);
  if (!buffer) {
    buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    noiseByContext.set(context, buffer);
  }
  return buffer;
}

// Fades a gain node in fast and out by `at + length`.
function shape(level, at, length, gain) {
  level.gain.setValueAtTime(0.0001, at);
  level.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.004, length / 3));
  level.gain.exponentialRampToValueAtTime(0.0001, at + length);
}

// `sweep` slides the pitch over the burst: above 1 rises; below 1 falls, like
// a disc landing.
function burst(context, at, { length, pitch, sweep = 1, gain }) {
  const source = context.createBufferSource();
  source.buffer = noiseFor(context);
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(pitch, at);
  filter.frequency.exponentialRampToValueAtTime(pitch * sweep, at + length);
  const level = context.createGain();
  shape(level, at, length, gain);
  source.connect(filter).connect(level).connect(context.destination);
  source.start(at, Math.random() * 0.5, length + 0.01);
}

function tone(context, at, { length, pitch, glide = 1, gain, wave = 'sine' }) {
  const oscillator = context.createOscillator();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(pitch, at);
  oscillator.frequency.exponentialRampToValueAtTime(pitch * glide, at + length);
  const level = context.createGain();
  shape(level, at, length, gain);
  oscillator.connect(level).connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + length + 0.01);
}

const EFFECTS = {
  // A disc landing in its column: a click, and a knock from the hollow board.
  drop(context, at) {
    burst(context, at, { length: 0.035, pitch: 2100, sweep: 0.55, gain: 0.8 });
    tone(context, at, { length: 0.09, pitch: 310, glide: 0.65, gain: 0.3, wave: 'triangle' });
  },

  // A disc lifted back out: a light click.
  place(context, at) {
    burst(context, at, { length: 0.03, pitch: 2600, sweep: 1.3, gain: 0.5 });
  },

  // The discs falling out of the bottom of the board: a clatter of plastic.
  clear(context, at) {
    for (let i = 0; i < 16; i++) {
      const start = i * 0.022 + Math.random() * 0.02;
      burst(context, at + start, { length: 0.024, pitch: 1700 + Math.random() * 1500, sweep: 0.6, gain: 0.26 + Math.random() * 0.3 });
    }
  },

  // A game won, in a match that goes on: three rising notes.
  chime(context, at) {
    [659, 784, 1046].forEach((pitch, i) => tone(context, at + i * 0.1, { length: i === 2 ? 0.42 : 0.2, pitch, gain: 0.17, wave: 'triangle' }));
  },

  // A full board with no winner: two level notes, going nowhere.
  draw(context, at) {
    [440, 440].forEach((pitch, i) => tone(context, at + i * 0.2, { length: 0.24, pitch, gain: 0.14, wave: 'triangle' }));
  },

  // About three seconds of brass and timpani, then the hall's ring.
  win(context, at) {
    playFanfare(context, at, noiseFor(context));
  },

  // A firework bursting: a soft thump and bang, then a scatter of crackles.
  firework(context, at) {
    tone(context, at, { length: 0.2, pitch: 110, glide: 0.45, gain: 0.25 });
    burst(context, at, { length: 0.16, pitch: 900, sweep: 0.4, gain: 0.4 });
    for (let i = 0; i < 7; i++) {
      burst(context, at + 0.12 + Math.random() * 0.4, { length: 0.012, pitch: 4000 + Math.random() * 2500, gain: 0.15 + Math.random() * 0.15 });
    }
  },

  // Your turn, in a Wi-Fi game: two soft notes, up a fourth.
  turn(context, at) {
    tone(context, at, { length: 0.16, pitch: 784, gain: 0.16, wave: 'triangle' });
    tone(context, at + 0.13, { length: 0.34, pitch: 1046, gain: 0.16, wave: 'triangle' });
  },

  lose(context, at) {
    [392, 330, 262].forEach((pitch, i) => tone(context, at + i * 0.14, { length: 0.32, pitch, gain: 0.2, wave: 'triangle' }));
  },
};

export const SOUNDS = Object.keys(EFFECTS);

// Schedules one effect on any audio context; the tests use an offline one.
export function renderSound(name, context, at = context.currentTime) {
  EFFECTS[name](context, at);
}

let context = null;
let muted = false;
let waking = false;

export function setMuted(value) {
  muted = value;
}

// Browsers only let a page make sound after a tap or key press, so this is
// called from every one of those.
export function unlockSound() {
  if (muted || !window.AudioContext) return;
  context ??= new AudioContext();
  if (context.state === 'running' || waking) return;
  waking = true;
  context
    .resume()
    .catch(() => {})
    .then(() => {
      waking = false;
    });
}

export function playSound(name, delay = 0) {
  // A suspended context would hoard sounds and play them all at once on waking.
  if (muted || !context || (context.state !== 'running' && !waking)) return;
  try {
    renderSound(name, context, context.currentTime + delay);
  } catch {
    // Sound is decoration: a browser that cannot make it must not stop the game.
  }
}
