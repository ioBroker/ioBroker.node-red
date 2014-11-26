/**
 *
 *      ioBroker node-red Adapter
 *
 *      (c) 2014 bluefox<bluefox@ccu.io>
 *
 *      Apache 2.0 License
 *
 */

var adapter = require(__dirname + '/../../lib/adapter.js')({
    name: 'node-red',
    systemConfig: true, // get the system configuration as systemConfig parameter of adapter
    unload: function (callback) {
        // Stop node-red
        stopping = true;
        if (redProcess) {
            redProcess.kill();
            redProcess = null;
        }
        if(notifications) notifications.close();

        if (callback) callback();
    }});
	
var fs =      require('fs');
var spawn =   require('child_process').spawn;
var Notify =  require('fs.notify');

adapter.on('message', function (obj) {
    if (obj) processMessage(obj);
    processMessages();
});

adapter.on('ready', function () {
    main();
});


// is called if a subscribed state changes
//adapter.on('stateChange', function (id, state) {
//});

function processMessage(obj) {
    if (!obj || !obj.command) return;
    switch (obj.command) {
        case 'update': {
            writeStateList(function(error) {
                if (obj.callback) adapter.sendTo(obj.from, obj.command, error, obj.callback);
            });
        }
    }
}

function processMessages() {
    adapter.getMessage(function (err, obj) {
        if (obj) {
            processMessage(obj.command, obj.message);
            processMessages();
        }
    });
}
var redProcess;
var stopping;
var notifications;

function startNodeRed() {
    var args = [__dirname + '/node_modules/node-red/red.js', '-v', '--settings', __dirname + '/userdata/settings.js'];
    adapter.log.info('Starting node-red: ' + args.join(' '));
    redProcess = spawn('node', args);
    redProcess.stdout.on('data', function (data) {
        if (data && data[data.length - 1] == '\n')
            data = data.substring(0, data.length - 1);
        adapter.log.debug(data);
    });
    redProcess.stderr.on('data', function (data) {
        adapter.log.error(data);
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
    var toFind = "'%%" + option + "%%'";
    var pos = line.indexOf(toFind);
    if (pos != -1) {
        return line.substring(0, pos) + ((value !== undefined) ? value: adapter.config[option]) + line.substring(pos + toFind.length);
    }
    return line;
}

function writeSettings() {
    var config = JSON.stringify(adapter.systemConfig);
    var text = fs.readFileSync(__dirname + '/settings.js').toString();
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
        lines[i] = setOption(lines[i], 'port');
        lines[i] = setOption(lines[i], 'instance', adapter.instance);
        lines[i] = setOption(lines[i], 'config', config);
    }
    fs.writeFileSync(__dirname + '/userdata/settings.js', lines.join('\n'));
}

function writeStateList(callback) {
    adapter.getForeignObjects('*', 'state', 'rooms', function (err, obj) {
        var states = {};
        for (var state in obj) {
            states[state] = {name: obj[state].common.name, role: obj[state].common.role, rooms: obj[state].enums};
        }
        fs.writeFileSync(__dirname + '/node_modules/node-red/public/iobroker.json', JSON.stringify(states));
        if (callback) callback(err);
    });
}

function main() {
    // create userdata directory
    if (!fs.existsSync(__dirname + '/userdata')) {
        fs.mkdirSync(__dirname + '/userdata');
    }

    // monitor project file
    notifications = new Notify([__dirname + '/userdata/flows_cred.json', __dirname + '/userdata/flows.json']);
    notifications.on('change', function (file, event, path) {
        var cred = {};
        var flows = {};

        if (fs.existsSync(__dirname + '/userdata/flows_cred.json')) cred = JSON.parse(fs.readFileSync(__dirname + '/userdata/flows_cred.json'));
        if (fs.existsSync(__dirname + '/userdata/flows.json')) flows = JSON.parse(fs.readFileSync(__dirname + '/userdata/flows.json'));

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
        });
    });

    // Read configuration
    adapter.getObject('flows', function (err, obj) {
        if (obj && obj.native && obj.native.cred) {
            fs.writeFileSync(__dirname + '/userdata/flows_cred.json', JSON.stringify(obj.native.cred));
        }
        if (obj && obj.native && obj.native.flows) {
            fs.writeFileSync(__dirname + '/userdata/flows.json', JSON.stringify(obj.native.flows));
        }

        // Create settings for node-red
        writeSettings();
        writeStateList(function () {
            startNodeRed();
        });
    });
}

