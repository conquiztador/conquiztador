import { FormEvent, ReactNode, useEffect, useState } from "react";
import {
    Difficulty,
    ROOM_SEATS_MAX,
    ROOM_SEATS_MIN,
    RoomSettings,
    RoomSummary,
    RoomView,
    SeatSetting,
    SeatView,
} from "@conquiztador/core";

import { formatNumber, language, playerName, useMessages } from "app/i18n";
import { gameClient, multiplayerStore } from "./GameClient";
import "./Multiplayer.css";

/** Login, room list and room screens, shown over the menu background. */
export function MultiplayerView() {
    const state = multiplayerStore.use();
    const m = useMessages();
    if (state.screen === "closed") return null;
    // During a match the PIXI pages are on screen; only say if we lost them.
    if (state.screen === "match")
        return state.reconnecting ? (
            <div className="mp-banner">{m.rooms.reconnecting}</div>
        ) : null;

    let body: ReactNode;
    if (state.screen === "login" || state.screen === "register")
        body = <AccountForm mode={state.screen} busy={state.busy} />;
    else if (state.lost)
        body = (
            <div className="mp-center">
                <p>{state.lost(m)}</p>
                <button
                    className="mp-button primary"
                    onClick={() => gameClient.reconnect()}
                >
                    {m.rooms.reconnect}
                </button>
            </div>
        );
    else if (state.connection !== "online")
        body = (
            <p className="mp-center">
                {state.reconnecting ? m.rooms.reconnecting : m.rooms.connecting}
            </p>
        );
    else if (state.screen === "solo")
        body = <p className="mp-center">{m.rooms.startingSolo}</p>;
    else if (state.screen === "room" && state.room)
        body = (
            <RoomScreen
                room={state.room}
                countdownEndsAt={state.countdownEndsAt}
            />
        );
    else body = <RoomList rooms={state.rooms} />;

    return (
        <div className="mp">
            <div className="mp-panel">
                <header className="mp-top">
                    <button
                        className="mp-link"
                        onClick={() => gameClient.exit()}
                    >
                        ← {m.account.back}
                    </button>
                    {state.user && (
                        <span className="mp-user">
                            {m.account.loggedInAs(state.user.displayName)} ·{" "}
                            {m.account.points(formatNumber(state.user.points))}{" "}
                            ·{" "}
                            <button
                                className="mp-link"
                                onClick={() => gameClient.logout()}
                            >
                                {m.account.logout}
                            </button>
                        </span>
                    )}
                </header>
                {state.notice && (
                    <div
                        className="mp-notice"
                        onClick={() => gameClient.dismissNotice()}
                    >
                        {state.notice(m)}
                    </div>
                )}
                {body}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- account

function AccountForm({
    mode,
    busy,
}: {
    mode: "login" | "register";
    busy: boolean;
}) {
    const m = useMessages();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [username, setUsername] = useState("");
    const registering = mode === "register";

    const submit = (e: FormEvent) => {
        e.preventDefault();
        if (registering) void gameClient.register(email, password, username);
        else void gameClient.login(email, password);
    };

    return (
        <form className="mp-form" onSubmit={submit}>
            <h2>{registering ? m.account.register : m.account.login}</h2>
            <label>
                {m.account.email}
                <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                />
            </label>
            {registering && (
                <label>
                    {m.account.username}
                    <input
                        autoComplete="nickname"
                        maxLength={150}
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                </label>
            )}
            <label>
                {m.account.password}
                <input
                    type="password"
                    autoComplete={
                        registering ? "new-password" : "current-password"
                    }
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
            </label>
            <button className="mp-button primary" type="submit" disabled={busy}>
                {registering ? m.account.register : m.account.login}
            </button>
            <button
                type="button"
                className="mp-link"
                onClick={() =>
                    registering
                        ? gameClient.showLogin()
                        : gameClient.showRegister()
                }
            >
                {registering ? m.account.haveAccount : m.account.noAccount}
            </button>
        </form>
    );
}

// ---------------------------------------------------------------- room list

const DEFAULT_SETTINGS: RoomSettings = {
    rounds: 5,
    placement: "draft",
    seats: 2,
    language: "en",
};

function RoomList({ rooms }: { rooms: RoomSummary[] }) {
    const m = useMessages();
    const [creating, setCreating] = useState(false);
    const [joining, setJoining] = useState<RoomSummary | null>(null);

    if (creating) return <CreateRoomForm onCancel={() => setCreating(false)} />;
    if (joining)
        return (
            <PasswordForm room={joining} onCancel={() => setJoining(null)} />
        );

    return (
        <>
            <div className="mp-row">
                <h2>{m.rooms.title}</h2>
                <button
                    className="mp-button primary"
                    onClick={() => setCreating(true)}
                >
                    {m.rooms.create}
                </button>
            </div>
            {rooms.length === 0 ? (
                <p className="mp-muted">{m.rooms.none}</p>
            ) : (
                <ul className="mp-rooms">
                    {rooms.map((r) => {
                        const full = r.filled >= r.settings.seats;
                        const blocked =
                            r.status !== "waiting"
                                ? r.status === "playing"
                                    ? m.rooms.playing
                                    : m.rooms.locked
                                : full
                                ? m.rooms.full
                                : null;
                        return (
                            <li key={r.id} className="mp-room">
                                <div className="mp-room-info">
                                    <span className="mp-room-name">
                                        {r.hasPassword && (
                                            <span title={m.rooms.protected}>
                                                🔒{" "}
                                            </span>
                                        )}
                                        {r.name}
                                    </span>
                                    <span className="mp-muted">
                                        {m.rooms.byAuthor(r.author)} ·{" "}
                                        {m.rooms.rounds(r.settings.rounds)} ·{" "}
                                        {r.settings.language.toUpperCase()}
                                    </span>
                                </div>
                                <span className="mp-seats">
                                    {m.rooms.seats(r.filled, r.settings.seats)}
                                </span>
                                <button
                                    className="mp-button"
                                    disabled={blocked !== null}
                                    onClick={() =>
                                        r.hasPassword
                                            ? setJoining(r)
                                            : gameClient.joinRoom(r.id)
                                    }
                                >
                                    {blocked ?? m.rooms.join}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </>
    );
}

function CreateRoomForm({ onCancel }: { onCancel: () => void }) {
    const m = useMessages();
    const user = multiplayerStore.get().user;
    const [name, setName] = useState(
        user ? m.rooms.defaultName(user.displayName) : ""
    );
    const [password, setPassword] = useState("");
    const [settings, setSettings] = useState<RoomSettings>({
        ...DEFAULT_SETTINGS,
        language: language(),
    });

    const submit = (e: FormEvent) => {
        e.preventDefault();
        gameClient.createRoom(name, password, settings);
    };
    return (
        <form className="mp-form" onSubmit={submit}>
            <h2>{m.rooms.create}</h2>
            <label>
                {m.rooms.name}
                <input
                    required
                    maxLength={40}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                />
            </label>
            <label>
                {m.rooms.passwordOptional}
                <input
                    type="password"
                    autoComplete="new-password"
                    maxLength={64}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
            </label>
            <SettingsEditor
                settings={settings}
                onChange={(p) => setSettings({ ...settings, ...p })}
            />
            <div className="mp-actions">
                <button type="button" className="mp-button" onClick={onCancel}>
                    {m.rooms.cancel}
                </button>
                <button type="submit" className="mp-button primary">
                    {m.rooms.create}
                </button>
            </div>
        </form>
    );
}

function PasswordForm({
    room,
    onCancel,
}: {
    room: RoomSummary;
    onCancel: () => void;
}) {
    const m = useMessages();
    const [password, setPassword] = useState("");
    return (
        <form
            className="mp-form"
            onSubmit={(e) => {
                e.preventDefault();
                gameClient.joinRoom(room.id, password);
            }}
        >
            <h2>🔒 {room.name}</h2>
            <label>
                {m.rooms.enterPassword}
                <input
                    type="password"
                    autoFocus
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                />
            </label>
            <div className="mp-actions">
                <button type="button" className="mp-button" onClick={onCancel}>
                    {m.rooms.cancel}
                </button>
                <button type="submit" className="mp-button primary">
                    {m.rooms.join}
                </button>
            </div>
        </form>
    );
}

// ---------------------------------------------------------------- settings

function Choice<T extends string | number>({
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

function SettingsEditor({
    settings,
    onChange,
}: {
    settings: RoomSettings;
    onChange?: (patch: Partial<RoomSettings>) => void;
}) {
    const m = useMessages();
    const seatCounts: number[] = [];
    for (let n = ROOM_SEATS_MIN; n <= ROOM_SEATS_MAX; n++) seatCounts.push(n);
    return (
        <div className="mp-settings">
            <span>{m.rooms.seatCount}</span>
            <Choice<number>
                options={seatCounts.map((n) => ({ value: n, label: `${n}` }))}
                value={settings.seats}
                onChange={onChange && ((seats) => onChange({ seats }))}
            />
            <span>{m.rooms.roundsLabel}</span>
            <Choice<number>
                options={[
                    { value: 3, label: m.lobby.short(3) },
                    { value: 5, label: m.lobby.standard(5) },
                    { value: 7, label: m.lobby.long(7) },
                ]}
                value={settings.rounds}
                onChange={
                    onChange &&
                    ((rounds) =>
                        onChange({ rounds: rounds as RoomSettings["rounds"] }))
                }
            />
            <span>{m.rooms.placement}</span>
            <Choice<RoomSettings["placement"]>
                options={[
                    { value: "draft", label: m.lobby.choose },
                    { value: "random", label: m.lobby.random },
                ]}
                value={settings.placement}
                onChange={onChange && ((placement) => onChange({ placement }))}
            />
            <span>{m.rooms.language}</span>
            <Choice<RoomSettings["language"]>
                options={[
                    { value: "en", label: m.rooms.languages.en },
                    { value: "bg", label: m.rooms.languages.bg },
                ]}
                value={settings.language}
                onChange={onChange && ((language) => onChange({ language }))}
            />
        </div>
    );
}

// ---------------------------------------------------------------- room

function useSecondsLeft(endsAt: number | null): number | null {
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (endsAt === null) return;
        const timer = setInterval(() => setNow(Date.now()), 200);
        return () => clearInterval(timer);
    }, [endsAt]);
    return endsAt === null
        ? null
        : Math.max(0, Math.ceil((endsAt - now) / 1000));
}

function RoomScreen({
    room,
    countdownEndsAt,
}: {
    room: RoomView;
    countdownEndsAt: number | null;
}) {
    const m = useMessages();
    const me = multiplayerStore.get().user?.uuid;
    const isAuthor = room.authorUuid === me;
    const editable = isAuthor && room.status === "waiting";
    const allFilled = room.seats.every(
        (s) => s.kind === "bot" || s.player !== null
    );
    const secondsLeft = useSecondsLeft(countdownEndsAt);

    let status: string;
    if (room.status === "playing") status = m.rooms.starting;
    else if (room.status === "countdown")
        status = m.rooms.startsIn(secondsLeft ?? 0);
    else if (!allFilled)
        status = isAuthor ? m.rooms.needAllSeats : m.rooms.waitingForPlayer;
    else status = isAuthor ? "" : m.rooms.waitingForHost;

    return (
        <>
            <div className="mp-row">
                <h2>
                    {room.hasPassword && "🔒 "}
                    {room.name}
                </h2>
            </div>
            <ul className="mp-seat-list">
                {room.seats.map((seat, i) => (
                    <Seat
                        key={i}
                        index={i}
                        seat={seat}
                        room={room}
                        me={me}
                        editable={editable}
                    />
                ))}
            </ul>
            <h3>{m.rooms.settings}</h3>
            <SettingsEditor
                settings={room.settings}
                onChange={
                    editable ? (p) => gameClient.updateSettings(p) : undefined
                }
            />
            <p
                className={`mp-status${
                    room.status === "countdown" ? " counting" : ""
                }`}
            >
                {status}
            </p>
            <div className="mp-actions">
                <button
                    className="mp-button"
                    onClick={() => gameClient.leaveRoom()}
                    disabled={room.status === "playing"}
                >
                    {m.rooms.leave}
                </button>
                {isAuthor && room.status === "waiting" && (
                    <button
                        className="mp-button primary"
                        disabled={!allFilled}
                        onClick={() => gameClient.lock()}
                    >
                        {m.rooms.lock}
                    </button>
                )}
                {isAuthor && room.status === "countdown" && (
                    <button
                        className="mp-button"
                        onClick={() => gameClient.unlock()}
                    >
                        {m.rooms.unlock}
                    </button>
                )}
            </div>
        </>
    );
}

const DIFFICULTIES = [Difficulty.Easy, Difficulty.Medium, Difficulty.Hard];

function seatValue(seat: SeatView): string {
    return seat.kind === "bot" ? `bot:${seat.difficulty}` : "open";
}

function parseSeatValue(value: string): SeatSetting {
    if (value === "open") return { kind: "open" };
    return { kind: "bot", difficulty: value.slice(4) as Difficulty };
}

function Seat({
    index,
    seat,
    room,
    me,
    editable,
}: {
    index: number;
    seat: SeatView;
    room: RoomView;
    me: string | undefined;
    editable: boolean;
}) {
    const m = useMessages();
    const difficultyName = (d: Difficulty) =>
        d === Difficulty.Easy
            ? m.lobby.easy
            : d === Difficulty.Hard
            ? m.lobby.hard
            : m.lobby.medium;

    let who: ReactNode;
    if (seat.kind === "bot")
        who = (
            <>
                🤖 {playerName({ id: `bot-${index}`, name: seat.name })}{" "}
                <span className="mp-muted">
                    · {difficultyName(seat.difficulty)}
                </span>
            </>
        );
    else if (seat.player)
        who = (
            <>
                {seat.player.displayName}
                {seat.player.uuid === me && (
                    <span className="mp-muted"> ({m.rooms.you})</span>
                )}
                {seat.player.uuid === room.authorUuid && (
                    <span className="mp-badge">{m.rooms.author}</span>
                )}
            </>
        );
    else who = <span className="mp-muted">{m.rooms.waitingForPlayer}</span>;

    const isAuthorSeat =
        seat.kind === "open" && seat.player?.uuid === room.authorUuid;
    return (
        <li className="mp-seat">
            <span className="mp-seat-n">{index + 1}</span>
            <span className="mp-seat-who">{who}</span>
            {editable && !isAuthorSeat && (
                <select
                    value={seatValue(seat)}
                    onChange={(e) =>
                        gameClient.setSeat(
                            index,
                            parseSeatValue(e.target.value)
                        )
                    }
                >
                    <option value="open">{m.rooms.open}</option>
                    {DIFFICULTIES.map((d) => (
                        <option key={d} value={`bot:${d}`}>
                            {m.rooms.bot} · {difficultyName(d)}
                        </option>
                    ))}
                </select>
            )}
        </li>
    );
}
