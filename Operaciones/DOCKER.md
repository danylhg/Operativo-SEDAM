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
