# Push filtered Edge secrets from .env.local (never prints values)
param(
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [string]$EnvFile = ".env.local"
)

$allowed = @(
  'CHANNEL_PROVIDER',
  'LLM_PROVIDER',
  'SAKANA_API_KEY',
  'SAKANA_BASE_URL',
  'SAKANA_MODEL',
  'SAKANA_TIMEOUT_MS',
  'EVOLUTION_URL',
  'EVOLUTION_INSTANCE',
  'EVOLUTION_API_KEY',
  'EVOLUTION_WEBHOOK_SECRET',
  'EROS_AUTO_REPLY',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
  'OLLAMA_API_KEY',
  'OLLAMA_TIMEOUT_MS',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL'
)

if (-not (Test-Path $EnvFile)) {
  Write-Error "Missing $EnvFile"
  exit 1
}

$map = @{}
Get-Content $EnvFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith('#')) { return }
  $i = $line.IndexOf('=')
  if ($i -lt 1) { return }
  $k = $line.Substring(0, $i).Trim()
  $v = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
  if ($allowed -contains $k -and $v) { $map[$k] = $v }
}

if (-not $map.ContainsKey('CHANNEL_PROVIDER')) { $map['CHANNEL_PROVIDER'] = 'evolution' }
if (-not $map.ContainsKey('LLM_PROVIDER')) { $map['LLM_PROVIDER'] = 'sakana' }
if (-not $map.ContainsKey('EROS_AUTO_REPLY')) { $map['EROS_AUTO_REPLY'] = 'false' }

if (-not $map.ContainsKey('SAKANA_API_KEY')) {
  Write-Error "SAKANA_API_KEY missing in $EnvFile"
  exit 1
}

$missingEvo = @('EVOLUTION_URL', 'EVOLUTION_INSTANCE', 'EVOLUTION_API_KEY') | Where-Object { -not $map.ContainsKey($_) }
if ($missingEvo.Count -gt 0) {
  Write-Warning ("Evolution keys missing (send/webhook auth fail until set): " + ($missingEvo -join ', '))
}

$npxArgs = @('supabase', 'secrets', 'set', '--project-ref', $ProjectRef)
foreach ($k in ($map.Keys | Sort-Object)) {
  $npxArgs += ($k + '=' + $map[$k])
}

Write-Host ("Pushing " + $map.Count + " secret(s) to " + $ProjectRef)
Write-Host ("Keys: " + (($map.Keys | Sort-Object) -join ', '))
& npx @npxArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Done. Redeploy functions if needed."
