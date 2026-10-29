# Diagnostico de la conexion con SEDAM: correr estando conectada a la red del KU.
#   powershell -ExecutionPolicy Bypass -File diagnostico_bridge.ps1
# Todo lo que muestra se guarda en diagnosticos\diagnostico_<fecha>.txt junto con la captura de
# tramas de la API, para revisarlo despues desde una red con internet.
$ErrorActionPreference = "SilentlyContinue"
Set-Location $PSScriptRoot

$sedamIp = "10.255.255.66"
$carpeta = Join-Path $PSScriptRoot "diagnosticos"
New-Item -ItemType Directory -Force $carpeta | Out-Null
$fecha = Get-Date -Format "yyyyMMdd_HHmmss"
Start-Transcript -Path (Join-Path $carpeta "diagnostico_$fecha.txt") | Out-Null

function Probar($ip, $puerto) {
  $c = New-Object System.Net.Sockets.TcpClient
  $ok = $c.ConnectAsync($ip, $puerto).Wait(3000) -and $c.Connected
  $c.Close()
  return $ok
}
function Texto($ok) { if ($ok) { "responde" } else { "NO responde" } }

Write-Host "`n=== 1. IPs de esta PC y tipo de red ===" -ForegroundColor Cyan
$ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254*" -and $_.InterfaceAlias -notlike "vEthernet*" }
$ips | ForEach-Object {
  $perfil = (Get-NetConnectionProfile -InterfaceIndex $_.InterfaceIndex).NetworkCategory
  "{0,-16} {1}  (red {2})" -f $_.IPAddress, $_.InterfaceAlias, $perfil
}

Write-Host "`n=== 2. Docker y la API ===" -ForegroundColor Cyan
$contenedor = docker ps --filter "name=operaciones-api" --format "{{.Names}}  {{.Status}}  {{.Ports}}"
$dockerOk = $? -and $contenedor
if ($dockerOk) { $contenedor } else { "Docker Desktop NO esta corriendo o la API no esta levantada" }
$apiOk = $false
try { $apiOk = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://localhost:3001/health).StatusCode -eq 200 } catch {}
"API /health: " + $(if ($apiOk) { "200" } else { "NO responde" })

Write-Host "`n=== 3. Servidor SEDAM Movil ($sedamIp) desde esta PC ===" -ForegroundColor Cyan
$ok3000 = Probar $sedamIp 3000
$ok5908 = Probar $sedamIp 5908
"${sedamIp}:3000 (socket de los celulares) " + (Texto $ok3000)
"${sedamIp}:5908 (puerto del Bridge)       " + (Texto $ok5908)

Write-Host "`n=== 4. Servidor SEDAM Movil desde dentro de Docker ===" -ForegroundColor Cyan
$desdeDocker = docker exec operaciones-api-1 node -e "const s=require('net').connect({host:'$sedamIp',port:3000,timeout:4000});s.on('connect',()=>{console.log('responde');s.destroy()});s.on('timeout',()=>{console.log('NO responde (timeout)');s.destroy()});s.on('error',e=>console.log('NO responde ('+e.code+')'))" 2>&1
"${sedamIp}:3000 desde el contenedor: $desdeDocker"

Write-Host "`n=== 5. Puerto 5908 en esta PC (por si el Bridge apunta aqui) ===" -ForegroundColor Cyan
$ips | ForEach-Object { "5908 por {0}: {1}" -f $_.IPAddress, (Texto (Probar $_.IPAddress 5908)) }
Get-NetFirewallProfile | ForEach-Object { "Firewall {0}: {1}" -f $_.Name, $(if ($_.Enabled) { "activo" } else { "apagado" }) }
$regla = Get-NetFirewallRule -DisplayName "Bridge SEDAM 5908"
if ($regla) { "Regla 'Bridge SEDAM 5908': habilitada=$($regla.Enabled) perfil=$($regla.Profile)" } else { "Regla 'Bridge SEDAM 5908': NO existe" }

Write-Host "`n=== 6. Mensajes de SEDAM en la API (ultimas 2 h) ===" -ForegroundColor Cyan
$logs = docker compose --env-file .env.docker logs --since 2h api 2>&1 | Select-String "BRIDGE|SOCKET SEDAM" | ForEach-Object { $_.Line }
$logs | Select-Object -Last 20

Write-Host "`n=== 7. Captura de tramas ===" -ForegroundColor Cyan
$captura = Join-Path $carpeta "captura_$fecha.log"
docker cp operaciones-api-1:/app/api/storage/sedam/captura.log $captura 2>&1 | Out-Null
if (Test-Path $captura) {
  $lineas = (Get-Content $captura | Measure-Object -Line).Lines
  "Copiada a $captura ($lineas lineas). Ultimas:"
  Get-Content $captura -Encoding UTF8 -Tail 8 | ForEach-Object { if ($_.Length -gt 160) { $_.Substring(0, 160) + "..." } else { $_ } }
} else { "Todavia no ha llegado nada de SEDAM (no hay captura)." }

Write-Host "`n=== RESULTADO ===" -ForegroundColor Yellow
$ultimo = $logs | Select-String "SOCKET SEDAM" | Select-Object -Last 1
if (-not $dockerOk -or -not $apiOk) {
  "Abre Docker Desktop y espera a que la API arranque (o: docker compose --env-file .env.docker up -d). NO uses --build sin internet."
} elseif (-not $ok3000) {
  "Esta PC no llega a ${sedamIp}:3000. Revisa que estes conectada a la red del KU (cable/wifi) y que tu IP sea de esa red."
} elseif ($desdeDocker -notlike "responde*") {
  "Windows llega a SEDAM pero Docker no. Reinicia Docker Desktop (cambio de red) y vuelve a correr este diagnostico."
} elseif ($logs -match "En l.{1,2}nea como id") {
  if ($logs -match "SEDAM cerr") { "La API entro, pero despues SEDAM la saco: revisa que ningun otro equipo use la serie SEDAMPC." }
  else { "TODO BIEN: la API esta en linea con SEDAM. Si el panel no muestra unidades, puede que nadie este transmitiendo." }
} elseif ($ultimo -match "no est.{1,2} registrada|ya est.{1,2} en uso") {
  "SEDAM rechaza la serie SEDAMPC: no esta registrada en el servidor SEDAM o ya la usa otro equipo. Hay que darla de alta en serial_numbers.json del servidor."
} else {
  "La red llega pero la API aun no entra. Ultimo mensaje: $ultimo"
}

Stop-Transcript | Out-Null
"`nGuardado en $carpeta"
