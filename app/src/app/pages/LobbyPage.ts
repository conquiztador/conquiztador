import * as PIXI from "pixi.js";

import Application from "../Application";
import { ButtonEvent, GameEvent } from "../Events";
import { Page } from "shared/Page";
import LayerManager from "app/managers/LayerManager";
import { DEFAULT_CONFIG } from "app/core/GameEngine";
import { Difficulty, GameConfig, PlacementMode } from "app/core/types";
import { Button, COLORS, label } from "app/game/ui";

interface Option<T> {
    label: string;
    value: T;
}

const BOT_NAMES = ["Asparuh", "Krum", "Simeon", "Samuil"];

/** Single-player match setup: opponents, difficulty, length and placement. */
export class LobbyPage extends Page {
    private opponents = 2;
    private difficulty = Difficulty.Medium;
    private rounds = 5;
    private placement: PlacementMode = "draft";

    constructor(app: Application, layerManager: LayerManager) {
        super(app, layerManager);
        this.visible = false;

        const title = label("New conquest", 44, COLORS.text, {
            stroke: { color: 0x000000, width: 5 },
        });
        title.anchor.set(0.5);
        title.position.set(this.app.center.x, 90);
        this.addChild(title);

        let y = 200;
        this.addRow(
            "Opponents",
            y,
            [1, 2, 3, 4].map((n) => ({ label: `${n}`, value: n })),
            () => this.opponents,
            (v) => (this.opponents = v)
        );
        this.addRow(
            "Bot difficulty",
            (y += 100),
            [
                { label: "Easy", value: Difficulty.Easy },
                { label: "Medium", value: Difficulty.Medium },
                { label: "Hard", value: Difficulty.Hard },
            ],
            () => this.difficulty,
            (v) => (this.difficulty = v)
        );
        this.addRow(
            "Rounds",
            (y += 100),
            [
                { label: "Short · 3", value: 3 },
                { label: "Standard · 5", value: 5 },
                { label: "Long · 7", value: 7 },
            ],
            () => this.rounds,
            (v) => (this.rounds = v)
        );
        this.addRow(
            "Starting capital",
            (y += 100),
            [
                { label: "Choose", value: "draft" as PlacementMode },
                { label: "Random", value: "random" as PlacementMode },
            ],
            () => this.placement,
            (v) => (this.placement = v)
        );

        const start = new Button("Start", 260, 60, 26).onClick(() =>
            this.start()
        );
        start.position.set(this.app.center.x + 150, 680);
        const back = new Button("Back", 260, 60, 26).onClick(() => {
            this.visible = false;
            this.app.stage.emit(ButtonEvent.exitButtonClicked);
        });
        back.position.set(this.app.center.x - 150, 680);
        this.addChild(start, back);

        this.app.stage.on(
            ButtonEvent.newGameButtonClicked,
            () => (this.visible = true)
        );
    }

    private addRow<T>(
        title: string,
        y: number,
        options: Option<T>[],
        get: () => T,
        set: (value: T) => void
    ) {
        const text = label(title, 24, COLORS.mutedText);
        text.anchor.set(1, 0.5);
        text.position.set(380, y);
        this.addChild(text);

        const buttons: Button[] = [];
        const refresh = () =>
            buttons.forEach(
                (b, i) => (b.selected = options[i].value === get())
            );
        options.forEach((o, i) => {
            const b = new Button(o.label, 180, 56, 22).onClick(() => {
                set(o.value);
                refresh();
            });
            b.position.set(510 + i * 195, y);
            buttons.push(b);
            this.addChild(b as PIXI.Container);
        });
        refresh();
    }

    private start() {
        const config: GameConfig = {
            ...DEFAULT_CONFIG,
            rounds: this.rounds,
            placement: this.placement,
            players: [
                { id: "you", name: "You", kind: "human" },
                ...BOT_NAMES.slice(0, this.opponents).map((name, i) => ({
                    id: `bot-${i + 1}`,
                    name,
                    kind: "bot" as const,
                    difficulty: this.difficulty,
                })),
            ],
        };
        this.visible = false;
        this.app.stage.emit(GameEvent.startMatch, config);
    }
}
