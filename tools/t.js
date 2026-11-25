// t.js —— OCR 可用性最小验证
var out = [];
function p(s) { out.push(s); log(s); }

p("start");
try { requestScreenCapture(false); p("cap ok"); } catch (e) { p("cap fail " + e); }
sleep(1200);

try {
    var img = captureScreen();
    p("img " + img.getWidth() + "x" + img.getHeight());
} catch (e) { p("captureScreen fail " + e); }

try {
    var t = ocr(captureScreen());
    p("ocr type=" + (typeof t) + " isArray=" + (t && (t.length !== undefined)) + " len=" + (t && t.length));
    if (t && t.length) {
        for (var i = 0; i < Math.min(5, t.length); i++) p("  [" + i + "] " + String(t[i]).substring(0, 40));
    }
} catch (e) { p("ocr fail " + e); }

try {
    var t2 = ocr.recognizeText(captureScreen());
    p("recognizeText type=" + (typeof t2) + " len=" + (t2 && t2.length));
} catch (e) { p("recognizeText fail " + e); }

try {
    var d = ocr.detect(captureScreen());
    p("detect len=" + (d && d.length) + (d && d.length ? " first=" + JSON.stringify(d[0]).substring(0, 60) : ""));
} catch (e) { p("detect fail " + e); }

p("end");
files.write("/sdcard/Download/autosgs-logs/ocrtest.txt", out.join("\n"));
toast("ocr test done");
