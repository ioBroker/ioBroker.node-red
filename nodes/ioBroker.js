/**
 * Copyright 2013,2014 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {
    'use strict';
    require('events').EventEmitter.prototype._maxListeners = 100;
    var util  = require('util');
    var utils = require('@iobroker/adapter-core');
    //var redis = require("redis");
    //var hashFieldRE = /^([^=]+)=(.*)$/;
	// Get the redis address

    var settings = require(process.env.NODE_RED_HOME + '/lib/red').settings;

    var instance = settings.get('iobrokerInstance') || 0;
    var config   = settings.get('iobrokerConfig');
	var valueConvert = settings.get('valueConvert');
    if (typeof config == 'string') {
        config = JSON.parse(config);
    }
    var adapter;

    try {
        adapter = utils.Adapter({name: 'node-red', instance: instance, config: config});
    } catch(e) {
        console.log(e);
    }
    var nodes = [];
    var nodeSets = [];
    var checkStates = [];
    var ready = false;
    var log = adapter && adapter.log && adapter.log.warn ? adapter.log.warn : console.log;

    adapter.on('ready', function () {
        function checkQueuedStates(callback) {
            if (!checkStates.length) {
                callback && callback();
                return;
            }
            const check = checkStates.shift();
            checkState(check.node, check.id, check.val, () => {
                check.callback && check.callback();
                checkQueuedStates(callback)
            });
        }

        ready = true;
        checkQueuedStates(() => {
            adapter.subscribeForeignStates('*');
            while (nodes.length) {
                var node = nodes.pop();
                if (node instanceof IOBrokerInNode) {
                    adapter.on('stateChange', node.stateChange);
                }
                node.status({fill: 'green', shape: 'dot', text: 'connected'});
            }
            var count = 0;
            while (nodeSets.length) {
                var nodeSetData = nodeSets.pop();
                nodeSetData.node.emit('input', nodeSetData.msg);
                count++;
            }
            if (count > 0) log(count + ' queued state values set in ioBroker');
        });
    });

    // name is like system.state, pattern is like "*.state" or "*" or "*system*"
    function getRegex(pattern) {
        if (!pattern || pattern === '*') return null;
        if (pattern.indexOf('*') === -1) return null;
        if (pattern[pattern.length - 1] !== '*') pattern = pattern + '$';
        if (pattern[0] !== '*') pattern = '^' + pattern;
        pattern = pattern.replace(/\*/g, '[a-zA-Z0-9.\s]');
        pattern = pattern.replace(/\./g, '\\.');
        return new RegExp(pattern);
    }

    function checkState(node, id, val, callback) {
        if (node.idChecked) {
            return callback && callback();
        }
        if (!ready) {
            checkStates.push({node, id, val, callback});
            return;
        }
        if (node.topic) {
            node.idChecked = true;
        }

        adapter.getObject(id, function (err, obj) {
            if (!obj) {
                adapter.getForeignObject(id, function (err, obj) {
                    if (!obj) {
                        log('State "' + id + '" was created in the ioBroker as ' + adapter._fixId(id));
                        // Create object
                        var common_ = {
                                name: node.objectPreDefinedName,
                                role: node.objectPreDefinedRole,
                                type: node.objectPreDefinedType,
                                read: true,
                                write: !node.objectPreDefinedReadonly,
                                desc: 'Created by Node-Red'
                        };
                        if(node.objectPreDefinedUnit !== null) common_['unit'] = node.objectPreDefinedUnit;
                        if(node.objectPreDefinedMin !== null) common_['min'] = node.objectPreDefinedMin;
                        if(node.objectPreDefinedMax !== null) common_['max'] = node.objectPreDefinedMax;
                        adapter.setObject(id, {
                            common: common_,
                            native: {},
                            type: 'state'
                        }, function (err) {
                            if (val !== undefined && val !== null && val !== '__create__') {
                                adapter.setState(id, val, function () {
                                    callback && callback();
                                });
                            } else {
                                adapter.setState(id, undefined, function () {
                                    callback && callback();
                                });
                            }
                        });
                    } else {
                        node._id = obj._id;
                        if (val !== undefined && val !== null && val !== '__create__') {
                            adapter.setForeignState(obj._id, val, function () {
                                callback && callback();
                            });
                        } else {
                            callback && callback();
                        }
                    }
                });
            } else {
                if (val !== undefined && val !== null && val !== '__create__') {
                    adapter.setForeignState(obj._id, val, function () {
                        callback && callback();
                    });
                } else {
                    callback && callback();
                }
            }
        });
    }

    function IOBrokerInNode(n) {
        var node = this;
        RED.nodes.createNode(node,n);
        node.topic = (n.topic || '*').replace(/\//g, '.');
        node.regex = new RegExp('^node-red\\.' + instance + '\\.');

        // If no adapter prefix, add own adapter prefix
        if (node.topic && node.topic.indexOf('.') === -1) {
            node.topic = adapter.namespace + '.' + node.topic;
        }

        node.regexTopic  = getRegex(this.topic);
        node.payloadType = n.payloadType;
        node.onlyack     = (n.onlyack == true || false);
        node.func        = n.func || 'all';
        node.gap         = n.gap || '0';
        node.pc          = false;

		if (node.gap.substr(-1) === '%') {
            node.pc = true;
            node.gap = parseFloat(node.gap);
        }
        node.g = node.gap;

        node.previous = {};

        if (node.topic) {
            var id = node.topic;
            // If no wildchars and belongs to this adapter
            if (id.indexOf('*') === -1 && (node.regex.test(id) || id.indexOf('.') !== -1)) {
                checkState(node, id);
            }
        }

        if (ready) {
            node.status({fill: 'green', shape: 'dot', text: 'connected'});
        } else {
            node.status({fill: 'red', shape: 'ring', text: 'disconnected'}, true);
        }

        node.stateChange = function(topic, obj) {
            if (node.regexTopic) {
                if (!node.regexTopic.test(topic)) return;
            } else if (node.topic !== '*' && node.topic !== topic) {
                return;
            }

			if (node.onlyack && obj.ack != true) return;

            var t = topic.replace(/\./g, '/') || '_no_topic';
            //node.log ("Function: " + node.func);

			if (node.func === 'rbe') {
                if (obj.val === node.previous[t]) {
                    return;
                }
            } else if (node.func === 'deadband') {
                var n = parseFloat(obj.val.toString());
                if (!isNaN(n)) {
                    //node.log('Old Value: ' + node.previous[t] + ' New Value: ' + n);
                    if (node.pc) { node.gap = (node.previous[t] * node.g / 100) || 0; }
                    if (!node.previous.hasOwnProperty(t)) {
                        node.previous[t] = n - node.gap;
                    }
                    if (!Math.abs(n - node.previous[t]) >= node.gap) {
                        return;
                    }
                } else {
                    node.warn('no number found in value');
                    return;
                }
            }
            node.previous[t] = obj.val;

            node.send({
                topic:       t,
                payload:     (node.payloadType === 'object') ? obj : ((obj.val === null || obj.val === undefined) ? '' : (valueConvert ? obj.val.toString() : obj.val)),
                acknowledged:obj.ack,
                timestamp:   obj.ts,
                lastchange:  obj.lc,
                from:        obj.from
            });

            node.status({fill: 'green', shape: 'dot', text: (node.payloadType === 'object') ? JSON.stringify(obj) : ((obj.val === null || obj.val === undefined) ? '' : obj.val.toString() ) });
        };

        node.on('close', function() {
            adapter.removeListener('stateChange', node.stateChange);
        });

        if (ready) {
            adapter.on('stateChange', node.stateChange);
        } else {
            nodes.push(node);
        }
    }
    RED.nodes.registerType('ioBroker in', IOBrokerInNode);

    function IOBrokerOutNode(n) {
        var node = this;
        RED.nodes.createNode(node,n);
        node.topic = n.topic;

        node.ack = (n.ack === 'true' || n.ack === true);
        node.autoCreate = (n.autoCreate === 'true' || n.autoCreate === true);
    //    if (node.autoCreate) {
    //        node.objectPreDefinedRole = n.stateRole;
    //        node.objectPreDefinedType = n.stateType;
    //        node.objectPreDefinedName = n.stateName || '';
    //        node.objectPreDefinedReadonly = n.stateReadonly || false;
    //        node.objectPreDefinedUnit = n.stateUnit;
    //        node.objectPreDefinedMin = n.stateMin;
    //        node.objectPreDefinedMax = n.stateMax;
    //    }
        node.regex = new RegExp('^node-red\\.' + instance + '\\.');

        if (ready) {
            node.status({fill: 'green', shape: 'dot', text: 'connected'});
        } else {
            node.status({fill: 'red', shape: 'ring', text: 'disconnected'}, true);
        }

        function setState(id, val, ack) {
            if (node.idChecked) {
                if (val !== '__create__') {
                    adapter.setState(id, {val: val, ack: ack});
                }
            } else {
                checkState(node, id, {val: val, ack: ack});
            }
        }

        node.on('input', function(msg) {
            var id = node.topic || msg.topic;
            if (!ready) {
                nodeSets.push({'node': node, 'msg': msg});
                //log('Message for "' + id + '" queued because ioBroker connection not initialized');
                return;
            }
            if (id) {
                id = id.replace(/\//g, '.');
                // Create variable if not exists
                if (node.autoCreate && !node.idChecked) {
                    node.objectPreDefinedRole = n.stateRole || msg.stateRole || 'state'
                    node.objectPreDefinedType = n.stateType || msg.stateType || typeof msg.payload
                    node.objectPreDefinedName = n.stateName || msg.stateName || id;
                    node.objectPreDefinedReadonly = n.stateReadonly || msg.stateReadonly || false;
                    node.objectPreDefinedUnit = n.stateUnit || msg.stateUnit || null;
                    node.objectPreDefinedMin = n.stateMin || msg.stateMin || null;
                    node.objectPreDefinedMax = n.stateMax || msg.stateMax || null;
                    id = id.replace(/\//g, '.');
                    // If no wildchars and belongs to this adapter
                    if (id.indexOf('*') === -1 && (node.regex.test(id) || id.indexOf('.') !== -1)) {
                        checkState(node, id);
                    }
                }

                // If not this adapter state
                if (!node.regex.test(id) && id.indexOf('.') !== -1) {
                    // Check if state exists
                    adapter.getForeignState(id, function (err, state) {
                        if (!err && state) {
                            adapter.setForeignState(id, {val: msg.payload, ack: node.ack});
                            node.status({fill: 'green', shape: 'dot', text: ((msg.payload === null || msg.payload === undefined) ? '' : msg.payload.toString().toString()) });
                        } else {
                            log('State "' + id + '" does not exist in the ioBroker');
                        }
                    });
                } else {
                    if (id.indexOf('*') !== -1) {
                        log('Invalid topic name "' + id + '" for ioBroker');
                    } else {
                        setState(id, msg.payload, node.ack);
                        node.status({fill: 'green', shape: 'dot', text: ((msg.payload === null || msg.payload === undefined) ? '' : msg.payload.toString().toString()) });
                    }
                }
            } else {
                node.warn('No key or topic set');
            }
        });

        if (!ready) {
            nodes.push(node);
        }

        //node.on("close", function() {
//
//        });

    }
    RED.nodes.registerType('ioBroker out', IOBrokerOutNode);

    function IOBrokerGetNode(n) {
        var node = this;
        RED.nodes.createNode(node,n);
        node.topic =  (typeof n.topic=== 'string' && n.topic.length > 0 ?  n.topic.replace(/\//g, '.') : null) ;

        // If no adapter prefix, add own adapter prefix
        if (node.topic && node.topic.indexOf('.') === -1) {
            node.topic = adapter.namespace + '.' + node.topic;
        }

        node.regex = new RegExp('^node-red\\.' + instance + '\\.');
        //node.regex = getRegex(this.topic);
        node.payloadType = n.payloadType;
        node.attrname = n.attrname;

        if (node.topic) {
            var id = node.topic;
            // If no wildchars and belongs to this adapter
            if (id.indexOf('*') === -1 && (node.regex.test(id) || id.indexOf('.') !== -1)) {
                checkState(node, id);
            }
        }

        if (ready) {
            node.status({fill: 'green', shape: 'dot', text: 'connected'});
        } else {
            node.status({fill: 'red', shape: 'ring', text: 'disconnected'}, true);
        }

        node.getStateValue = function (msg) {
            return function (err, state) {
                if (!err && state) {
                    msg[node.attrname] = (node.payloadType === 'object') ? state : ((state.val === null || state.val === undefined) ? '' : (valueConvert ? state.val.toString() : state.val));
                    msg.acknowledged   = state.ack;
                    msg.timestamp      = state.ts;
                    msg.lastchange     = state.lc;
                    node.status({
                        fill: 'green',
                        shape: 'dot',
                        text: (node.payloadType === 'object') ? JSON.stringify(state) : ((state.val === null || state.val === undefined) ? '' : state.val.toString())
                    });
                    node.send(msg);
                } else {
                    log('State "' + id + '" does not exist in the ioBroker');
                }
            };
        };

        node.on('input', function(msg) {
            var id = node.topic || msg.topic;
            if (!ready) {
                nodeSets.push({'node': node, 'msg': msg});
                //log('Message for "' + id + '" queued because ioBroker connection not initialized');
                return;
            }
            if (id) {
                id = id.replace(/\//g, '.');
                // If not this adapter state
                if (!node.regex.test(id) && id.indexOf('.') !== -1) {
                    // Check if state exists
                    adapter.getForeignState(id, node.getStateValue(msg));
                } else {
                    if (id.indexOf('*') !== -1) {
                        log('Invalid topic name "' + id + '" for ioBroker');
                    } else {
                        adapter.getState(id, node.getStateValue(msg));
                    }
                }
            } else {
                node.warn('No key or topic set');
            }
        });

        if (!ready) {
            nodes.push(node);
        }

    }
    RED.nodes.registerType('ioBroker get', IOBrokerGetNode);


    function IOBrokerGetObjectNode(n) {
        var node = this;
        RED.nodes.createNode(node,n);
        node.topic =  (typeof n.topic=== 'string' && n.topic.length > 0 ?  n.topic.replace(/\//g, '.') : null) ;

        // If no adapter prefix, add own adapter prefix
        if (node.topic && node.topic.indexOf('.') === -1) {
            node.topic = adapter.namespace + '.' + node.topic;
        }

        node.regex = new RegExp('^node-red\\.' + instance + '\\.');
        node.attrname = n.attrname;

        if (node.topic) {
            var id = node.topic;
            // If no wildchars and belongs to this adapter
            if (id.indexOf('*') === -1 && (node.regex.test(id) || id.indexOf('.') !== -1)) {
                checkState(node, id);
            }
        }

        if (ready) {
            node.status({fill: 'green', shape: 'dot', text: 'connected'});
        } else {
            node.status({fill: 'red', shape: 'ring', text: 'disconnected'}, true);
        }

        node.getObject = function (msg) {
            return function (err, state) {
                if (!err && state) {
                    msg[node.attrname] = state;
                    node.status({
                        fill: 'green',
                        shape: 'dot',
                        text: JSON.stringify(state)
                    });
                    node.send(msg);
                } else {
                    log('Object "' + id + '" does not exist in the ioBroker');
                }
            };
        };

        node.on('input', function(msg) {
            var id = node.topic || msg.topic;
            if (!ready) {
                nodeSets.push({'node': node, 'msg': msg});
                //log('Message for "' + id + '" queued because ioBroker connection not initialized');
                return;
            }
            if (id) {
                id = id.replace(/\//g, '.');
                // If not this adapter state
                if (!node.regex.test(id) && id.indexOf('.') !== -1) {
                    // Check if state exists
                    adapter.getForeignObject(id, node.getObject(msg));
                } else {
                    if (id.indexOf('*') !== -1) {
                        log('Invalid topic name "' + id + '" for ioBroker');
                    } else {
                        adapter.getObject(id, node.getObject(msg));
                    }
                }
            } else {
                node.warn('No key or topic set');
            }
        });

        if (!ready) {
            nodes.push(node);
        }

    }
    RED.nodes.registerType('ioBroker get object', IOBrokerGetObjectNode);

};
