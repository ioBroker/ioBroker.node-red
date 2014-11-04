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
    "use strict";
    var util = require("util");
    //var redis = require("redis");
    var hashFieldRE = /^([^=]+)=(.*)$/;
	// Get the redis address

	var settings = require(process.env.NODE_RED_HOME+"/red/red").settings;
    var instance = settings.get('iobrokerInstance') || 0;
    var config   = settings.get('iobrokerConfig');
    if (typeof config == 'string') {
        config = JSON.parse(config);
    }

    try {
        var adapter = require(__dirname + '/../../../lib/adapter.js')({name: 'node-red', instance: instance, config: config});
    } catch(e) {
        console.log(e);
    }
    var nodes = [];
    var ready = false;

    adapter.on("ready", function () {
        ready = true;
        adapter.subscribeForeignStates('io.*');
        while (nodes.length) {
            var node = nodes.pop();
            if (node instanceof IOBrokerInNode)
                adapter.on('stateChange', node.stateChange);
            node.status({fill:"green",shape:"dot",text:"connected"});
        }
    });

    // name is like io.system.state, pattern is like "*.state" or "io.*" or "*system*"
    function getRegex(pattern) {
        if (!pattern || pattern == '*') return null;
        if (pattern.indexOf('*') == -1) return null;
        if (pattern[pattern.length - 1] != '*') pattern = pattern + '$';
        if (pattern[0] != '*') pattern = '^' + pattern;
        pattern = pattern.replace(/\*/g, '[a-zA-Z0-9.\s]');
        return new RegExp(pattern);
    }

    function IOBrokerInNode(n) {
        var node = this;
        RED.nodes.createNode(node,n);
        node.topic = n.topic || 'io.*';
        node.structtype = n.structtype;
        node.regex = getRegex(this.topic);

        if (ready) {
            node.status({fill:"green",shape:"dot",text:"connected"});
        } else {
            node.status({fill:"red",shape:"ring",text:"disconnected"},true);
        }

        node.stateChange = function(topic, obj) {
            if (node.regex && !node.regex.exec(topic)) return;

            node.send({
                topic:       topic,
                payload:     obj.val.toString(),
                acknowledged:obj.ack,
                timestamp:   obj.ts,
                lastchange:  obj.lc,
                from:        obj.from
            });
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
    RED.nodes.registerType("ioBroker in",IOBrokerInNode);

    function IOBrokerOutNode(n) {
        var node = this;
        RED.nodes.createNode(node,n);
        node.topic = n.topic;
        node.ack = (n.ack === "true" || n.ack === true);
        node.autoCreate = n.autoCreate;
        node.regex = new RegExp("^io\.node-red\." + instance);

        if (ready) {
            node.status({fill:"green",shape:"dot",text:"connected"});
        } else {
            node.status({fill:"red",shape:"ring",text:"disconnected"},true);
        }


        node.on("input", function(msg) {
            var id = node.topic || msg.topic;
            if (id) {
                if (id.match(/^io\./) && !node.regex.exec(id)) {
                    // Check if state exists
                    adapter.getForeignState(id, function (obj) {
                        if (obj) {
                            adapter.setForeignState(id, {val: msg.payload, ack: node.ack});
                        } else {
                            adapter.log.warn('State "' + id + '" does not exist in the ioBroker')
                        }
                    });
                } else {
                    adapter.getObject(id, function (obj) {
                        if (!obj) {
                            if (!node.autoCreate) {
                                adapter.log.warn('State "' + id + '" does not exist in the ioBroker.');
                                return;
                            }
                            adapter.log.warn('State "' + id + '" was created in the ioBroker as ' + adapter._fixId(id));
                            // Create object
                            adapter.setObject(id, {
                                common: {
                                    name: id,
                                    role: 'info'
                                },
                                parent: 'node-red.' + settings.iobrokerInstance,
                                native: {},
                                type: 'state'
                            });
                            adapter.setState(id, {val: msg.payload, ack: node.ack});
                        } else {
                            adapter.setState(id, {val: msg.payload, ack: node.ack});
                        }
                    });
                }
            } else {
                node.warn("No key or topic set");
            }
        });
        if (!ready) {
            nodes.push(node);
        }

        //node.on("close", function() {
//
//        });

    }
    RED.nodes.registerType("ioBroker out",IOBrokerOutNode);
}
