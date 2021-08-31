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
    require('events').EventEmitter.prototype._maxListeners = 10000;

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
    const existingNodes = [];

    try {
        adapter = utils.Adapter({name: 'node-red', instance, config});
    } catch(e) {
        console.log(e);
    }
    if (typeof adapter.setMaxListeners === 'function') {
        adapter.setMaxListeners(10000);
    }
    const nodeSets = [];
    const checkStates = [];
    const isValidID = new RegExp('^[_A-Za-z0-9ÄÖÜäöüа-яА-Я][-_A-Za-z0-9ÄÖÜäöüа-яА-Я]*\\.\\d+\\.');
    let ready = false;
    const log = adapter && adapter.log && adapter.log.warn ? adapter.log.warn : console.log;

    adapter.on('ready', () => {
        function checkQueuedStates(callback) {
            if (!checkStates.length) {
                return callback && callback();
            }
            const check = checkStates.shift();
            checkState(check.node, check.id, check.common, check.val, () => {
                check.callback && check.callback();
                setImmediate(() => checkQueuedStates(callback));
            });
        }

        ready = true;
        checkQueuedStates(() => {
            existingNodes.forEach(node => {
                if (node instanceof IOBrokerInNode) {
                    adapter.on('stateChange', node.stateChange);
                    if (node.fireOnStart && !node.topic.includes('*')) {
                        adapter.getForeignState(node.topic, (err, state) =>
                            node.stateChange(node.topic, state));
                    }
                }
                node.subscribePattern && adapter.subscribeForeignStates(node.subscribePattern);
                node.status({fill: 'green', shape: 'dot', text: 'connected'});
            });

            let count = 0;

            while (nodeSets.length) {
                const nodeSetData = nodeSets.pop();
                nodeSetData.node.emit('input', nodeSetData.msg);
                count++;
            }
            count && log(count + ' queued state values set in ioBroker');
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
        pattern = pattern.replace(/\./g, '\\.');
        pattern = pattern.replace(/\*/g, '.*');
        return new RegExp(pattern);
    }

    // check if object exists and sets its value if provided
    function checkState(node, id, common, val, callback) {
        if (node.idChecked) {
            return callback && callback();
        }
        if (!ready) {
            checkStates.push({node, id, common, val, callback});
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
                        if (common) {
                            log('State "' + id + '" was created in the ioBroker as ' + adapter._fixId(id));
                            // Create object
                            const data = {
                                common,
                                native: {},
                                type: 'state'
                            };

                            if (isForeignState(id)) {
                                if (allowCreationOfForeignObjects) {
                                    adapter.setForeignObject(id, data, _ => adapter.setForeignState(id, val, () => callback && callback(true)));
                                } else {
                                    adapter.log.info('Creation of foreign objects is not enabled. You can enable it in the configuration');
                                    callback && callback(false);
                                }
                            } else {
                                adapter.setObject(id, data, _ => adapter.setState(id, val, () => callback && callback(true)));
                            }
                        } else {
                            adapter.log.info('Automatic objects creation is not enabled. You can enable it in the node configuration');
                            callback && callback(false);
                        }
                    } else {
                        node._id = obj._id;
                        if (val !== undefined) {
                            adapter.setForeignState(obj._id, val, () => callback && callback(true));
                        } else {
                            callback && callback(true);
                        }
                    }
                });
            } else {
                if (val !== undefined) {
                    adapter.setForeignState(obj._id, val, () => callback && callback(true));
                } else {
                    callback && callback(true);
                }
            }
        });
    }

    function assembleCommon(node, msg, id) {
        msg = msg || {};
        const common = {
            read:  true,
            write: node.objectPreDefinedReadonly,
            desc:  'Created by Node-Red',
            role:  node.objectPreDefinedRole     || msg.stateRole || 'state',
            name:  node.objectPreDefinedName     || msg.stateName || id,
            type:  node.objectPreDefinedType     || msg.stateType || typeof msg.payload || 'string'
        };
        if (msg.stateReadonly !== undefined) {
            common.write = (msg.stateReadonly === false || msg.stateReadonly === 'false');
        }

        if (node.objectPreDefinedUnit || msg.stateUnit) {
            common.unit = node.objectPreDefinedUnit || msg.stateUnit;
        }
        if (node.objectPreDefinedMax || node.objectPreDefinedMax === 0 || msg.stateMax || msg.stateMax === 0) {
            if (node.objectPreDefinedMax || node.objectPreDefinedMax === 0) {
                common.max = node.objectPreDefinedMax;
            } else {
                common.max = msg.stateMax;
            }
        }
        if (node.objectPreDefinedMin || node.objectPreDefinedMin === 0 || msg.stateMin || msg.stateMin === 0) {
            if (node.objectPreDefinedMin || node.objectPreDefinedMin === 0) {
                common.min = node.objectPreDefinedMin;
            } else {
                common.min = msg.stateMin;
            }
        }
        return common;
    }

    function defineCommon(node, n) {
        node.autoCreate = n.autoCreate === 'true' || n.autoCreate === true;

        if (node.autoCreate) {
            node.objectPreDefinedRole     = n.role;
            node.objectPreDefinedType     = n.payloadType;
            node.objectPreDefinedName     = n.stateName || '';
            node.objectPreDefinedReadonly = (n.readonly === 'false' || n.readonly === false);
            node.objectPreDefinedUnit     = n.stateUnit;
            node.objectPreDefinedMin      = n.stateMin;
            node.objectPreDefinedMax      = n.stateMax;
        }
    }

    function onClose(node) {
        const pos = existingNodes.indexOf(node);
        if (pos !== -1) {
            existingNodes.splice(pos, 1);
        }
        node.subscribePattern && adapter.unsubscribeForeignStates(node.subscribePattern);
    }

    function IOBrokerInNode(n) {
        const node = this;
        RED.nodes.createNode(node, n);
        node.topic = (n.topic || '*').replace(/\//g, '.');

        defineCommon(node, n);

        // If no adapter prefix, add own adapter prefix
        if (node.topic && !isValidID.test(node.topic) && !node.topic.startsWith(adapter.namespace)) {
            node.topic = adapter.namespace + '.' + node.topic;
        }
        node.subscribePattern = node.topic;

        node.regexTopic  = getRegex(node.topic);
        node.payloadType = n.payloadType;
        node.onlyack     = n.onlyack === true || n.onlyack === 'true' || false;
        node.func        = n.func || 'all';
        node.gap         = n.gap  || '0';
        node.gap         = n.gap  || '0';
        node.fireOnStart = n.fireOnStart === true || n.fireOnStart === 'true' || false;

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
            node.status({fill: 'green', shape: 'dot',  text: 'connected'});
        } else {
            node.status({fill: 'red',   shape: 'ring', text: 'disconnected'}, true);
        }

        node.stateChange = function (topic, state) {
            if (node.regexTopic) {
                if (!node.regexTopic.test(topic)) {
                    return;
                }
            } else if (node.topic !== '*' && node.topic !== topic) {
                return;
            }

			if (node.onlyack && state && !state.ack) {
			    return;
            }

            const t = topic.replace(/\./g, '/') || '_no_topic';
            //node.log ("Function: " + node.func);

			if (node.func === 'rbe') {
                if (state && state.val === node.previous[t]) {
                    return;
                }
            } else if (state && node.func === 'deadband') {
                const n = parseFloat(state.val.toString());
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
            node.previous[t] = state ? state.val : null;

            node.send({
                topic:        t,
                payload:      node.payloadType === 'object' ? state : (!state || state.val === null || state.val === undefined ? '' : (valueConvert ? state.val.toString() : state.val)),
                acknowledged: state ? state.ack  : false,
                timestamp:    state ? state.ts   : Date.now(),
                lastchange:   state ? state.lc   : Date.now(),
                from:         state ? state.from : ''
            });

            if (!state) {
                node.status({
                    fill: 'red',
                    shape: 'ring',
                    text: 'not exists'
                });
            } else {
                node.status({
                    fill: 'green',
                    shape: 'dot',
                    text: node.payloadType === 'object' ? JSON.stringify(state) : (!state || state.val === null || state.val === undefined ? '' : state.val.toString())
                });
            }
        };

        if (ready) {
            adapter.on('stateChange', node.stateChange);
            node.subscribePattern && adapter.subscribeForeignStates(node.subscribePattern);

            if (node.fireOnStart && !node.topic.includes('*')) {
                adapter.getForeignState(node.topic, (err, state) =>
                    node.stateChange(node.topic, state));
            }
        }

        node.on('close', () => {
            adapter.removeListener('stateChange', node.stateChange);
            onClose(node);
        });
        existingNodes.push(node);
    }
    RED.nodes.registerType('ioBroker in', IOBrokerInNode);

    function IOBrokerOutNode(n) {
        const node = this;
        RED.nodes.createNode(node, n);
        node.topic = n.topic;

        node.ack = n.ack === 'true' || n.ack === true;

        defineCommon(node, n);

        if (ready) {
            node.status({fill: 'green', shape: 'dot',  text: 'connected'});
        } else {
            node.status({fill: 'red',   shape: 'ring', text: 'disconnected'}, true);
        }

        function setState(id, val, ack, callback) {
            if (node.idChecked) {
                if (val !== undefined && val !== '__create__') {
                    // If not this adapter state
                    if (isForeignState(id)) {
                        adapter.setForeignState(id, {val, ack}, callback);
                    } else {
                        adapter.setState(id, {val, ack}, callback);
                    }
                }
            } else {
                checkState(node, id, null, {val, ack}, isOk => callback && callback(!isOk));
            }
        }

        node.on('input', (msg, send, done) => {
            let id = node.topic;
            if (!id) {
                id = msg.topic;
            }
            // if not starts with adapter.instance.
            if (id && !isValidID.test(id) && !id.startsWith(adapter.namespace)) {
                id = adapter.namespace + '.' + id;
            }

            const msgAck = msg.ack !== undefined ? (msg.ack === 'true' || msg.ack === true) : node.ack

            if (!ready) {
                //log('Message for "' + id + '" queued because ioBroker connection not initialized');
                nodeSets.push({node, msg});
            } else if (id) {
                id = id.replace(/\//g, '.');
                // Create variable if not exists
                if (node.autoCreate && !node.idChecked) {
                    if (!id.includes('*') && isValidID.test(id)) {
                        return checkState(node, id, assembleCommon(node, msg, id), {val: msg.payload, ack: msgAck}, isOk => {
                            if (isOk) {
                                node.status({
                                    fill:  'green',
                                    shape: 'dot',
                                    text:   msg.payload === null || msg.payload === undefined ? '' : msg.payload.toString()
                                });
                            } else {
                                node.status({
                                    fill:  'red',
                                    shape: 'ring',
                                    text:  'Cannot set state'
                                });
                            }
                            done();
                        });
                    }
                }
                // If not this adapter state
                if (isForeignState(id)) {
                    // Check if state exists
                    adapter.getForeignObject(id, (err, obj) => {
                        if (!err && obj) {
                            adapter.setForeignState(id, {val: msg.payload, ack: msgAck}, (err, _id) => {
                                if (err) {
                                    node.status({
                                        fill:  'red',
                                        shape: 'ring',
                                        text:   'Error on setForeignState. See Log'
                                    });
                                    log('Error on setState for ' + id + ': ' + err);
                                } else {
                                    node.status({
                                        fill: 'green',
                                        shape: 'dot',
                                        text: _id + ': ' + (msg.payload === null || msg.payload === undefined ? '' : msg.payload.toString())
                                    });
                                }
                                done();
                            });
                        } else {
                            log('State "' + id + '" does not exist in the ioBroker');
                            node.status({
                                fill:  'red',
                                shape: 'ring',
                                text:   'State "' + id + '" does not exist in the ioBroker'
                            });
                            done();
                        }
                    });
                } else {
                    if (id.includes('*')) {
                        log('Invalid topic name "' + id + '" for ioBroker');
                        node.status({
                            fill:  'red',
                            shape: 'ring',
                            text:  'Invalid topic name "' + id + '" for ioBroker'
                        });
                        done();
                    } else {
                        setState(id, msg.payload, msgAck, (err, _id) => {
                            if (err) {
                                node.status({
                                    fill:  'red',
                                    shape: 'ring',
                                    text:   'Error on setState. See Log'
                                });
                                log('Error on setState for ' + id + ': ' + err);
                            } else {
                                node.status({
                                    fill: 'green',
                                    shape: 'dot',
                                    text: _id + ': ' + (msg.payload === null || msg.payload === undefined ? '' : msg.payload.toString())
                                });
                            }
                            done();
                        });
                    }
                }
            } else {
                node.warn('No key or topic set');
                node.status({
                    fill:  'red',
                    shape: 'ring',
                    text:  'No key or topic set'
                });
                done();
            }
        });

        node.on('close', () => onClose(node));
        existingNodes.push(node);
    }
    RED.nodes.registerType('ioBroker out', IOBrokerOutNode);

    function IOBrokerGetNode(n) {
        const node = this;
        RED.nodes.createNode(node, n);
        node.topic = typeof n.topic === 'string' && n.topic.length > 0 ?  n.topic.replace(/\//g, '.') : null;

        defineCommon(node, n);

        // If no adapter prefix, add own adapter prefix
        if (node.topic && !isValidID.test(node.topic) && !node.topic.startsWith(adapter.namespace)) {
            node.topic = adapter.namespace + '.' + node.topic;
        }

        node.payloadType = n.payloadType;
        node.attrname    = n.attrname;

        // Create ID if not exits
        if (node.topic && !node.topic.includes('*')) {
            checkState(node, node.topic);
        }

        if (ready) {
            node.status({fill: 'green', shape: 'dot', text: 'connected'});
        } else {
            node.status({fill: 'red', shape: 'ring', text: 'disconnected'}, true);
        }

        node.getStateValue = function (msg, id) {
            return function (err, state) {
                if (!err && state) {
                    msg[node.attrname] = (node.payloadType === 'object') ? state : ((state.val === null || state.val === undefined) ? '' : (valueConvert ? state.val.toString() : state.val));
                    msg.acknowledged   = state.ack;
                    msg.timestamp      = state.ts;
                    msg.lastchange     = state.lc;
                    msg.topic          = node.topic || msg.topic;
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
                        return adapter.getForeignState(id, node.getStateValue(msg, id));
                    } else {
                        return adapter.getState(id, node.getStateValue(msg, id));
                    }
                }
            } else {
                node.warn('No key or topic set');
            }
        });

        node.on('close', () => onClose(node));
        existingNodes.push(node);
    }
    RED.nodes.registerType('ioBroker get', IOBrokerGetNode);

    function IOBrokerGetObjectNode(n) {
        const node = this;
        RED.nodes.createNode(node, n);
        node.topic = typeof n.topic === 'string' && n.topic.length > 0 ?  n.topic.replace(/\//g, '.') : null;

        defineCommon(node, n);

        // If no adapter prefix, add own adapter prefix
        if (node.topic && !isValidID.test(node.topic) && !node.topic.startsWith(adapter.namespace)) {
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
                    msg.topic          = node.topic || msg.topic;
                    node.status({
                        fill:  'green',
                        shape: 'dot',
                        text:  JSON.stringify(state)
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
                        return adapter.getForeignObject(id, node.getObject(msg));
                    } else {
                        return adapter.getObject(id, node.getObject(msg));
                    }
                }
            } else {
                node.warn('No key or topic set');
            }
        });

        node.on('close', () => onClose(node));
        existingNodes.push(node);
    }
    RED.nodes.registerType('ioBroker get object', IOBrokerGetObjectNode);

    function IOBrokerListNode(n) {
        const node = this;
        RED.nodes.createNode(node, n);
        node.topic = typeof n.topic === 'string' && n.topic.length > 0 ? n.topic.replace(/\//g, '.') : null;

        // If no adapter prefix, add own adapter prefix
        if (node.topic && !isValidID.test(node.topic) && !node.topic.startsWith(adapter.namespace)) {
            node.topic = adapter.namespace + '.' + node.topic;
        }
        node.objType = n.objType;
        node.regex = n.regex;
        node.asArray = n.asArray === 'true' || n.asArray === true;
        node.onlyIDs = n.onlyIDs === 'true' || n.onlyIDs === true;
        node.withValues = n.withValues === 'true' || n.withValues === true;
        if (node.regex) {
            node.regex = new RegExp(node.regex.replace('\\', '\\\\'));
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
                        fill:  'green',
                        shape: 'dot',
                        text:  JSON.stringify(state)
                    });
                    node.send(msg);
                } else {
                    log('Object "' + id + '" does not exist in the ioBroker');
                }
            };
        };

        node.on('input', async msg => {
            let pattern = node.topic || msg.topic;
            if (!ready) {
                nodeSets.push({node, msg});
            } else if (pattern) {
                pattern = pattern.replace(/\//g, '.');

                let list = {};
                // Adds result rows to the return object
                /** @param {any[] | undefined} rows */
                const addRows = rows => {
                    if (rows) {
                        for (let id in rows) {
                            list[id] = rows[id];
                        }
                    }
                };

                try {
                    if (!node.objType || node.objType === 'folder') {
                        const folders = await adapter.getForeignObjectsAsync(pattern, 'folder');
                        addRows(folders);
                    }
                } catch (err) {
                    /* ignore, we'll return what we get till now */
                    log('Error while requesting folders: ' + err);
                }
                try {
                    if (!node.objType || node.objType === 'device') {
                        const devices = await adapter.getForeignObjectsAsync(pattern, 'device');
                        addRows(devices);
                    }
                } catch (err) {
                    /* ignore, we'll return what we get till now */
                    log('Error while requesting devices: ' + err);
                }
                try {
                    if (!node.objType || node.objType === 'channel') {
                        const channels = await adapter.getForeignObjectsAsync(pattern, 'channel');
                        addRows(channels);
                    }
                } catch (err) {
                    /* ignore, we'll return what we get till now */
                    log('Error while requesting channels: ' + err);
                }
                try {
                    if (!node.objType || node.objType === 'state') {
                        const states = await adapter.getForeignObjectsAsync(pattern, 'state');
                        addRows(states);
                    }
                } catch (err) {
                    /* ignore, we'll return what we get till now */
                    log('Error while requesting states: ' + err);
                }
                try {
                    if (!node.objType || node.objType === 'meta') {
                        const metas = await adapter.getForeignObjectsAsync(pattern, 'meta');
                        addRows(metas);
                    }
                } catch (err) {
                    /* ignore, we'll return what we get till now */
                    log('Error while requesting metas: ' + err);
                }
                try {
                    if (!node.objType || node.objType === 'instance') {
                        const instances = await adapter.getForeignObjectsAsync(pattern, 'instance');
                        addRows(instances);
                    }
                } catch (err) {
                    /* ignore, we'll return what we get till now */
                    log('Error while requesting instances: ' + err);
                }
                try {
                    if (!node.objType || node.objType === 'adapter') {
                        const adapters = await adapter.getForeignObjectsAsync(pattern, 'adapter');
                        addRows(adapters);
                    }
                } catch (err) {
                    /* ignore, we'll return what we get till now */
                    log('Error while requesting adapters: ' + err);
                }

                if (node.regex) {
                    const newList = {};
                    Object.keys(list).forEach(id => {
                        if (node.regex.test(id)) {
                            newList[id] = list[id];
                        }
                    });
                    list = newList;
                }

                const ids = Object.keys(list);

                return adapter.getForeignStatesAsync(!node.withValues ? [] : ids)
                    .then(values => {
                        if (node.asArray) {
                            if (node.onlyIDs) {
                                msg.payload = ids;
                                if (node.withValues) {
                                    msg.payload = msg.payload.map(id => {
                                        values[id] = values[id] || {};
                                        values[id]._id = id;
                                        return values[id];
                                    });
                                }
                            } else {
                                let newList = [];
                                ids.forEach(id => newList.push(list[id]));
                                // Add states values if required
                                node.withValues && newList.forEach(el => Object.assign(el, values[el._id] || {}));
                                msg.payload = newList;
                            }
                            node.send(msg);
                        } else {
                            // every ID as one message
                            const _msg = JSON.parse(JSON.stringify(msg));
                            ids.forEach((id, i) => {
                                const __msg = !i ? msg : JSON.parse(JSON.stringify(_msg));
                                __msg.topic = id;
                                if (!node.onlyIDs) {
                                    __msg.payload = list[id];
                                }
                                // Add states values if required
                                if (node.withValues) {
                                    if (typeof __msg.payload !== 'object' || __msg.payload === null) {
                                        __msg.payload = {};
                                    }
                                    Object.assign(__msg.payload, values[id]);
                                }
                                node.send(__msg);
                            });
                        }
                });
            } else {
                node.warn('No pattern set');
            }
        });

        node.on('close', () => onClose(node));
        existingNodes.push(node);
    }
    RED.nodes.registerType('ioBroker list', IOBrokerListNode);
};
