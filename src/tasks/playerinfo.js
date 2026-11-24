// tasks/playerinfo.js —— 玩家信息读取（AutoX 移植版）
sgs = (typeof sgs === "undefined") ? {} : sgs;
sgs.tasks = sgs.tasks || {};

sgs.tasks.playerinfo = {
    id: "playerinfo",
    name: "玩家信息读取",

    // 主城可直接读到的 6 个字段；level 需点头像开弹窗，单独处理
    FIELDS: [
        { key: "nickname", parser: "text" },
        { key: "level", parser: "level" },
        { key: "combat_power", parser: "text" },
        { key: "physical", parser: "fraction" },
        { key: "energy", parser: "fraction" },
        { key: "sycee", parser: "int" },
        { key: "jade", parser: "int" }
    ],

    run: function () {
        var v = sgs.vision;
        var roi = sgs.ROI.playerInfo;
        var out = {};

        if (!v.init()) throw new Error("截图权限获取失败");
        var img = v.frame(true);
        if (!img) throw new Error("截图失败");
        sgs.log.i("画面 " + img.getWidth() + "x" + img.getHeight());

        for (var i = 0; i < this.FIELDS.length; i++) {
            var f = this.FIELDS[i];
            var rect = roi[f.key];
            var raw = v.ocrRect(rect, img);
            var parsed = this._parse(f.parser, raw);
            out[f.key] = { raw: raw, value: parsed };
            if (parsed === null) {
                sgs.log.e(f.key + " 解析失败 原文=[" + raw + "]");
            } else {
                sgs.log.i(f.key + " = " + JSON.stringify(parsed) + "  原文=[" + raw + "]");
            }
        }
        return out;
    },

    _parse: function (type, raw) {
        var s = String(raw == null ? "" : raw).replace(/^\s+|\s+$/g, "");
        if (type === "text") return s === "" ? null : s;
        if (type === "level") {
            // 等级上限三位数；OCR 常把「级」认成 2/1，多末尾一位就丢尾
            var m0 = s.replace(/\s+/g, "").match(/\d+/);
            if (!m0) return null;
            var v0 = m0[0];
            if (v0.length > 3) v0 = v0.substring(0, 3);
            return parseInt(v0, 10);
        }
        if (type === "int") {
            var m1 = s.replace(/[,\s]/g, "").match(/(\d+)/);
            return m1 ? parseInt(m1[1], 10) : null;
        }
        if (type === "fraction") {
            var m2 = s.replace(/\s+/g, "").match(/(\d+)\s*\/\s*(\d+)/);
            return m2 ? { current: parseInt(m2[1], 10), max: parseInt(m2[2], 10) } : null;
        }
        return s === "" ? null : s;
    }
};
