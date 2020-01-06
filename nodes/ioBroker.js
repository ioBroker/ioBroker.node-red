/**
 * Copyright 2014-2020 bluefox <dogafox@gmail.com>.
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
    // patch event emitter
    require('events').EventEmitter.prototype._maxListeners = 100;

    const utils        = require('@iobroker/adapter-core');
    const settings     = require(process.env.NODE_RED_HOME + '/lib/red').settings;

    const instance     = settings.get('iobrokerInstance') || 0;
    let config         = settings.get('iobrokerConfig');
	const valueConvert = settings.get('valueConvert');
	const allowCreationOfForeignObjects = settings.get('allowCreationOfForeignObjects');
    if (typeof config === 'string') {
        config = JSON.parse(config);
    }
    let adapter;

    try {
        adapter = utils.Adapter({name: 'node-red', instance, config});
    } catch(e) {
        console.log(e);
    }
    const nodes = [];
    const nodeSets = [];
    const checkStates = [];
    const isValidID = new RegExp('^[-_a-z0-9]+\\.\\d+\\.');
    let ready = false;
    const log = adapter && adapter.log && adapter.log.warn ? adapter.log.warn : console.log;

    adapter.on('ready', () => {
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
                const node = nodes.pop();
                if (node instanceof IOBrokerInNode) {
                    adapter.on('stateChange', node.stateChange);
                }
                node.status({fill: 'green', shape: 'dot', text: 'connected'});
            }
            let count = 0;
            while (nodeSets.length) {
                const nodeSetData = nodeSets.pop();
                nodeSetData.node.emit('input', nodeSetData.msg);
                count++;
            }
            count > 0 && log(count + ' queued state values set in ioBroker');
        });
    });

    function isForeignState(id) {
        return isValidID.test(id) && !id.startsWith(adapter.namespace + '.');
    }

    // name is like system.state, pattern is like "*.state" or "*" or "*system*"
    function getRegex(pattern) {
        if (!pattern || pattern === '*') {
            return null;
        }
        if (!pattern.includes('*')) {
            return null;
        }
        if (pattern[pattern.length - 1] !== '*') {
            pattern = pattern + '$';
        }
        if (pattern[0] !== '*') {
            pattern = '^' + pattern;
        }
        pattern = pattern.replace(/\*/g, '[a-zA-Z0-9.\s]');
        pattern = pattern.replace(/\./g, '\\.');
        return new RegExp(pattern);
    }

    // check if object exists and sets its value if provided
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

        if (val === null || val === '__create__') {
            val = undefined;
        }

        adapter.getObject(id, (err, obj) => {
            if (!obj) {
                adapter.getForeignObject(id, (err, obj) => {
                    // If not exists
                    if (!obj) {
                        log('State "' + id + '" was created in the ioBroker as ' + adapter._fixId(id));
                        // Create object
                        const data = {
                            common: {
                                name:  node.objectPreDefinedName || id,
                                role:  node.objectPreDefinedRole || 'info',
                                type:  node.objectPreDefinedType || 'state',
                                read:  true,
                                write: !node.objectReadonly,
                                desc:  'Created by Node-Red'
                            },
                            native: {},
                            type: 'state'
                        };

                        if (isForeignState(id)) {
                            if (allowCreationOfForeignObjects) {
                                adapter.setForeignObject(id, data, _ => adapter.setForeignState(id, val, () => callback && callback()));
                            } else {
                                adapter.log.warn('Creation of foreign objects is not enabled. You can enable it in the configuration');
                                callback && callback();
                            }
                        } else {
                            adapter.setObject(id, data, _ => adapter.setState(id, val, () => callback && callback()));
                        }
                    } else {
                        node._id = obj._id;
                        if (val !== undefined) {
                            adapter.setForeignState(obj._id, val, () => callback && callback());
                        } else {
                            callback && callback();
                        }
                    }
                });
            } else {
                if (val !== undefined) {
                    adapter.setForeignState(obj._id, val, () => callback && callback());
                } else {
                    callback && callback();
                }
            }
        });
    }

    function IOBrokerInNode(n) {
        const node = this;
        RED.nodes.createNode(node,n);
        node.topic = (n.topic || '*').replace(/\//g, '.');

        // If no adapter prefix, add own adapter prefix
        if (node.topic && !isValidID.test(node.topic)) {
            node.topic = adapter.namespace + '.' + node.topic;
        }

        node.regexTopic  = getRegex(this.topic);
        node.payloadType = n.payloadType;
        node.onlyack     = (n.onlyack === true || n.onlyack === 'true' || false);
        node.func        = n.func || 'all';
        node.gap         = n.gap || '0';
        node.pc          = false;

		if (node.gap.substr(-1) === '%') {
            node.pc = true;
            node.gap = parseFloat(node.gap);
        }
        node.g = node.gap;

        node.previous = {};

        // Create ID if not exits
        if (node.topic && !node.topic.includes('*')) {
            checkState(node, node.topic);
        }

        if (ready) {
            node.status({fill: 'green', shape: 'dot', text: 'connected'});
        } else {
            node.status({fill: 'red', shape: 'ring', text: 'disconnected'}, true);
        }

        node.stateChange = function (topic, obj) {
            if (node.regexTopic) {
                if (!node.regexTopic.test(topic)) {
                    return;
                }
            } else if (node.topic !== '*' && node.topic !== topic) {
                return;
            }

			if (node.onlyack && !obj.ack) {
			    return;
            }

            const t = topic.replace(/\./g, '/') || '_no_topic';
            //node.log ("Function: " + node.func);

			if (node.func === 'rbe') {
                if (obj.val === node.previous[t]) {
                    return;
                }
            } else if (node.func === 'deadband') {
                const n = parseFloat(obj.val.toString());
                if (!isNaN(n)) {
                    //node.log('Old Value: ' + node.previous[t] + ' New Value: ' + n);
                    if (node.pc) {
                        node.gap = (node.previous[t] * node.g / 100) || 0;
                    }
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
                topic:        t,
                payload:      node.payloadType === 'object' ? obj : (obj.val === null || obj.val === undefined ? '' : (valueConvert ? obj.val.toString() : obj.val)),
                acknowledged: obj.ack,
                timestamp:    obj.ts,
                lastchange:   obj.lc,
                from:         obj.from
            });

            node.status({
                fill: 'green',
                shape: 'dot',
                text: node.payloadType === 'object' ? JSON.stringify(obj) : (obj.val === null || obj.val === undefined ? '' : obj.val.toString())
            });
        };

        node.on('close', () => 
            adapter.removeListener('stateChange', node.stateChange));

        if (ready) {
            adapter.on('stateChange', node.stateChange);
        } else {
            nodes.push(node);
        }
    }
    RED.nodes.registerType('ioBroker in', IOBrokerInNode);

    function IOBrokerOutNode(n) {
        const node = this;
        RED.nodes.createNode(node,n);
        node.topic = n.topic;

        node.ack = n.ack === 'true' || n.ack === true;
        node.autoCreate = n.autoCreate === 'true' || n.autoCreate === true;

        if (node.autoCreate) {
            node.objectPreDefinedRole = n.role;
            node.objectPreDefinedType = n.payloadType;
            node.objectPreDefinedName = n.stateName || '';
            node.objectReadonly       = n.readonly || false;
        }

        if (ready) {
            node.status({fill: 'green', shape: 'dot', text: 'connected'});
        } else {
            node.status({fill: 'red', shape: 'ring', text: 'disconnected'}, true);
        }

        function setState(id, val, ack) {
            if (node.idChecked) {
                if (val !== undefined && val !== '__create__') {
                    // If not this adapter state
                    if (isForeignState(id)) {
                        adapter.setForeignState(id, {val, ack});
                    } else {
                        adapter.setState(id, {val, ack});
                    }
                }
            } else {
                checkState(node, id, {val, ack});
            }
        }

        node.on('input', msg => {
            let id = node.topic;
            if (!id) {
                id = msg.topic;
                // if not starts with adapter.instance.
                if (id && !isValidID.test(id)) {
                    id = adapter.namespace + '.' + id;
                }
            }

            if (!ready) {
                nodeSets.push({node, msg});
                //log('Message for "' + id + '" queued because ioBroker connection not initialized');
                return;
            }
            if (id) {
                id = id.replace(/\//g, '.');
                // Create variable if not exists
                if (node.autoCreate && !node.idChecked) {
                    node.objectPreDefinedRole = node.objectPreDefinedRole || msg.role;
                    node.objectReadonly       = n.objectReadonly          || msg.readonly;
                    node.objectPreDefinedType = node.objectPreDefinedType || msg.type      || typeof msg.payload;
                    node.objectPreDefinedName = n.stateName               || msg.stateName || '';
                    id = id.replace(/\//g, '.');
                    if (!id.includes('*') && !isForeignState(id)) {
                        checkState(node, id);
                    }
                }

                // If not this adapter state
                if (isForeignState(id)) {
                    // Check if state exists
                    adapter.getForeignState(id, (err, state) => {
                        if (!err && state) {
                            adapter.setForeignState(id, {val: msg.payload, ack: node.ack});
                            node.status({
                                fill: 'green',
                                shape: 'dot',
                                text: msg.payload === null || msg.payload === undefined ? '' : msg.payload.toString()
                            });
                        } else {
                            log('State "' + id + '" does not exist in the ioBroker');
                        }
                    });
                } else {
                    if (id.includes('*')) {
                        log('Invalid topic name "' + id + '" for ioBroker');
                    } else {
                        setState(id, msg.payload, node.ack);
                        node.status({
                            fill: 'green',
                            shape: 'dot',
                            text: msg.payload === null || msg.payload === undefined ? '' : msg.payload.toString()
                        });
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
        const node = this;
        RED.nodes.createNode(node,n);
        node.topic =  (typeof n.topic=== 'string' && n.topic.length > 0 ?  n.topic.replace(/\//g, '.') : null) ;

        // If no adapter prefix, add own adapter prefix
        if (node.topic && !isValidID.test(node.topic)) {
            node.topic = adapter.namespace + '.' + node.topic;
        }

        node.payloadType = n.payloadType;
        node.attrname = n.attrname;

        // Create ID if not exits
        if (node.topic && !node.topic.includes('*')) {
            checkState(node, node.topic);
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

        node.on('input', msg => {
            let id = node.topic || msg.topic;
            if (!ready) {
                nodeSets.push({node, msg});
                //log('Message for "' + id + '" queued because ioBroker connection not initialized');
                return;
            }
            if (id) {
                if (id.includes('*')) {
                    log('Invalid topic name "' + id + '" for ioBroker');
                } else {
                    id = id.replace(/\//g, '.');
                    // If not this adapter state
                    if (isForeignState(id)) {
                        adapter.getForeignState(id, node.getStateValue(msg));
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
        const node = this;
        RED.nodes.createNode(node,n);
        node.topic =  (typeof n.topic=== 'string' && n.topic.length > 0 ?  n.topic.replace(/\//g, '.') : null) ;

        // If no adapter prefix, add own adapter prefix
        if (node.topic && !isValidID.test(node.topic)) {
            node.topic = adapter.namespace + '.' + node.topic;
        }
        node.attrname = n.attrname;

        // Create ID if not exits
        if (node.topic && !node.topic.includes('*')) {
            checkState(node, node.topic);
        }

        if (ready) {
            node.status({fill: 'green', shape: 'dot',  text: 'connected'});
        } else {
            node.status({fill: 'red',   shape: 'ring', text: 'disconnected'}, true);
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

        node.on('input', msg => {
            let id = node.topic || msg.topic;
            if (!ready) {
                nodeSets.push({node, msg});
                //log('Message for "' + id + '" queued because ioBroker connection not initialized');
            } else if (id) {
                if (id.includes('*')) {
                    log('Invalid topic name "' + id + '" for ioBroker');
                } else {
                    id = id.replace(/\//g, '.');
                    // If not this adapter state
                    if (isForeignState(id)) {
                        // Check if state exists
                        adapter.getForeignObject(id, node.getObject(msg));
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
