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
    var redis = require("redis");
    var hashFieldRE = /^([^=]+)=(.*)$/;
    var io_host = "127.0.0.1";
    var io_port = 6379;


    var redisConnectionInPool = function() {
        var connections = {};
        var obj = {
            get: function(host,port) {
                var id = host+":"+port;
                if (!connections[id]) {
                    connections[id] = redis.createClient(port,host);
                    connections[id].on("error",function(err) {
                        util.log("[ioBroker] "+err);
                    });
                    connections[id].on("connect",function() {
                        util.log("[ioBroker] connected to "+host+":"+port);
                    });
                    connections[id]._id = id;
                    connections[id]._nodeCount = 0;
                }
                connections[id]._nodeCount += 1;
                return connections[id];
            },
            close: function(connection) {
                connection._nodeCount -= 1;
                if (connection._nodeCount === 0) {
                    if (connection) {
                        clearTimeout(connection.retry_timer);
                        connection.end();
                    }
                    delete connections[connection._id];
                }
            }
        };
        return obj;
    }();
    var redisConnectionOutPool = function() {
        var connections = {};
        var obj = {
            get: function(host,port) {
                var id = host+":"+port;
                if (!connections[id]) {
                    connections[id] = redis.createClient(port,host);
                    connections[id].on("error",function(err) {
                        util.log("[ioBroker] "+err);
                    });
                    connections[id].on("connect",function() {
                        util.log("[ioBroker] connected to "+host+":"+port);
                    });
                    connections[id]._id = id;
                    connections[id]._nodeCount = 0;
                }
                connections[id]._nodeCount += 1;
                return connections[id];
            },
            close: function(connection) {
                connection._nodeCount -= 1;
                if (connection._nodeCount === 0) {
                    if (connection) {
                        clearTimeout(connection.retry_timer);
                        connection.end();
                    }
                    delete connections[connection._id];
                }
            }
        };
        return obj;
    }();

    function IOBrokerInNode(n) {
        RED.nodes.createNode(this,n);
        this.topic = n.topic || 'io.*';
        this.structtype = n.structtype;

        this.client = redisConnectionInPool.get(io_host,io_port);

        if (this.client.connected) {
            this.status({fill:"green",shape:"dot",text:"connected"});
        } else {
            this.status({fill:"red",shape:"ring",text:"disconnected"},true);
        }

        var node = this;
        this.client.on("end", function() {
            node.status({fill:"red",shape:"ring",text:"disconnected"});
        });
        this.client.on("connect", function() {
            node.status({fill:"green",shape:"dot",text:"connected"});
        });

        if (this.topic !== undefined) {
            this.client.psubscribe(this.topic);
        }

        this.client.on('pmessage', function(pattern, topic, message) {
            try {
                var obj = JSON.parse(message);
                node.send({
                    topic:       topic,
                    payload:     obj.val.toString(),
                    acknowledged:obj.ack,
                    timestamp:   obj.ts,
                    lastchange:  obj.lc,
                    from:        obj.from
                });
            } catch (e) {
                node.error('pmessage ' + topic + ' ' + message + ' ' + e.message);
            }
        });

        this.on('close', function() {
            redisConnectionInPool.close(node.client);
        });
    }
    RED.nodes.registerType("ioBroker in",IOBrokerInNode);

    function IOBrokerOutNode(n) {
        RED.nodes.createNode(this,n);
        this.topic = n.topic;
        this.ack = (n.ack === "true" || n.ack === true);

        this.client = redisConnectionOutPool.get(io_host,io_port);

        if (this.client.connected) {
            this.status({fill:"green",shape:"dot",text:"connected"});
        } else {
            this.status({fill:"red",shape:"ring",text:"disconnected"},true);
        }

        var node = this;
        this.client.on("end", function() {
            node.status({fill:"red",shape:"ring",text:"disconnected"});
        });
        this.client.on("connect", function() {
            node.status({fill:"green",shape:"dot",text:"connected"});
        });

        this.on("input", function(msg) {
            var k = node.topic || msg.topic;
            if (k && k.indexOf('*') == -1) {
                node.client.get(k, function (err, oldObj) {
                    if (!oldObj) {
                        oldObj = {};
                    } else {
                        try {
                            oldObj = JSON.parse(oldObj);
                        } catch (e) {
                            oldObj = {};
                        }
                    }

                    var obj = {};
                    if (msg.payload !== undefined) {
                        obj.val = msg.payload;
                    } else {
                        obj.val = oldObj.val;
                    }

                    obj.ack = node.ack;
                    obj.ts = Math.round((new Date()).getTime() / 1000);
                    obj.from = 'node-red';
                    var hasChanged;
                    if (typeof obj.val === 'object') {
                        hasChanged = JSON.stringify(oldObj.val) !== JSON.stringify(obj.val);
                    } else {
                        hasChanged = oldObj.val !== obj.val;
                    }
                    if (!oldObj.lc || hasChanged) {
                        obj.lc = obj.ts;
                    } else {
                        obj.lc = oldObj.lc;
                    }

                    // set object in redis
                    var str = JSON.stringify(obj);
                    console.log('Publish "' + k + '": ' + str);
                    node.client.publish(k, str);
                    node.client.set(k, str);
                });
            } else {
                if (!k) {
                    node.warn("No key or topic set");
                } else {
                    node.warn('Invalid chanracters in topic "' + k + '"');
                }
            }
        });
        this.on("close", function() {
            redisConnectionOutPool.close(node.client);
        });
    }
    RED.nodes.registerType("ioBroker out",IOBrokerOutNode);
}
