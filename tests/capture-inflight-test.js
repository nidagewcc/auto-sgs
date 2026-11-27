'use strict';
// Exercise the actual runtime shot/poll functions with a deterministic lock stub.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../capture/runtime.js'), 'utf8');
function functionSource(name, next) {
  const begin = source.indexOf('    function ' + name + '() {');
  const end = source.indexOf('    function ' + next + '()', begin + 1);
  assert(begin >= 0 && end > begin, 'runtime function layout changed');
  return source.slice(begin, end);
}
let locked = false, taskExists = true, callbackRuns = 0;
const writes = [];
const old = { state: 'recording', sessionId: 'old', sceneId: 'scene', frames: [], frameCount: 0 };
const ctx = {
  mutex: { tryLock() { if (locked) return false; locked = true; return true; }, unlock() { assert(locked); locked = false; } },
  current: old, dir: '/old', recoveryLocked: false, HEART: '/heart', TASK: '/task', TX: '/tx',
  Date, console, atomic() {}, safe(x) { return x; }, now() { return 'now'; }, paint() {}, toast() {},
  captureState: { append(m) { return { ...m, frameCount: 1, frames: [{ file: '001.png' }] }; } },
  captureProtocol: { parse() { return { command: 'retry', scene: 'scene' }; } },
  files: { read() { return 'capture:scene:retry'; } },
  java: { io: { File: function (p) { this.exists = () => p === '/task' && taskExists; this.delete = () => { taskExists = false; return true; }; } } },
  shell(cmd) {
    assert(cmd.includes('/old/001.png'));
    // Poll arrives while the screenshot owns the actual runtime mutex.
    ctx.poll();
    assert.strictEqual(taskExists, true, 'retry must remain pending while frame is in flight');
    assert.strictEqual(callbackRuns, 0, 'retry must not execute while screenshot is in flight');
    return { code: 0 };
  },
  pngValid() { return true; },
  save(m) { writes.push({ dir: ctx.dir, sessionId: m.sessionId, file: m.frames[0].file }); },
  retry() { callbackRuns++; assert.strictEqual(ctx.current.frameCount, 1); ctx.dir = '/new'; ctx.current = { ...old, sessionId: 'new', frames: [], frameCount: 0 }; },
  receipt() {},
  markFailed() { throw new Error('unexpected screenshot failure'); },
};
vm.createContext(ctx);
vm.runInContext(functionSource('shot', 'cleanReceipts') + '\n' + functionSource('poll', 'recoverInterrupted'), ctx);
ctx.shot();
assert.deepStrictEqual(writes, [{ dir: '/old', sessionId: 'old', file: '001.png' }]);
ctx.poll();
assert.strictEqual(callbackRuns, 1);
assert.strictEqual(taskExists, false);
assert.strictEqual(ctx.current.sessionId, 'new');
assert.strictEqual(ctx.current.frameCount, 0);
console.log('capture in-flight screenshot/retry serialization: ok');
