'use strict';
// Local package validation. No device access occurs in this module.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PROFILE = 'emu-ld-960x540';
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
function fail(message) { throw new Error(message); }
function filePath(p, profiles) {
  if (typeof p !== 'string' || p.length > 200 || p.includes('\\')) fail('非法路径');
  const parts = p.split('/');
  if (parts.some(x => !x || x === '.' || x === '..' || !/^[a-z0-9._-]+$/.test(x))) fail('非法路径: ' + p);
  if (p !== 'recipe.json' && !(parts.length >= 3 && parts[0] === 'assets' && profiles.has(parts[1]))) fail('非法文件位置: ' + p);
  return p;
}
function readRegular(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) fail('禁止符号链接: ' + relative);
  }
  if (!fs.statSync(current).isFile()) fail('不是普通文件: ' + relative);
  return fs.readFileSync(current);
}
function validate(root) {
  root = path.resolve(root);
  if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) fail('包根目录无效');
  const entries = fs.readdirSync(root);
  if (entries.some(x => !['manifest.json', 'recipe.json', 'assets'].includes(x))) fail('未知顶层文件');
  const manifestBytes = readRegular(root, 'manifest.json');
  const m = JSON.parse(manifestBytes.toString('utf8'));
  if (m.schema !== 'sgs-workbench/recipe-package' || m.schemaVersion !== 1 || !/^pkg-\d{8}-\d{6}$/.test(m.packageId || '') || typeof m.exportedAt !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(m.exportedAt) || Number.isNaN(Date.parse(m.exportedAt))) fail('manifest 标识无效');
  if (!Array.isArray(m.profiles) || !m.profiles.length || !Array.isArray(m.scenes) || !Array.isArray(m.files)) fail('manifest 列表无效');
  const profiles = new Map();
  for (const p of m.profiles) {
    if (!p || !/^[a-z0-9-]+$/.test(p.id || '') || profiles.has(p.id) || typeof p.label !== 'string' || !p.frame || !Number.isInteger(p.frame.width) || p.frame.width <= 0 || !Number.isInteger(p.frame.height) || p.frame.height <= 0 || typeof p.ratio !== 'number' || !Number.isFinite(p.ratio) || p.ratio <= 0) fail('profile 无效');
    profiles.set(p.id, p);
  }
  const target = profiles.get(PROFILE);
  if (!target || target.frame.width !== 960 || target.frame.height !== 540) fail('模拟器 profile 不匹配');
  const files = new Map();
  let previous = '';
  for (const item of m.files) {
    if (!item || typeof item.path !== 'string') fail('文件清单无效');
    filePath(item.path, profiles);
    if (item.path <= previous || !/^[0-9a-f]{64}$/.test(item.sha256 || '') || !Number.isSafeInteger(item.bytes) || item.bytes < 0) fail('文件清单排序、哈希或长度无效');
    previous = item.path;
    const data = readRegular(root, item.path);
    if (data.length !== item.bytes || hash(data) !== item.sha256) fail('本地哈希不符: ' + item.path);
    files.set(item.path, item);
  }
  if (!files.has('recipe.json')) fail('缺少 recipe.json');
  const recipe = JSON.parse(readRegular(root, 'recipe.json').toString('utf8'));
  if (!Array.isArray(recipe.scenes)) fail('recipe scenes 无效');
  const scenes = new Map();
  for (const s of m.scenes) {
    if (!s || !/^[a-z0-9_-]+$/.test(s.id || '') || scenes.has(s.id) || typeof s.name !== 'string' || typeof s.section !== 'string' || !s.profileStatus || s.profileStatus[PROFILE] !== 'bound' || !s.consumes || s.consumes.jadeOrPay !== false) fail('场景或安全声明无效');
    for (const [id, status] of Object.entries(s.profileStatus)) if (!profiles.has(id) || !['bound', 'draft', 'missing'].includes(status)) fail('场景 profile 状态无效');
    scenes.set(s.id, s);
  }
  const seen = new Set();
  const used = new Set();
  for (const s of recipe.scenes) {
    if (!s || !scenes.has(s.id) || seen.has(s.id) || !s.consumes || s.consumes.jadeOrPay !== false || !Array.isArray(s.elements)) fail('recipe 场景无效');
    seen.add(s.id);
    const elementIds = new Set();
    for (const e of s.elements) {
      if (!e || typeof e.id !== 'string' || elementIds.has(e.id) || !['point','roi','template','text'].includes(e.kind) || !e.bindings || !e.bindings[PROFILE]) fail('元素绑定无效');
      elementIds.add(e.id);
      for (const [id, b] of Object.entries(e.bindings)) {
        const p = profiles.get(id);
        if (!p || !b || typeof b !== 'object') fail('未知绑定 profile');
        const valid = (x, max) => Number.isFinite(x) && x >= 0 && x < max;
        if (e.kind === 'point') {
          if (!valid(b.x, p.frame.width) || !valid(b.y, p.frame.height)) fail('点坐标越界');
        } else {
          const r = b.rect;
          if (!Array.isArray(r) || r.length !== 4 || !valid(r[0],p.frame.width) || !valid(r[1],p.frame.height) || !valid(r[2],p.frame.width) || !valid(r[3],p.frame.height) || r[2] <= r[0] || r[3] <= r[1]) fail('区域坐标越界');
        }
        if (e.kind === 'template') {
          const asset = b.template && b.template.asset;
          if (typeof asset !== 'string') fail('模板缺失');
          const full = asset.startsWith('assets/') ? asset : 'assets/' + id + '/' + asset;
          filePath(full, profiles);
          if (!full.startsWith('assets/' + id + '/') || !files.has(full)) fail('模板引用缺失');
          if (b.template.sha256 && b.template.sha256 !== files.get(full).sha256) fail('模板哈希不符');
          used.add(full);
        }
      }
    }
    function checkRefs(value) {
      if (!value || typeof value !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(value, 'elementId') && !elementIds.has(value.elementId)) fail('元素引用缺失');
      if (Object.prototype.hasOwnProperty.call(value, 'conditionElementId') && !elementIds.has(value.conditionElementId)) fail('条件引用缺失');
      for (const v of Object.values(value)) checkRefs(v);
    }
    checkRefs(s.steps); checkRefs(s.branches);
  }
  if (seen.size !== scenes.size) fail('场景集合不一致');
  return { manifest: m, manifestSha256: hash(manifestBytes), warnings: [...files.keys()].filter(p => p.startsWith('assets/') && !used.has(p)).map(p => '孤儿素材: ' + p) };
}
module.exports = { validate, filePath, hash };
