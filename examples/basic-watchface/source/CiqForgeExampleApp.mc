using Toybox.Application;
using Toybox.WatchUi;

class CiqForgeExampleApp extends Application.AppBase {
    private var _forge;

    function initialize() {
        AppBase.initialize();
        _forge = ForgeBootstrap.context();
        _forge.diagnostics.record("app.initialize", "ok");
    }

    function onStart(state) {
        _forge.diagnostics.record("app.start", "ok");
    }

    function getInitialView() {
        _forge.diagnostics.record("view.created", "ok");
        return [new CiqForgeExampleView(_forge)];
    }
}
