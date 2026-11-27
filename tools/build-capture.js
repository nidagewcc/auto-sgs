'use strict';
const fs = require('fs');
const path = require('path');
const base = path.resolve(__dirname, '..');
function moduleCode(file, name) {
  return 'var ' + name + ' = (function(){ var module={exports:{}}; var exports=module.exports;\n' + fs.readFileSync(path.join(base, file), 'utf8') + '\nreturn module.exports; })();\n';
}
const out = path.join(base, 'build', 'capture-bundle.js');
const code = moduleCode('capture/protocol.js', 'captureProtocol') + moduleCode('capture/state.js', 'captureState') + moduleCode('capture/retry-transaction.js', 'captureRetryTransaction') + fs.readFileSync(path.join(base, 'capture/runtime.js'), 'utf8');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, code, 'utf8');
console.log('capture bundle -> ' + out);
