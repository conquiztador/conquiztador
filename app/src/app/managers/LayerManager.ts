import { Service } from "typedi";
import { RenderLayer } from "pixi.js";

import Application from "app/Application";

@Service()
export default class LayerManager {
    public background: RenderLayer;
    public foreground: RenderLayer;

    constructor(private app: Application) {
        this.background = new RenderLayer({ sortableChildren: true });
        this.foreground = new RenderLayer({ sortableChildren: true });

        this.app.stage.addChild(this.background, this.foreground);
    }
}
