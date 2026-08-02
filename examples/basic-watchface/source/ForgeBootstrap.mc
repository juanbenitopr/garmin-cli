(:forgeProduction)
module ForgeBootstrap {
    private var _context = null;

    function context() {
        if (_context == null) {
            _context = CiqForge.productionContext();
        }
        return _context;
    }
}
