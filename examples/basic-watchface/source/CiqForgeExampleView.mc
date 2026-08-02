using Toybox.Graphics;

class CiqForgeExampleView extends CiqForge.WatchFace {
    function onForgeUpdate(dc) {
        var clock = forge().clock.getClockTime();
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
        forge().diagnostics.record(
            "layout.element",
            "id=time;kind=text;x=" + ((dc.getWidth() - textWidth) / 2) +
            ";y=" + ((dc.getHeight() - textHeight) / 2) +
            ";width=" + textWidth + ";height=" + textHeight
        );
        forge().diagnostics.record("update", timeText);
        forge().diagnostics.assertResult("rendered", dc.getWidth() > 0 && dc.getHeight() > 0, "display-size");
    }
}
