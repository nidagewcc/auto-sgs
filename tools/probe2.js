// probe2.js —— 横屏画布方向探测：拉游戏 → 申请截图 → 看画布尺寸
var OUT = "/sdcard/Download/autosgs-logs/probe2.txt";
var L = [];
function say(s) { L.push(s); log(s); }

files.ensureDir("/sdcard/Download/autosgs-logs/");
say("=== probe2 " + new Date().toLocaleString() + " ===");
say("起始前台: " + (function () { try { return currentPackage(); } catch (e) { return "?"; } })());

// 1) 拉起游戏，等加载
try { app.launchPackage("com.sanguosha.mjz.mi"); } catch (e) { say("拉起失败 " + e); }
say("已拉起游戏，等 20s");
sleep(20000);

// 2) 第一次申请（要求横屏）
var ok1 = false;
try { ok1 = requestScreenCapture(true); } catch (e) { say("cap(true) 异常 " + e); }
sleep(1200);
var im1 = null, d1 = "?";
try { im1 = captureScreen(); d1 = im1.getWidth() + "x" + im1.getHeight(); } catch (e) { say("captureScreen 异常 " + e); }
say("requestScreenCapture(true) => " + ok1 + " | 画布 " + d1);

// 3) 同进程第二次申请（要求竖屏，看方向参数是否还生效）
var ok2 = false;
try { ok2 = requestScreenCapture(false); } catch (e) { say("cap(false) 异常 " + e); }
sleep(1200);
var im2 = null, d2 = "?";
try { im2 = captureScreen(); d2 = im2.getWidth() + "x" + im2.getHeight(); } catch (e) { say("captureScreen 异常 " + e); }
say("再申请 capture(false) => " + ok2 + " | 画布 " + d2);

// 4) 保存原图
try { images.save(im1, "/sdcard/Download/autosgs-logs/p2_raw.jpg"); say("已保存 p2_raw.jpg"); } catch (e) { say("save 失败 " + e); }

// 5) 测 resize 数组签名 + scale
if (im1) {
    try {
        var c = images.clip(im1, 0, 0, Math.min(200, im1.getWidth()), Math.min(200, im1.getHeight()));
        var r = images.resize(c, [400, 400], "LINEAR");
        say("images.resize(clip,[400,400],LINEAR) => " + r.getWidth() + "x" + r.getHeight());
    } catch (e) { say("resize 失败 " + e); }
}

// 6) 测 OCR（在游戏画面上）
if (im1) {
    try {
        var t = ocr(im1);
        say("ocr(全屏) 返回类型 " + (typeof t) + " 长度 " + (t && t.length) + " 首行: " +
            (t && t.length ? String(t[0]).substring(0, 30) : "-"));
    } catch (e) { say("ocr 失败 " + e); }
}

// 7) 找锚点（横屏 2772x1280 坐标）
if (im1) {
    try {
        var tpl = images.read("/sdcard/脚本/auto-sgs/res/img/common/anchor-zhengzhan.png");
        if (!tpl) { say("锚点模板读取失败"); }
        else {
            var r3 = images.findImage(im1, tpl, { threshold: 0.8, region: [2400, 980, 2772, 1280] });
            say("锚点 region匹配 => " + (r3 ? r3.x + "," + r3.y : "null") + " | 模板 " + tpl.getWidth() + "x" + tpl.getHeight());
            var r4 = images.findImage(im1, tpl, { threshold: 0.7 });
            say("锚点 全屏匹配 0.7 => " + (r4 ? r4.x + "," + r4.y : "null"));
        }
    } catch (e) { say("锚点测试失败 " + e); }
}

say("=== done ===");
files.write(OUT, L.join("\n"));
toast("probe2 完成");
