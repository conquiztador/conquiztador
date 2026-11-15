# AGENTS.md — Conquiztador Development Guide

## 1. Project Overview

**Conquiztador** is a turn-based, trivia-driven territory conquest game inspired by classic map-control trivia games. Players compete to conquer regions on a map (initially **Bulgaria**, divided into its 28 provinces/oblasts) by answering multiple-choice and numerical estimation trivia questions.

- **Game Modes:** Single-Player (vs. AI Bots) and Multiplayer (2 to 5 players, supporting human players and bot backfill).
- **Match Formats:** Configurable round limits (e.g., Short: 3 rounds, Standard: 5 rounds, Long: 7 rounds).
- **Primary Objective:** Control the highest number of territories (or highest total score/points) at the end of the final round, OR eliminate opponents by capturing their Capitals.

---

## 2. Core Game Rules & Mechanics

### 2.1 Setup & Initialization

1. **Lobby Configuration:**
   - Select Game Mode (Single-Player / Multiplayer).
   - Select Player Count (2–5 participants).
   - Select Match Length (3, 5, 7, or custom N rounds).
   - Select Starting Placement Mode: **Random** or **Draft/Selected** (players pick their starting Capital region in turn order).
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

Players have access to tactical power-ups (limited uses per match or earned via streak/territory milestones):

- **50/50 (Hint):** Eliminates two incorrect answers during a Multiple-Choice phase.
- **Range Finder / Proximity Hint:** Narrows the acceptable range or gives an order-of-magnitude clue during a Numerical phase.
- **Fortify / Wall:** Places a defensive barrier on an owned territory. Requires an extra successful attack to breach, or blocks attacks for 1 round.
- **Extra Time:** Adds +5 seconds to the player's question timer.
- **Spy / Scout:** Reveals whether the opponent has answered or shows the category of the upcoming question before selecting a territory.

---

## 3. Architecture & Engineering Guidelines for AI Agents

When writing code, designing schemas, or implementing features for Conquiztador, adhere to the following principles:

### 3.1 Authoritative State Machine

- **Server-Authoritative Logic:** All game state transitions, timer validations, answer checks, and adjacency verifications must be enforced by a central state machine (or backend server in multiplayer) to prevent cheating (e.g., inspecting network payloads for correct answers).
- **Never expose `correctAnswer` to the client** until the round timer expires or both players have submitted their answers.
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

---

## 4. Coding Standards & Conventions

- **Type Safety:** Strictly type all game events, socket payloads, question models, and map entities.
- **Separation of Concerns:** Keep core game rules (pure functions for combat resolution, win-condition checks, and pathfinding/adjacency) completely decoupled from UI rendering and networking layers.
- **Testing:** Any modifications to combat resolution, Capital chain-attacks, or win conditions must include unit tests covering edge cases (e.g., simultaneous ties, Capital captured on the final turn of the final round).
