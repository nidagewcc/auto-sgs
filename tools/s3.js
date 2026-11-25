// s3.js —— 测试无障碍能否点掉 MediaProjection 授权框
var out = [];
function p(s) { out.push(s); log(s); }
try {
    p("auto 就绪检查：currentPackage=" + (function () { try { return currentPackage(); } catch (e) { return "ERR"; } })());
    var nodes = text("共享屏幕").find();
    p("text(共享屏幕) 命中 " + nodes.size);
    if (nodes.size > 0) {
        var b = nodes.get(0);
        p("bounds=" + b.bounds());
        p("clickable=" + b.clickable());
        var ok = false;
        try { ok = b.click(); } catch (e) { p("click 异常 " + e); }
        p("b.click() = " + ok);
        if (!ok) {
            var bb = b.bounds();
            p("坐标点击 = " + click(bb.centerX(), bb.centerY()));
        }
    } else {
        var all = className("android.widget.Button").find();
        p("Button 节点 " + all.size);
        for (var i = 0; i < Math.min(all.size, 8); i++) {
            p("  btn[" + i + "] text=" + all.get(i).text() + " bounds=" + all.get(i).bounds());
        }
    }
} catch (e2) { p("顶层异常 " + e2); }
files.write("/sdcard/Download/autosgs-logs/s3.txt", out.join("\n"));
