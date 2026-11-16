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
    if (!visible) return null;

    const roundLabel = `Round ${Math.max(1, round)}/${rounds}`;
    const header = (
        <div className="hud-header">
            <span className="hud-round">{roundLabel}</span>
            <button className="hud-quit" onClick={onQuit}>
                Quit
            </button>
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
                <div className="hud-message">{message}</div>
                {list}
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
                <div className="hud-message">{message}</div>
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
    return (
        <li
            className={`hud-player${p.active ? " active" : ""}${
                p.eliminated ? " eliminated" : ""
            }`}
        >
            <span className="hud-dot" style={{ background: css(p.color) }} />
            <span className="hud-name">
                {p.name}
                {p.isBot && <span className="hud-bot"> 🤖</span>}
            </span>
            <span className="hud-stats">
                {p.eliminated ? (
                    <span style={{ color: css(COLORS.wrong) }}>out</span>
                ) : (
                    <>
                        <span title="Regions">⬢ {p.regions}</span>
                        <span className="hud-hp" title="Capital shields">
                            {"♥".repeat(p.capitalHp)}
                        </span>
                    </>
                )}
            </span>
        </li>
    );
}
