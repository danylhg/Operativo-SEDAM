# Ejecutar Operaciones con Docker

Este entorno inicia PostgreSQL y la API. La API también sirve los archivos web, por lo que la pantalla de inicio queda disponible en `http://localhost:3001/login.html`.

## 1. Configurar secretos

Desde la carpeta `Operaciones`, crea el archivo de configuración local:

```powershell
Copy-Item .env.docker.example .env.docker
```

Edita `.env.docker` y asigna valores reales a `POSTGRES_PASSWORD`, `JWT_SECRET` y `CESIUM_TOKEN`. No subas ese archivo al repositorio.

## 2. Preparar la base de datos

El repositorio no contiene un esquema SQL completo para crear las tablas principales. Antes de iniciar un entorno nuevo, exporta la base de datos actual a un archivo SQL y guárdalo fuera del control de versiones:

```powershell
pg_dump -h localhost -p 5433 -U postgres -d bdsedam --no-owner --no-privileges -f .\docker\bdsedam.sql
```

Después del primer arranque, restaúrala dentro del contenedor:

```powershell
docker compose --env-file .env.docker up -d
Get-Content .\docker\bdsedam.sql | docker compose --env-file .env.docker exec -T db psql -U operaciones -d bdsedam
```

> Haz la exportación sólo desde una base de datos destinada a demostración. No distribuyas datos reales, contraseñas, ubicaciones ni grabaciones.

## 3. Iniciar y comprobar

### Inicializar una base Docker nueva desde el esquema local

Si la instancia local de desarrollo está disponible (en este proyecto usa
PostgreSQL 18), después de `up -d` importa solo su estructura y carga los
datos de demostración. No se transfieren datos operativos ni grabaciones:

```powershell
Get-Content .\api\.env | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
docker run --rm -e PGPASSWORD=$env:PGPASSWORD postgres:18-alpine `
  pg_dump -h host.docker.internal -p $env:PGPORT -U $env:PGUSER -d $env:PGDATABASE `
  --schema-only --no-owner --no-privileges |
  docker compose --env-file .env.docker exec -T db psql -v ON_ERROR_STOP=1 -U operaciones -d bdsedam

# Keep the database role aligned with the Compose secret after the import.
Get-Content .\.env.docker | ForEach-Object {
  if ($_ -match '^([^#=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
  }
}
docker compose --env-file .env.docker exec -T db psql -U operaciones -d bdsedam `
  -c "ALTER USER operaciones PASSWORD '$env:POSTGRES_PASSWORD';"
docker compose --env-file .env.docker exec -T api npm run seed:users
```

Ejecuta esta inicialización una vez por volumen nuevo. Sin la instancia local,
solicita un respaldo de esquema autorizado; no importes una base con datos reales.

```powershell
docker compose --env-file .env.docker up -d --build
docker compose --env-file .env.docker ps
```

Abre `http://localhost:3001/login.html` y comprueba `http://localhost:3001/health`.

## Compartir fuera de la red local

Docker hace reproducible la instalación, pero no publica el servidor en Internet. Para una demo privada usa Tailscale y configura en la tablet la IP Tailscale del equipo con `:3001`. Para acceso público, despliega este Compose en un VPS y coloca HTTPS/reverse proxy delante de la API; no expongas PostgreSQL.

## Detener

```powershell
docker compose --env-file .env.docker down
```

Los datos quedan en los volúmenes. Para borrarlos intencionalmente junto con la base de datos, usa `docker compose --env-file .env.docker down -v`.

## Mapas sin internet

Web, app Android y reloj piden las teselas del mapa a la propia API
(`/tiles/<capa>/<z>/<x>/<y>.png`, carpeta `api/storage/tiles/<capa>/...`).
Capas: `satellite` (imagen), `reference` (etiquetas) y `osm` (calles, opcional: sin ella "Normal" usa el satélite).
OpenStreetMap bloquea la descarga masiva de tile.openstreetmap.org (devuelve una imagen "Access blocked"); para `osm` usa tu propio servidor o paquete con `--url`.
Si falta una tesela de zoom alto, el servidor amplía la del nivel inferior (sharp), así nunca queda un hueco al acercarse; fuera de la cobertura se ve el mapa mundial local de Cesium.

Preparar el paquete UNA vez en una máquina con internet (respeta los términos del proveedor;
hay tope de 20 000 teselas por corrida, para áreas grandes usa un servidor/paquete propio):

```bash
cd Operaciones/api
node scripts/download-tiles.js --bbox=-103.60,25.40,-103.30,25.65 --zoom=8-16 --layer=satellite
node scripts/download-tiles.js --bbox=-103.60,25.40,-103.30,25.65 --zoom=8-16 --layer=reference
```

(`--bbox=oeste,sur,este,norte`). Con Docker copia la carpeta al volumen:
`docker compose cp api/storage/tiles api:/app/api/storage/`. Comprobar: `GET /tiles/info`.

Rutas por calles: define `OSRM_URL` (p. ej. un OSRM propio en la red local) en el `.env`
de la API. Sin servicio de rutas, la web y la app trazan una línea directa.

Caché automático de mapas: si la API tiene internet, las teselas que se miran y no están en el
paquete (hasta zoom 17) se piden al proveedor y se guardan en `storage/tiles`; desde entonces
funcionan sin internet. Sin internet no se intenta (pausa de 60 s tras un fallo). Para
desactivarlo: `TILE_PROXY=0` en el `.env` de la API.
