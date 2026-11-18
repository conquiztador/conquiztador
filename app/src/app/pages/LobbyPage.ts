import * as PIXI from "pixi.js";

import Application from "../Application";
import { ButtonEvent, GameEvent } from "../Events";
import { Page } from "shared/Page";
import LayerManager from "app/managers/LayerManager";
import { Difficulty, PlacementMode } from "@conquiztador/core";
import { Button, COLORS, label } from "app/game/ui";
import { language, Messages, t } from "app/i18n";
import { gameClient } from "app/multiplayer/GameClient";

/** Text that's re-read from the dictionary whenever the language changes. */
type Text = (m: Messages) => string;

interface Option<T> {
    label: Text;
    value: T;
}

/** Single-player match setup: opponents, difficulty, length and placement. */
export class LobbyPage extends Page {
    private opponents = 2;
    private difficulty = Difficulty.Medium;
    private rounds = 5;
    private placement: PlacementMode = "draft";

    private title: PIXI.Text;
    private rows: {
        text: PIXI.Text;
        title: Text;
        buttons: Button[];
        labels: Text[];
    }[] = [];
    private startButton: Button;
    private backButton: Button;

    constructor(app: Application, layerManager: LayerManager) {
        super(app, layerManager);
        this.visible = false;

        const title = (this.title = label("", 44, COLORS.text, {
            stroke: { color: 0x000000, width: 5 },
        }));
        title.anchor.set(0.5);
        this.addChild(title);

        this.addRow(
            (m) => m.lobby.opponents,
            [1, 2, 3, 4].map((n) => ({ label: () => `${n}`, value: n })),
            () => this.opponents,
            (v) => (this.opponents = v)
        );
        this.addRow(
            (m) => m.lobby.difficulty,
            [
                { label: (m) => m.lobby.easy, value: Difficulty.Easy },
                { label: (m) => m.lobby.medium, value: Difficulty.Medium },
                { label: (m) => m.lobby.hard, value: Difficulty.Hard },
            ],
            () => this.difficulty,
            (v) => (this.difficulty = v)
        );
        this.addRow(
            (m) => m.lobby.rounds,
            [
                { label: (m) => m.lobby.short(3), value: 3 },
                { label: (m) => m.lobby.standard(5), value: 5 },
                { label: (m) => m.lobby.long(7), value: 7 },
            ],
            () => this.rounds,
            (v) => (this.rounds = v)
        );
        this.addRow(
            (m) => m.lobby.startingCapital,
            [
                {
                    label: (m) => m.lobby.choose,
                    value: "draft" as PlacementMode,
                },
                {
                    label: (m) => m.lobby.random,
                    value: "random" as PlacementMode,
                },
            ],
            () => this.placement,
            (v) => (this.placement = v)
        );

        const start = new Button("", 260, 60, 26).onClick(() => this.start());
        const back = new Button("", 260, 60, 26).onClick(() => {
            this.visible = false;
            this.app.stage.emit(ButtonEvent.exitButtonClicked);
        });
        this.startButton = start;
        this.backButton = back;
        this.addChild(start, back);

        this.app.stage.on(ButtonEvent.newGameButtonClicked, () => {
            this.visible = true;
        });
        this.app.stage.on(GameEvent.startMatch, () => (this.visible = false));
        this.relabel();
        this.layout();
    }

    protected relabel() {
        const m = t();
        this.title.text = m.lobby.title;
        for (const row of this.rows) {
            row.text.text = row.title(m);
            row.buttons.forEach((b, i) => (b.label = row.labels[i](m)));
        }
        this.startButton.label = m.lobby.start;
        this.backButton.label = m.lobby.back;
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
        title: Text,
        options: Option<T>[],
        get: () => T,
        set: (value: T) => void
    ) {
        const text = label("", 24, COLORS.mutedText);
        this.addChild(text);

        const buttons: Button[] = [];
        const refresh = () =>
            buttons.forEach(
                (b, i) => (b.selected = options[i].value === get())
            );
        options.forEach((o) => {
            const b = new Button("", 160, 56, 22).onClick(() => {
                set(o.value);
                refresh();
            });
            buttons.push(b);
            this.addChild(b as PIXI.Container);
        });
        refresh();
        this.rows.push({
            text,
            title,
            buttons,
            labels: options.map((o) => o.label),
        });
    }

    /**
     * Starts a single-player match on the game server (which also saves the
     * points). The server picks the questions in the current language.
     */
    private start() {
        this.visible = false;
        gameClient.startSolo({
            rounds: this.rounds as 3 | 5 | 7,
            placement: this.placement,
            language: language(),
            bots: Array.from({ length: this.opponents }, () => this.difficulty),
        });
    }
}
