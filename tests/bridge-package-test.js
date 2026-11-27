'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFixture } = require('./bridge-fixture');
const { validate, hash } = require('../tools/bridge-package');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sgs-bridge-test-'));
function fixture(name) { const dir = path.join(root, name); createFixture(dir); return dir; }
function rewrite(dir, file, fn) { const p=path.join(dir,file); const v=JSON.parse(fs.readFileSync(p,'utf8')); fn(v); fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n'); }
function rehashRecipe(dir) { const data=fs.readFileSync(path.join(dir,'recipe.json')); rewrite(dir,'manifest.json',m=>{const f=m.files.find(x=>x.path==='recipe.json'); f.sha256=hash(data);f.bytes=data.length;}); }
const good=fixture('good'); assert.strictEqual(validate(good).warnings.length,0);
const traversal=fixture('traversal'); rewrite(traversal,'manifest.json',m=>m.files[0].path='assets/emu-ld-960x540/../escape'); assert.throws(()=>validate(traversal),/非法路径/);
const tampered=fixture('tampered'); fs.appendFileSync(path.join(tampered,'assets','emu-ld-960x540','fixture.bin'),'bad'); assert.throws(()=>validate(tampered),/哈希不符/);
const jade=fixture('jade'); rewrite(jade,'manifest.json',m=>m.scenes[0].consumes.jadeOrPay=true); assert.throws(()=>validate(jade),/安全声明/);
const bounds=fixture('bounds'); rewrite(bounds,'recipe.json',r=>r.scenes[0].elements[0].bindings['emu-ld-960x540'].x=960); rehashRecipe(bounds); assert.throws(()=>validate(bounds),/坐标越界/);
const missing=fixture('missing'); rewrite(missing,'recipe.json',r=>r.scenes[0].elements[2].bindings['emu-ld-960x540'].template.asset='missing.bin'); rehashRecipe(missing); assert.throws(()=>validate(missing),/引用缺失/);
const { spawnSync } = require('child_process');
for (const dir of [traversal, jade, bounds]) {
  const run = spawnSync(process.execPath, [path.join(__dirname, '../tools/bridge.js'), 'deploy', '--serial', 'emulator-5554', '--package', dir], { encoding:'utf8' });
  assert.strictEqual(run.status, 3, run.stderr);
}
console.log('bridge package validation: 6 cases passed; traversal/jade/bounds CLI exit=3');
