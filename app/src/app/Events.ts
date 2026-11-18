export enum ButtonEvent {
    newGameButtonClicked = "newGameButtonClicked",
    exitButtonClicked = "exitButtonClicked",
}

export enum GameEvent {
    /** A match from the game server is now on screen. */
    startMatch = "startMatch",
    /** Payload: final state, points per player, the local player's id. */
    matchFinished = "matchFinished",
}
