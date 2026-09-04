export function configureGoogleLikeCamera(viewer, options = {}) {
  const controller = viewer?.scene?.screenSpaceCameraController;
  if (!controller) return;

  const {
    minimumZoomDistance = 500,
    maximumZoomDistance = 5000000,
    inertiaSpin = 0.35,
    inertiaTranslate = 0.35,
    inertiaZoom = 0.25,
    maximumMovementRatio = 0.08,
    zoomFactor = 2.2
  } = options;

  controller.minimumZoomDistance = minimumZoomDistance;
  controller.maximumZoomDistance = maximumZoomDistance;

  controller.inertiaSpin = inertiaSpin;
  controller.inertiaTranslate = inertiaTranslate;
  controller.inertiaZoom = inertiaZoom;
  controller.maximumMovementRatio = maximumMovementRatio;

  if ("zoomFactor" in controller) {
    controller.zoomFactor = zoomFactor;
  }

  controller.enableRotate = true;
  controller.enableTranslate = true;
  controller.enableZoom = true;
  controller.enableTilt = true;
  controller.enableLook = false;

}
