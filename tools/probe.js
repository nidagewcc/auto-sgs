// probe.js —— 能力探测：在目标机型上直接运行，输出能力矩阵
// 用法：AutoJs6 / AutoX 里打开此文件点运行，弹出截图授权后允许。
// 结果写在 /sdcard/Download/autosgs-logs/probe.txt，同时在控制台打印。

var OUT = "/sdcard/Download/autosgs-logs/probe.txt";
var L = [];

function say(s) { L.push(s); log(s); }

function once(name, fn) {
    try {
        var v = fn();
        say("[OK]   " + name + " => " + v);
        return v;
    } catch (e) {
        say("[FAIL] " + name + " => " + e);
        return null;
    }
}

files.ensureDir("/sdcard/Download/autosgs-logs/");

say("=== probe " + new Date().toLocaleString() + " ===");
say("self pkg   : " + (function () { try { return context.getPackageName(); } catch (e) { return "?"; } })());
say("brand/model: " + device.brand + " " + device.model + " / " + device.release + " sdk" + device.sdkInt);
say("device     : " + device.width + "x" + device.height + " density" + (device.density || "?"));

// --- 1. 截图与画布方向 ---
var capF = once("requestScreenCapture(false)", function () { return requestScreenCapture(false); });
sleep(800);
if (capF) {
    var raw = once("captureScreen(false)", function () {
        var im = captureScreen();
        return im.getWidth() + "x" + im.getHeight();
    });
    say("raw canvas  : " + raw);
    once("images.resize(img,w,h)", function () {
        var c = images.clip(captureScreen(), 0, 0, 200, 200);
        var r = images.resize(c, 400, 400);
        return r.getWidth() + "x" + r.getHeight();
    });
    once("images.resize(img,w,h,LINEAR)", function () {
        var c = images.clip(captureScreen(), 0, 0, 200, 200);
        var r = images.resize(c, 400, 400, "LINEAR");
        return r.getWidth() + "x" + r.getHeight();
    });
    once("images.scale(img,sx,sy)", function () {
        var c = images.clip(captureScreen(), 0, 0, 200, 200);
        var r = images.scale(c, 2, 2);
        return r.getWidth() + "x" + r.getHeight();
    });

    // --- 2. findImage 的 region 参数 ---
    var base = images.clip(captureScreen(), 100, 100, 300, 200);
    var tpl = images.clip(base, 20, 20, 80, 40);
    once("findImage(region=[l,t,r,b])", function () {
        var r = images.findImage(captureScreen(), tpl, { threshold: 0.8, region: [150, 150, 500, 400] });
        return r ? r.x + "," + r.y : "null";
    });
    once("findImage(region=[x,y,w,h])", function () {
        var r = images.findImage(captureScreen(), tpl, { threshold: 0.8, region: [150, 150, 350, 250] });
        return r ? r.x + "," + r.y : "null";
    });
    once("findImage(no region)", function () {
        var r = images.findImage(captureScreen(), tpl, { threshold: 0.8 });
        return r ? r.x + "," + r.y : "null";
    });

    // --- 3. OCR ---
    once("gmlkit.ocr (AutoX)", function () {
        var r = gmlkit.ocr(captureScreen(), "zh");
        return "\"" + String(r && r.text ? r.text : "").substring(0, 40) + "\"";
    });
    once("ocr() (AutoJs6)", function () {
        var r = ocr(captureScreen(), "zh");
        if (typeof r === "string") return "\"" + r.substring(0, 40) + "\"";
        return "obj:" + JSON.stringify(Object.keys(r || {}));
    });
    once("images.findColor", function () {
        return images.findColor(captureScreen(), "#FFFFFF", { threshold: 20 }) ? "hit" : "null";
    });
}

// --- 4. 运行环境能力 ---
once("floaty.checkPermission", function () { return typeof floaty.checkPermission === "function" ? floaty.checkPermission() : "no api"; });
once("threads.start", function () { var t = threads.start(function () { }); return !!t; });
once("engines.execScriptFile", function () { return typeof engines.execScriptFile; });
once("http.get", function () { return typeof http.get; });
once("images.pixel", function () { return typeof images.pixel; });
once("images.toBase64", function () { return typeof images.toBase64; });
once("currentPackage", function () { return currentPackage(); });
once("shell", function () { return typeof shell; });
once("ui mode", function () { return typeof "ui"; });

say("=== done ===");
files.write(OUT, L.join("\n"));
toast("probe 完成 -> " + OUT);
