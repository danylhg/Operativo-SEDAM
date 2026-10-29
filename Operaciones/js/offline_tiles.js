// Mapas sin internet: las teselas se sirven desde la propia API (/tiles/<capa>/z/x/y.png).
// Debajo siempre va el mapa mundial NaturalEarthII incluido en Cesium, para que el globo
// nunca se vea vacío aunque el paquete de teselas no cubra la zona o el zoom pedido.
(function () {
  const apiBase = () => String(window.OPERACIONES_API_BASE || window.location.origin).replace(/\/+$/, "");

  const state = { layers: {}, loaded: false };

  function maxLevel(layer, fallback) {
    return state.layers[layer]?.maxZoom ?? fallback;
  }

  function tiles(layer, credit) {
    return new Cesium.UrlTemplateImageryProvider({
      url: `${apiBase()}/tiles/${layer}/{z}/{x}/{y}.png`,
      minimumLevel: 0,
      // Nivel alto: donde falta la tesela (404) Cesium amplía la del nivel inferior.
      maximumLevel: 19,
      credit
    });
  }

  window.OfflineMap = {
    state,
    apiBase,
    // Mapa mundial de baja resolución, 100% local (vendor/cesium).
    world() {
      const root = Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII");
      return new Cesium.UrlTemplateImageryProvider({
        url: `${root}/{z}/{x}/{reverseY}.jpg`,
        tilingScheme: new Cesium.GeographicTilingScheme(),
        maximumLevel: 2,
        credit: "Natural Earth"
      });
    },
    // Sin paquete de calles instalado, "Normal" usa la imagen satelital (nunca queda vacío).
    hasOsm: () => Boolean(state.layers.osm),
    osm: () => state.layers.osm ? tiles("osm", "OpenStreetMap") : tiles("satellite", "Imagen satelital"),
    satellite: () => tiles("satellite", "Imagen satelital"),
    reference: () => tiles("reference", "Referencias"),
    // Consulta qué niveles de zoom hay instalados y avisa para redibujar el mapa.
    async load() {
      try {
        const res = await fetch(`${apiBase()}/tiles/info`, { cache: "no-store" });
        if (res.ok) state.layers = (await res.json()).layers || {};
      } catch (_) { /* sin servidor: se usa el mapa mundial local */ }
      state.loaded = true;
      window.dispatchEvent(new CustomEvent("offlinemap:ready"));
    }
  };

  window.OfflineMap.load();
})();
