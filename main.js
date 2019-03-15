/**
 *
 *      ioBroker node-red Adapter
 *
 *      (c) 2014 bluefox<bluefox@ccu.io>
 *
 *      Apache 2.0 License
 *
 */
/* jshint -W097 */// jshint strict:false
/*jslint node: true */
'use strict';

const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const adapter = utils.Adapter({
    name:           'node-red',
    systemConfig:   true, // get the system configuration as systemConfig parameter of adapter
    unload:         unloadRed
});

const fs          = require('fs');
const path        = require('path');
const spawn       = require('child_process').spawn;
const Notify      = require('fs.notify');
const attempts    = {};
const additional  = [];
let secret;

let userdataDir = __dirname + '/userdata/';

adapter.on('message', function (obj) {
    if (obj) processMessage(obj);
    processMessages();
});

adapter.on('ready', function () {
    installLibraries(main);
});

function installNpm(npmLib, callback) {
    const path = __dirname;
    if (typeof npmLib === 'function') {
        callback = npmLib;
        npmLib = undefined;
    }

    const cmd = 'npm install ' + npmLib + ' --production --prefix "' + path + '" --save';
    adapter.log.info(cmd + ' (System call)');
    // Install node modules as system call

    // System call used for update of js-controller itself,
    // because during installation npm packet will be deleted too, but some files must be loaded even during the install process.
    const exec = require('child_process').exec;
    const child = exec(cmd);
    child.stdout.on('data', function(buf) {
        adapter.log.info(buf.toString('utf8'));
    });
    child.stderr.on('data', function(buf) {
        adapter.log.error(buf.toString('utf8'));
    });

    child.on('exit', function (code, signal) {
        if (code) {
            adapter.log.error('Cannot install ' + npmLib + ': ' + code);
        }
        // command succeeded
        if (callback) callback(npmLib);
    });
}

function installLibraries(callback) {
    let allInstalled = true;
    if (typeof adapter.common.npmLibs === 'string') {
        adapter.common.npmLibs = adapter.common.npmLibs.split(/[,;\s]+/);
    }

    if (adapter.common && adapter.common.npmLibs) {
        for (let lib = 0; lib < adapter.common.npmLibs.length; lib++) {
            if (adapter.common.npmLibs[lib] && adapter.common.npmLibs[lib].trim()) {
                adapter.common.npmLibs[lib] = adapter.common.npmLibs[lib].trim();
                if (!fs.existsSync(__dirname + '/node_modules/' + adapter.common.npmLibs[lib] + '/package.json')) {

                    if (!attempts[adapter.common.npmLibs[lib]]) {
                        attempts[adapter.common.npmLibs[lib]] = 1;
                    } else {
                        attempts[adapter.common.npmLibs[lib]]++;
                    }
                    if (attempts[adapter.common.npmLibs[lib]] > 3) {
                        adapter.log.error('Cannot install npm packet: ' + adapter.common.npmLibs[lib]);
                        continue;
                    }

                    installNpm(adapter.common.npmLibs[lib], function () {
                        installLibraries(callback);
                    });
                    allInstalled = false;
                    break;
                } else {
                    if (additional.indexOf(adapter.common.npmLibs[lib]) === -1) additional.push(adapter.common.npmLibs[lib]);
                }
            }
        }
    }
    if (allInstalled) callback();
}

// is called if a subscribed state changes
//adapter.on('stateChange', function (id, state) {
//});
function unloadRed (callback) {
    // Stop node-red
    stopping = true;
    if (redProcess) {
        adapter.log.info("kill node-red task");
        redProcess.kill();
        redProcess = null;
    }
    if (notificationsCreds) notificationsCreds.close();
    if (notificationsFlows) notificationsFlows.close();

    if (callback) callback();
}

function processMessage(obj) {
    if (!obj || !obj.command) return;
    switch (obj.command) {
        case 'update':
            writeStateList(error => {
                if (typeof obj.callback === 'function') adapter.sendTo(obj.from, obj.command, error, obj.callback);
            });
            break;

        case 'stopInstance':
            unloadRed();
            break;

    }
}

function processMessages() {
    adapter.getMessage((err, obj) => {
        if (obj) {
            processMessage(obj.command, obj.message);
            processMessages();
        }
    });
}

function getNodeRedPath() {
    let nodeRed = __dirname + '/node_modules/node-red';
    if (!fs.existsSync(nodeRed)) {
        nodeRed = path.normalize(__dirname + '/../node-red');
        if (!fs.existsSync(nodeRed)) {
            nodeRed = path.normalize(__dirname + '/../node_modules/node-red');
            if (!fs.existsSync(nodeRed)) {
                adapter && adapter.log && adapter.log.error('Cannot find node-red packet!');
                throw new Error('Cannot find node-red packet!');
            }
        }
    }

    return nodeRed;
}

let redProcess;
let stopping;
let notificationsFlows;
let notificationsCreds;
let saveTimer;
const nodePath = getNodeRedPath();
const editorclientPath = getNodeRedPath() + '/../@node-red/editor-client';

function startNodeRed() {
    adapter.config.maxMemory = parseInt(adapter.config.maxMemory, 10) || 128;
    const args = ['--max-old-space-size=' + adapter.config.maxMemory, nodePath + '/red.js', '-v', '--settings', userdataDir + 'settings.js'];
    adapter.log.info('Starting node-red: ' + args.join(' '));

    redProcess = spawn('node', args);

    redProcess.on('error', function (err) {
        adapter.log.error('catched exception from node-red:' + JSON.stringify(err));
        });

    redProcess.stdout.on('data', function (data) {
        if (!data) return;
        data = data.toString();
        if (data[data.length - 2] === '\r' && data[data.length - 1] === '\n') data = data.substring(0, data.length - 2);
        if (data[data.length - 2] === '\n' && data[data.length - 1] === '\r') data = data.substring(0, data.length - 2);
        if (data[data.length - 1] === '\r') data = data.substring(0, data.length - 1);

        if (data.indexOf('[err') !== -1) {
            adapter.log.error(data);
        }  else if (data.indexOf('[warn]') !== -1) {
            adapter.log.warn(data);
        } else {
            adapter.log.debug(data);
        }
    });
    redProcess.stderr.on('data', function (data) {
		if (!data) return;
		if (data[0]) {
            let text = '';
			for (let i = 0; i < data.length; i++) {
				text += String.fromCharCode(data[i]);
			}
			data = text;
		}
        if (data.indexOf && data.indexOf('[warn]') === -1) {
            adapter.log.warn(data);
        } else {
            adapter.log.error(JSON.stringify(data));
        }
    });

    redProcess.on('exit', function (exitCode) {
        adapter.log.info('node-red exited with ' + exitCode);
        redProcess = null;
        if (!stopping) {
            setTimeout(startNodeRed, 5000);
        }
    });
}

function setOption(line, option, value) {
    const toFind = "'%%" + option + "%%'";
    const pos = line.indexOf(toFind);
    if (pos !== -1) {
        return line.substring(0, pos) + ((value !== undefined) ? value : (adapter.config[option] === null || adapter.config[option] === undefined) ? '' : adapter.config[option]) + line.substring(pos + toFind.length);
    }
    return line;
}

function writeSettings() {
    const config = JSON.stringify(adapter.systemConfig);
    const text = fs.readFileSync(__dirname + '/settings.js').toString();
    const lines = text.split('\n');
    let npms = '\r\n';
    const dir = __dirname.replace(/\\/g, '/') + '/node_modules/';
    const nodesDir = '"' + __dirname.replace(/\\/g, '/') + '/nodes/"';

    const bind = '"' + (adapter.config.bind || '0.0.0.0') + '"';
    const auth = adapter.config.user && adapter.config.pass ? JSON.stringify({user: adapter.config.user, pass: adapter.config.pass}) : '""';
    const pass = '"' + adapter.config.pass + '"';

    for (let a = 0; a < additional.length; a++) {
        if (additional[a].match(/^node-red-/)) continue;
        npms += '        "' + additional[a] + '": require("' + dir + additional[a] + '")';
        if (a !== additional.length - 1) {
            npms += ', \r\n';
        }
    }

	// update from 1.0.1 (new convert-option)
	if (adapter.config.valueConvert === null      ||
        adapter.config.valueConvert === undefined ||
        adapter.config.valueConvert === ''        ||
        adapter.config.valueConvert === 'true'    ||
        adapter.config.valueConvert === '1'       ||
        adapter.config.valueConvert === 1) {
		adapter.config.valueConvert = true;
	}
    if (adapter.config.valueConvert === 0   ||
        adapter.config.valueConvert === '0' ||
        adapter.config.valueConvert === 'false') {
        adapter.config.valueConvert = false;
    }
    for (let i = 0; i < lines.length; i++) {
        lines[i] = setOption(lines[i], 'port');
        lines[i] = setOption(lines[i], 'auth', auth);
        lines[i] = setOption(lines[i], 'pass', pass);
        lines[i] = setOption(lines[i], 'bind', bind);
        lines[i] = setOption(lines[i], 'port');
        lines[i] = setOption(lines[i], 'instance', adapter.instance);
        lines[i] = setOption(lines[i], 'config', config);
        lines[i] = setOption(lines[i], 'functionGlobalContext', npms);
        lines[i] = setOption(lines[i], 'nodesdir', nodesDir);
        lines[i] = setOption(lines[i], 'httpRoot');
        lines[i] = setOption(lines[i], 'credentialSecret', secret);
		lines[i] = setOption(lines[i], 'valueConvert');
    }
    fs.writeFileSync(userdataDir + 'settings.js', lines.join('\n'));
}

function writeStateList(callback) {
    adapter.getForeignObjects('*', 'state', ['rooms', 'functions'], function (err, obj) {
        // remove native information
        for (const i in obj) {
            if (obj.hasOwnProperty(i) && obj[i].native) {
                delete obj[i].native;
            }
        }

        fs.writeFileSync(editorclientPath + '/public/iobroker.json', JSON.stringify(obj));
        if (callback) callback(err);
    });
}

function saveObjects() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }
    let cred  = undefined;
    let flows = undefined;

    try {
        if (fs.existsSync(userdataDir + 'flows_cred.json')) {
            cred = JSON.parse(fs.readFileSync(userdataDir + 'flows_cred.json'));
        }
    } catch(e) {
        adapter.log.error('Cannot save ' + userdataDir + 'flows_cred.json');
    }
    try {
        if (fs.existsSync(userdataDir + 'flows.json')) {
            flows = JSON.parse(fs.readFileSync(userdataDir + 'flows.json'));
        }
    } catch(e) {
        adapter.log.error('Cannot save ' + userdataDir + 'flows.json');
    }
    //upload it to config
    adapter.setObject('flows', {
        common: {
            name: 'Flows for node-red'
        },
        native: {
            cred:  cred,
            flows: flows
        },
        type: 'config'
    }, function () {
        adapter.log.info('Save ' + userdataDir + 'flows.json');
    });
}

function syncPublic(path) {
    if (!path) path = '/public';

    const dir = fs.readdirSync(__dirname + path);

    if (!fs.existsSync(editorclientPath + path)) {
        fs.mkdirSync(editorclientPath + path);
    }

    for (let i = 0; i < dir.length; i++) {
        const stat = fs.statSync(__dirname + path + '/' + dir[i]);
        if (stat.isDirectory())  {
            syncPublic(path + '/' + dir[i]);
        } else {
            if (!fs.existsSync(editorclientPath + path + '/' + dir[i])) {
                fs.createReadStream(__dirname + path + '/' + dir[i]).pipe(fs.createWriteStream(editorclientPath + path + '/' + dir[i]));
            }
        }
    }
}

function installNotifierFlows(isFirst) {
    if (!notificationsFlows) {
        if (fs.existsSync(userdataDir + 'flows.json')) {
            if (!isFirst) saveObjects();
            // monitor project file
            notificationsFlows = new Notify([userdataDir + 'flows.json']);
            notificationsFlows.on('change', function () {
                if (saveTimer) clearTimeout(saveTimer);
                saveTimer = setTimeout(saveObjects, 500);
            });
        } else {
            // Try to install notifier every 10 seconds till the file will be created
            setTimeout(function () {
                installNotifierFlows();
            }, 10000);
        }
    }
}

function installNotifierCreds(isFirst) {
    if (!notificationsCreds) {
        if (fs.existsSync(userdataDir + 'flows_cred.json')) {
            if (!isFirst) saveObjects();
            // monitor project file
            notificationsCreds = new Notify([userdataDir + 'flows_cred.json']);
            notificationsCreds.on('change', function () {
                if (saveTimer) clearTimeout(saveTimer);
                saveTimer = setTimeout(saveObjects, 500);
            });
        } else {
            // Try to install notifier every 10 seconds till the file will be created
            setTimeout(function () {
                installNotifierCreds();
            }, 10000);
        }
    }
}

function main() {
    // Find userdata directory

    // normally /opt/iobroker/node_modules/iobroker.js-controller
    // but can be /example/ioBroker.js-controller
    const controllerDir = utils.controllerDir;
    const parts = controllerDir.split('/');
    if (parts.length > 1 && parts[parts.length - 2] === 'node_modules') {
        parts.splice(parts.length - 2, 2);
        userdataDir = parts.join('/');
        userdataDir += '/iobroker-data/node-red/';
    }

    // create userdata directory
    if (!fs.existsSync(userdataDir)) {
        fs.mkdirSync(userdataDir);
    }

    syncPublic();

    // Read configuration
    adapter.getObject('flows', function (err, obj) {
        if (obj && obj.native && obj.native.cred) {
            const c = JSON.stringify(obj.native.cred);
            // If really not empty
            if (c !== '{}' && c !== '[]') {
                fs.writeFileSync(userdataDir + 'flows_cred.json', JSON.stringify(obj.native.cred));
            }
        }
        if (obj && obj.native && obj.native.flows) {
            const f = JSON.stringify(obj.native.flows);
            // If really not empty
            if (f !== '{}' && f !== '[]') {
                fs.writeFileSync(userdataDir  + 'flows.json', JSON.stringify(obj.native.flows));
            }
        }

        installNotifierFlows(true);
        installNotifierCreds(true);

        adapter.getForeignObject('system.config', (err, obj) => {
            if (obj && obj.native && obj.native.secret) {
                //noinspection JSUnresolvedVariable
                secret = obj.native.secret;
            }
            // Create settings for node-red
            writeSettings();
            writeStateList(() => startNodeRed());
        });
    });
}
