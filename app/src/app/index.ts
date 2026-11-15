import "reflect-metadata";

import * as PIXI from "pixi.js";
import { Container } from "typedi";

import "./styles/main.css";
import Application from "./Application";
import { MenuPage } from "./pages/MenuPage";
import { GamePage } from "./pages/GamePage";
import { EndGamePage } from "./pages/EndGamePage";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).PIXI = PIXI;

async function main() {
    await Container.get(Application).setup();

    await PIXI.Assets.load([
        "assets/white-square.jpg",
        "assets/red-square.jpg",
        "assets/green-square.jpg",
        "assets/blue-square.jpg",
    ]);

    Container.get(MenuPage);
    Container.get(GamePage);
    Container.get(EndGamePage);
}

main();
