var net          = require('net');
var util         = require('util');
var EventEmitter = require('events').EventEmitter;

var phidgets = function(options) {
    this.options = this.defaults();
    this.data = {}
    this.ready = false;
    this.socketDataString = '';
    this.client = null;
    this.shouldReconnect = true;
    this.ids = [];

    for (var i in options) {
        if (this.options[i] != null) {
            this.options[i] = options[i];
        }
    }
}

util.inherits(phidgets, EventEmitter);


phidgets.prototype.defaults = function() {
  return {
    host:             "127.0.0.1",
    port:             5001,
    version:          "1.0.10",
    password:         null,
    delimiter:        '\r\n',
    readyWaitTimeout: 200,
  }
}


phidgets.prototype.connect = function(next) {
    var self = this;
    var delimiter = self.options.delimiter;

    self.emit('state', 'connecting');

    self.client = net.createConnection(self.options.port, self.options.host, function() {
        self.client.setEncoding('utf8');
        self.client.setKeepAlive("enable", 10000);

        self.client.on('end',   self.handleConnectionEnd);
        self.client.on('close', self.handleConnectionEnd);
        self.client.on('error', function(e) {
            self.emit('error', e);
        });
        self.client.on('data',  function(d) {
            self.handleData(d, self);
        });

        self.connectWaitTimer = setTimeout(self.checkReady, self.options.readyWaitTimeout, next, self);

        self.client.write("995 authenticate, version=" + self.options.version + self.options.delimiter);
        self.client.write("report 10 report" + self.options.delimiter);

        // lid1 is for interface kit
        self.client.write('listen "^/PSK/PhidgetInterfaceKit/[a-zA-Z_0-9/.\\-]*/[0-9]*/" lid1' + self.options.delimiter);
        self.client.write('set /PCK/Client/0.0.0.0/1/PhidgetInterfaceKit="Open" for session' + self.options.delimiter);

        // Get attach / detatch events...
        // lid0 is for manager updates
        self.client.write("set /PCK/Client/0.0.0.0/2/PhidgetManager=\"Open\" for session" + self.options.delimiter);
        self.client.write("listen /PSK/List lid0" + self.options.delimiter); // Listen for connect/disconnect events.
    });
};


phidgets.prototype.checkReady = function(next, self) {
    if (self == null) { var self = this; }

    clearTimeout(self.connectWaitTimer);
    if (self.ready === false) {
        self.connectWaitTimer = setTimeout(self.checkReady, self.options.readyWaitTimeout, next, self);
    } else {
        self.emit('state', 'connected');
        if (typeof next === 'function') {
            next();
        }
    }
};


phidgets.prototype.quit = function() {
    var self = this;

    self.shouldReconnect = false;
    self.client.write("set /PCK/Client/0.0.0.0/1/PhidgetInterfaceKit=\"Closed\" for session" + self.options.delimiter);
    self.client.write("set /PCK/Client/0.0.0.0/2/PhidgetManager=\"Closed\" for session" + self.options.delimiter);
    self.client.write("quit\r\n");
};


phidgets.prototype.handleConnectionEnd = function() {
    var self = this;

    self.ready = false;
    self.emit('state', 'disconnected');
    if (self.shouldReconnect === true) {
        self.connect();
    } else{
        // nothing to do
    }
};


phidgets.prototype.setOutput = function(boardId, output, value) {
    var self = this;

    if (self.ready !== true) {
        throw new Error('board is not ready');
    }

    if (boardId == null && self.ids.length === 1) {
        boardId = self.ids[0];
    } else if (boardId == null) {
        throw new Error('boardId is required');
    }

    if (value === true)  { value = 1; }
    if (value === false) { value = 0; }
    output = parseInt(output);
    value  = parseInt(value);

    if (value === 1 || value === 0) {
        var msg = 'set /PCK/PhidgetInterfaceKit/' + boardId + '/Output/' + output + '="' + value + '"' + this.options.delimiter;
        self.client.write(msg);
        self.data[boardId].outputs[output] = value
    } else {
        throw new Error('digital input must be true/false or 1/0');
    }
};


phidgets.prototype.initBoard = function(boardId, boardKind) {
    var self = this;
    self.ids.push(boardId);
    self.data[boardId] = {
        inputs:  {},
        sensors: {},
        outputs: {},
    };
}


phidgets.prototype.handleData = function(chunk, self) {
    var index, line;

    chunk = chunk.toString('utf8');
    self.socketDataString += chunk;

    while ((index = self.socketDataString.indexOf('\n')) > -1) {
        var line = self.socketDataString.slice(0, index);
        self.socketDataString = self.socketDataString.slice(index + 1);
        line = line.replace(/\u0000/gi, "");
        line = line.replace(/\u0001/gi, "");

        self.emit('line', line);


        var re = /report 200-([a-zA-Z0-9]+).*key (.*) latest value "(.*)" \((.*)\)/;
        var matches = re.exec(line);

        if (matches) {
            var listener  = matches[1];
            var pathParts = matches[2].split('/');
            var value     = matches[3];
            var annot     = matches[4];

            // Manager
            if (listener === "lid0") {
                // report 200-lid0 is pending, key /PSK/List/PhidgetInterfaceKit/346585 latest value "Attached Version=605 ID=68 Label=" (current)
                var valueParts = value.split(' ');
                var boardId    = parseInt(pathParts[4]);
                var boardKind  = pathParts[3];
                if (valueParts[0] === "Attached") {
                    if (self.ids.indexOf(boardId) < 0) {
                        self.initBoard(boardId, boardKind);
                    }
                    self.emit("attached", boardId, boardKind);
                    } else if (valueParts[0] === "Detached") {
                    self.emit("detached", boardId, boardKind);
                }
            }
            // InterfaceKit
            else if (listener === "lid1") {
                // report 200-lid0 is pending, key /PSK/PhidgetInterfaceKit//48587/Output/6 latest value "0" (changed)
                var boardKind = pathParts[3];
                var boardId   = parseInt(pathParts[4]);
                var type      = pathParts[5];
                var number    = parseInt(pathParts[6]);

                if (self.ids.indexOf(boardId) < 0) {
                    self.initBoard(boardId, boardKind);
                }

                if (type === "Input") {
                    self.data[boardId].inputs[number] = value;
                    self.emit("input", boardId, number, value);
                } else if (type === "Sensor") {
                    self.data[boardId].sensors[number] = value;
                    self.emit("sensor", boardId, number, value);
                } else if (type === "Output") {
                    self.data[boardId].outputs[number] = value;
                    self.emit("output", boardId, number, value);
                } else if (type === "NumberOfInputs") {
                    self.data[boardId].inputCount = parseInt(value);
                } else if (type === "NumberOfOutputs") {
                    self.data[boardId].outputCount = parseInt(value);
                } else if (type === "NumberOfSensors") {
                    self.data[boardId].sensorCount = parseInt(value);
                } else {
                    var asNumber = parseInt(value);
                    self.data[boardId][type] = isNaN(asNumber) ? value : asNumber;
                }

            }
        }

        else if (self.ready == false && line == "report 200-that's all for now") {
            self.ready = true;
        }


        // } else if (words[0] === '994') {
        //     self.emit('error', line);
        // }

    }
};


module.exports = phidgets;
