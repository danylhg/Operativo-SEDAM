# Drones y RTMP con FFmpeg

Para drones o camaras externas se usa FFmpeg como puente: FFmpeg recibe un flujo RTMP/RTSP/HTTP y lo publica como HLS dentro de `Operaciones/runtime/ffmpeg-streams`, que el frontend ya puede reproducir.

Todas las salidas de este puente se normalizan a 240p, 15 fps y bitrate bajo para no saturar la PC ni la red. Esto aplica tanto para drones que se leen por RTSP/RTMP/HTTP como para drones que empujan RTMP hacia tu PC.

## 1. Iniciar el proyecto

Ejecuta:

```powershell
uy\setup_proyecto.bat
```

El bat verifica FFmpeg y deja el frontend sirviendo archivos en:

```text
http://localhost:3000
```

## 2. Convertir un stream del dron a HLS

Para un dron/camara que entrega una URL RTSP o RTMP:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File uy\start_ffmpeg_drone_hls.ps1 -InputUrl "rtsp://USUARIO:PASS@IP_DEL_DRON:554/stream1" -StreamKey "dron-01" -PublicBaseUrl "http://IP_DE_TU_PC:3000/Operaciones/runtime/ffmpeg-streams"
```

Ese comando ya baja el video a 240p aunque el dron entregue 720p/1080p.

Tambien sirve con una entrada RTMP:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File uy\start_ffmpeg_drone_hls.ps1 -InputUrl "rtmp://IP_DEL_DRON/live/camara" -StreamKey "dron-01" -PublicBaseUrl "http://IP_DE_TU_PC:3000/Operaciones/runtime/ffmpeg-streams"
```

El resultado queda en:

```text
http://IP_DE_TU_PC:3000/Operaciones/runtime/ffmpeg-streams/dron-01/index.m3u8
```

## 3. Registrar el dron en la operacion

Registra ese HLS en la API como dispositivo externo:

```http
POST http://localhost:3001/ops/ID_OPERACION/streams/external
Authorization: Bearer TOKEN
Content-Type: application/json
```

```json
{
  "kind": "AUDIO_VIDEO",
  "label": "Dron 01",
  "stream_key": "dron-01",
  "playback_url": "http://IP_DE_TU_PC:3000/Operaciones/runtime/ffmpeg-streams/dron-01/index.m3u8",
  "external_device_id": "dron-01"
}
```

## Si el dron empuja RTMP

Si el dron no da una URL para leer y en cambio necesita publicar hacia tu PC, inicia FFmpeg en modo escucha:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File uy\start_ffmpeg_drone_hls.ps1 -Listen -InputUrl "rtmp://0.0.0.0:1935/live/dron-01" -StreamKey "dron-01" -PublicBaseUrl "http://IP_DE_TU_PC:3000/Operaciones/runtime/ffmpeg-streams"
```

Luego configura el dron para transmitir a:

```text
rtmp://IP_DE_TU_PC:1935/live/dron-01
```

Ese modo es simple y sirve para una entrada por proceso de FFmpeg. Para varios drones que empujan RTMP, abre un proceso por dron usando un `StreamKey` y un puerto diferente, por ejemplo `1935`, `1936`, `1937`.

## OBS

El setup ya arranca un puente para OBS con el stream key `obs-01`.

OBS tambien se publica por el mismo puente FFmpeg, asi que el dashboard y las grabaciones quedan en 240p aunque OBS envie una resolucion mayor.

En OBS configura:

```text
Server: rtmp://IP_DE_TU_PC:1935/live
Stream Key: obs-01
```

La URL que reproduce el dashboard queda en:

```text
http://IP_DE_TU_PC:3000/Operaciones/runtime/ffmpeg-streams/obs-01/index.m3u8
```

En el dashboard, abre la operacion, deja la clave `obs-01` en el panel de camaras y pulsa `Ver OBS`.

Cuando el stream se reproduce en el dashboard, queda grabado con el mismo buffer de camaras: se generan segmentos y se suben al historial de grabaciones de la operacion.
