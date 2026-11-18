import type { PowerUpKind } from "@conquiztador/core";

import { useMessages } from "app/i18n";

import {
    canUsePowerUp,
    POWER_UP_ICONS,
    PowerUpMoment,
    QUESTION_POWER_UPS,
    QuestionAids,
    TURN_POWER_UPS,
} from "../powerUpRules";
import { powerUpStore, toastStore } from "./PowerUps";
import "./PowerUps.css";

/**
 * HUD power-up bar: your charges of every kind in play. Fortify and Scout
 * are used from here on your turn; the question aids are used in the battle
 * overlay (the HUD is dimmed during battles).
 */
export function HudPowerUps() {
    const m = useMessages();
    const pu = powerUpStore.use();
    if (!pu.enabled.length || !pu.charges) return null;

    const moment: PowerUpMoment = pu.target
        ? { kind: "target", ...pu.target }
        : { kind: "none" };
    const check = { charges: pu.charges, moment, pending: pu.pending !== null };

    return (
        <div className="pu-hud">
            <div className="pu-bar" aria-label={m.hud.powerUps}>
                {pu.enabled.map((kind) => {
                    const turnKind = TURN_POWER_UPS.includes(kind);
                    const cancel = kind === "fortify" && pu.fortifying;
                    const usable =
                        turnKind &&
                        (cancel ||
                            (!pu.fortifying && canUsePowerUp(kind, check)));
                    return (
                        <PowerUpButton
                            key={kind}
                            kind={kind}
                            count={pu.charges[kind]}
                            enabled={usable}
                            active={cancel}
                            label={cancel ? m.powerUps.cancel : undefined}
                            onClick={() => pu.onUse(kind)}
                        />
                    );
                })}
            </div>
            {pu.scouted && (
                <div className="pu-scouted">
                    {POWER_UP_ICONS.scout}{" "}
                    {m.powerUps.scouted(
                        pu.scouted.category ?? m.powerUps.noCategory
                    )}
                </div>
            )}
        </div>
    );
}

/** The aids for the question on screen (inside the battle overlay). */
export function BattlePowerUps({
    question,
    answering,
    aids,
}: {
    question: "mcq" | "numeric";
    answering: boolean;
    aids: QuestionAids;
}) {
    const pu = powerUpStore.use();
    const kinds = QUESTION_POWER_UPS[question].filter((k) =>
        pu.enabled.includes(k)
    );
    if (!kinds.length || !pu.charges) return null;
    const check = {
        charges: pu.charges,
        moment: { kind: question, answering, aids } as PowerUpMoment,
        pending: pu.pending !== null,
    };
    return (
        <div className="pu-battle">
            {kinds.map((kind) => (
                <PowerUpButton
                    key={kind}
                    kind={kind}
                    count={pu.charges[kind]}
                    enabled={canUsePowerUp(kind, check)}
                    onClick={() => pu.onUse(kind)}
                    showName
                />
            ))}
        </div>
    );
}

function PowerUpButton({
    kind,
    count,
    enabled,
    active = false,
    label,
    showName = false,
    onClick,
}: {
    kind: PowerUpKind;
    count: number;
    enabled: boolean;
    active?: boolean;
    /** Replaces the name (e.g. "Cancel"). */
    label?: string;
    /** Always show the name (otherwise CSS decides by layout). */
    showName?: boolean;
    onClick: () => void;
}) {
    const m = useMessages();
    const name = m.powerUps.names[kind];
    return (
        <button
            type="button"
            className={`pu-button${active ? " active" : ""}${
                count ? "" : " empty"
            }`}
            disabled={!enabled}
            onClick={onClick}
            title={`${name} — ${m.powerUps.descriptions[kind]}`}
            aria-label={`${label ?? name} (${count})`}
        >
            <span className="pu-icon">
                {active ? "✕" : POWER_UP_ICONS[kind]}
            </span>
            <span className={`pu-name${showName ? " shown" : ""}`}>
                {label ?? name}
            </span>
            {!active && <span className="pu-count">{count}</span>}
        </button>
    );
}

/** Short news over the match: uses, earned power-ups, rejected uses. */
export function PowerUpToast() {
    const m = useMessages();
    const { text, id } = toastStore.use();
    if (!text) return null;
    return (
        <div className="pu-toast" key={id} role="status">
            {text(m)}
        </div>
    );
}
