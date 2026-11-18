import Application from "../Application";
import { ButtonEvent, GameEvent } from "../Events";
import { Page } from "shared/Page";
import LayerManager from "app/managers/LayerManager";
import { language } from "app/i18n";
import { gameClient } from "app/multiplayer/GameClient";
import { lobbyStore } from "app/settings/LobbyView";
import { LobbySettings } from "app/settings/matchSettings";

/**
 * Single-player match setup. The form itself is React (`LobbyView`, for the
 * number field and checkboxes); this page shows and hides it with the menu
 * background behind.
 */
export class LobbyPage extends Page {
    constructor(app: Application, layerManager: LayerManager) {
        super(app, layerManager);
        this.visible = false;

        lobbyStore.set({
            visible: false,
            onStart: (settings) => this.start(settings),
            onBack: () => {
                this.show(false);
                this.app.stage.emit(ButtonEvent.exitButtonClicked);
            },
        });
        this.app.stage.on(ButtonEvent.newGameButtonClicked, () =>
            this.show(true)
        );
        this.app.stage.on(GameEvent.startMatch, () => this.show(false));
    }

    private show(visible: boolean) {
        this.visible = visible;
        lobbyStore.set((s) => ({ ...s, visible }));
    }

    /**
     * Starts a single-player match on the game server (which also saves the
     * points). The server picks the questions in the current language.
     */
    private start(s: LobbySettings) {
        this.show(false);
        gameClient.startSolo({
            rounds: s.rounds,
            placement: s.placement,
            language: language(),
            powerUps: s.powerUps,
            bots: Array.from({ length: s.opponents }, () => s.difficulty),
        });
    }
}
