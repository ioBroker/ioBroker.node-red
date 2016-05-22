var expect  = require('chai').expect;
var setup   = require(__dirname + '/lib/setup');
var request = require('request');

var objects = null;
var states  = null;
var onStateChanged = null;
var onObjectChanged = null;
var port    = 18888;

function checkConnectionOfAdapter(cb, counter) {
    counter = counter || 0;
    if (counter > 20) {
        cb && cb('Cannot check connection');
        return;
    }

    states.getState('system.adapter.node-red.0.alive', function (err, state) {
        if (err) console.error(err);
        if (state && state.val) {
            cb && cb();
        } else {
            setTimeout(function () {
                checkConnectionOfAdapter(cb, counter + 1);
            }, 1000);
        }
    });
}

function checkValueOfState(id, value, cb, counter) {
    counter = counter || 0;
    if (counter > 20) {
        cb && cb('Cannot check value Of State ' + id);
        return;
    }

    states.getState(id, function (err, state) {
        if (err) console.error(err);
        if (value === null && !state) {
            cb && cb();
        } else
        if (state && (value === undefined || state.val === value)) {
            cb && cb();
        } else {
            setTimeout(function () {
                checkValueOfState(id, value, cb, counter + 1);
            }, 500);
        }
    });
}

describe('Test node-red', function() {
    before('Test node-red: Start js-controller', function (_done) {
        this.timeout(600000); // because of first install from npm

        setup.setupController(function () {
            var config = setup.getAdapterConfig();
            // enable adapter
            config.common.enabled  = true;
            config.common.loglevel = 'debug';
            config.native.port     = port;

            setup.setAdapterConfig(config.common, config.native);

            setup.startController(true, function (id, obj) {
                    if (onObjectChanged) onObjectChanged(id, obj);
                }, function (id, state) {
                    if (onStateChanged) onStateChanged(id, state);
            },
            function (_objects, _states) {
                objects = _objects;
                states  = _states;
                states.subscribe('*');
                _done();
            });
        });
    });

    it('Test node-red: Check if adapter started', function (done) {
        this.timeout(5000);
        checkConnectionOfAdapter(done);
    });

    it('Test node-red: check creation of state', function (done) {
        this.timeout(20000);
        // check if node-red is running

        setTimeout(function () {
            request('http://localhost:' + port, function (error, response, body) {
                expect(error).to.be.not.ok;
                expect(body).to.be.ok;
                done();
            });
        }, 5000);
    });

    after('Test node-red: Stop js-controller', function (done) {
        this.timeout(6000);

        setup.stopController(function (normalTerminated) {
            console.log('Adapter normal terminated: ' + normalTerminated);
            done();
        });
    });
});