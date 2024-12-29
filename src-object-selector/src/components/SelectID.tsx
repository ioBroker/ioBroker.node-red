import React, { Component } from 'react';
import { ThemeProvider, StyledEngineProvider } from '@mui/material/styles';

import {
    SelectID,
    Connection,
    PROGRESS,
    type ConnectionProps,
    Theme,
    type IobTheme,
    I18n,
} from '@iobroker/adapter-react-v5';

import langEn from '@iobroker/adapter-react-v5/i18n/en.json';
import langDe from '@iobroker/adapter-react-v5/i18n/de.json';
import langRu from '@iobroker/adapter-react-v5/i18n/ru.json';
import langPt from '@iobroker/adapter-react-v5/i18n/pt.json';
import langNl from '@iobroker/adapter-react-v5/i18n/nl.json';
import langFr from '@iobroker/adapter-react-v5/i18n/fr.json';
import langIt from '@iobroker/adapter-react-v5/i18n/it.json';
import langEs from '@iobroker/adapter-react-v5/i18n/es.json';
import langPl from '@iobroker/adapter-react-v5/i18n/pl.json';
import langUk from '@iobroker/adapter-react-v5/i18n/uk.json';
import langZhCn from '@iobroker/adapter-react-v5/i18n/zh-cn.json';

type OnClose = (
    newId: string | null,
    newObj?: ioBroker.Object | null,
    oldId?: string,
    oldObj?: ioBroker.Object | null,
) => void;

if (window.socketUrl) {
    if (window.socketUrl.startsWith(':')) {
        window.socketUrl = `${window.location.protocol}//${window.location.hostname}${window.socketUrl}`;
    } else if (!window.socketUrl.startsWith('http://') && !window.socketUrl.startsWith('https://')) {
        window.socketUrl = `${window.location.protocol}//${window.socketUrl}`;
    }
}

let connection: Connection;
function singletonConnection(props: ConnectionProps, onConnectionChanged: (connected: boolean) => void): Connection {
    if (connection) {
        return connection;
    }

    // init translations
    const translations: Record<ioBroker.Languages, Record<string, string>> = {
        en: langEn,
        de: langDe,
        ru: langRu,
        pt: langPt,
        nl: langNl,
        fr: langFr,
        it: langIt,
        es: langEs,
        pl: langPl,
        uk: langUk,
        'zh-cn': langZhCn,
    };
    I18n.setTranslations(translations);

    if (!props.protocol || !props.host || !props.port) {
        if (window.socketUrl) {
            if (window.socketUrl.startsWith('https')) {
                props.protocol = 'https:';
            } else {
                props.protocol = 'http:';
            }
            const [host, port] = window.socketUrl.split('/')[2].split(':');
            props.port = port || 80;
            props.host = host;
        }
    }

    connection = new Connection({
        ...props,
        protocol: props.protocol || window.location.protocol,
        host: props.host || window.location.hostname,
        port: props.port || 8081,
        name: 'node-red',
        onProgress: (progress: PROGRESS) => {
            if (progress === PROGRESS.CONNECTING) {
                onConnectionChanged(false);
            } else if (progress === PROGRESS.READY) {
                onConnectionChanged(true);
            } else {
                onConnectionChanged(true);
            }
        },
        onReady: (/* objects, scripts */) => {},
        // Remove this line after adapter-react-v5 version 7.4.10 is released
        onLog: (_message: any) => {
            // ignore
        },
    });
    return connection;
}

export interface ISelectIDNodeRedProps {
    port?: number | string;
    protocol?: 'http:' | 'https';
    host?: string;
    selected?: string;
    onclose: OnClose | string;
    open: string | boolean;
    language: ioBroker.Languages;
    all?: 'true' | 'false';
}

interface SelectIDNodeRedState {
    connected: boolean;
    socket: Connection;
    theme: IobTheme;
    selected: string;
    opened: boolean;
    all: 'true' | 'false';
}

export class SelectIDNodeRed extends Component<ISelectIDNodeRedProps, SelectIDNodeRedState> {
    constructor(props: ISelectIDNodeRedProps) {
        super(props);

        const theme = Theme('light');
        theme.palette.primary.main = '#AD1625';
        theme.palette.secondary.main = 'rgb(228, 145, 145)';
        theme.palette.background.paper = 'rgb(243, 243, 243)';

        this.state = {
            theme,
            selected: props.selected || '',
            socket: singletonConnection(
                {
                    port: props.port,
                    host: props.host,
                    protocol: props.protocol,
                },
                (connected: boolean) => {
                    this.setState({ connected });
                },
            ),
            opened: !!props.open,
            connected: false,
            all: props.all || 'false',
        };
        I18n.setLanguage(this.props.language || 'en');
    }

    iobOnPropertyChanged = (attr: string, value: string | boolean): void => {
        console.log(`New value ${attr}, ${value}`);
        if (attr === 'open') {
            const _opened = value === true || value === 'true';
            if (_opened !== this.state.opened) {
                this.setState({ opened: _opened });
            }
        } else if (attr === 'selected' && value !== this.state.selected) {
            this.setState({ selected: value as string });
        } else if (attr === 'all' && value !== this.state.all) {
            this.setState({ all: value as 'true' | 'false' });
        }
    };

    componentDidMount(): void {
        (window as any)._iobOnPropertyChanged = this.iobOnPropertyChanged;
    }

    componentWillUnmount(): void {
        if ((window as any)._iobOnPropertyChanged === this.iobOnPropertyChanged) {
            (window as any)._iobOnPropertyChanged = null;
        }
    }

    render(): React.JSX.Element {
        (window as any)._renderText = `[${new Date().toString()}] render`;

        console.log(
            `Render socket: ${!!this.state.socket}, theme: ${!!this.state.theme}, connected: ${this.state.connected}, opened: ${this.state.opened}, selected: ${this.state.selected}`,
        );

        if (!this.state.socket || !this.state.theme) {
            return <div>...</div>;
        }
        if (!this.state.connected) {
            return <div>...</div>;
        }

        return this.state.opened ? (
            <StyledEngineProvider injectFirst>
                <ThemeProvider theme={this.state.theme}>
                    <SelectID
                        themeName="light"
                        themeType="light"
                        allowNonObjects={this.state.all === 'true'}
                        imagePrefix={`${this.props.protocol || window.location.protocol}//${this.props.host || window.location.hostname}:${this.props.port || 8081}`}
                        theme={this.state.theme}
                        selected={this.state.selected}
                        socket={this.state.socket}
                        onClose={() => {
                            if (
                                typeof this.props.onclose === 'string' &&
                                typeof (window as any)[this.props.onclose] === 'function'
                            ) {
                                (window as any)[this.props.onclose](null);
                                return;
                            }

                            return (this.props.onclose as OnClose)(null);
                        }}
                        onOk={async (selected: string | string[] | undefined) => {
                            let id: string | undefined;
                            if (selected && typeof selected === 'object') {
                                id = selected[0];
                            } else {
                                id = selected;
                            }
                            if (id) {
                                const newObj = await this.state.socket?.getObject(id);
                                let oldObj: ioBroker.Object | undefined | null;
                                if (this.props.selected) {
                                    oldObj = await this.state.socket?.getObject(this.props.selected);
                                }
                                if (
                                    typeof this.props.onclose === 'string' &&
                                    typeof (window as any)[this.props.onclose] === 'function'
                                ) {
                                    (window as any)[this.props.onclose](id, newObj, this.props.selected, oldObj);
                                    return;
                                }

                                return (this.props.onclose as OnClose)(id, newObj, this.props.selected, oldObj);
                            }
                            if (
                                typeof this.props.onclose === 'string' &&
                                typeof (window as any)[this.props.onclose] === 'function'
                            ) {
                                (window as any)[this.props.onclose](null);
                                return;
                            }

                            return (this.props.onclose as OnClose)(null);
                        }}
                    />
                </ThemeProvider>
            </StyledEngineProvider>
        ) : (
            <div />
        );
    }
}
