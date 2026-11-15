import * as PIXI from "pixi.js";

import { McqAnswer, NumericAnswer, Side } from "app/core/types";

import { Button, COLORS, label, panel, tween, wait, easeOutBack } from "../ui";

export interface Combatant {
    name: string;
    color: number;
    isHuman: boolean;
}

export interface BattleInfo {
    attacker: Combatant;
    defender: Combatant;
    targetName: string;
    isCapital: boolean;
    capitalHp: number;
    chainIndex: number;
    walled: boolean;
}

interface PublicMcq {
    text: string;
    category?: string;
    options: string[];
}

interface PublicNumeric {
    text: string;
    category?: string;
}

const W = 960;
const H = 600;

/**
 * Modal panel for a battle: shows who fights whom, asks the human the
 * question with a countdown, and reveals both answers afterwards.
 */
export class BattleOverlay extends PIXI.Container {
    private dim = new PIXI.Graphics();
    private box = new PIXI.Container();
    private content = new PIXI.Container();
    private info: BattleInfo;
    private cleanup: (() => void)[] = [];

    constructor(
        private ticker: PIXI.Ticker,
        private designWidth: number,
        private designHeight: number
    ) {
        super();
        this.dim
            .rect(-2000, -2000, designWidth + 4000, designHeight + 4000)
            .fill({ color: 0x000000, alpha: 0.55 });
        this.dim.eventMode = "static"; // block clicks to the map
        this.box.addChild(panel(W, H), this.content);
        this.box.pivot.set(W / 2, H / 2);
        this.box.position.set(designWidth / 2, designHeight / 2 + 20);
        this.addChild(this.dim, this.box);
        this.visible = false;
    }

    async open(info: BattleInfo) {
        this.info = info;
        this.visible = true;
        this.clear();
        this.drawHeader();
        this.box.scale.set(0.6);
        await tween(this.ticker, 250, (t) =>
            this.box.scale.set(0.6 + 0.4 * easeOutBack(t))
        );
    }

    close() {
        this.clear();
        this.visible = false;
    }

    /** Big centred announcement inside the panel (e.g. siege chain). */
    async announce(text: string, color: number = COLORS.gold, ms = 1300) {
        this.clear();
        this.drawHeader();
        const t = label(text, 40, color, {
            align: "center",
            wordWrap: true,
            wordWrapWidth: W - 80,
            stroke: { color: 0x000000, width: 5 },
        });
        t.anchor.set(0.5);
        t.position.set(W / 2, H / 2 + 20);
        this.content.addChild(t);
        await tween(this.ticker, 300, (p) =>
            t.scale.set(0.5 + 0.5 * easeOutBack(p))
        );
        await wait(ms);
    }

    // ------------------------------------------------------------ MCQ

    askMcq(
        question: PublicMcq,
        humanSide: Side | null,
        opponentResponseMs: number | null,
        timeLimitMs: number
    ): Promise<McqAnswer | null> {
        this.clear();
        this.drawHeader();
        this.drawQuestion(
            question.text,
            question.category,
            "Phase 1 · Multiple choice"
        );

        const buttons = question.options.map((option, i) => {
            const b = new Button(`${i + 1}. ${option}`, 430, 72, 22);
            b.position.set(
                W / 2 + (i % 2 === 0 ? -225 : 225),
                330 + Math.floor(i / 2) * 90
            );
            b.enabled = humanSide !== null;
            this.content.addChild(b);
            return b;
        });
        this.mcqButtons = buttons;

        return this.runTimer<number>(
            humanSide,
            opponentResponseMs,
            timeLimitMs,
            (finish) => {
                const choose = (i: number) => {
                    buttons.forEach((b, j) => {
                        b.enabled = false;
                        b.selected = i === j;
                    });
                    finish(i);
                };
                buttons.forEach((b, i) => b.onClick(() => choose(i)));
                this.onKey((key) => {
                    const n = Number(key);
                    if (n >= 1 && n <= buttons.length) choose(n - 1);
                });
            }
        ).then((r) =>
            r === null ? null : { optionIndex: r.value, responseTimeMs: r.ms }
        );
    }

    private mcqButtons: Button[] = [];
    private timerStatus: PIXI.Text | null = null;

    async revealMcq(
        correctIndex: number,
        answers: Partial<Record<Side, McqAnswer>>
    ) {
        this.stopInput();
        if (this.timerStatus) this.timerStatus.visible = false;
        this.mcqButtons.forEach((b, i) => {
            b.enabled = false;
            if (i === correctIndex) b.setColor(COLORS.correct);
        });
        for (const side of ["attacker", "defender"] as Side[]) {
            const a = answers[side];
            const who =
                side === "attacker" ? this.info.attacker : this.info.defender;
            const idx = a?.optionIndex;
            if (idx === null || idx === undefined || idx < 0) continue;
            const b = this.mcqButtons[idx];
            if (idx !== correctIndex) b.setColor(COLORS.wrong);
            const chip = this.chip(who);
            chip.position.set(
                b.x - b.buttonWidth / 2 + 6 + (side === "attacker" ? 0 : 22),
                b.y - b.buttonHeight / 2 - 8
            );
            this.content.addChild(chip);
        }
        this.drawAnswerSummary(
            ["attacker", "defender"].map((side: Side) => {
                const a = answers[side];
                const ok = a?.optionIndex === correctIndex;
                const timedOut =
                    a?.optionIndex === null || a?.optionIndex === undefined;
                return timedOut ? "No answer" : ok ? "Correct" : "Wrong";
            }) as [string, string]
        );
        await wait(2200);
    }

    // ------------------------------------------------------------ Numeric

    askNumeric(
        question: PublicNumeric,
        humanSide: Side | null,
        opponentResponseMs: number | null,
        timeLimitMs: number
    ): Promise<NumericAnswer | null> {
        this.clear();
        this.drawHeader();
        this.drawQuestion(
            question.text,
            question.category,
            "Phase 2 · Tie-breaker: closest answer wins, then fastest"
        );

        let value = "";
        const display = panel(300, 56, 0x0f1420, 1);
        display.position.set(W / 2 - 150, 250);
        const displayText = label("", 32);
        displayText.anchor.set(0.5);
        displayText.position.set(150, 28);
        display.addChild(displayText);
        this.content.addChild(display);

        const keys = [
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
            "⌫",
            "0",
            "OK",
        ];
        const keyButtons = keys.map((k, i) => {
            const b = new Button(k, 90, 52, 24);
            b.position.set(
                W / 2 - 100 + (i % 3) * 100,
                350 + Math.floor(i / 3) * 60
            );
            b.enabled = humanSide !== null;
            this.content.addChild(b);
            return b;
        });
        if (humanSide === null) displayText.text = "…";

        return this.runTimer<number>(
            humanSide,
            opponentResponseMs,
            timeLimitMs,
            (finish) => {
                const press = (k: string) => {
                    if (k === "OK" || k === "Enter") {
                        if (value === "") return;
                        keyButtons.forEach((b) => (b.enabled = false));
                        finish(Number(value));
                        return;
                    }
                    if (k === "⌫" || k === "Backspace")
                        value = value.slice(0, -1);
                    else if (/^[0-9]$/.test(k) && value.length < 9) {
                        value = value === "0" ? k : value + k;
                    }
                    displayText.text = value;
                };
                keyButtons.forEach((b, i) => b.onClick(() => press(keys[i])));
                this.onKey(press);
            }
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
        this.clear();
        this.drawHeader();

        const title = label(
            `Correct answer: ${correctValue.toLocaleString("en-US")}`,
            34,
            COLORS.gold
        );
        title.anchor.set(0.5);
        title.position.set(W / 2, 170);
        this.content.addChild(title);

        (["attacker", "defender"] as Side[]).forEach((side, i) => {
            const who =
                side === "attacker" ? this.info.attacker : this.info.defender;
            const a = answers[side];
            const has = a && typeof a.value === "number";
            const row = panel(
                760,
                90,
                side === winner ? 0x23402d : COLORS.panel,
                1
            );
            row.position.set(W / 2 - 380, 240 + i * 110);
            const chip = this.chip(who);
            chip.position.set(20, 33);
            const name = label(who.name, 24, who.color);
            name.position.set(56, 14);
            const detail = label(
                has
                    ? `Answer ${a.value.toLocaleString(
                          "en-US"
                      )}  ·  off by ${Math.abs(
                          a.value - correctValue
                      ).toLocaleString("en-US")}  ·  ${(
                          a.responseTimeMs / 1000
                      ).toFixed(1)}s`
                    : "No answer",
                20,
                COLORS.mutedText
            );
            detail.position.set(56, 50);
            row.addChild(chip, name, detail);
            if (side === winner) {
                const win = label("WINS", 26, COLORS.correct);
                win.anchor.set(1, 0.5);
                win.position.set(740, 45);
                row.addChild(win);
            }
            this.content.addChild(row);
        });
        await wait(2600);
    }

    // ------------------------------------------------------------ helpers

    /**
     * Shows the countdown and the opponent's status. Resolves with the human's
     * answer and response time, or null on timeout / spectator mode.
     */
    private runTimer<T>(
        humanSide: Side | null,
        opponentResponseMs: number | null,
        timeLimitMs: number,
        setupInput: (finish: (value: T) => void) => void
    ): Promise<{ value: T; ms: number } | null> {
        const barBg = new PIXI.Graphics()
            .roundRect(40, 210, W - 80, 10, 5)
            .fill(0x0f1420);
        const bar = new PIXI.Graphics();
        const status = label("", 18, COLORS.mutedText);
        status.anchor.set(0.5);
        status.position.set(W / 2, H - 28);
        this.content.addChild(barBg, bar, status);
        this.timerStatus = status;

        const spectating = humanSide === null;
        const limit = spectating ? 1800 : timeLimitMs;

        return new Promise((resolve) => {
            let elapsed = 0;
            let done = false;
            const finish = (value: T | null) => {
                if (done) return;
                done = true;
                this.ticker.remove(step);
                resolve(
                    value === null ? null : { value, ms: Math.round(elapsed) }
                );
            };

            const step = (tk: PIXI.Ticker) => {
                elapsed += tk.deltaMS;
                const left = Math.max(0, 1 - elapsed / limit);
                bar.clear()
                    .roundRect(40, 210, (W - 80) * left, 10, 5)
                    .fill(left > 0.33 ? COLORS.correct : COLORS.wrong);

                if (spectating) {
                    status.text = `${this.info.attacker.name} and ${this.info.defender.name} are answering…`;
                } else {
                    const opponentDone =
                        opponentResponseMs !== null &&
                        elapsed >= opponentResponseMs;
                    const secs = Math.ceil((limit - elapsed) / 1000);
                    status.text = `${secs}s left  ·  Opponent ${
                        opponentDone ? "has answered" : "is thinking…"
                    }`;
                }
                if (elapsed >= limit) finish(null);
            };
            this.ticker.add(step);
            this.cleanup.push(() => finish(null));
            if (!spectating) setupInput((v) => finish(v));
        });
    }

    private onKey(handler: (key: string) => void) {
        const listener = (e: KeyboardEvent) => handler(e.key);
        window.addEventListener("keydown", listener);
        this.cleanup.push(() =>
            window.removeEventListener("keydown", listener)
        );
    }

    private stopInput() {
        this.cleanup.forEach((fn) => fn());
        this.cleanup = [];
    }

    private clear() {
        this.stopInput();
        this.content
            .removeChildren()
            .forEach((c) => c.destroy({ children: true }));
    }

    private chip(who: Combatant): PIXI.Container {
        const c = new PIXI.Container();
        c.addChild(
            new PIXI.Graphics()
                .circle(10, 10, 11)
                .fill(who.color)
                .stroke({ width: 2, color: 0xffffff })
        );
        const letter = label(who.name[0].toUpperCase(), 13);
        letter.anchor.set(0.5);
        letter.position.set(10, 10);
        c.addChild(letter);
        return c;
    }

    private drawHeader() {
        const {
            attacker,
            defender,
            targetName,
            isCapital,
            capitalHp,
            chainIndex,
            walled,
        } = this.info;
        const a = label(attacker.name, 26, attacker.color, {
            stroke: { color: 0x000000, width: 3 },
        });
        const vs = label("⚔", 26, COLORS.text);
        const d = label(defender.name, 26, defender.color, {
            stroke: { color: 0x000000, width: 3 },
        });
        const totalWidth = a.width + vs.width + d.width + 40;
        let x = W / 2 - totalWidth / 2;
        for (const t of [a, vs, d]) {
            t.position.set(x, 22);
            x += t.width + 20;
        }

        let sub = `Battle for ${targetName}`;
        if (isCapital)
            sub += `  ·  Capital siege — battle ${chainIndex}, ${capitalHp} shield${
                capitalHp === 1 ? "" : "s"
            } left`;
        if (walled) sub += "  ·  Walled";
        const subText = label(
            sub,
            18,
            isCapital ? COLORS.gold : COLORS.mutedText
        );
        subText.anchor.set(0.5, 0);
        subText.position.set(W / 2, 62);
        this.content.addChild(a, vs, d, subText);
    }

    private drawQuestion(
        text: string,
        category: string | undefined,
        phase: string
    ) {
        const meta = label(
            `${phase}${category ? `  ·  ${category}` : ""}`,
            16,
            COLORS.mutedText
        );
        meta.anchor.set(0.5, 0);
        meta.position.set(W / 2, 98);
        const q = label(text, 26, COLORS.text, {
            align: "center",
            wordWrap: true,
            wordWrapWidth: W - 100,
        });
        q.anchor.set(0.5);
        q.position.set(W / 2, 162);
        this.content.addChild(meta, q);
    }

    private drawAnswerSummary([attacker, defender]: [string, string]) {
        const t = label(
            `${this.info.attacker.name}: ${attacker}    ·    ${this.info.defender.name}: ${defender}`,
            20
        );
        t.anchor.set(0.5);
        t.position.set(W / 2, H - 28);
        this.content.addChild(t);
    }
}
