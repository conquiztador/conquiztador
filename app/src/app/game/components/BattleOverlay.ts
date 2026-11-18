import {
    McqAnswer,
    NumericAnswer,
    PowerUpEffect,
    Side,
} from "@conquiztador/core";
import { sfx } from "app/audio/sfx";
import type { Messages } from "app/i18n";
import { createStore } from "app/ui/store";

import { COLORS, wait } from "../ui";
import { applyEffect, NO_AIDS, QuestionAids } from "../powerUpRules";

export interface Combatant {
    /** Player id, or null for the neutral defender. */
    id: string | null;
    /** Raw player name; the view localizes it. */
    name: string;
    color: number;
    isHuman: boolean;
}

export interface BattleInfo {
    attacker: Combatant;
    defender: Combatant;
    targetId: string;
    isCapital: boolean;
    capitalHp: number;
    chainIndex: number;
    walled: boolean;
}

export interface PublicMcq {
    text: string;
    category?: string;
    options: string[];
}

export interface PublicNumeric {
    text: string;
    category?: string;
}

/** Shared by both question kinds while the countdown runs. */
interface Timed {
    spectating: boolean;
    opponentResponseMs: number | null;
    /** Time to answer, without Extra Time (see `aids.bonusMs`). */
    limitMs: number;
    startedAt: number;
    /** Your power-ups on this question. */
    aids: QuestionAids;
}

/** Time to answer the question on screen, Extra Time included. */
export const answerLimitMs = (t: Timed) => t.limitMs + t.aids.bonusMs;

export type BattleStep =
    | { kind: "header" }
    | { kind: "announce"; text: (m: Messages) => string; color: number }
    | (Timed & {
          kind: "mcq";
          question: PublicMcq;
          picked: number | null;
          reveal: {
              correctIndex: number;
              answers: Partial<Record<Side, McqAnswer>>;
          } | null;
      })
    | (Timed & {
          kind: "numeric";
          question: PublicNumeric;
          submitted: boolean;
      })
    | {
          kind: "numericReveal";
          correctValue: number;
          answers: Partial<Record<Side, NumericAnswer>>;
          winner: Side;
      };

export interface BattleViewState {
    /** null while the overlay is closed. */
    info: BattleInfo | null;
    step: BattleStep;
    /** Bumped on every step change so the view can replay entry animations. */
    seq: number;
    /** Set while the human may answer the current question. */
    onAnswer: ((value: number) => void) | null;
}

export const battleStore = createStore<BattleViewState>({
    info: null,
    step: { kind: "header" },
    seq: 0,
    onAnswer: null,
});

/** Tick each second over the last few seconds of the countdown. */
const TICK_SECONDS = 3;

/**
 * Drives the battle modal (rendered by BattleOverlayView): shows who fights
 * whom, asks the human the question with a countdown, and reveals both
 * answers afterwards.
 */
export class BattleOverlay {
    private cleanup: (() => void)[] = [];
    private humanSide: Side | null = null;
    /** Re-arms the answer timeout after Extra Time, while one runs. */
    private retime: (() => void) | null = null;

    async open(info: BattleInfo) {
        this.stopInput();
        battleStore.set((s) => ({
            info,
            step: { kind: "header" },
            seq: s.seq + 1,
            onAnswer: null,
        }));
        sfx.battleStart();
        await wait(250);
    }

    close() {
        this.stopInput();
        battleStore.set((s) => ({ ...s, info: null, onAnswer: null }));
    }

    /** Big centred announcement inside the panel (e.g. siege chain). */
    async announce(
        text: (m: Messages) => string,
        color: number = COLORS.gold,
        ms = 1300,
        chime = true
    ) {
        this.setStep({ kind: "announce", text, color });
        if (chime) sfx.announce();
        await wait(300 + ms);
    }

    askMcq(
        question: PublicMcq,
        humanSide: Side | null,
        opponentResponseMs: number | null,
        timeLimitMs: number
    ): Promise<McqAnswer | null> {
        this.humanSide = humanSide;
        const timed = this.timed(humanSide, opponentResponseMs, timeLimitMs);
        this.setStep({
            kind: "mcq",
            question,
            picked: null,
            reveal: null,
            ...timed,
        });
        return this.runTimer(timed, (i) =>
            this.patchStep({ picked: i })
        ).then((r) =>
            r === null ? null : { optionIndex: r.value, responseTimeMs: r.ms }
        );
    }

    async revealMcq(
        correctIndex: number,
        answers: Partial<Record<Side, McqAnswer>>
    ) {
        this.stopInput();
        this.patchStep({ reveal: { correctIndex, answers } });
        if (!this.humanSide) sfx.reveal();
        else if (answers[this.humanSide]?.optionIndex === correctIndex)
            sfx.correct();
        else sfx.wrong();
        await wait(2200);
    }

    askNumeric(
        question: PublicNumeric,
        humanSide: Side | null,
        opponentResponseMs: number | null,
        timeLimitMs: number
    ): Promise<NumericAnswer | null> {
        this.humanSide = humanSide;
        const timed = this.timed(humanSide, opponentResponseMs, timeLimitMs);
        this.setStep({ kind: "numeric", question, submitted: false, ...timed });
        return this.runTimer(timed, () =>
            this.patchStep({ submitted: true })
        ).then((r) =>
            r === null ? null : { value: r.value, responseTimeMs: r.ms }
        );
    }

    async revealNumeric(
        correctValue: number,
        answers: Partial<Record<Side, NumericAnswer>>,
        winner: Side
    ) {
        this.stopInput();
        this.setStep({ kind: "numericReveal", correctValue, answers, winner });
        if (!this.humanSide) sfx.reveal();
        else if (winner === this.humanSide) sfx.correct();
        else sfx.wrong();
        await wait(2600);
    }

    /**
     * Shows what your power-up did to the question on screen (50/50, Range
     * Finder, Extra Time). Applying the same effect again changes nothing.
     */
    applyEffect(effect: PowerUpEffect) {
        const step = battleStore.get().step;
        if (step.kind !== "mcq" && step.kind !== "numeric") return;
        const aids = applyEffect(step.aids, effect, step.kind);
        if (aids === step.aids) return;
        this.patchStep({ aids });
        if (aids.bonusMs !== step.aids.bonusMs) this.retime?.();
    }

    /** A human opponent locked in their answer just now. */
    opponentAnswered() {
        const step = battleStore.get().step;
        if (step.kind !== "mcq" && step.kind !== "numeric") return;
        if (step.opponentResponseMs !== null) return;
        this.patchStep({
            opponentResponseMs: performance.now() - step.startedAt,
        });
    }

    // ------------------------------------------------------------ helpers

    private timed(
        humanSide: Side | null,
        opponentResponseMs: number | null,
        timeLimitMs: number
    ): Timed {
        const spectating = humanSide === null;
        return {
            spectating,
            opponentResponseMs,
            limitMs: timeLimitMs,
            startedAt: performance.now(),
            aids: NO_AIDS,
        };
    }

    /**
     * Resolves with the human's answer and response time, or null on
     * timeout / spectator mode.
     */
    private runTimer(
        timed: Timed,
        onPicked: (value: number) => void
    ): Promise<{ value: number; ms: number } | null> {
        return new Promise((resolve) => {
            let done = false;
            let timeout: ReturnType<typeof setTimeout>;
            let ticks: ReturnType<typeof setTimeout>[] = [];
            const finish = (value: number | null) => {
                if (done) return;
                done = true;
                clearTimeout(timeout);
                ticks.forEach(clearTimeout);
                if (this.retime === schedule) this.retime = null;
                battleStore.set((s) => ({ ...s, onAnswer: null }));
                if (value !== null) {
                    sfx.lockIn();
                    onPicked(value);
                }
                resolve(
                    value === null
                        ? null
                        : {
                              value,
                              ms: Math.round(
                                  performance.now() - timed.startedAt
                              ),
                          }
                );
            };
            /** (Re)arms the timeout and ticks for the current time limit. */
            const schedule = () => {
                clearTimeout(timeout);
                ticks.forEach(clearTimeout);
                const step = battleStore.get().step;
                const limit =
                    step.kind === "mcq" || step.kind === "numeric"
                        ? answerLimitMs(step)
                        : timed.limitMs;
                const left = timed.startedAt + limit - performance.now();
                timeout = setTimeout(() => finish(null), Math.max(0, left));
                ticks = timed.spectating
                    ? []
                    : Array.from(
                          { length: TICK_SECONDS },
                          (_, i) => left - (i + 1) * 1000
                      )
                          .filter((at) => at >= 0)
                          .map((at) => setTimeout(sfx.tick, at));
            };
            schedule();
            this.retime = schedule;
            this.cleanup.push(() => finish(null));
            if (!timed.spectating)
                battleStore.set((s) => ({ ...s, onAnswer: finish }));
        });
    }

    private setStep(step: BattleStep) {
        this.stopInput();
        battleStore.set((s) => ({ ...s, step, seq: s.seq + 1 }));
    }

    private patchStep(patch: Record<string, unknown>) {
        battleStore.set((s) => ({
            ...s,
            step: { ...s.step, ...patch } as BattleStep,
        }));
    }

    private stopInput() {
        const fns = this.cleanup;
        this.cleanup = [];
        fns.forEach((fn) => fn());
    }
}
