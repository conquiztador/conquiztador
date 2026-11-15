export enum ButtonEvent {
    newGameButtonClicked = "newGameButtonClicked",
    exitButtonClicked = "exitButtonClicked",
}

export enum GameEvent {
    /** Payload: GameConfig. Emitted by the lobby to start a match. */
    startMatch = "startMatch",
    /** Payload: final GameState. */
    matchFinished = "matchFinished",
}
