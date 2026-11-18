# AGENTS.md — Conquiztador Development Guide

## 1. Project Overview

**Conquiztador** is a turn-based, trivia-driven territory conquest game inspired by classic map-control trivia games. Players compete to conquer regions on a map (initially **Bulgaria**, divided into its 28 provinces/oblasts) by answering multiple-choice and numerical estimation trivia questions.

- **Game Modes:** Single-Player (vs. AI Bots) and Multiplayer (2 to 5 players in a room, any mix of humans and bots — see §2.6).
- **Match Formats:** Configurable round limits (e.g., Short: 3 rounds, Standard: 5 rounds, Long: 7 rounds).
- **Primary Objective:** Control the highest number of territories (or highest total score/points) at the end of the final round, OR eliminate opponents by capturing their Capitals.
- **Languages:** English and Bulgarian. UI text follows each player's chosen language; questions come from a separate pool per language (an English player only gets English questions).
- **Accounts & Points:** Players earn points during matches (§2.7). Points are saved to the player's account to be spent on purchases later.

---

## 2. Core Game Rules & Mechanics

### 2.1 Setup & Initialization

1. **Lobby Configuration:**
   - Select Game Mode (Single-Player / Multiplayer). Multiplayer setup happens in a room (§2.6).
   - Select Player Count (2–5 participants).
   - Select Match Length (presets 3, 5, 7, or any custom whole number from 1 to 15).
   - Select power-ups: supply mode and which kinds are in play (§2.5).
   - Select Starting Placement Mode: **Random** or **Draft/Selected** (players pick their starting Capital region in turn order).
   - Capitals may not border each other: at least one region must separate any two capitals.
2. **Map Data (Bulgaria):**
   - The map consists of interconnected nodes (regions/oblasts).
   - Each region must define an adjacency list (`neighbors: string[]`) to validate legal attacks.
   - Each player starts with **1 Capital territory** (3 HP/shields). All other territories start as **Neutral/Unoccupied** (1 HP).

### 2.2 Turn & Round Structure

- A **Round** consists of every active player taking **1 turn** in sequence (turn order may rotate or randomize per round for fairness).
- **Turn Action:**
  1. The active player selects a target territory adjacent to any territory they currently control.
  2. _(Optional)_ Pre-battle power-ups are activated (e.g., attacking through a Wall).
  3. A **Battle** is initiated:
     - **If Occupied:** Attacker vs. Territory Owner (Human or Bot).
     - **If Unoccupied:** Attacker vs. Neutral Bot (environment defender).

### 2.3 Battle Resolution (Trivia Combat)

Battles consist of up to two phases:

1. **Phase 1: Multiple-Choice Question (4 options)**
   - Both Attacker and Defender answer simultaneously within a strict timer (e.g., 15 seconds).
   - **Attacker Correct & Defender Wrong:** Attacker wins the battle.
   - **Attacker Wrong (regardless of Defender):** Defender wins/holds the territory. Turn ends.
   - **Both Wrong:** Defender holds the territory. Turn ends.
   - **Both Correct:** Proceed to **Phase 2 (Tie-Breaker)**.

2. **Phase 2: Numerical Estimation Question (Open Number)**
   - Both players input a numeric value within a timer (e.g., 15 seconds).
   - System records `answerValue` and `responseTimeMs`.
   - **Winner Determination:**
     1. Smallest absolute difference: `|playerAnswer - correctAnswer|`.
     2. **Tie-breaker:** If both players are equally close, the player with the lower `responseTimeMs` (answered first) wins.

### 2.4 Territory Capture & Capital Siege Rules

- **Standard Territory (1 HP):**
  - Winning a battle immediately transfers ownership to the Attacker. The Attacker's turn ends.
- **Capital Territory (3 HP):**
  - Capitals require **3 successful attacks** to be captured.
  - **Blitz/Chain Attack Mechanic:** If an Attacker wins a battle against a Capital and reduces its HP (e.g., from 3 to 2, or 2 to 1), **the Attacker immediately initiates another battle** against that same Capital within the same turn.
  - This chain continues until either:
    - The Capital reaches 0 HP (Captured!).
    - The Defender wins a battle (defends successfully), ending the Attacker's turn.
  - **Capital Capture Consequence:** When a player's Capital is captured, that player is eliminated, and all of their remaining territories either transfer to the conqueror or revert to neutral (configurable rule; default: transfer to conqueror).

### 2.5 Power-Ups & Modifiers

Players have access to tactical power-ups. Rules and values live in `core/src/powerUps.ts`.

- **50/50 (Hint):** During a multiple-choice question you're answering (before you answer), hides two wrong options. Once per question.
- **Range Finder:** During the numeric tie-breaker (before you answer), shows an integer bracket containing the answer, about ±25% of it wide (at least 4 wide) and randomly placed, so the answer isn't always in the middle.
- **Fortify / Wall:** A free action on your turn, before choosing a target: walls one of your regions. The next successful attack on it only breaks the wall (no HP lost). The wall lasts until it is breached. A region can hold one wall.
- **Extra Time:** Adds 5 seconds to **your own** timer for the current question only (multiple-choice or numeric). The response time used for the tie-breaker is still the real time.
- **Scout:** On your turn, before choosing a target: shows the category of the question your next battle will use (the question is drawn now and kept for that battle; it doesn't carry into capital-chain follow-ups). Whether the opponent has answered is always shown to everyone, so Scout doesn't cover that.

Power-ups visible to everyone: each player's charges and every use (but only the user sees what a power-up revealed). A failed use costs no charge.

- **When the server accepts a use:** Fortify / Scout only while you hold your target prompt; 50/50, Range Finder and Extra Time only while the server waits for your answer and your own time (incl. grace) hasn't run out. Otherwise `not_your_turn`; a rule violation (no charge, wrong question type, already used, not your region) is `invalid`; outside a match `not_in_room`.
- **Extra Time in a battle:** the question waits until the latest player's deadline (+ grace); the other player's limit is unchanged, so their late answer still counts as wrong.
- **Order of news:** bots' 50/50 is announced right after the `battle` event, their Range Finder right after `tieBreaker`; power-ups earned by answering after `mcqResult`, by taking/losing a region after `battleResult`. Each `powerUpUsed` / `powerUpGranted` state differs from the previous state shown by exactly that one charge (so no battle outcome leaks early).

**Supply (room setting `powerUps`: a mode plus the enabled kinds):**

| Mode | Players get |
| --- | --- |
| `none` | No power-ups. |
| `oneEach` | One charge of each enabled kind at the start. |
| `random` | 3 random charges of enabled kinds at the start (kinds may repeat). |
| `reward` | Nothing at the start; a random enabled power-up for every 3rd correct multiple-choice answer and every 2nd region taken. |
| `catchUp` | Nothing at the start; a random enabled power-up for every 2nd wrong multiple-choice answer (including timeouts) and every region lost. |

- A player never holds more than 3 charges of one kind (earned ones beyond that are skipped).
- Neutral defenders never get power-ups. Bots get them like players.
- Default for new rooms and single-player: `oneEach` with all five kinds.

**Bots** (§3.3) use power-ups by simple rules: Fortify on their own capital when it borders another player's land and isn't walled yet (Easy bots only half the time); 50/50 in every capital battle and in 20% of other battles; Range Finder in every tie-breaker. They don't use Extra Time or Scout (they gain nothing from them). With 50/50 a bot that doesn't "know" the answer guesses between the two options left; with Range Finder its numeric spread is halved and kept inside the bracket.

### 2.6 Multiplayer Rooms

1. **Room list:** Players can see the existing rooms and create new ones.
2. **Access:** A room is either **open** (anyone can join) or **protected with a password** (joining requires the password).
3. **Joining:** Players join a room by taking a free seat that is open for players.
4. **Room author (host):** The player who created the room controls it:
   - **Settings:** match length, placement mode, number of seats (2–5), power-ups (§2.5) and **question language** (all players in a room get questions from the same language pool; each player still sees the UI in their own language).
   - **Seats:** each seat is either **open for a player** or a **Bot** with its own difficulty (**Easy**, **Medium**, **Hard**). Turning an occupied seat into a bot removes that player from the seat.
5. **Locking & start:** When every seat is filled (by a player or a bot), the author can **lock** the room. A short **5-second countdown** follows, then the match starts.
6. **After the match:** the room reopens with the same seats, so the players can go again (the author locks it again). A seat whose player quit mid-match stays a bot.
7. **Single-player** is a private room (not listed) with the player and 1–4 bots. It starts immediately, without a countdown, and closes when the match ends.
8. **One room per player:** a player can sit in one room at a time. Opening the game in a second window takes over the connection (the first window is told so).

### 2.7 Points & Rewards

- **Accounts:** Multiplayer and single-player both require a logged-in account. Single-player is a private room with bots only, run by the game server like any other match, so its points can't be faked.
- **Point values** (human players only; bots earn nothing):

  | Event | Points |
  | --- | --- |
  | Correct multiple-choice answer | 10 |
  | Winning a tie-breaker (numeric) battle | 10 |
  | Taking a region | 25 |
  | Each hit on a capital's shields (including the final, capturing hit) | 25 |
  | Capturing a capital (on top of the hit) | 100 |
  | Winning the match | 200 |

- Points are computed by the game server, never trusted from the client, and saved to the player's account as ledger entries (with a running balance).
- "Correct answer" counts multiple-choice answers only; a tie-breaker counts as a win only for the closer (or, if equal, faster) player.
- Each player's points are saved once at the end of the match, with a per-event breakdown, and the game-over screen shows what they earned. A player who leaves early keeps what they earned so far but gets no victory bonus; once a bot plays their seat, the seat earns nothing more. The same match is never credited twice (the ledger is unique per player, match and event).
- Saved points will be spent on purchases later (not designed yet).

### 2.8 Multiplayer Timing & Connection Rules

- **Choice timer:** a human has 20 seconds to choose a capital (draft) or a target; when it expires the server picks one using the bot logic, so no player can stall a match. The HUD shows the seconds left.
- **Answer timing:** response times are measured by the server, from when it sent the question to when the answer arrives (clients can't claim to be faster).
- **Quitting:** a player who quits mid-match is replaced by a Medium bot immediately. If no humans are left, the match stops (points earned so far are still saved).
- **Disconnects:** a player who disconnects mid-match has 60 seconds to reconnect (the client retries automatically and resumes the match where it is, including an open question). Meanwhile their questions time out unanswered. After that, a Medium bot takes over the seat for the rest of the match. On resume the server re-sends the open question with its **base** time left (possibly 0 while Extra Time still runs), then that player's power-up effects for it (50/50, Range Finder, Extra Time — the client adds the bonus once), and at their target prompt their Scout result for this turn.
- **Before the match:** if anyone leaves during the 5-second countdown, it is cancelled and the room unlocks; the author can also cancel it. If the author leaves, the next player becomes author; an empty room is closed.

---

## 3. Architecture & Engineering Guidelines for AI Agents

When writing code, designing schemas, or implementing features for Conquiztador, adhere to the following principles:

### 3.1 Authoritative State Machine

- **Server-Authoritative Logic:** All game state transitions, timer validations, answer checks, and adjacency verifications must be enforced by a central state machine (or backend server in multiplayer) to prevent cheating (e.g., inspecting network payloads for correct answers).
- **Where it runs:** matches run on the **Node game server** (`server/`, TypeScript, WebSockets), which uses the same `core` engine package as the client. **Django** owns accounts, questions and the points ledger. The game server fetches questions (with solutions) from Django using a shared secret; that endpoint is never callable from browsers.
- **Never expose `correctAnswer` to the client** until the round timer expires or both players have submitted their answers.
- **Server-paced matches:** the game server drives the match and waits a fixed time for each step (`MATCH_TIMING` in `core/src/protocol.ts`): capital reveals, bot thinking, question reveals, battle results. The client plays the server's events in order, fitting each animation inside that time; if it falls behind (e.g. the tab was in the background) it skips animations to catch up. Change client animation lengths and `MATCH_TIMING` together.
- **Protocol:** every WebSocket message is typed in `core/src/protocol.ts` and validated with zod on the server. Bump `PROTOCOL_VERSION` on incompatible changes.
- **Explicit States:**
  - `LOBBY` -> `CAPITAL_SELECTION` -> `TURN_SELECT_TARGET` -> `BATTLE_MCQ` -> `BATTLE_NUMERIC` -> `BATTLE_RESOLUTION` -> `ROUND_END` -> `GAME_OVER`

### 3.2 Map & Graph Integrity

- Represent the Bulgaria map as a clean JSON/TypeScript graph structure:
- Always validate graph symmetry in unit tests (if Region A lists Region B as a neighbor, Region B must list Region A).

### 3.3 Bot / AI Opponent Design

Bots are required for both Single-Player mode and defending Unoccupied territories.

- **Difficulty Tiers:** `Easy`, `Medium`, `Hard`.
- **Strategic Target Selection:**
  - Prioritize attacking territories that complete a cluster or border an opponent's damaged Capital.
  - Avoid attacking fortified (Walled) territories unless no other moves exist.
- **Trivia Simulation:**
  - Bots should not be omniscient. Simulate human-like behavior:
    - Probability $P(\text{correct})$ based on difficulty (e.g., Easy: 40%, Medium: 65%, Hard: 85%).
    - Numerical variance based on a Gaussian distribution around the true value.
    - Simulated response delay (`responseTimeMs` between 2500ms and 9000ms) so tie-breakers remain fair and realistic.

### 3.4 UI/UX & Responsiveness

- **Interactive Map:** Regions should clearly display ownership color, Capital icon + HP indicator (3 shields/hearts), Wall status, and highlight valid attackable neighbors on the active player's turn.
- **Clear Feedback:** Clearly animate Capital siege chains so players understand why they are immediately entering a second or third consecutive question.

### 3.5 Running Locally

Three processes (npm workspaces at the repo root: `core`, `app`, `server`; run `npm install` at the root):

- **Django** (accounts, questions, points): `cd backend && pipenv run server` → `:8000`.
- **Game server** (rooms and matches): `cd server && npm start` → `:8090`, WebSocket path `/ws`.
- **Web app**: `cd app && npm start` → `:8080`. Vite proxies `/api` to Django and `/ws` to the game server, so phones on the LAN only need port 8080.
- `GAME_SERVER_SECRET` must be the same for Django and the game server. Both default to a development value; production must set it (the game server refuses to start without it).

---

## 4. Coding Standards & Conventions

- **Type Safety:** Strictly type all game events, socket payloads, question models, and map entities.
- **Separation of Concerns:** Keep core game rules (pure functions for combat resolution, win-condition checks, and pathfinding/adjacency) completely decoupled from UI rendering and networking layers.
- **Testing:** Any modifications to combat resolution, Capital chain-attacks, or win conditions must include unit tests covering edge cases (e.g., simultaneous ties, Capital captured on the final turn of the final round).

---

## 5. Keeping This Document Up to Date

- This file is the source of truth for **game rules and design decisions**. When a feature adds or changes a rule (combat, scoring, rooms, points, languages, etc.), update the relevant section here in the same change.
- Record decisions, not just intentions: once a value or behaviour is settled (e.g. point amounts, timers), write the concrete value here.
