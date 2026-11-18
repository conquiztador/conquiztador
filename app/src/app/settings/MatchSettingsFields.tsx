import { useEffect, useState } from "react";
import {
    POWER_UP_KINDS,
    POWER_UP_MODES,
    PowerUpMode,
    PowerUpSettings,
    ROOM_ROUNDS,
    ROUNDS_MAX,
    ROUNDS_MIN,
} from "@conquiztador/core";

import { useMessages } from "app/i18n";
import { POWER_UP_ICONS } from "app/game/powerUpRules";
import {
    isPresetRounds,
    parseRounds,
    powerUpProblem,
    toggleKind,
    withMode,
} from "./matchSettings";
import "./MatchSettings.css";

/**
 * Settings rows shared by the single-player lobby and room settings. Each
 * goes inside a `.mp-settings` grid (label, then control). Without
 * `onChange` they're read-only (room members who aren't the host).
 */

export function Choice<T extends string | number>({
    options,
    value,
    onChange,
}: {
    options: { value: T; label: string }[];
    value: T;
    /** Omit for read-only. */
    onChange?: (value: T) => void;
}) {
    return (
        <div className="mp-choice">
            {options.map((o) => (
                <button
                    type="button"
                    key={String(o.value)}
                    className={o.value === value ? "selected" : ""}
                    disabled={!onChange}
                    onClick={() => onChange?.(o.value)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

/** Rounds: the presets, or any whole number in range. */
export function RoundsField({
    rounds,
    onChange,
    onValidChange,
}: {
    rounds: number;
    onChange?: (rounds: number) => void;
    /** Told whether the typed number is usable (to block submitting). */
    onValidChange?: (valid: boolean) => void;
}) {
    const m = useMessages();
    const presetLabels = [m.lobby.short, m.lobby.standard, m.lobby.long];
    const [text, setText] = useState(String(rounds));
    // Follow changes from outside (presets, the host's edits) unless the
    // field already says the same number.
    useEffect(() => {
        setText((t) => (parseRounds(t) === rounds ? t : String(rounds)));
    }, [rounds]);
    const valid = parseRounds(text) !== null;
    useEffect(() => onValidChange?.(valid), [valid, onValidChange]);

    const choose = (n: number) => {
        setText(String(n));
        onChange?.(n);
    };
    return (
        <div className="ms-rounds">
            <Choice<number>
                options={ROOM_ROUNDS.map((n, i) => ({
                    value: n,
                    label: presetLabels[i](n),
                }))}
                value={valid && isPresetRounds(rounds) ? rounds : -1}
                onChange={onChange && choose}
            />
            <label
                className={`ms-custom${
                    valid && !isPresetRounds(rounds) ? " selected" : ""
                }`}
            >
                <span>{m.settings.custom}</span>
                <input
                    type="number"
                    inputMode="numeric"
                    min={ROUNDS_MIN}
                    max={ROUNDS_MAX}
                    step={1}
                    value={text}
                    disabled={!onChange}
                    aria-invalid={!valid}
                    onChange={(e) => {
                        setText(e.target.value);
                        const n = parseRounds(e.target.value);
                        if (n !== null && n !== rounds) onChange?.(n);
                    }}
                    onBlur={() => !valid && setText(String(rounds))}
                />
            </label>
            {!valid && (
                <span className="ms-error">
                    {m.settings.roundsRange(ROUNDS_MIN, ROUNDS_MAX)}
                </span>
            )}
        </div>
    );
}

/** Power-up supply mode (with a hint) and the kinds in play. */
export function PowerUpFields({
    settings,
    onChange,
}: {
    settings: PowerUpSettings;
    onChange?: (settings: PowerUpSettings) => void;
}) {
    const m = useMessages();
    const off = settings.mode === "none";
    const problem = powerUpProblem(settings);
    return (
        <>
            <span>{m.settings.powerUps}</span>
            <div className="ms-powerups">
                <select
                    value={settings.mode}
                    disabled={!onChange}
                    onChange={(e) =>
                        onChange?.(
                            withMode(settings, e.target.value as PowerUpMode)
                        )
                    }
                >
                    {POWER_UP_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                            {m.powerUps.modes[mode]}
                        </option>
                    ))}
                </select>
                <span className="ms-hint">
                    {m.powerUps.modeHints[settings.mode]}
                </span>
            </div>
            {!off && (
                <>
                    <span>{m.settings.powerUpKinds}</span>
                    <div className="ms-kinds">
                        {POWER_UP_KINDS.map((kind) => (
                            <label
                                key={kind}
                                className="ms-kind"
                                title={m.powerUps.descriptions[kind]}
                            >
                                <input
                                    type="checkbox"
                                    checked={settings.kinds.includes(kind)}
                                    // At least one kind stays in play.
                                    disabled={
                                        !onChange ||
                                        (settings.kinds.length === 1 &&
                                            settings.kinds[0] === kind)
                                    }
                                    onChange={() =>
                                        onChange?.(toggleKind(settings, kind))
                                    }
                                />
                                <span className="ms-kind-icon">
                                    {POWER_UP_ICONS[kind]}
                                </span>
                                <span className="ms-kind-text">
                                    <b>{m.powerUps.names[kind]}</b>
                                    <span className="ms-hint">
                                        {m.powerUps.descriptions[kind]}
                                    </span>
                                </span>
                            </label>
                        ))}
                        {problem && (
                            <span className="ms-error">
                                {m.settings.needKind}
                            </span>
                        )}
                    </div>
                </>
            )}
        </>
    );
}
