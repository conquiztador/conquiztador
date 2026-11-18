import { z } from "zod";

import type { PublicGameState } from "./GameEngine";
import {
    BattleResult,
    Difficulty,
    McqAnswer,
    NumericAnswer,
    PlayerId,
    RegionId,
    Side,
} from "./types";

/**
 * WebSocket protocol between the web client and the game server.
 *
 * Every message is a JSON object with a `type`. Client messages are
 * validated on the server with these schemas; nothing from the client is
 * trusted beyond its shape. Messages added in later steps (rooms, match)
 * extend the two unions below.
 */

export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------- client → server

export const AuthMessage = z.object({
    type: z.literal("auth"),
    /** Django REST token (`/api/token/`). */
    token: z.string().min(1).max(200),
    protocol: z.literal(PROTOCOL_VERSION),
});

export const PingMessage = z.object({ type: z.literal("ping") });

// Rooms (agents.md §2.6) -------------------------------------------------

export const ROOM_SEATS_MIN = 2;
export const ROOM_SEATS_MAX = 5;
export const ROOM_ROUNDS = [3, 5, 7] as const;
export const ROOM_COUNTDOWN_MS = 5000;

export const QuestionLanguage = z.enum(["en", "bg"]);
export type QuestionLanguage = z.infer<typeof QuestionLanguage>;

export const RoomSettings = z.object({
    rounds: z.union([z.literal(3), z.literal(5), z.literal(7)]),
    placement: z.enum(["draft", "random"]),
    seats: z.number().int().min(ROOM_SEATS_MIN).max(ROOM_SEATS_MAX),
    /** Pool every player's questions come from. */
    language: QuestionLanguage,
});
export type RoomSettings = z.infer<typeof RoomSettings>;

/** What the author can set a seat to. Players fill open seats by joining. */
export const SeatSetting = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("open") }),
    z.object({ kind: z.literal("bot"), difficulty: z.enum(Difficulty) }),
]);
export type SeatSetting = z.infer<typeof SeatSetting>;

const RoomName = z.string().trim().min(1).max(40);
const RoomPassword = z.string().min(1).max(64);
const RoomId = z.string().min(1).max(64);

/** Start receiving `rooms` updates (the room list). */
export const WatchRoomsMessage = z.object({ type: z.literal("watchRooms") });
export const UnwatchRoomsMessage = z.object({ type: z.literal("unwatchRooms") });
export const CreateRoomMessage = z.object({
    type: z.literal("createRoom"),
    name: RoomName,
    /** Omitted or empty: open room. */
    password: z.string().max(64).optional(),
    settings: RoomSettings,
});
export const JoinRoomMessage = z.object({
    type: z.literal("joinRoom"),
    roomId: RoomId,
    password: RoomPassword.optional(),
});
export const LeaveRoomMessage = z.object({ type: z.literal("leaveRoom") });
/** Author only. */
export const UpdateSettingsMessage = z.object({
    type: z.literal("updateSettings"),
    settings: RoomSettings.partial(),
});
/** Author only. Making an occupied seat a bot removes its player. */
export const SetSeatMessage = z.object({
    type: z.literal("setSeat"),
    index: z.number().int().min(0).max(ROOM_SEATS_MAX - 1),
    seat: SeatSetting,
});
/** Author only, when every seat is filled: starts the countdown. */
export const LockRoomMessage = z.object({ type: z.literal("lockRoom") });
/** Author only: stops the countdown and unlocks. */
export const UnlockRoomMessage = z.object({ type: z.literal("unlockRoom") });

// Matches ------------------------------------------------------------------

/**
 * How long the server gives each step of a match. The client's animations
 * fit inside these, so every player sees the same moment at the same time.
 */
export const MATCH_TIMING = {
    /** A human choosing a capital or a target (agents.md §2.8). */
    choiceMs: 20_000,
    /** Revealing a capital chosen by a bot or placed at random. */
    capitalRevealMs: 2_900,
    /** Revealing a capital a human clicked (no "selecting…" pause). */
    ownCapitalRevealMs: 1_800,
    botThinkMs: 700,
    botAttackMs: 900,
    battleIntroMs: 400,
    chainAnnounceMs: 1_600,
    /** Extra wait for answers in flight when a question's time runs out. */
    answerGraceMs: 600,
    /** A bots-only question is shown this long. */
    spectateMs: 1_800,
    mcqRevealMs: 2_300,
    tieBreakerMs: 1_100,
    numericRevealMs: 2_700,
    resultMs: 1_800,
    roundEndMs: 1_400,
} as const;

/** Points per event, for human players only (agents.md §2.7). */
export const POINT_VALUES = {
    correct_answer: 10,
    tiebreaker_win: 10,
    region_taken: 25,
    capital_hit: 25,
    capital_captured: 100,
    victory: 200,
} as const;
export type PointsReason = keyof typeof POINT_VALUES;
/** How many times each event happened. */
export type PointsTally = Partial<Record<PointsReason, number>>;

export function pointsTotal(tally: PointsTally): number {
    return (Object.keys(tally) as PointsReason[]).reduce(
        (sum, reason) => sum + (tally[reason] ?? 0) * POINT_VALUES[reason],
        0
    );
}

export const SoloSettings = z.object({
    rounds: RoomSettings.shape.rounds,
    placement: RoomSettings.shape.placement,
    language: QuestionLanguage,
    /** One entry per opponent (1–4). */
    bots: z.array(z.enum(Difficulty)).min(1).max(ROOM_SEATS_MAX - 1),
});
export type SoloSettings = z.infer<typeof SoloSettings>;

/** Single-player: a private room with bots that starts at once. */
export const StartSoloMessage = z.object({
    type: z.literal("startSolo"),
    settings: SoloSettings,
});
/** A capital (while drafting) or a target (on your turn). */
export const SelectRegionMessage = z.object({
    type: z.literal("selectRegion"),
    regionId: z.string().min(1).max(64),
});
/** Option index (multiple choice) or the number (tie-breaker). */
export const AnswerMessage = z.object({
    type: z.literal("answer"),
    value: z.number().finite(),
});

export const ClientMessage = z.discriminatedUnion("type", [
    StartSoloMessage,
    SelectRegionMessage,
    AnswerMessage,
    AuthMessage,
    PingMessage,
    WatchRoomsMessage,
    UnwatchRoomsMessage,
    CreateRoomMessage,
    JoinRoomMessage,
    LeaveRoomMessage,
    UpdateSettingsMessage,
    SetSeatMessage,
    LockRoomMessage,
    UnlockRoomMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------------------------------------------------------------- server → client

export const PublicUser = z.object({
    uuid: z.string(),
    /** What other players see: username, or the part of the email before @. */
    displayName: z.string(),
    points: z.number().int(),
});
export type PublicUser = z.infer<typeof PublicUser>;

export const ErrorCode = z.enum([
    "bad_message",
    "unauthenticated",
    "auth_failed",
    "auth_timeout",
    "protocol_mismatch",
    /** Another connection logged in as the same user. */
    "replaced",
    "room_not_found",
    "wrong_password",
    "room_full",
    "room_locked",
    "already_in_room",
    "not_in_room",
    "not_author",
    "invalid",
    "not_your_turn",
    "no_questions",
    "internal",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export type RoomStatus = "waiting" | "countdown" | "playing";

/** One row in the room list. */
export interface RoomSummary {
    id: string;
    name: string;
    author: string;
    hasPassword: boolean;
    status: RoomStatus;
    settings: RoomSettings;
    /** Seats taken by players or bots. */
    filled: number;
}

export type SeatView =
    | {
          kind: "open";
          /** null while the seat is free. */
          player: { uuid: string; displayName: string } | null;
      }
    | { kind: "bot"; difficulty: Difficulty; name: string };

/** The room the client is in, in full. */
export interface RoomView {
    id: string;
    name: string;
    hasPassword: boolean;
    authorUuid: string;
    status: RoomStatus;
    settings: RoomSettings;
    seats: SeatView[];
    /** Time left until the match starts, while `status` is "countdown". */
    countdownMs: number | null;
}

/** Game state as players see it: no map (clients have it), no battle. */
export type MatchSnapshot = Omit<PublicGameState, "map" | "battle">;

export type PublicQuestion =
    | { kind: "mcq"; text: string; category?: string; options: string[] }
    | { kind: "numeric"; text: string; category?: string };

export type MatchEvent =
    | {
          kind: "started";
          matchId: string;
          you: PlayerId;
          state: MatchSnapshot;
          /** Re-sent after a reconnect: show the board as it is, no intro. */
          resumed: boolean;
      }
    /** New state, e.g. after capitals were placed. */
    | { kind: "state"; state: MatchSnapshot }
    /** Sent to the player who must choose. */
    | {
          kind: "prompt";
          prompt: "capital" | "target";
          options: RegionId[];
          timeMs: number;
      }
    | { kind: "turn"; playerId: PlayerId }
    /** `auto`: the player's time ran out and the server chose for them. */
    | { kind: "target"; playerId: PlayerId; targetId: RegionId; auto: boolean }
    | {
          kind: "battle";
          attackerId: PlayerId;
          defenderId: PlayerId | null;
          targetId: RegionId;
          chainIndex: number;
          isCapital: boolean;
          hp: number;
          walled: boolean;
      }
    | {
          kind: "question";
          question: PublicQuestion;
          timeMs: number;
          /** When a bot opponent answers (ms after the question appears). */
          opponentMs: number | null;
      }
    | { kind: "answered"; side: Side }
    | {
          kind: "mcqResult";
          correctIndex: number;
          answers: Partial<Record<Side, McqAnswer>>;
      }
    | { kind: "tieBreaker" }
    | {
          kind: "numericResult";
          correctValue: number;
          answers: Partial<Record<Side, NumericAnswer>>;
          winner: Side;
      }
    | { kind: "battleResult"; result: BattleResult; state: MatchSnapshot }
    | { kind: "roundEnd"; round: number; final: boolean }
    /** A player quit or didn't come back; a bot plays for them now. */
    | { kind: "botTakeover"; playerId: PlayerId; state: MatchSnapshot }
    | {
          kind: "gameOver";
          state: MatchSnapshot;
          /** What each human player earned, by event. */
          points: Record<PlayerId, PointsTally>;
      };

export type RoomLeftReason = "left" | "removed" | "closed";

export type ServerMessage =
    | { type: "welcome"; user: PublicUser }
    | { type: "pong" }
    | { type: "error"; code: ErrorCode; message: string }
    | { type: "rooms"; rooms: RoomSummary[] }
    | { type: "room"; room: RoomView }
    | { type: "roomLeft"; roomId: string; reason: RoomLeftReason }
    | { type: "match"; event: MatchEvent }
    /** The account's points balance changed (points were saved). */
    | { type: "balance"; points: number };
