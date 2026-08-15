import { Adapter, type AdapterOptions, getAbsoluteDefaultDataDir } from '@iobroker/adapter-core';
import {
    createReadStream,
    createWriteStream,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { join, normalize } from 'node:path';
import { exec, spawn, type ChildProcess } from 'node:child_process';
import Notify from 'fs.notify';
import { hashSync } from 'bcrypt';

/** Root directory of the adapter. The compiled sources are located in `<adapterRootDir>/build` */
const adapterRootDir = normalize(`${__dirname}/..`);

function getNodeRedPath(): string {
    let nodeRed = `${adapterRootDir}/node_modules/node-red`;
    if (!existsSync(nodeRed)) {
        nodeRed = normalize(`${adapterRootDir}/../node-red`);
        if (!existsSync(nodeRed)) {
            nodeRed = normalize(`${adapterRootDir}/../node_modules/node-red`);
            if (!existsSync(nodeRed)) {
                throw new Error('Cannot find node-red packet!');
            }
        }
    }

    return nodeRed;
}

function getNodeRedEditorPath(): string {
    let nodeRedEditor = `${adapterRootDir}/node_modules/@node-red/editor-client`;
    if (!existsSync(nodeRedEditor)) {
        nodeRedEditor = normalize(`${adapterRootDir}/../@node-red/editor-client`);
        if (!existsSync(nodeRedEditor)) {
            nodeRedEditor = normalize(`${adapterRootDir}/../node_modules/@node-red/editor-client`);
            if (!existsSync(nodeRedEditor)) {
                throw new Error('Cannot find @node-red/editor-client packet!');
            }
        }
    }
    return nodeRedEditor;
}

const nodePath = getNodeRedPath();
const editorClientPath = getNodeRedEditorPath();

/** One user of the node-red `adminAuth` configuration */
interface NodeRedAuthUser {
    username: string;
    password: string;
    permissions: string;
}

/** The `adminAuth` configuration written into the generated settings.js */
interface NodeRedAuth {
    type: 'credentials';
    users?: NodeRedAuthUser[];
    default?: { permissions: string };
}

/** Values that may be written into the generated settings.js */
type SettingsValue = string | number | boolean | null;

class NodeRed extends Adapter {
    private systemSecret: string | null = null;
    private userDataDir: string = `${adapterRootDir}/userdata/`;
    private redProcess: ChildProcess | null = null;
    private adminUrl = '';

    private stopping = false;
    private saveTimer: ioBroker.Timeout | undefined = undefined;

    private notificationsFlows: Notify | null = null;
    private notificationsCreds: Notify | null = null;

    private readonly attempts: Record<string, number> = {};
    private readonly additional: string[] = [];

    public constructor(options: Partial<AdapterOptions> = {}) {
        super({
            ...options,
            name: 'node-red',
            systemConfig: true,
        });

        this.on('objectChange', this.onObjectChange.bind(this));
        this.on('ready', this.onReady.bind(this));
        //this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady(): Promise<void> {
        await this.setState('info.connection', { val: false, ack: true });

        this.installLibraries(() => {
            if (this.config.projectsEnabled === undefined) {
                this.config.projectsEnabled = false;
            }
            if (this.config.allowCreationOfForeignObjects === undefined) {
                this.config.allowCreationOfForeignObjects = false;
            }

            // create userData directory
            if (!existsSync(this.userDataDir)) {
                mkdirSync(this.userDataDir);
            }

            void this.generateHtml().then(() => {
                this.syncPublic();

                // Read flow configuration
                this.getObject('flows', (err, obj) => {
                    if (obj?.native?.cred) {
                        const c = JSON.stringify(obj.native.cred);
                        // If really not empty
                        if (c !== '{}' && c !== '[]') {
                            writeFileSync(join(this.userDataDir, 'flows_cred.json'), JSON.stringify(obj.native.cred));
                            this.log.debug(`Updated flow cred configuration of object data`);
                        }
                    }
                    if (obj?.native?.flows) {
                        const f = JSON.stringify(obj.native.flows);
                        // If really not empty
                        if (f !== '{}' && f !== '[]') {
                            writeFileSync(join(this.userDataDir, 'flows.json'), JSON.stringify(obj.native.flows));
                            this.log.debug(`Updated flow configuration of object data`);
                        }
                    }

                    this.installNotifierFlows(true);
                    this.installNotifierCreds(true);

                    void this.getForeignObject('system.config', (err, obj) => {
                        if (obj?.native?.secret) {
                            this.systemSecret = obj.native.secret;
                            this.log.debug(`Found system secret: ${this.systemSecret!.substring(-10)}**********`);
                        } else {
                            this.log.warn('Unable to find system secret in system.config');
                        }

                        // Create settings for node-red
                        this.writeSettings();
                        this.writeStateList(() => this.startNodeRed());
                    });
                });
            });
        });
    }

    static getAdminJson(adminInstanceObj: ioBroker.InstanceObject | null | undefined): string {
        // We can load the admin only if it has the same security (http/https) and has no authentication
        return `window.ioBrokerAdmin = ${
            adminInstanceObj
                ? JSON.stringify({
                      port: adminInstanceObj.native.port || 8081,
                      host: adminInstanceObj.native.bind === '0.0.0.0' ? '' : adminInstanceObj.native.bind,
                      protocol: adminInstanceObj.native.secure ? 'https:' : 'http:',
                  })
                : 'false'
        };`;
    }

    async onObjectChange(id: string): Promise<void> {
        if (id.startsWith('system.adapter.admin.')) {
            const { adminUrl } = await this.getWsConnectionString();
            if (this.adminUrl !== adminUrl) {
                // restart node-red to apply new settings
                this.log.info('Restarting node-red to apply new settings of admin instance');
                const obj = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
                if (obj) {
                    await this.setForeignObjectAsync(obj._id, obj);
                }
            }
        }
    }

    async getWsConnectionString(): Promise<{
        adminInstanceObj: ioBroker.InstanceObject | null | undefined;
        adminUrl: string;
    }> {
        // get settings for admin
        const settings = await this.getForeignObjectAsync(`system.adapter.${this.namespace}`);
        let adminInstanceObj: ioBroker.InstanceObject | null | undefined;
        let adminUrl = '';

        if (settings) {
            // read all admin adapters on this host
            const admins = await this.getObjectViewAsync(
                'system',
                'instance',
                { startkey: 'system.adapter.admin.', endkey: 'system.adapter.admin.\u9999' },
                {},
            );
            const admin = admins.rows.find(
                obj =>
                    // admin should run on the same host
                    obj.value.common.host === settings.common.host &&
                    // admin should be enabled
                    obj.value.common.enabled &&
                    // admin should have the secure option enabled if node-red has the secure option enabled and vice versa
                    !!obj.value.native.secure === !!settings.native.secure,
            );

            adminInstanceObj = admin?.value || null;
            if (adminInstanceObj) {
                // subscribe on changes of admin instance
                await this.subscribeForeignObjectsAsync(adminInstanceObj._id);
            }
            if (this.config.doNotReadObjectsDynamically) {
                adminUrl = '';
            } else if (adminInstanceObj && !adminInstanceObj.native.auth) {
                if (
                    (!adminInstanceObj.native.secure && !!settings.native.secure) ||
                    !!adminInstanceObj.native.secure === !!settings.native.secure
                ) {
                    adminUrl = `ws${adminInstanceObj.native.secure ? 's' : ''}://${adminInstanceObj.native.bind === '0.0.0.0' || adminInstanceObj.native.bind === '127.0.0.1' ? `' + window.location.hostname + '` : adminInstanceObj.native.bind}:${adminInstanceObj.native.port}`;
                } else {
                    adminUrl = '';
                }
            } else if (adminInstanceObj) {
                adminUrl = '';
            } else {
                adminUrl = '';
            }
        }

        return { adminInstanceObj, adminUrl };
    }

    async generateHtml(): Promise<void> {
        const searchText = '// THIS LINE WILL BE CHANGED FOR ADMIN';
        const html = readFileSync(`${adapterRootDir}/nodes/ioBroker.html`).toString('utf8');
        const lines = html.split('\n');
        const pos = lines.findIndex(line => line.includes(searchText));
        if (pos) {
            this.log.debug(`Found searched text "${searchText}" of /nodes/ioBroker.html in line ${pos + 1}`);

            const { adminInstanceObj, adminUrl } = await this.getWsConnectionString();

            if (this.config.doNotReadObjectsDynamically) {
                lines[pos] = `            var socket = null; ${searchText}`;
            } else if (adminInstanceObj) {
                if (adminUrl) {
                    lines[pos] =
                        `            var socket = new WebSocket('${adminUrl}?sid=' + Date.now()); // THIS LINE WILL BE CHANGED FOR ADMIN`;
                } else {
                    lines[pos] = `            var socket = null; ${searchText}`;
                    this.log.warn(
                        `Cannot enable the dynamic object read as admin is SSL ${adminInstanceObj.native.secure ? 'with' : 'without'} and node-red is ${this.config.secure ? 'with' : 'without'} SSL`,
                    );
                }
            } else {
                lines[pos] = `            var socket = null; ${searchText}`;
                this.log.warn(
                    `Cannot enable the dynamic object read as no admin instance found on the same host and without authentication`,
                );
            }

            const searchTextIob = '// THIS LINE WILL BE CHANGED FOR SELECT ID';
            const posIob = lines.findIndex(line => line.includes(searchTextIob));
            if (posIob !== -1) {
                lines[posIob] = `    ${NodeRed.getAdminJson(adminInstanceObj)} ${searchTextIob}`;
            }

            if (html !== lines.join('\n')) {
                writeFileSync(`${adapterRootDir}/nodes/ioBroker.html`, lines.join('\n'));
            }
            this.adminUrl = adminUrl;
        }
    }

    syncPublic(subPath?: string): void {
        subPath = subPath || '/public';

        const dirs = readdirSync(adapterRootDir + subPath);
        const dest = editorClientPath + subPath;

        if (!existsSync(dest)) {
            mkdirSync(dest);
        }

        // this.log.debug(`[syncPublic] Src ${subPath} to ${dest}`);

        for (const dir of dirs) {
            const sourcePath = `${adapterRootDir + subPath}/${dir}`;
            const destPath = `${dest}/${dir}`;

            const stat = statSync(sourcePath);
            if (stat.isDirectory()) {
                this.syncPublic(`${subPath}/${dir}`);
            } else {
                if (!existsSync(destPath)) {
                    createReadStream(sourcePath).pipe(createWriteStream(destPath));
                } else if (dir.endsWith('.js')) {
                    const destContent = readFileSync(destPath).toString('utf8');
                    const srcContent = readFileSync(sourcePath).toString('utf8');
                    if (destContent !== srcContent) {
                        createReadStream(sourcePath).pipe(createWriteStream(destPath));
                    }
                }

                this.log.debug(`[syncPublic] Copied ${sourcePath} to ${destPath}`);
            }
        }
    }

    installNotifierFlows(isFirst?: boolean): void {
        if (!this.notificationsFlows) {
            const flowsPath = join(this.userDataDir, 'flows.json');
            if (existsSync(flowsPath)) {
                if (!isFirst) {
                    this.saveObjects();
                }

                // monitor the project file
                this.notificationsFlows = new Notify([flowsPath]);
                this.notificationsFlows.on('change', () => {
                    if (this.saveTimer) {
                        this.clearTimeout(this.saveTimer);
                    }
                    this.saveTimer = this.setTimeout(this.saveObjects.bind(this), 500);
                });
            } else {
                // Try to install notifier every 10 seconds till the file will be created
                this.setTimeout(() => this.installNotifierFlows(), 10000);
            }
        }
    }

    installNotifierCreds(isFirst?: boolean): void {
        if (!this.notificationsCreds) {
            const flowsCredPath = join(this.userDataDir, 'flows_cred.json');
            if (existsSync(flowsCredPath)) {
                if (!isFirst) {
                    this.saveObjects();
                }

                // monitor the project file
                this.notificationsCreds = new Notify([flowsCredPath]);
                this.notificationsCreds.on('change', () => {
                    if (this.saveTimer) {
                        this.clearTimeout(this.saveTimer);
                    }
                    this.saveTimer = this.setTimeout(this.saveObjects.bind(this), 500);
                });
            } else {
                // Try to install notifier every 10 seconds till the file will be created
                this.setTimeout(() => this.installNotifierCreds(), 10000);
            }
        }
    }

    startNodeRed(): void {
        this.config.maxMemory = parseInt(this.config.maxMemory as string, 10) || 128;
        const args = [
            `--max-old-space-size=${this.config.maxMemory}`,
            join(nodePath, 'red.js'),
            '-v',
            '--settings',
            join(this.userDataDir, 'settings.js'),
        ];

        if (this.config.safeMode) {
            args.push('--safe');
        }

        this.log.info(`Starting node-red: ${args.join(' ')}`);

        const envVars = {
            ...process.env,
            ...this.config.envVars?.reduce<Record<string, string | null>>(
                (acc, v) => ({ ...acc, [v.name]: v.value || null }),
                {},
            ),
        } as NodeJS.ProcessEnv;

        this.redProcess = spawn('node', args, { env: envVars });
        this.redProcess.on('error', err => this.log.error(`caught exception from node-red:${JSON.stringify(err)}`));
        this.redProcess.on('spawn', () => {
            void this.setStateAsync('info.connection', { val: true, ack: true });
            this.log.info(`Node-RED started successfully (PID: ${this.redProcess?.pid})`);
        });

        this.redProcess.stdout?.on('data', (chunk: Buffer | string) => {
            if (!chunk) {
                return;
            }

            let data = chunk.toString();

            if (data.endsWith('\r\n')) {
                data = data.substring(0, data.length - 2);
            }
            if (data.endsWith('\n\r')) {
                data = data.substring(0, data.length - 2);
            }
            if (data.endsWith('\r')) {
                data = data.substring(0, data.length - 1);
            }
            if (data.endsWith('\n')) {
                data = data.substring(0, data.length - 1);
            }

            if (data.includes('[err')) {
                this.log.error(`Node-RED: ${data}`);
            } else if (data.includes('[warn]')) {
                this.log.warn(`Node-RED: ${data}`);
            } else if (data.includes('[info] [debug:')) {
                // Debug node, lets log as Info
                this.log.info(`Node-RED: ${data}`);
            } else if (data.includes('[info]')) {
                // Just "info" is more like debug
                this.log.debug(`Node-RED: ${data}`);
            } else {
                this.log.debug(`Node-RED: ${data}`);
            }
        });

        this.redProcess.stderr?.on('data', (chunk: Buffer | string) => {
            if (!chunk) {
                return;
            }

            let data: string;
            if (typeof chunk === 'string') {
                data = chunk;
            } else {
                data = '';
                for (let i = 0; i < chunk.length; i++) {
                    data += String.fromCharCode(chunk[i]);
                }
            }

            if (!data.includes('[warn]')) {
                this.log.warn(data);
            } else {
                this.log.error(JSON.stringify(data));
            }
        });

        this.redProcess.on('exit', exitCode => {
            this.log.info(`Node-RED exited with ${exitCode}`);
            this.redProcess = null;
            if (!this.stopping) {
                this.setTimeout(this.startNodeRed.bind(this), 5000);
                void this.setStateAsync('info.connection', { val: false, ack: true, c: `EXIT_CODE_${exitCode}` });
            }
        });
    }

    installNpm(npmLib: string, callback?: (npmLib: string) => void): void {
        const cmd = `npm install ${npmLib} --omit=dev --prefix "${this.userDataDir}" --save`;
        this.log.info(`${cmd} (System call)`);
        // Install node modules as system call

        // System call used for update of js-controller itself,
        // because during an installation the npm packet will be deleted too, but some files must be loaded even during the installation process.
        const child = exec(cmd);
        child.stdout?.on('data', (buf: Buffer) => this.log.info(buf.toString('utf8')));
        child.stderr?.on('data', (buf: Buffer) => this.log.error(buf.toString('utf8')));

        child.on('exit', code => {
            if (code) {
                this.log.error(`Cannot install ${npmLib}: ${code}`);
            }
            // command succeeded
            callback?.(npmLib);
        });
    }

    installLibraries(callback: () => void): void {
        let allInstalled = true;

        let npmLibs: string[] = [];
        if (typeof this.config.npmLibs === 'string') {
            npmLibs = this.config.npmLibs.split(/[,;\s]+/);
            this.config.npmLibs = npmLibs;
        } else if (Array.isArray(this.config.npmLibs)) {
            npmLibs = this.config.npmLibs;
        }

        // Find userdata directory
        if (this.instance === 0) {
            this.userDataDir = join(getAbsoluteDefaultDataDir(), 'node-red');
        } else {
            this.userDataDir = join(getAbsoluteDefaultDataDir(), `node-red.${this.instance}`);
        }

        if (this.config.npmLibs && !this.config.palletmanagerEnabled) {
            this.log.info(`Requested NPM packages: ${JSON.stringify(this.config.npmLibs)}`);
            for (let lib of npmLibs) {
                lib = lib.trim();
                if (lib) {
                    if (!existsSync(join(this.userDataDir, `node_modules/${lib}/package.json`))) {
                        if (!this.attempts[lib]) {
                            this.attempts[lib] = 1;
                        } else {
                            this.attempts[lib]++;
                        }

                        if (this.attempts[lib] > 3) {
                            this.log.error(`Cannot install npm packet: ${lib}`);
                            continue;
                        }

                        this.installNpm(lib, () => setImmediate(() => this.installLibraries(callback)));

                        allInstalled = false;
                        break;
                    } else {
                        if (!this.additional.includes(lib)) {
                            this.additional.push(lib);
                        }
                    }
                }
            }
        }

        if (allInstalled) {
            callback();
        }
    }

    setOption(line: string, option: string, value?: SettingsValue): string {
        const toFind = `'%%${option}%%'`;
        const pos = line.indexOf(toFind);

        if (pos !== -1) {
            const configValue = (this.config as Record<string, any>)[option] as SettingsValue | undefined;
            let setValue: SettingsValue =
                value !== undefined ? value : configValue === null || configValue === undefined ? '' : configValue;
            if (
                typeof setValue === 'string' &&
                !setValue.startsWith('{') &&
                !setValue.endsWith('}') &&
                !setValue.startsWith('[') &&
                !setValue.endsWith(']')
            ) {
                setValue = setValue.replace(/\\/g, '\\\\');
            }

            return `${line.substring(0, pos)}${setValue}${line.substring(pos + toFind.length)}`;
        }

        return line;
    }

    hashPassword(pass: string): string {
        return hashSync(pass, 8);
    }

    writeSettings(): void {
        const config = JSON.stringify(this.systemConfig);
        const text = readFileSync(`${adapterRootDir}/settings.js`).toString();
        const lines = text.split('\n');
        const dir = `${adapterRootDir.replace(/\\/g, '/')}/node_modules/`;
        const nodesDir = `"${adapterRootDir.replace(/\\/g, '/')}/nodes/"`;

        const bind = `"${this.config.bind || '0.0.0.0'}"`;

        let authObj: NodeRedAuth = { type: 'credentials' };
        if (this.config.authType === undefined || this.config.authType === '') {
            // first time after upgrade or fresh install
            if (this.config.user) {
                this.config.authType = 'Simple';
            } else {
                this.config.authType = 'None';
            }
        }

        switch (this.config.authType) {
            case 'None':
                authObj = { type: 'credentials', users: [], default: { permissions: '*' } };
                break;

            case 'Simple':
                authObj.users = [
                    { username: this.config.user, password: this.hashPassword(this.config.pass), permissions: '*' },
                ];
                break;

            case 'Extended':
                authObj.users = this.config.authExt.map(user => ({
                    ...user,
                    password: this.hashPassword(user.password),
                }));
                if (this.config.hasDefaultPermissions) {
                    authObj.default = { permissions: this.config.defaultPermissions };
                }
                break;
        }

        this.log.debug(
            `Writing extended authentication for authType: "${this.config.authType}": ${JSON.stringify(authObj)}`,
        );

        const pass = `"${this.config.pass}"`;
        const secure = this.config.secure ? '' : '// ';
        const certFile = this.config.certPublic ? join(this.userDataDir, `${this.config.certPublic}.crt`) : '';
        const keyFile = this.config.certPrivate ? join(this.userDataDir, `${this.config.certPrivate}.key`) : '';
        const hNodeRoot = this.config.httpNodeRoot ? this.config.httpNodeRoot : '/';
        const hStatic = this.config.httpStatic ? '' : '// ';

        const npms = this.additional
            .filter(pack => !pack.startsWith('node-red-') && !pack.startsWith('@node-red-'))
            .map(pack => `        "${pack}": require('${dir}${pack}')`)
            .join(',\n');

        this.log.debug(`[writeSettings] Additional npm packages (functionGlobalContext): ${npms}`);

        // update from 1.0.1 (new convert-option)
        const valueConvert = this.config.valueConvert as unknown;
        if (
            valueConvert === null ||
            valueConvert === undefined ||
            valueConvert === '' ||
            valueConvert === 'true' ||
            valueConvert === '1' ||
            valueConvert === 1
        ) {
            this.config.valueConvert = true;
        }
        if (valueConvert === 0 || valueConvert === '0' || valueConvert === 'false') {
            this.config.valueConvert = false;
        }

        // write certificates, if defined
        if (this.config.certPublic && this.config.certPrivate) {
            // the names default to this.config.certPublic/certPrivate
            this.getCertificates(undefined, undefined, undefined, (err, certificates) => {
                if (certificates) {
                    writeFileSync(certFile, certificates.cert);
                    writeFileSync(keyFile, certificates.key);
                }
            });
        }

        for (let i = 0; i < lines.length; i++) {
            lines[i] = this.setOption(lines[i], 'port');
            lines[i] = this.setOption(lines[i], 'auth', JSON.stringify(authObj, null, 4));
            lines[i] = this.setOption(lines[i], 'pass', pass);
            lines[i] = this.setOption(lines[i], 'secure', secure);
            lines[i] = this.setOption(lines[i], 'certPrivate', keyFile);
            lines[i] = this.setOption(lines[i], 'certPublic', certFile);
            lines[i] = this.setOption(lines[i], 'bind', bind);
            lines[i] = this.setOption(lines[i], 'port');
            lines[i] = this.setOption(lines[i], 'instance', this.instance);
            lines[i] = this.setOption(lines[i], 'config', config);
            lines[i] = this.setOption(lines[i], 'functionGlobalContext', npms);
            lines[i] = this.setOption(lines[i], 'nodesdir', nodesDir);
            lines[i] = this.setOption(lines[i], 'contextDir', this.userDataDir);
            lines[i] = this.setOption(lines[i], 'httpAdminRoot');
            lines[i] = this.setOption(lines[i], 'httpNodeRoot', hNodeRoot);
            lines[i] = this.setOption(lines[i], 'hStatic', hStatic);
            lines[i] = this.setOption(lines[i], 'httpStatic');
            lines[i] = this.setOption(lines[i], 'credentialSecret', this.systemSecret);
            lines[i] = this.setOption(lines[i], 'valueConvert');
            lines[i] = this.setOption(lines[i], 'projectsEnabled', this.config.projectsEnabled);
            lines[i] = this.setOption(lines[i], 'palletmanagerEnabled', this.config.palletmanagerEnabled);
            lines[i] = this.setOption(
                lines[i],
                'allowCreationOfForeignObjects',
                this.config.allowCreationOfForeignObjects,
            );
            lines[i] = this.setOption(lines[i], 'editor');
            lines[i] = this.setOption(lines[i], 'theme');
        }

        const settingsPath = join(this.userDataDir, 'settings.js');
        const oldText = existsSync(settingsPath) ? readFileSync(settingsPath, 'utf8') : '';
        const newText = lines.join('\n');
        if (oldText !== newText) {
            writeFileSync(settingsPath, newText);
            this.log.debug(`[writeSettings] Updated settings file: ${settingsPath}`);
        }
    }

    writeStateList(callback?: (err?: Error | null) => void): void {
        this.getForeignObjects('*', 'state', ['rooms', 'functions'], (err, objs) => {
            // remove native information
            for (const id in objs) {
                if (Object.prototype.hasOwnProperty.call(objs, id) && objs[id].native) {
                    delete (objs[id] as { native?: Record<string, any> }).native;
                }
            }

            writeFileSync(`${editorClientPath}/public/iobroker.json`, JSON.stringify(objs, null, 2));

            //this.log.debug(`[writeStateList] Updated to: ${JSON.stringify(objs)}`);

            callback?.(err);
        });
    }

    saveObjects(): void {
        if (this.saveTimer) {
            this.clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
        }

        let cred: any = undefined;
        let flows: any = undefined;

        const flowCredPath = join(this.userDataDir, 'flows_cred.json');
        try {
            if (existsSync(flowCredPath)) {
                cred = JSON.parse(readFileSync(flowCredPath, 'utf8'));
            }
        } catch {
            this.log.error(`Cannot read ${flowCredPath}`);
        }
        const flowsPath = join(this.userDataDir, 'flows.json');
        try {
            if (existsSync(flowsPath)) {
                flows = JSON.parse(readFileSync(flowsPath, 'utf8'));
            }
        } catch {
            this.log.error(`Cannot save ${flowsPath}`);
        }

        // upload it to config
        this.setObject(
            'flows',
            {
                type: 'config',
                common: {
                    name: {
                        en: 'Node-RED flows configuration',
                        de: 'Node-RED flows Konfiguration',
                        ru: 'Node-RED flows конфигурация',
                        pt: 'Node-RED flows configuração',
                        nl: 'Node-RED flows verontrusting',
                        fr: 'Node-RED flows configuration',
                        it: 'Node-RED flows configurazione',
                        es: 'Node-RED flows configuración',
                        pl: 'Node-RED flows konfiguracja',
                        uk: 'Node-RED flows конфігурація',
                        'zh-cn': 'Node-RED flows 组合',
                    },
                },
                native: {
                    cred: cred,
                    flows: flows,
                },
            },
            () => this.log.debug(`Saved flow configuration of ${flowsPath} to object`),
        );
    }

    onMessage(msg: ioBroker.Message): void {
        if (msg?.command && !msg?.callback?.ack) {
            this.log.debug(`Received command: ${JSON.stringify(msg)}`);

            switch (msg.command) {
                case 'update':
                    this.writeStateList(error => {
                        if (error) {
                            if (msg.callback) {
                                this.sendTo(msg.from, msg.command, { error }, msg.callback);
                            }
                        } else if (msg.callback) {
                            this.sendTo(msg.from, msg.command, { result: 'success' }, msg.callback);
                        }
                    });
                    break;

                case 'stopInstance':
                    this.unloadRed();
                    break;
            }
        }
    }

    unloadRed(callback?: () => void): void {
        // Stop node-red
        this.stopping = true;

        if (this.redProcess) {
            this.log.info('kill node-red task');
            this.redProcess.kill();
            this.redProcess = null;
        }

        if (this.saveTimer) {
            this.clearTimeout(this.saveTimer);
        }

        this.notificationsCreds?.close();
        this.notificationsFlows?.close();

        this.setTimeout(() => callback?.(), 2000);
    }

    onUnload(callback: () => void): void {
        try {
            this.log.info('cleaned everything up...');

            callback();
        } catch {
            // ignore
        }
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<AdapterOptions> | undefined) => new NodeRed(options);
} else {
    // otherwise start the instance directly
    (() => new NodeRed())();
}
