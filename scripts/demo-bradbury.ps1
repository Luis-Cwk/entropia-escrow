# Flujo completo del escrow en Bradbury Phase 2.
#
# Usa el RPC nuevo de Bradbury. El CLI calcula y adjunta las fees del
# protocolo, por eso las escrituras no pagables van por CLI. create_order
# (pagable) usa genlayer-js 2.0.0-rc.2 con fees estimadas.
#
# Requisitos:
#   - .secrets/demo-keys.json (lo genera scripts/demo.mjs)
#   - Cuentas CLI importadas: bradbury-seller y bradbury-buyer
#   - $env:GL_PASSWORD con el password de esos keystores
#   - $env:CONTRACT_ADDRESS con el contrato nuevo en Bradbury
#
# Uso:
#   $env:GL_PASSWORD = "..."; $env:CONTRACT_ADDRESS = "0x..."; .\scripts\demo-bradbury.ps1

param(
  [string]$DeliveryUrl = "https://example.com/",
  [string]$DisputeReason = "La entrega es una pagina generica que no tiene relacion con el brief."
)

$ErrorActionPreference = "Continue"
if (-not $env:GL_PASSWORD) { throw "Define GL_PASSWORD con el password de los keystores" }
if (-not $env:CONTRACT_ADDRESS) { throw "Define CONTRACT_ADDRESS con el contrato en Bradbury" }
$env:GENLAYER_NETWORK = "testnet_bradbury"
$env:GL_RPC = "https://rpc.testnet-chain.genlayer.com/"

function Invoke-GLWrite([string]$AccountName, [string]$Method, [string[]]$Arguments) {
  genlayer account use $AccountName | Out-Null
  $output = $env:GL_PASSWORD | genlayer write $env:CONTRACT_ADDRESS $Method --args $Arguments --rpc $env:GL_RPC 2>&1 | Out-String
  $hash = [regex]::Match($output, "0x[0-9a-fA-F]{64}").Value
  if (-not $hash) { throw "No se obtuvo hash para $Method`n$output" }
  Write-Host "  $Method -> $hash"
  $env:GL_PASSWORD | genlayer receipt $hash --status ACCEPTED --rpc $env:GL_RPC 2>&1 | Out-Null
  Start-Sleep -Seconds 5
  return $hash
}

$created = node scripts/create-order.mjs | ConvertFrom-Json
Write-Host "Pedido $($created.orderId) creado: $($created.hash)"

Invoke-GLWrite "bradbury-seller" "submit_delivery" @($created.orderId, $DeliveryUrl, "Entrega generada por entropiav2")
Invoke-GLWrite "bradbury-buyer" "dispute" @($created.orderId, $DisputeReason)
Write-Host "Resolviendo con consenso (web + LLM)..."
Invoke-GLWrite "bradbury-buyer" "resolve_dispute" @($created.orderId)

genlayer call $env:CONTRACT_ADDRESS get_order --args $created.orderId --rpc $env:GL_RPC
