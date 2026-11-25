// build.js —— 与 build.py 同源的 bundle 拼装器（不依赖 python）
// 直接解析 tools/build.py 里的三段常量，保证单一来源。
const fs = require("fs");
const path = require("path");

const BASE = path.resolve(__dirname, "..");
const PY = path.join(BASE, "tools", "build.py");
const OUT = path.join(BASE, "build", "bundle.js");

const MODS = [
  "src/config.js",
  "src/vision.js",
  "src/game.js",
  "src/tasks/playerinfo.js",
  "src/tasks/mail.js",
  "src/tasks/xiaoqiao.js",
  "src/ui.js",
];

const pySrc = fs.readFileSync(PY, "utf8");

function grab(name) {
  const re = new RegExp(name + '\\s*=\\s*u"""([\\s\\S]*?)"""');
  const m = pySrc.match(re);
  if (!m) throw new Error("未能从 build.py 提取 " + name);
  // 还原 python 三重引号里的转义
  return m[1].replace(/\\\\/g, "\\");
}

const HEADER = grab("HEADER");
const LOGBLOCK = grab("LOGBLOCK");
const RUNNER = grab("RUNNER");

const parts = [HEADER, LOGBLOCK];
for (const rel of MODS) {
  const p = path.join(BASE, rel);
  if (!fs.existsSync(p)) throw new Error("缺少模块 " + rel);
  parts.push("\n// ===== " + rel + " =====\n");
  parts.push(fs.readFileSync(p, "utf8"));
}
parts.push(RUNNER);

const code = parts.join("\n");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, code, "utf8");
console.log("bundle -> " + OUT + "  (" + Buffer.byteLength(code, "utf8") + " bytes)");
