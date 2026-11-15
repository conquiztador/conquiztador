import * as PIXI from "pixi.js";

import "./styles/main.css";
import Application from "./Application";
import LayerManager from "./managers/LayerManager";
import { QuestionService } from "./services/QuestionService";
import { ScoreService } from "./services/ScoreService";
import { QuestionComponent } from "./components/QuestionComponent";
import { ScoreComponent } from "./components/ScoreComponent";
import { MenuPage } from "./pages/MenuPage";
import { GamePage } from "./pages/GamePage";
import { EndGamePage } from "./pages/EndGamePage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).PIXI = PIXI;

async function main() {
    const app = new Application();
    await app.setup();

    await PIXI.Assets.load([
        "assets/white-square.jpg",
        "assets/red-square.jpg",
        "assets/green-square.jpg",
        "assets/blue-square.jpg",
    ]);

    const layerManager = new LayerManager(app);

    const questionService = new QuestionService();
    const scoreService = new ScoreService();

    const questionComponent = new QuestionComponent(app, questionService);
    const scoreComponent = new ScoreComponent(app, scoreService);

    new MenuPage(app, layerManager);
    new GamePage(app, layerManager, questionComponent, scoreComponent);
    new EndGamePage(app, layerManager, scoreService);
}

main();
