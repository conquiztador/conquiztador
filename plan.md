# Plan

Upcoming work, in order. Game rules and decisions live in `agents.md`; this file tracks what is left to build. Tick items off as they land and delete finished sections once they're released.

## Status (2026-11-18)

Checked agents.md against the code:

| Area | State |
| --- | --- |
| §2.1–2.4 setup, turns, combat, capital siege | Done, unit-tested (`core`) |
| §2.6 rooms, §2.8 timing & reconnects | Done, tested (`server`) |
| §2.7 points ledger | Done, tested (`server`, `backend`) |
| §3.3 bot targeting & trivia simulation | Done, tested (`core`) |
| §2.1 custom round count | **Missing**: protocol only allowed 3/5/7 → now 1–15 (core done) |
| §2.5 power-ups | **Missing**: walls existed in combat/UI but nothing set them → core and app done, server to do |

## 1. Power-ups and custom rounds

Branch `power-ups`. Protocol version 2.

### 1a. Core — done

- [x] Types: `PowerUpKind`, `PowerUpSettings` (mode + kinds), inventories and progress in `GameState`, `BattleState.aids`.
- [x] `core/src/powerUps.ts`: supply modes, milestones, 50/50, Range Finder bracket, bot rules (`botChooseFortify`, `botWantsFiftyFifty`).
- [x] `GameEngine.usePowerUp(playerId, kind, regionId?)` → private `PowerUpEffect`; `drainGrants()`; per-side time limits for Extra Time; bots use 50/50 and Range Finder inside the engine.
- [x] Protocol: `RoomSettings.powerUps`, `SoloSettings.powerUps`, `rounds` 1–15, `usePowerUp` client message, `powerUpUsed` / `powerUpEffect` / `powerUpGranted` match events.
- [x] Tests: `core/src/powerUps.test.ts`, `core/src/protocol.test.ts`.

### 1b. Game server

- [x] `rooms.ts`: default room and solo settings get `powerUps: ALL_POWER_UPS`; pass `settings.powerUps` into `GameConfig`; `updateSettings` accepts `powerUps` and any `rounds` 1–15.
- [x] `connection.ts`: route `usePowerUp` to the player's match (errors as `invalid` / `not_your_turn` / `not_in_room`).
- [x] `match.ts`:
  - `usePowerUp(playerId, kind, regionId?)`: fortify / scout only while that player has the `target` prompt; 50/50, Range Finder, Extra Time only while the server waits for that player's answer. Engine `GameRuleError` → `RoomError("invalid", …)`.
  - Send `powerUpEffect` to the user only; broadcast `powerUpUsed` with a fresh snapshot.
  - Extra Time extends that player's answer deadline by `bonusMs` (the question wait ends at the latest deadline + grace).
  - Bots: before a bot picks a target, `botChooseFortify` → `engine.usePowerUp` → broadcast `powerUpUsed`. Bot 50/50 / Range Finder happen inside the engine: announced from the battle's `aids` right after `battle` / `tieBreaker` (no `powerUpEffect` for bots).
  - After each question resolves, `engine.drainGrants()` → broadcast `powerUpGranted` per grant.
  - `resume()`: re-send the reconnecting player's `powerUpEffect`s for the open question (from `battle.aids[side]`) and the Scout category if they scouted this turn.
  - A human whose seat a bot takes over keeps their charges for the bot.
- [x] Tests (`server/src/*.test.ts`): settings validation and defaults; each power-up through the match flow (effect private, broadcast public, charge spent, invalid moments rejected); Extra Time really extends the wait; bot fortify announced; grants announced in reward mode; resume re-sends effects.

### 1c. Web app — done (needs a browser play-through, see 1d)

- [x] Settings UI (single-player lobby and room settings): rounds presets 3/5/7 plus a custom number (1–15); power-up mode select and kind checkboxes (at least one kind unless mode is none). Room members see the author's choices read-only. The lobby is now a React form (`settings/LobbyView.tsx`) and remembers its settings in `localStorage` (old values tolerated).
- [x] Match HUD power-up bar: your charges per kind, everyone's total in the player rows; a button is enabled only when the server would accept it (`game/powerUpRules.ts`, unit-tested). Fortify: pick one of your regions on the map (cancel possible). Scout: show the category until the battle starts.
- [x] Battle overlay: aid buttons inside the battle card (the HUD is dimmed there); 50/50 hides the removed options; Range Finder shows "between X and Y"; Extra Time adds 5 s to your timer. Re-sent effects (reconnect) are applied idempotently.
- [x] Feedback for everyone: "X used 50/50", "X earned a Scout" (toast), wall drawn on fortified region (already rendered by `MapView`). Rejected uses show a short toast.
- [x] i18n: every new string in `en.ts` and `bg.ts` (informal "ти").
- [x] Protocol version 2 in the client handshake (`PROTOCOL_VERSION` from core).
- [x] Tests (`app`, jest): availability helper, effect reducer, settings form validation, i18n key parity.

### 1d. Wrap-up

- [ ] Full test run (`npm test` at the root, backend `pipenv run test`), typecheck, manual play-through on desktop and phone width.
- [ ] Merge `power-ups` into `master`.

## 2. Test debt

- [x] `server/src/match.test.ts`: flaky "Not your turn" thrown from the scripted bot's `setTimeout` in "keeps a dropped player's seat until the reconnect window ends" (race between prompt and takeover). Make the scripted player ignore stale prompts.
- [ ] Backend tests can't run in the current pipenv environment (Django not importable) — fix the environment, then run `pipenv run test`.
- [ ] App: no tests for pages/components (`ConquestPage`, `MatchHud`, `BattleOverlay`); extract pure logic from them where it's worth testing.

## 3. Later (not designed yet)

- Spending points on purchases (§2.7).
- More maps.
