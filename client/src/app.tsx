import _ from "lodash";
import { useCallback, useEffect, useState } from "react";
import { createGlobalStyle } from "styled-components";
import * as Tone from "tone";

import { AppContainer } from "./app-styles";
import { getNameForEvent, GlobalConfig } from "./config";
import { Logger } from "./modules/types";
import { SoundScene } from "./sounds";
import { fetchStats, getFailureStats, Stats } from "./stats";
import ModuleRenderer from "./components/modules/module-renderer";

const GlobalStyle = createGlobalStyle`
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }
`;

// Delta change threshold in amounts
// Config file for expected errors.

// Map all oks to rain drops, all errors to synth noises
// 4 noise synths can produce up to 1024 sounds per 5 seconds

// TODO: Duration of request, difference sound reaction to success / failure
// TODO: Staff sonification of backed data, spikes could be scales up and down, steady stats would drone more.

const logLength = 24;

const passwordKey = "password";

function loadPassword(): string {
    return window.localStorage.getItem(passwordKey) ?? "";
}

function savePassword(password: string): void {
    window.localStorage.setItem(passwordKey, password);
}

enum PasswordState {
    Unchanged,
    Untested,
    Success,
    Fail,
}

function App() {
    const [config, setConfig] = useState<GlobalConfig | false>();
    const [isPlaying, setIsPlaying] = useState(false);
    const [soundScene, setSoundScene] = useState<SoundScene>();
    const [log, setLog] = useState<string[]>([]);
    const [password, setPassword] = useState<[string, PasswordState]>([loadPassword(), PasswordState.Unchanged]);

    const loopTime = 5000; // 5 seconds request and play loop

    useEffect(() => {
        const getConfig = async () => {
            // `config.json` will connect to the public Glide Radio server.  To
            // connect to the dummy server running on your own machine, fetch
            // `config-dummy.json` instead.
            const response = await fetch("/config.json");
            if (!response.ok) {
                setConfig(false);
                return;
            }
            setConfig(await response.json());
        };
        getConfig();
    }, []);

    useEffect(() => {
        const testPassword = async () => {
            if (password[1] === PasswordState.Success || password[1] === PasswordState.Fail) return;
            if (config === undefined || config === false) return;

            const data = await fetchStats(config.server, password[0]);
            const success = data !== undefined;

            setPassword([password[0], success ? PasswordState.Success : PasswordState.Fail]);
            if (success) {
                savePassword(password[0]);
            }
        };
        testPassword();
    }, [config, password]);

    const onPlay = useCallback(async () => {
        if (soundScene === undefined) return;
        // Start audio context if blocked
        await Tone.start();
        soundScene.startLoop();
        setIsPlaying(true);
    }, [soundScene]);

    useEffect(() => {
        if (config === undefined || config === false || password[1] !== PasswordState.Success) return;

        let lastLog: string[] = [];
        const logger: Logger = {
            log: t => {
                lastLog = [...lastLog, t];
                while (lastLog.length > logLength) {
                    lastLog.shift();
                }
                setLog(lastLog);
            },
        };

        const data = new Stats(config.server, password[0], loopTime, s => {
            logger.log(
                `${s.aggregates.oks} / ${s.aggregates.errors} — ` +
                    _.sortBy(getFailureStats(s.data), s => -s.count)
                        .map(s => `${getNameForEvent(s.endpoint, config)}:${s.count}`)
                        .join(" - ")
            );
        });
        data.startRequestLoop();

        const sounds = new SoundScene(loopTime, data, logger, config);
        setSoundScene(sounds);

        return () => {
            data.stopRequestLoop();
        };
    }, [config, password]);

    const setPasswordToTry = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setPassword([e.target.value, PasswordState.Untested]);
    }, []);

    const onPause = useCallback(() => {
        if (soundScene === undefined) return;
        soundScene.stopLoop();
        setIsPlaying(false);
    }, [soundScene]);

    return (
        <>
            <GlobalStyle />
            <AppContainer>
                <div className="feed"></div>

                <div className="content">
                    <div className="top">
                        <a href="https://glideapps.com/" rel="noopener noreferrer" target="_blank">
                            <img src="/images/glide.svg" alt="Glide Radio" />
                        </a>
                        <div className="description">
                            <div>
                                You're listening to{" "}
                                <a href="https://glideapps.com/" rel="noopener noreferrer" target="_blank">
                                    Glide
                                </a>
                                's backend
                            </div>

                            <div className="hiring">
                                <a href="https://glideapps.com/jobs" rel="noopener noreferrer" target="_blank">
                                    We're hiring
                                </a>
                            </div>

                            <div className="github">
                                <a
                                    className="github-link"
                                    href="https://github.com/glideapps/glide-radio"
                                    rel="noopener noreferrer"
                                    target="_blank">
                                    <img className="octocat" src="/images/github.svg" alt="Glide Radio Github" />
                                    GitHub
                                </a>
                            </div>
                        </div>
                    </div>

                    <div className="middle">
                        {(password[1] === PasswordState.Untested || password[1] === PasswordState.Fail) && (
                            <div>
                                Password
                                <input onChange={setPasswordToTry} value={password[0]} />
                            </div>
                        )}
                        {!isPlaying && (
                            <div className="button" onClick={onPlay}>
                                <img src="/images/play.svg" alt="Start radio" />
                            </div>
                        )}
                        {isPlaying && (
                            <div className="button" onClick={onPause}>
                                <img src="/images/pause.svg" alt="Stop radio" />
                            </div>
                        )}
                    </div>

                    <div className="bottom">
                        <div className="controls">
                            {soundScene?.modules.map((m, i) => (
                                <ModuleRenderer key={i} module={m} />
                            ))}
                        </div>
                        <div className="log">
                            {log.map((s, i) => (
                                <div key={i}>{s}</div>
                            ))}
                        </div>
                    </div>
                </div>
            </AppContainer>
        </>
    );
}

export default App;
