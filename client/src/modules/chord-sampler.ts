import * as Tone from "tone";

import { GlobalConfig } from "../config";
import { StatSnapshot } from "../stats";
import { randomItem } from "../utils";
import { BaseModule } from "./base-module";
import { PlaySettings } from "./types";

interface Config {
    readonly chordURLs: readonly string[];
}

export class ChordSampleBackgroundModule extends BaseModule {
    // This is the name of the module to be displayed in the UI.
    public readonly name = "Chord samples (random)";

    private readonly players: readonly Tone.Player[];
    private numLoaded = 0;

    constructor(volume: number, globalConfig: GlobalConfig) {
        super(volume);

        // We get our config out of the global config.
        const config = globalConfig.chordSamples as Config;

        // We make a player for each of our configured samples.
        this.players = config.chordURLs.map(url => {
            return new Tone.Player({ url, onload: () => this.numLoaded++ }).chain(this.volume, Tone.Destination);
        });
    }

    public play(_snapshot: StatSnapshot, time: number, { playbackRate }: PlaySettings): void {
        if (this.numLoaded < this.players.length) return;

        // We play a random sample at the start of the loop.
        const p = randomItem(this.players);
        // We need to set the playback rate or we'll be out of harmony
        // if the melody gets elevated due to high load.
        p.playbackRate = playbackRate;
        p.start(time);
    }
}
