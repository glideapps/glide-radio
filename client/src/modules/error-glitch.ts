import _ from "lodash";
import * as Tone from "tone";
import { GlobalConfig } from "../config";

import { StatSnapshot } from "../stats";
import { randomItem, randomItems, roundUpToMultiple } from "../utils";
import { Module, PlaySettings } from "./types";

type DrumType = "kick" | "snare" | "hihat" | "tom";

// Create a weighted pool of drum types to pick
// FIXME: Do this cleaner
const drumWeights = {
    kick: 1.0,
    hihat: 6.0,
    snare: 1.0,
    tom: 2.0,
};
const kicks: DrumType[] = _.range(drumWeights.kick).map((_) => "kick");
const snares: DrumType[] = _.range(drumWeights.snare).map((_) => "snare");
const hihats: DrumType[] = _.range(drumWeights.hihat).map((_) => "hihat");
const toms: DrumType[] = _.range(drumWeights.tom).map((_) => "tom");

const pickArray = [...kicks, ...snares, ...hihats, ...toms];

interface Config {
    readonly drumURLs: {
        readonly kick: string;
        readonly snare: string;
        readonly hihat: string;
        readonly tom: string;
    };
}

export class ErrorGlitchModule implements Module {
    public readonly name = "Drums (Errors)";
    public readonly meter: Tone.Meter;

    private readonly reverb: Tone.Reverb;
    private readonly volume: Tone.Volume;

    private readonly kickPlayer: Tone.Player;
    private readonly kickPanner: Tone.AutoPanner;

    private readonly snarePlayer: Tone.Player;
    private readonly snarePanner: Tone.AutoPanner;

    private readonly hihatPlayer: Tone.Player;
    private readonly hihatPanner: Tone.AutoPanner;

    private readonly tomPlayer: Tone.Player;
    private readonly tomPanner: Tone.AutoPanner;

    private readonly errorBase: number;

    constructor(volume: number, globalConfig: GlobalConfig) {
        const config = globalConfig.errorDrums as Config;
        this.errorBase = globalConfig.errorBase;

        this.meter = new Tone.Meter();
        this.reverb = new Tone.Reverb({ decay: 2.0, wet: 0.3 });
        this.volume = new Tone.Volume(volume).connect(this.meter);

        this.kickPanner = new Tone.AutoPanner({
            frequency: 10,
            depth: 0.1,
        }).start();
        this.kickPlayer = new Tone.Player(config.drumURLs.kick).chain(
            this.reverb,
            this.kickPanner,
            this.volume,
            Tone.Destination
        );

        this.snarePanner = new Tone.AutoPanner({
            frequency: 10,
            depth: 1.0,
        }).start();
        this.snarePlayer = new Tone.Player(config.drumURLs.snare).chain(
            this.reverb,
            this.snarePanner,
            this.volume,
            Tone.Destination
        );

        this.hihatPanner = new Tone.AutoPanner({
            frequency: 10,
            depth: 1.0,
        }).start();
        this.hihatPlayer = new Tone.Player(config.drumURLs.hihat).chain(
            this.reverb,
            this.hihatPanner,
            this.volume,
            Tone.Destination
        );

        this.tomPanner = new Tone.AutoPanner({
            frequency: 10,
            depth: 1.0,
        }).start();
        this.tomPlayer = new Tone.Player(config.drumURLs.tom).chain(
            this.reverb,
            this.tomPanner,
            this.volume,
            Tone.Destination
        );
    }

    public play(
        snapshot: StatSnapshot,
        time: number,
        { loopLength }: PlaySettings
    ): void {
        let { errors } = snapshot.aggregates;

        errors *= 12 / this.errorBase;

        let escalationVolume: number;
        if (errors <= 128) {
            escalationVolume = 0;
        } else {
            escalationVolume = Math.min(20, Math.log2(errors / 128) * 6);
            errors = 128;
        }

        const drumCounts = {
            kicks: 0,
            snares: 0,
            hihats: 0,
            toms: 0,
        };

        _.range(errors).forEach((i) => {
            // Fill up kicks and hihats first to keep pulse
            const minKicks = randomItem([4, 8]);
            const minHihats = randomItem([8, 16]);

            if (i < minKicks) {
                drumCounts.kicks += 1;
                return;
            }

            if (i < minHihats) {
                drumCounts.hihats += 1;
                return;
            }

            // Grab a random drum based on weights
            const drum = randomItem(pickArray);
            switch (drum) {
                case "snare":
                    drumCounts.snares += 1;
                    return;
                case "hihat":
                    drumCounts.hihats += 1;
                    return;
                case "tom":
                    drumCounts.toms += 1;
                    return;
            }
        });

        function getSteps(drumType: DrumType, count: number) {
            // Kicks and hihats sound better when quantized to 8
            // 4 can result in triplets so let the snares and toms do that
            const rounded =
                drumType === "kick" || drumType === "hihat"
                    ? roundUpToMultiple(count, 8)
                    : roundUpToMultiple(count, 4);
            return randomItems(_.range(rounded), count).map((i) => ({
                time: i * (loopLength / rounded),
                duration: loopLength / rounded,
                volume: _.random(-18, -22),
                playbackSpeed: _.random(0.9, 1.1),
                panFreq: _.random(0.01, 0.5),
            }));
        }

        const stepsGroup = [
            {
                player: this.kickPlayer,
                panner: this.kickPanner,
                steps: getSteps("kick", drumCounts.kicks),
            },
            {
                player: this.snarePlayer,
                panner: this.snarePanner,
                steps: getSteps("snare", drumCounts.snares),
            },
            {
                player: this.hihatPlayer,
                panner: this.hihatPanner,
                steps: getSteps("hihat", drumCounts.hihats),
            },
            {
                player: this.tomPlayer,
                panner: this.tomPanner,
                steps: getSteps("tom", drumCounts.toms),
            },
        ];

        stepsGroup.forEach((s) => {
            const { player, panner, steps } = s;
            new Tone.Part((time, value) => {
                player.start(time, 0, value.duration);
                player.volume.value = value.volume + escalationVolume;
                player.playbackRate = value.playbackSpeed;
                panner.frequency.rampTo(
                    value.panFreq,
                    _.random(1.0, loopLength / 2)
                );
            }, steps).start(time);
        });
    }

    public isMuted(): boolean {
        return this.volume.mute;
    }

    public mute(): void {
        this.volume.mute = true;
    }

    public unMute(): void {
        this.volume.mute = false;
    }
}
