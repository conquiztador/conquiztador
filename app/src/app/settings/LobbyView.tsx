import { FormEvent, useState } from "react";
import { Difficulty } from "@conquiztador/core";

import { useMessages } from "app/i18n";
import { createStore } from "app/ui/store";
import { LobbySettings, powerUpProblem, sanitizeLobby } from "./matchSettings";
import { Choice, PowerUpFields, RoundsField } from "./MatchSettingsFields";
import "app/multiplayer/Multiplayer.css";

const STORAGE_KEY = "conquiztador.lobby";

/** Last used lobby settings (tolerates old or broken stored values). */
export function loadLobbySettings(): LobbySettings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return sanitizeLobby(raw ? JSON.parse(raw) : null);
    } catch {
        return sanitizeLobby(null);
    }
}

function saveLobbySettings(settings: LobbySettings) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Not remembered this time.
    }
}

export interface LobbyViewState {
    visible: boolean;
    onStart: (settings: LobbySettings) => void;
    onBack: () => void;
}

export const lobbyStore = createStore<LobbyViewState>({
    visible: false,
    onStart: () => undefined,
    onBack: () => undefined,
});

/** Single-player match setup: opponents, difficulty, length, power-ups. */
export function LobbyView() {
    const { visible } = lobbyStore.use();
    if (!visible) return null;
    return <LobbyForm />;
}

function LobbyForm() {
    const m = useMessages();
    const [settings, setSettings] = useState(loadLobbySettings);
    const [roundsValid, setRoundsValid] = useState(true);
    const update = (patch: Partial<LobbySettings>) => {
        const next = { ...settings, ...patch };
        setSettings(next);
        saveLobbySettings(next);
    };
    const canStart = roundsValid && powerUpProblem(settings.powerUps) === null;

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (!canStart) return;
        saveLobbySettings(settings);
        lobbyStore.get().onStart(settings);
    };

    return (
        <div className="mp">
            <form className="mp-panel mp-form" onSubmit={submit}>
                <h2>{m.lobby.title}</h2>
                <div className="mp-settings">
                    <span>{m.lobby.opponents}</span>
                    <Choice<number>
                        options={[1, 2, 3, 4].map((n) => ({
                            value: n,
                            label: `${n}`,
                        }))}
                        value={settings.opponents}
                        onChange={(opponents) => update({ opponents })}
                    />
                    <span>{m.lobby.difficulty}</span>
                    <Choice<Difficulty>
                        options={[
                            { value: Difficulty.Easy, label: m.lobby.easy },
                            { value: Difficulty.Medium, label: m.lobby.medium },
                            { value: Difficulty.Hard, label: m.lobby.hard },
                        ]}
                        value={settings.difficulty}
                        onChange={(difficulty) => update({ difficulty })}
                    />
                    <span>{m.lobby.rounds}</span>
                    <RoundsField
                        rounds={settings.rounds}
                        onChange={(rounds) => update({ rounds })}
                        onValidChange={setRoundsValid}
                    />
                    <span>{m.lobby.startingCapital}</span>
                    <Choice<LobbySettings["placement"]>
                        options={[
                            { value: "draft", label: m.lobby.choose },
                            { value: "random", label: m.lobby.random },
                        ]}
                        value={settings.placement}
                        onChange={(placement) => update({ placement })}
                    />
                    <PowerUpFields
                        settings={settings.powerUps}
                        onChange={(powerUps) => update({ powerUps })}
                    />
                </div>
                <div className="mp-actions">
                    <button
                        type="button"
                        className="mp-button"
                        onClick={() => lobbyStore.get().onBack()}
                    >
                        {m.lobby.back}
                    </button>
                    <button
                        type="submit"
                        className="mp-button primary"
                        disabled={!canStart}
                    >
                        {m.lobby.start}
                    </button>
                </div>
            </form>
        </div>
    );
}
