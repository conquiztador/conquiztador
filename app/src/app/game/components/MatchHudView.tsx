import { playerName, useMessages } from "app/i18n";
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
                <div className="hud-message">{message(m)}</div>
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
                <div className="hud-message">{message(m)}</div>
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
