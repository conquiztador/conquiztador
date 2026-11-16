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

    private title: PIXI.Text;
    private rows: { text: PIXI.Text; buttons: Button[] }[] = [];
    private startButton: Button;
    private backButton: Button;

    constructor(app: Application, layerManager: LayerManager) {
        super(app, layerManager);
        this.visible = false;

        const title = (this.title = label("New conquest", 44, COLORS.text, {
            stroke: { color: 0x000000, width: 5 },
        }));
        title.anchor.set(0.5);
        this.addChild(title);

        this.addRow(
            "Opponents",
            [1, 2, 3, 4].map((n) => ({ label: `${n}`, value: n })),
            () => this.opponents,
            (v) => (this.opponents = v)
        );
        this.addRow(
            "Bot difficulty",
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
        const back = new Button("Back", 260, 60, 26).onClick(() => {
            this.visible = false;
            this.app.stage.emit(ButtonEvent.exitButtonClicked);
        });
        this.startButton = start;
        this.backButton = back;
        this.addChild(start, back);

        this.app.stage.on(
            ButtonEvent.newGameButtonClicked,
            () => (this.visible = true)
        );
        this.layout();
    }

    protected layout() {
        const { x } = this.app.center;
        const portrait = this.app.isPortrait;
        this.title.position.set(x, portrait ? 120 : 90);

        // Landscape: label left of the option buttons, one row per setting.
        // Portrait: label centred above its buttons.
        this.rows.forEach(({ text, buttons }, i) => {
            if (portrait) {
                const y = 210 + i * 170;
                text.anchor.set(0.5);
                text.position.set(x, y);
                buttons.forEach((b, j) =>
                    b.position.set(
                        x + (j - (buttons.length - 1) / 2) * 172,
                        y + 62
                    )
                );
            } else {
                const y = 200 + i * 100;
                text.anchor.set(1, 0.5);
                text.position.set(380, y);
                buttons.forEach((b, j) => b.position.set(510 + j * 175, y));
            }
        });

        const buttonsY = this.app.designHeight - 88;
        this.backButton.position.set(x - 150, buttonsY);
        this.startButton.position.set(x + 150, buttonsY);
    }

    private addRow<T>(
        title: string,
        options: Option<T>[],
        get: () => T,
        set: (value: T) => void
    ) {
        const text = label(title, 24, COLORS.mutedText);
        this.addChild(text);

        const buttons: Button[] = [];
        const refresh = () =>
            buttons.forEach(
                (b, i) => (b.selected = options[i].value === get())
            );
        options.forEach((o) => {
            const b = new Button(o.label, 160, 56, 22).onClick(() => {
                set(o.value);
                refresh();
            });
            buttons.push(b);
            this.addChild(b as PIXI.Container);
        });
        refresh();
        this.rows.push({ text, buttons });
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
