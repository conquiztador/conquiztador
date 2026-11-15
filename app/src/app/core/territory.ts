import {
    CapitalCaptureRule,
    GameState,
    MapGraph,
    PlayerId,
    RegionId,
    STANDARD_HP,
    Territory,
} from "./types";

export function territoriesOf(
    territories: Record<RegionId, Territory>,
    playerId: PlayerId
): Territory[] {
    return Object.values(territories).filter((t) => t.ownerId === playerId);
}

/** Regions the player may attack: adjacent to something they own and not owned by them. */
export function attackableTargets(
    state: Pick<GameState, "map" | "territories">,
    playerId: PlayerId
): RegionId[] {
    const targets = new Set<RegionId>();
    for (const owned of territoriesOf(state.territories, playerId)) {
        for (const n of state.map.regions[owned.regionId].neighbors) {
            if (state.territories[n].ownerId !== playerId) targets.add(n);
        }
    }
    return [...targets];
}

export function isAttackable(
    state: Pick<GameState, "map" | "territories">,
    playerId: PlayerId,
    targetId: RegionId
): boolean {
    return attackableTargets(state, playerId).includes(targetId);
}

export interface WinOutcome {
    territories: Record<RegionId, Territory>;
    targetHpAfter: number;
    wallBroken: boolean;
    captured: boolean;
    eliminatedPlayerId: PlayerId | null;
}

/**
 * Applies an attacker's battle win to the target. A wall absorbs the win;
 * otherwise the target loses 1 HP and is captured at 0. Capturing a capital
 * eliminates its owner and hands their land to the attacker or to neutral.
 * Returns a new territories record (input is not mutated).
 */
export function applyAttackerWin(
    territories: Record<RegionId, Territory>,
    attackerId: PlayerId,
    targetId: RegionId,
    rule: CapitalCaptureRule
): WinOutcome {
    const next: Record<RegionId, Territory> = {};
    for (const [id, t] of Object.entries(territories)) next[id] = { ...t };
    const target = next[targetId];

    if (target.walled) {
        target.walled = false;
        return {
            territories: next,
            targetHpAfter: target.hp,
            wallBroken: true,
            captured: false,
            eliminatedPlayerId: null,
        };
    }

    target.hp -= 1;
    if (target.hp > 0) {
        return {
            territories: next,
            targetHpAfter: target.hp,
            wallBroken: false,
            captured: false,
            eliminatedPlayerId: null,
        };
    }

    const previousOwner = target.ownerId;
    const wasCapital = target.isCapital;

    target.ownerId = attackerId;
    target.hp = STANDARD_HP;
    target.isCapital = false;

    let eliminatedPlayerId: PlayerId | null = null;
    if (wasCapital && previousOwner !== null) {
        eliminatedPlayerId = previousOwner;
        for (const t of Object.values(next)) {
            if (t.ownerId === previousOwner) {
                t.ownerId = rule === "transfer" ? attackerId : null;
                t.hp = STANDARD_HP;
                t.isCapital = false;
            }
        }
    }

    return {
        territories: next,
        targetHpAfter: 0,
        wallBroken: false,
        captured: true,
        eliminatedPlayerId,
    };
}

/** True if every `neighbors` relation in the graph is symmetric and references existing regions. */
export function findAsymmetricEdges(map: MapGraph): [RegionId, RegionId][] {
    const problems: [RegionId, RegionId][] = [];
    for (const region of Object.values(map.regions)) {
        for (const n of region.neighbors) {
            const other = map.regions[n];
            if (!other || !other.neighbors.includes(region.id)) {
                problems.push([region.id, n]);
            }
        }
    }
    return problems;
}
