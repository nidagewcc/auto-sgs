// v3: selftest with log upload back to PC (ASCII only)
auto.waitFor();

var PC = "http://192.168.2.250:8099";
var LOGS = [];

function say(msg) {
    LOGS.push(msg);
    log(msg);
}

function push() {
    try {
        var body = LOGS.join("\n");
        var r = http.post(PC + "/log", body, { headers: { "Content-Type": "text/plain; charset=utf-8" }, timeout: 8000 });
        log("upload: " + (r ? r.statusCode : "no-response"));
    } catch (e) {
        log("upload failed: " + e);
    }
}

say("=== selftest v3 ===");
say("script dir: " + files.cwd());
say("screen: " + device.width + "x" + device.height);
say("device: " + device.brand + " " + device.model + " / Android " + device.release);

var img = null;
try {
    if (!requestScreenCapture()) {
        say("FAIL: capture denied");
        push();
        exit();
    }
    sleep(800);
    img = captureScreen();
    if (img) {
        say("OK: capture " + img.getWidth() + "x" + img.getHeight());
    } else {
        say("FAIL: capture null");
    }
} catch (e) {
    say("FAIL: capture error " + e);
}

// template load test
try {
    var DIR = files.cwd() + "/res/img/";
    var tpl = images.read(DIR + "common/anchor-zhengzhan.png");
    if (tpl) {
        say("OK: template loaded " + tpl.getWidth() + "x" + tpl.getHeight());
        if (img) {
            var p = images.findImage(img, tpl, { threshold: 0.7 });
            say(p ? ("OK: findImage hit " + p.x + "," + p.y) : "MISS: anchor not on current screen (expected if portrait)");
        }
    } else {
        say("FAIL: template missing " + DIR + "common/anchor-zhengzhan.png");
    }
} catch (e) {
    say("FAIL: findImage error " + e);
}

// OCR test
try {
    var txt = "";
    if (typeof gmlkit !== "undefined" && gmlkit.ocr) {
        var r1 = gmlkit.ocr(img, "zh");
        txt = r1 && r1.text ? r1.text : "";
        say("OK: mlkit ocr, len=" + txt.length);
        say("ocr head: " + txt.replace(/\n/g, " | ").substring(0, 150));
    } else if (typeof ocr !== "undefined" && ocr.recognizeText) {
        var r2 = ocr.recognizeText(img, "zh");
        say("OK: ocr module, len=" + String(r2).length);
        say("ocr head: " + String(r2).replace(/\n/g, " | ").substring(0, 150));
    } else {
        say("FAIL: no ocr module");
    }
} catch (e) {
    say("FAIL: ocr error " + e);
}

// click test at safe point
try {
    var cx = Math.round(device.width / 2);
    var cy = Math.round(device.height * 0.55);
    click(cx, cy);
    say("OK: click at " + cx + "," + cy);
} catch (e) {
    say("FAIL: click error " + e);
}

say("=== done ===");
push();
toast("selftest finished");
