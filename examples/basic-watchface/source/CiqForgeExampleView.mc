using Toybox.Graphics;
using Toybox.WatchUi;

class CiqForgeExampleView extends WatchUi.WatchFace {
    private var _forge;

    function initialize(forgeContext) {
        WatchFace.initialize();
        _forge = forgeContext;
    }

    function onLayout(dc) {
        _forge.diagnostics.record("view.layout", dc.getWidth() + "x" + dc.getHeight());
    }

    function onShow() {
        _forge.diagnostics.record("view.show", "ok");
    }

    function onUpdate(dc) {
        _forge.diagnostics.beginRender();
        var clock = _forge.clock.getClockTime();
        var timeText = clock.hour.format("%02d") + ":" + clock.min.format("%02d");
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_BLACK);
        dc.clear();
        dc.drawText(
            dc.getWidth() / 2,
            dc.getHeight() / 2,
            Graphics.FONT_LARGE,
            timeText,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER
        );
        var textWidth = dc.getTextWidthInPixels(timeText, Graphics.FONT_LARGE);
        var textHeight = dc.getFontHeight(Graphics.FONT_LARGE);
        _forge.diagnostics.record(
            "layout.element",
            "id=time;kind=text;x=" + ((dc.getWidth() - textWidth) / 2) +
            ";y=" + ((dc.getHeight() - textHeight) / 2) +
            ";width=" + textWidth + ";height=" + textHeight
        );
        _forge.diagnostics.record("update", timeText);
        _forge.diagnostics.record("view.update", timeText);
        _forge.diagnostics.endRender();
        _forge.diagnostics.assertResult("rendered", dc.getWidth() > 0 && dc.getHeight() > 0, "display-size");
    }

    function onEnterSleep() {
        _forge.diagnostics.record("sleep.enter", "ok");
    }

    function onExitSleep() {
        _forge.diagnostics.record("sleep.exit", "ok");
    }
}
