import { CSSProperties, useEffect, useState } from "react";

import { Side } from "app/core/types";
import { formatNumber, Messages, playerName, useMessages } from "app/i18n";
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
const fmt = (n: number, options?: Intl.NumberFormatOptions) =>
    formatNumber(n, options);

/** A combatant's display name in the current language. */
const nameOf = (c: Combatant, m: Messages) =>
    c.id === null ? m.players.neutral : playerName({ id: c.id, name: c.name });

export function BattleOverlayView() {
    const { info, step, seq, onAnswer } = battleStore.use();
    if (!info) return null;

    return (
        <div className="battle-dim">
            <div className="battle-box" key={info.targetId}>
                <Header info={info} />
                <div className="battle-body" key={seq}>
                    <Step info={info} step={step} onAnswer={onAnswer} />
                </div>
            </div>
        </div>
    );
}

function Step(props: {
    info: BattleInfo;
    step: BattleStep;
    onAnswer: ((v: number) => void) | null;
}) {
    return <StepInner {...props} m={useMessages()} />;
}

function StepInner({
    info,
    step,
    onAnswer,
    m,
}: {
    info: BattleInfo;
    step: BattleStep;
    onAnswer: ((v: number) => void) | null;
    m: Messages;
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
                    {step.text(m)}
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
    const m = useMessages();
    const {
        attacker,
        defender,
        targetId,
        isCapital,
        capitalHp,
        chainIndex,
        walled,
    } = info;
    let sub = m.battle.battleFor(m.regions[targetId]);
    if (isCapital)
        sub += `  ·  ${m.battle.capitalSiege(chainIndex, capitalHp)}`;
    if (walled) sub += `  ·  ${m.battle.walled}`;
    return (
        <header className="battle-header">
            <div className="battle-versus">
                <span style={{ color: css(attacker.color) }}>
                    {nameOf(attacker, m)}
                </span>
                <span>⚔</span>
                <span style={{ color: css(defender.color) }}>
                    {nameOf(defender, m)}
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
    const m = useMessages();
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
                phase={m.battle.phaseMcq}
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
                                ? m.battle.noAnswer
                                : idx === reveal.correctIndex
                                ? m.battle.correct
                                : m.battle.wrong;
                        return `${nameOf(info[s], m)}: ${result}`;
                    }).join("    ·    ")}
                </div>
            )}
        </>
    );
}

const PAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];
const MAX_DIGITS = 9;

/**
 * Tie-breaker answer entry. Uses an on-screen number pad and a plain display
 * (not an <input>) so phones never open the system keyboard over the
 * question. Physical keyboards still work: digits, Backspace and Enter.
 */
function Numeric({
    info,
    step,
    onAnswer,
}: {
    info: BattleInfo;
    step: Of<"numeric">;
    onAnswer: ((v: number) => void) | null;
}) {
    const m = useMessages();
    const [value, setValue] = useState("");

    const press = (key: string) => {
        if (!onAnswer) return;
        if (key === "OK" || key === "Enter") {
            if (value !== "") onAnswer(Number(value));
        } else if (key === "⌫" || key === "Backspace") {
            setValue((v) => v.slice(0, -1));
        } else if (/^[0-9]$/.test(key)) {
            setValue((v) =>
                v.length >= MAX_DIGITS ? v : v === "0" ? key : v + key
            );
        }
    };

    // Re-subscribe when value changes so Enter submits the latest value.
    useEffect(() => {
        if (!onAnswer) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            press(e.key);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    const display = value ? fmt(Number(value)) : step.spectating ? "…" : "";

    return (
        <>
            <Question
                text={step.question.text}
                category={step.question.category}
                phase={m.battle.phaseNumeric}
            />
            <Timer info={info} step={step} />
            <div className="numeric-entry">
                <div className="numeric-side">
                    <div
                        className={`numeric-display${value ? "" : " empty"}`}
                        aria-live="polite"
                    >
                        {display || m.battle.yourAnswer}
                    </div>
                    <button
                        className="battle-button numeric-submit"
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
                        onClick={() => press("OK")}
                    >
                        {step.submitted ? m.battle.lockedIn : m.battle.submit}
                    </button>
                </div>
                <div className="numeric-pad">
                    {PAD_KEYS.map((k) => (
                        <button
                            key={k}
                            className="battle-button numeric-key"
                            style={
                                {
                                    "--bg": css(
                                        k === "OK"
                                            ? COLORS.buttonSelected
                                            : k === "⌫"
                                            ? COLORS.buttonDisabled
                                            : COLORS.button
                                    ),
                                } as CSSProperties
                            }
                            disabled={!onAnswer || (k === "OK" && !value)}
                            onClick={() => press(k)}
                            aria-label={
                                k === "⌫"
                                    ? m.battle.delete
                                    : k === "OK"
                                    ? m.battle.submit
                                    : k
                            }
                        >
                            {k}
                        </button>
                    ))}
                </div>
            </div>
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
    const m = useMessages();
    const { correctValue, answers, winner } = step;
    return (
        <>
            <div className="numeric-correct">
                {m.battle.correctAnswer(fmt(correctValue))}
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
                                {nameOf(who, m)}
                            </div>
                            <div className="muted">
                                {has
                                    ? m.battle.answerDetail(
                                          fmt(a.value),
                                          fmt(Math.abs(a.value - correctValue)),
                                          fmt(a.responseTimeMs / 1000, {
                                              minimumFractionDigits: 1,
                                              maximumFractionDigits: 1,
                                          })
                                      )
                                    : m.battle.noAnswer}
                            </div>
                        </div>
                        {side === winner && (
                            <div className="numeric-win">{m.battle.wins}</div>
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
    const m = useMessages();
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
                    ? m.battle.bothAnswering(
                          nameOf(info.attacker, m),
                          nameOf(info.defender, m)
                      )
                    : m.battle.timeLeft(Math.max(0, secs), opponentDone)}
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
    const m = useMessages();
    return (
        <span className="chip" style={{ background: css(who.color) }}>
            {nameOf(who, m)[0].toUpperCase()}
        </span>
    );
}
