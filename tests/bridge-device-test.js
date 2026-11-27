'use strict';
// Explicit opt-in integration test: only the named emulator is touched.
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { execFileSync, spawnSync } = require('child_process');
const { createFixture } = require('./bridge-fixture');
const pkg = require('../tools/bridge-package');
const { create } = require('../tools/bridge-device');
const serial = process.argv[2];
if (!/^emulator-\d+$/.test(serial || '')) throw new Error('Pass an explicitly authorized emulator serial');
const adbExe = process.env.AUTOSGS_ADB || 'D:\\develops\\tools\\platform-tools\\adb.exe';
const real = args => execFileSync(adbExe, args, {encoding:'buffer',maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-');
const fixture = path.resolve('_bridge', 'gate1-tamper-' + stamp);
if (fs.existsSync(fixture)) throw new Error('Fixture already exists; choose a clean test workspace');
createFixture(fixture, 'pkg-' + stamp);
const good = pkg.validate(fixture);
const realCurrent = real(['-s',serial,'shell','cat /storage/emulated/0/Download/autosgs-logs/recipes/current.txt']).toString();
let injected = false;
function tamperedAdb(args) {
  const out = real(args);
  if (!injected && args[2] === 'push' && args[4].endsWith('/fixture.bin')) {
    injected = true;
    real(['-s', serial, 'shell', "printf tampered > '/storage/emulated/0/Download/autosgs-logs/recipes/.staging-" + stamp + "/assets/emu-ld-960x540/fixture.bin'"]);
  }
  return out;
}
let code;
try { create(tamperedAdb, serial, 'ld-' + serial.slice(9)).deploy(fixture, good); } catch (e) { code=e.code; }
assert.strictEqual(code,5); assert(injected);
assert.strictEqual(real(['-s',serial,'shell','cat /storage/emulated/0/Download/autosgs-logs/recipes/current.txt']).toString(), realCurrent);
let writes = 0;
function badPointerAdb(args) {
  if (args[2] === 'shell' && args[3] === "cat '/storage/emulated/0/Download/autosgs-logs/recipes/current.txt'") return Buffer.from('../bad\n');
  if (args[2] === 'push' || (args[2] === 'shell' && /^(mkdir|mv|rm|rmdir|touch|printf)\b/.test(args[3]))) writes++;
  return real(args);
}
code=undefined;
try { create(badPointerAdb,serial,'ld-' + serial.slice(9)).rollback(); } catch(e) { code=e.code; }
assert.strictEqual(code,8); assert.strictEqual(writes,0);
assert.strictEqual(real(['-s',serial,'shell','cat /storage/emulated/0/Download/autosgs-logs/recipes/current.txt']).toString(), realCurrent);
console.log('device readback corruption exit=5; invalid current exit=8; pointer unchanged; incomplete deployment retained for evidence');
