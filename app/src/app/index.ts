import * as PIXI from "pixi.js";

import "./styles/main.css";
import Application from "./Application";
import { mountUi } from "./ui/mountUi";
import LayerManager from "./managers/LayerManager";
import { MenuPage } from "./pages/MenuPage";
import { LobbyPage } from "./pages/LobbyPage";
import { ConquestPage } from "./pages/ConquestPage";
import { GameOverPage } from "./pages/GameOverPage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).PIXI = PIXI;

async function main() {
    const app = new Application();
    await app.setup();
    mountUi(app.uiRoot, app.screenRoot);

    const layerManager = new LayerManager(app);

    new MenuPage(app, layerManager);
    new LobbyPage(app, layerManager);
    new ConquestPage(app, layerManager);
    new GameOverPage(app, layerManager);
}

main();
