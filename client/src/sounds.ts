import * as Tone from "tone";
import { GlobalConfig } from "./config";

import { ArpeggiatorModule } from "./modules/arpeggiator";
import { ChordSampleBackgroundModule } from "./modules/chord-sampler";
import { ChordSynthBackgroundModule } from "./modules/chord-synth";
import { ErrorGlitchModule } from "./modules/error-glitch";
import { EventMelodyModule } from "./modules/event-melody";
import { EventOneShotModule } from "./modules/event-one-shot";
import { LooperModule } from "./modules/looper";
import { Logger, Module } from "./modules/types";
import { Stats } from "./stats";
import { roundToNearestMultiple, scale } from "./utils";

const escalateTempo = false;
const numEscalationDimensions = escalateTempo ? 4 : 3;

export class SoundScene {
    public readonly meters: readonly Tone.Meter[];
    public readonly modules: readonly Module[];

    private readonly data: Stats;
    private readonly loopLength: number;
    private readonly isEnabled: Map<Module, boolean> = new Map();

    constructor(
        loopLength: number,
        data: Stats,
        private readonly logger: Logger,
        private readonly config: GlobalConfig
    ) {
        // Scale to seconds
        this.loopLength = loopLength / 1000;

        this.data = data;

        const compressor = new Tone.Compressor(0, 3);
        const limiter = new Tone.Limiter(0);
        const mainMeter = new Tone.Meter({ channels: 2 });

        Tone.Destination.chain(compressor, limiter, mainMeter);
        this.meters = [mainMeter];

        // 1.25 beats per second so each measure will take 5 seconds
        // and play 1 data snapshot
        Tone.Transport.bpm.value = 48;

        const defaultOnModules = [
            new ArpeggiatorModule(-20),
            new EventMelodyModule(0, config, this.logger),
            new ErrorGlitchModule(-5, config),
            new LooperModule(-5, config),
            new EventOneShotModule(0, config, this.logger),
        ];
        const defaultOffModules = [
            new ChordSampleBackgroundModule(-20, config),
            new ChordSynthBackgroundModule(-25),
            // new GranularModule(-20, config),
        ];
        for (const m of defaultOffModules) {
            m.mute();
        }
        this.modules = [...defaultOnModules, ...defaultOffModules];
        this.meters = [...this.meters, ...this.modules.map(m => m.meter)];
    }

    public startLoop() {
        Tone.Transport.start();
        Tone.Transport.scheduleRepeat(() => {
            const snapshot = this.data.getSnapshot();

            const { oks } = snapshot.aggregates;

            // FIXME: support scale < 1
            const okScale = Math.max(1, oks / this.config.okBase);
            const scalePerDimension = Math.min(4, Math.pow(okScale, 1 / numEscalationDimensions));

            const numTones = scale(scalePerDimension, { min: 1, max: 4 }, { min: 8, max: 32 });

            const clipToNearestFour = roundToNearestMultiple(numTones, 4);
            const mainSpacing = this.loopLength / clipToNearestFour;

            const semitoneOffset = Math.round(scale(scalePerDimension, { min: 1, max: 4 }, { min: 0, max: 11 }));
            const playbackRate = Math.pow(2, semitoneOffset / 12);

            const time = Tone.now();
            for (const m of this.modules) {
                if (this.isEnabled.get(m) === false) continue;

                m.play(snapshot, time, {
                    loopLength: this.loopLength,
                    numMainTones: clipToNearestFour,
                    mainSpacing,
                    scalePerDimension,
                    semitoneOffset,
                    playbackRate,
                });
            }
        }, this.loopLength);
    }

    public stopLoop() {
        for (const m of this.modules) {
            m.stop?.();
        }
        Tone.Transport.stop();
    }

    public increaseOKs() {
        this.data.increaseOKs();
    }

    public decreaseOKs() {
        this.data.decreaseOKs();
    }

    public increaseErrors() {
        this.data.increaseErrors();
    }

    public decreaseErrors() {
        this.data.decreaseErrors();
    }
}
