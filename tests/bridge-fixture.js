'use strict';
const fs = require('fs');
const path = require('path');
const { hash } = require('../tools/bridge-package');
function createFixture(dir, packageId = 'pkg-20261127-220000') {
  fs.mkdirSync(path.join(dir, 'assets', 'emu-ld-960x540'), { recursive: true });
  const asset = Buffer.from('gate1-fixture-asset\n');
  fs.writeFileSync(path.join(dir, 'assets', 'emu-ld-960x540', 'fixture.bin'), asset);
  const consumes = { stamina:false, energy:false, sycee:false, fodder:false, jadeOrPay:false };
  const profile = { id:'emu-ld-960x540', label:'雷电模拟器', frame:{width:960,height:540}, ratio:960/540 };
  const recipe = { scenes:[{ id:'fixture_probe', name:'fixture', section:'daily', consumes, elements:[
    { id:'point', kind:'point', bindings:{'emu-ld-960x540':{x:10,y:20}} },
    { id:'roi', kind:'roi', bindings:{'emu-ld-960x540':{rect:[1,2,30,40]}} },
    { id:'template', kind:'template', bindings:{'emu-ld-960x540':{rect:[1,2,30,40],template:{asset:'fixture.bin',sha256:hash(asset)}}} }
  ], steps:[], branches:[] }] };
  const data = Buffer.from(JSON.stringify(recipe, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'recipe.json'), data);
  const manifest = { schema:'sgs-workbench/recipe-package', schemaVersion:1, packageId, exportedAt:new Date().toISOString(), profiles:[profile], scenes:[{id:'fixture_probe',name:'fixture',section:'daily',profileStatus:{'emu-ld-960x540':'bound'},consumes}], files:[{path:'assets/emu-ld-960x540/fixture.bin',sha256:hash(asset),bytes:asset.length},{path:'recipe.json',sha256:hash(data),bytes:data.length}] };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
if (require.main === module) {
  if (!process.argv[2]) { console.error('usage: node tests/bridge-fixture.js <empty-directory> [package-id]'); process.exitCode=2; }
  else if (fs.existsSync(process.argv[2]) && fs.readdirSync(process.argv[2]).length) { console.error('directory must be empty'); process.exitCode=2; }
  else console.log(JSON.stringify(createFixture(process.argv[2], process.argv[3]), null, 2));
}
module.exports = { createFixture };
