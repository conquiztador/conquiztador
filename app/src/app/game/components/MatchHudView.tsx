import { useEffect, useState } from "react";

import { Messages, playerName, useMessages } from "app/i18n";
import { css } from "app/ui/store";

import { COLORS } from "../ui";
import { HudPlayer, matchHud } from "./MatchHud";
import "./MatchHud.css";

/** Round, status message, standings and Quit, in real (unscaled) pixels. */
export function MatchHudView() {
    const {
        visible,
        round,
        rounds,
        message,
        deadline,
        players,
        layout,
        onQuit,
    } = matchHud.use();
    const m = useMessages();
    if (!visible) return null;

    const roundLabel = m.hud.round(Math.max(1, round), rounds);
    const quit = (
        <button className="hud-quit" onClick={onQuit}>
            {m.hud.quit}
        </button>
    );
    // The side column is too narrow to share its top row with the corner
    // controls, so there Quit moves to the bottom of the panel.
    const header = (
        <div className="hud-header">
            <span className="hud-round">{roundLabel}</span>
            {layout.kind === "top" && quit}
        </div>
    );
    const list = (
        <ul className="hud-players">
            {players.map((p) => (
                <Player key={p.id} player={p} />
            ))}
        </ul>
    );

    if (layout.kind === "side") {
        return (
            <aside className="hud hud-side" style={{ width: layout.width }}>
                {header}
                <Message text={message} deadline={deadline} />
                {list}
                <div className="hud-footer">{quit}</div>
            </aside>
        );
    }
    return (
        <>
            <header
                className="hud hud-top"
                style={{ height: layout.barHeight }}
            >
                {header}
                <Message text={message} deadline={deadline} />
            </header>
            <section
                className="hud hud-bottom"
                style={{ top: layout.playersTop }}
            >
                {list}
            </section>
        </>
    );
}

/** Status line, with the seconds left while it's your move. */
function Message({
    text,
    deadline,
}: {
    text: (m: Messages) => string;
    deadline: number | null;
}) {
    const m = useMessages();
    const [now, setNow] = useState(() => performance.now());
    useEffect(() => {
        if (deadline === null) return;
        const id = setInterval(() => setNow(performance.now()), 250);
        return () => clearInterval(id);
    }, [deadline]);
    const left =
        deadline === null
            ? null
            : Math.max(0, Math.ceil((deadline - now) / 1000));
    return (
        <div className="hud-message">
            {text(m)}
            {left !== null && (
                <span className={`hud-timer${left <= 5 ? " urgent" : ""}`}>
                    {m.status.secondsLeft(left)}
                </span>
            )}
        </div>
    );
}

function Player({ player: p }: { player: HudPlayer }) {
    const m = useMessages();
    return (
        <li
            className={`hud-player${p.active ? " active" : ""}${
                p.eliminated ? " eliminated" : ""
            }`}
        >
            <span className="hud-dot" style={{ background: css(p.color) }} />
            <span className="hud-name">
                {playerName(p)}
                {p.isBot && <span className="hud-bot"> 🤖</span>}
            </span>
            <span className="hud-stats">
                {p.eliminated ? (
                    <span style={{ color: css(COLORS.wrong) }}>
                        {m.hud.out}
                    </span>
                ) : (
                    <>
                        <span title={m.hud.regions}>⬢ {p.regions}</span>
                        <span className="hud-hp" title={m.hud.shields}>
                            {"♥".repeat(p.capitalHp)}
                        </span>
                    </>
                )}
            </span>
        </li>
    );
}
