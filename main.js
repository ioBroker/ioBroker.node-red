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
    unload: function (callback) {
        // Stop node-red
        stopping = true;
        if (redProcess) {
            redProcess.kill();
            redProcess = null;
        }
        if (callback) callback();
    }});
var nodered = require('node-red');
var fs =      require('fs');
var spawn   = require('child_process').spawn;

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
            writeStateList();
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

function setOption(line, option) {
    var toFind = "'%%" + option + "%%'";
    var pos = line.indexOf(toFind);
    if (pos != -1) {
        return line.substring(0, pos) + adapter.config[option] + lines[i].substring(pos + toFind.length);
    }
    return line;
}

function writeSettings() {
    var text = fs.readFileSync(__dirname + '/settings.js').toString();
    var lines = text.split('\n');
    for (var i = 0; i < lines.length; i++) {
        lines[i] = setOption(lines[i], 'port');
    }
    fs.writeFileSync(__dirname + '/userdata/settings.js', lines.join('\n'));
}

function writeStateList(callback) {
    adapter.getForeignStates('io.*', function (err, obj) {
        var states = {values: []};
        for (var state in obj) {
            states.values.push(state);
        }
        fs.writeFileSync(__dirname + '/node_modules/node-red/public/iobroker.json', JSON.stringify(states));
        if (callback) callback();
    });
}

function main() {
    // Create settings for node-red
    writeSettings();
    writeStateList(function () {
        startNodeRed();
    });
}

