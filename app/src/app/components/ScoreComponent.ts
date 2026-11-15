import * as PIXI from "pixi.js";

import Application from "../Application";
import { ScoreService } from "app/services/ScoreService";

export class ScoreComponent extends PIXI.Container {
    private scoreText: PIXI.Text;

    constructor(private app: Application, private scoreService: ScoreService) {
        super();

        this.addScore();
    }

    addScore(): void {
        this.scoreText = new PIXI.Text({
            text: `${this.scoreService.score}`,
            style: {
                fontFamily: "Arial",
                fontWeight: "bold",
                fontSize: 24,
                fill: 0xffffff,
                align: "center",
            },
        });

        this.addChild(this.scoreText);

        this.scoreText.anchor.set(1, 0);
        this.scoreText.position.set(
            this.app.screen.width - this.scoreText.width,
            10
        );
    }

    resetScore(): void {
        this.scoreService.reset();
        this.scoreText.text = "0";
    }

    increaseScore(increment = 1): void {
        this.scoreService.increaseScore(increment);
        this.scoreText.text = `${this.scoreService.score}`;
    }
}
