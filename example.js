var phidgetsPrototype = require('./lib/phidgets.js');
var options = {
  host: "localhost"
}
var phidgets = new phidgetsPrototype(options);

// events
phidgets.on('state',    function(state){ console.log("[state] " + state); });
phidgets.on('error',    function(error){ console.log("[error] " + error); });
phidgets.on('input',    function(boardId, id, value){ console.log("[" + boardId + "][input]  " + id + " @ " + value); });
phidgets.on('sensor',   function(boardId, id, value){ console.log("[" + boardId + "][sensor] " + id + " @ " + value); });
phidgets.on('output',   function(boardId, id, value){ console.log("[" + boardId + "][output] " + id + " @ " + value); });
phidgets.on('attached', function(boardId, kind){ console.log("[" + boardId + "] Attached. Kind: " + kind);});
phidgets.on('detached', function(boardId, kind){ console.log("[" + boardId + "] Detached. Kind: " + kind);});

// debugging event
phidgets.on('line', function(line){ console.log("[line] " + line); });


var dump = function() {
    console.log("Dump: " + JSON.stringify(phidgets.data));
    setTimeout(dump, 1000);
}

phidgets.on("attached", function(boardId, kind){
    var value = true;
    setInterval(function(){ phidgets.setOutput(boardId, 0, value); value = ! value}, 1000);
})

// connect
phidgets.connect(function(){
    console.log("connected to:", phidgets.ids);
    dump();
//    setTimeout(function() { phidgets.quit(); }, 5000);
});