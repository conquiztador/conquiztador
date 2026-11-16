/**
 * Procedural sound effects via the Web Audio API — no audio assets needed.
 * Each effect is a few oscillator/noise notes with short envelopes.
 */

type Wave = OscillatorType;

interface Note {
    freq: number;
    /** Glide target; omit for a steady pitch. */
    to?: number;
    at?: number;
    dur: number;
    wave?: Wave;
    gain?: number;
}

const MUTE_KEY = "conquiztador.muted";

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = readMuted();
const muteListeners = new Set<(muted: boolean) => void>();

function readMuted(): boolean {
    try {
        return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
        return false;
    }
}

function audio(): AudioContext | null {
    if (typeof AudioContext === "undefined") return null;
    if (!ctx) {
        ctx = new AudioContext();
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.35;
        master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
}

// Browsers only allow audio after a user gesture; unlock on the first one.
if (typeof window !== "undefined") {
    const unlock = () => {
        audio();
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
}

function play(notes: Note[]) {
    const ac = audio();
    if (!ac || !master || muted) return;
    const t0 = ac.currentTime + 0.01;
    for (const n of notes) {
        const start = t0 + (n.at ?? 0);
        const end = start + n.dur;
        const osc = ac.createOscillator();
        const env = ac.createGain();
        osc.type = n.wave ?? "triangle";
        osc.frequency.setValueAtTime(n.freq, start);
        if (n.to) osc.frequency.exponentialRampToValueAtTime(n.to, end);
        const peak = n.gain ?? 0.5;
        env.gain.setValueAtTime(0.0001, start);
        env.gain.exponentialRampToValueAtTime(peak, start + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(env).connect(master);
        osc.start(start);
        osc.stop(end + 0.02);
    }
}

function noise(dur: number, gain = 0.4, at = 0) {
    const ac = audio();
    if (!ac || !master || muted) return;
    const buffer = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++)
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = ac.createBufferSource();
    const filter = ac.createBiquadFilter();
    const env = ac.createGain();
    src.buffer = buffer;
    filter.type = "lowpass";
    filter.frequency.value = 900;
    env.gain.value = gain;
    src.connect(filter).connect(env).connect(master);
    src.start(ac.currentTime + 0.01 + at);
}

/** Major arpeggio starting at `root` Hz. */
const arpeggio = (root: number, step = 0.09, wave: Wave = "square") =>
    [1, 1.26, 1.5, 2].map((m, i) => ({
        freq: root * m,
        at: i * step,
        dur: i === 3 ? 0.45 : 0.14,
        wave,
        gain: 0.25,
    }));

export const sfx = {
    click: () => play([{ freq: 660, dur: 0.06, wave: "square", gain: 0.15 }]),
    select: () =>
        play([{ freq: 440, to: 880, dur: 0.12, wave: "triangle", gain: 0.3 }]),
    battleStart: () => {
        noise(0.35, 0.5);
        play([
            { freq: 196, dur: 0.18, wave: "sawtooth", gain: 0.2 },
            { freq: 262, at: 0.16, dur: 0.35, wave: "sawtooth", gain: 0.2 },
        ]);
    },
    announce: () =>
        play([
            { freq: 523, dur: 0.12, wave: "square", gain: 0.2 },
            { freq: 784, at: 0.1, dur: 0.25, wave: "square", gain: 0.2 },
        ]),
    tick: () => play([{ freq: 1200, dur: 0.04, wave: "square", gain: 0.12 }]),
    lockIn: () =>
        play([{ freq: 330, to: 660, dur: 0.1, wave: "triangle", gain: 0.3 }]),
    correct: () =>
        play([
            { freq: 784, dur: 0.1, gain: 0.35 },
            { freq: 1047, at: 0.09, dur: 0.25, gain: 0.35 },
        ]),
    wrong: () =>
        play([{ freq: 220, to: 150, dur: 0.35, wave: "sawtooth", gain: 0.2 }]),
    /** Neutral reveal while spectating bot battles. */
    reveal: () => play([{ freq: 587, dur: 0.18, gain: 0.25 }]),
    conquer: () => {
        noise(0.4, 0.4);
        play(arpeggio(392));
    },
    defeat: () =>
        play([
            { freq: 392, dur: 0.22, wave: "sawtooth", gain: 0.18 },
            { freq: 330, at: 0.2, dur: 0.22, wave: "sawtooth", gain: 0.18 },
            { freq: 262, at: 0.4, dur: 0.5, wave: "sawtooth", gain: 0.18 },
        ]),
    impact: () => {
        noise(0.5, 0.6);
        play([{ freq: 110, to: 55, dur: 0.4, wave: "sine", gain: 0.6 }]);
    },
    victory: () =>
        play([
            ...arpeggio(523, 0.12),
            ...arpeggio(784, 0.12).map((n) => ({ ...n, at: n.at + 0.55 })),
        ]),
    gameLost: () =>
        play([
            { freq: 294, dur: 0.4, wave: "triangle", gain: 0.3 },
            { freq: 277, at: 0.4, dur: 0.4, wave: "triangle", gain: 0.3 },
            { freq: 262, at: 0.8, dur: 0.9, wave: "triangle", gain: 0.3 },
        ]),
};

export function isMuted(): boolean {
    return muted;
}

export function setMuted(value: boolean): void {
    muted = value;
    try {
        localStorage.setItem(MUTE_KEY, value ? "1" : "0");
    } catch {
        // Storage unavailable (private mode): keep the in-memory setting.
    }
    if (master) master.gain.value = value ? 0 : 0.35;
    muteListeners.forEach((fn) => fn(value));
}

export function onMuteChange(fn: (muted: boolean) => void): () => void {
    muteListeners.add(fn);
    return () => muteListeners.delete(fn);
}
