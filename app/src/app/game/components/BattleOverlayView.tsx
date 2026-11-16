import { CSSProperties, FormEvent, useEffect, useState } from "react";

import { Side } from "app/core/types";
import { css } from "app/ui/store";

import { COLORS } from "../ui";
import {
    BattleInfo,
    BattleStep,
    battleStore,
    Combatant,
} from "./BattleOverlay";
import "./BattleOverlay.css";

const SIDES: Side[] = ["attacker", "defender"];
const fmt = (n: number) => n.toLocaleString("en-US");

export function BattleOverlayView() {
    const { info, step, seq, onAnswer } = battleStore.use();
    if (!info) return null;

    return (
        <div className="battle-dim">
            <div className="battle-box" key={info.targetName}>
                <Header info={info} />
                <div className="battle-body" key={seq}>
                    <Step info={info} step={step} onAnswer={onAnswer} />
                </div>
            </div>
        </div>
    );
}

function Step({
    info,
    step,
    onAnswer,
}: {
    info: BattleInfo;
    step: BattleStep;
    onAnswer: ((v: number) => void) | null;
}) {
    switch (step.kind) {
        case "header":
            return null;
        case "announce":
            return (
                <div
                    className="battle-announce"
                    style={{ color: css(step.color) }}
                >
                    {step.text}
                </div>
            );
        case "mcq":
            return <Mcq info={info} step={step} onAnswer={onAnswer} />;
        case "numeric":
            return <Numeric info={info} step={step} onAnswer={onAnswer} />;
        case "numericReveal":
            return <NumericReveal info={info} step={step} />;
    }
}

function Header({ info }: { info: BattleInfo }) {
    const {
        attacker,
        defender,
        targetName,
        isCapital,
        capitalHp,
        chainIndex,
        walled,
    } = info;
    let sub = `Battle for ${targetName}`;
    if (isCapital)
        sub += `  ·  Capital siege — battle ${chainIndex}, ${capitalHp} shield${
            capitalHp === 1 ? "" : "s"
        } left`;
    if (walled) sub += "  ·  Walled";
    return (
        <header className="battle-header">
            <div className="battle-versus">
                <span style={{ color: css(attacker.color) }}>
                    {attacker.name}
                </span>
                <span>⚔</span>
                <span style={{ color: css(defender.color) }}>
                    {defender.name}
                </span>
            </div>
            <div
                className="battle-sub"
                style={{
                    color: css(isCapital ? COLORS.gold : COLORS.mutedText),
                }}
            >
                {sub}
            </div>
        </header>
    );
}

function Question({
    text,
    category,
    phase,
}: {
    text: string;
    category?: string;
    phase: string;
}) {
    return (
        <>
            <div className="battle-meta">
                {phase}
                {category ? `  ·  ${category}` : ""}
            </div>
            <div className="battle-question">{text}</div>
        </>
    );
}

type Of<K extends BattleStep["kind"]> = Extract<BattleStep, { kind: K }>;

function Mcq({
    info,
    step,
    onAnswer,
}: {
    info: BattleInfo;
    step: Of<"mcq">;
    onAnswer: ((v: number) => void) | null;
}) {
    const { question, picked, reveal } = step;

    useEffect(() => {
        if (!onAnswer) return;
        const onKey = (e: KeyboardEvent) => {
            const n = Number(e.key);
            if (n >= 1 && n <= question.options.length) onAnswer(n - 1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onAnswer, question.options.length]);

    const chosenBy = (i: number) =>
        reveal ? SIDES.filter((s) => reveal.answers[s]?.optionIndex === i) : [];

    return (
        <>
            <Question
                text={question.text}
                category={question.category}
                phase="Phase 1 · Multiple choice"
            />
            {!reveal && <Timer info={info} step={step} />}
            <div className="mcq-grid">
                {question.options.map((option, i) => {
                    let color = COLORS.button;
                    if (reveal) {
                        if (i === reveal.correctIndex) color = COLORS.correct;
                        else if (chosenBy(i).length) color = COLORS.wrong;
                        else color = COLORS.buttonDisabled;
                    } else if (picked === i) color = COLORS.buttonSelected;
                    else if (!onAnswer) color = COLORS.buttonDisabled;
                    return (
                        <button
                            key={i}
                            className="battle-button mcq-option"
                            style={{ "--bg": css(color) } as CSSProperties}
                            disabled={!onAnswer}
                            onClick={() => onAnswer?.(i)}
                        >
                            <span className="chips">
                                {chosenBy(i).map((s) => (
                                    <Chip key={s} who={info[s]} />
                                ))}
                            </span>
                            {i + 1}. {option}
                        </button>
                    );
                })}
            </div>
            {reveal && (
                <div className="battle-status">
                    {SIDES.map((s) => {
                        const idx = reveal.answers[s]?.optionIndex;
                        const result =
                            idx === null || idx === undefined
                                ? "No answer"
                                : idx === reveal.correctIndex
                                ? "Correct"
                                : "Wrong";
                        return `${info[s].name}: ${result}`;
                    }).join("    ·    ")}
                </div>
            )}
        </>
    );
}

function Numeric({
    info,
    step,
    onAnswer,
}: {
    info: BattleInfo;
    step: Of<"numeric">;
    onAnswer: ((v: number) => void) | null;
}) {
    const [value, setValue] = useState("");

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (value !== "") onAnswer?.(Number(value));
    };

    return (
        <>
            <Question
                text={step.question.text}
                category={step.question.category}
                phase="Phase 2 · Tie-breaker: closest answer wins, then fastest"
            />
            <Timer info={info} step={step} />
            <form className="numeric-form" onSubmit={submit}>
                <input
                    className="numeric-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus
                    placeholder={step.spectating ? "…" : "Your answer"}
                    disabled={!onAnswer}
                    value={value}
                    onChange={(e) =>
                        setValue(e.target.value.replace(/\D/g, "").slice(0, 9))
                    }
                />
                <button
                    className="battle-button"
                    style={
                        {
                            "--bg": css(
                                step.submitted
                                    ? COLORS.buttonSelected
                                    : onAnswer && value
                                    ? COLORS.button
                                    : COLORS.buttonDisabled
                            ),
                        } as CSSProperties
                    }
                    disabled={!onAnswer || value === ""}
                >
                    {step.submitted ? "Locked in" : "Submit"}
                </button>
            </form>
        </>
    );
}

function NumericReveal({
    info,
    step,
}: {
    info: BattleInfo;
    step: Of<"numericReveal">;
}) {
    const { correctValue, answers, winner } = step;
    return (
        <>
            <div className="numeric-correct">
                Correct answer: {fmt(correctValue)}
            </div>
            {SIDES.map((side) => {
                const who = info[side];
                const a = answers[side];
                const has = a && typeof a.value === "number";
                return (
                    <div
                        key={side}
                        className="numeric-row"
                        style={{
                            background: css(
                                side === winner ? 0x23402d : COLORS.panel
                            ),
                        }}
                    >
                        <Chip who={who} />
                        <div className="numeric-row-text">
                            <div style={{ color: css(who.color) }}>
                                {who.name}
                            </div>
                            <div className="muted">
                                {has
                                    ? `Answer ${fmt(a.value)}  ·  off by ${fmt(
                                          Math.abs(a.value - correctValue)
                                      )}  ·  ${(
                                          a.responseTimeMs / 1000
                                      ).toFixed(1)}s`
                                    : "No answer"}
                            </div>
                        </div>
                        {side === winner && (
                            <div className="numeric-win">WINS</div>
                        )}
                    </div>
                );
            })}
        </>
    );
}

/** Countdown bar plus opponent status, re-rendered every frame while running. */
function Timer({
    info,
    step,
}: {
    info: BattleInfo;
    step: Of<"mcq"> | Of<"numeric">;
}) {
    const elapsed = useElapsed(step.startedAt);
    const left = Math.max(0, 1 - elapsed / step.limitMs);
    const secs = Math.ceil((step.limitMs - elapsed) / 1000);
    const opponentDone =
        step.opponentResponseMs !== null && elapsed >= step.opponentResponseMs;

    return (
        <>
            <div className="timer-track">
                <div
                    className="timer-bar"
                    style={{
                        width: `${left * 100}%`,
                        background: css(
                            left > 0.33 ? COLORS.correct : COLORS.wrong
                        ),
                    }}
                />
            </div>
            <div className="battle-status muted">
                {step.spectating
                    ? `${info.attacker.name} and ${info.defender.name} are answering…`
                    : `${Math.max(0, secs)}s left  ·  Opponent ${
                          opponentDone ? "has answered" : "is thinking…"
                      }`}
            </div>
        </>
    );
}

function useElapsed(since: number): number {
    const [now, setNow] = useState(() => performance.now());
    useEffect(() => {
        let id = requestAnimationFrame(function tick(t) {
            setNow(t);
            id = requestAnimationFrame(tick);
        });
        return () => cancelAnimationFrame(id);
    }, []);
    return now - since;
}

function Chip({ who }: { who: Combatant }) {
    return (
        <span className="chip" style={{ background: css(who.color) }}>
            {who.name[0].toUpperCase()}
        </span>
    );
}
