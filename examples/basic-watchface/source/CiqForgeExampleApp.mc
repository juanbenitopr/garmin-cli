class CiqForgeExampleApp extends CiqForge.AppBase {
    function createForgeContext() {
        return ForgeBootstrap.context();
    }

    function createInitialView(forgeContext) {
        return [new CiqForgeExampleView(forgeContext)];
    }
}
