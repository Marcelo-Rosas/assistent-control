<#
.SYNOPSIS
  Download Estabelecimentos*.zip from Receita Federal Nextcloud (WebDAV).

.EXAMPLE
  .\scripts\fetch-receita-estabelecimentos.ps1 -Smoke
  .\scripts\fetch-receita-estabelecimentos.ps1 -Month 2026-07
  .\scripts\fetch-receita-estabelecimentos.ps1 -ListOnly
#>
[CmdletBinding()]
param(
  [string]$Token = 'YggdBLfdninEJX9',
  [string]$Month = '',
  [string]$OutDir = '',
  [switch]$Smoke,
  [switch]$ListOnly,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Base = 'https://arquivos.receitafederal.gov.br/public.php/webdav'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $OutDir) {
  $OutDir = Join-Path $Root 'data/raw/Receita'
}

function Invoke-WebDavPropfind([string]$Url) {
  $body = @'
<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:displayname/>
    <d:getcontentlength/>
    <d:getlastmodified/>
    <d:resourcetype/>
  </d:prop>
</d:propfind>
'@
  return Invoke-WebRequest -Uri $Url -Method PropFind -Headers @{
    Authorization = "Basic $([Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${Token}:")))"
    Depth         = '1'
    'Content-Type' = 'text/xml; charset=utf-8'
  } -Body $body -UseBasicParsing
}

function Get-LatestMonth {
  $r = Invoke-WebDavPropfind "$Base/"
  $months = [regex]::Matches($r.Content, '/public\.php/webdav/(\d{4}-\d{2})/') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique
  if (-not $months.Count) { throw 'Nenhum mês encontrado no WebDAV' }
  return $months[-1]
}

function Get-EstabeleFiles([string]$M) {
  $r = Invoke-WebDavPropfind "$Base/$M/"
  $items = @()
  foreach ($m in [regex]::Matches($r.Content, '<d:response>([\s\S]*?)</d:response>')) {
    $block = $m.Groups[1].Value
    $href = [regex]::Match($block, '<d:href>([^<]+)</d:href>').Groups[1].Value
    $name = Split-Path $href -Leaf
    if ($name -notmatch '^Estabelecimentos\d+\.zip$') { continue }
    $size = [regex]::Match($block, '<d:getcontentlength>(\d+)</d:getcontentlength>').Groups[1].Value
    $items += [pscustomobject]@{ Name = $name; Size = [int64]$size; Url = "$Base/$M/$name" }
  }
  return $items | Sort-Object Name
}

$logDir = $OutDir
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "_download-$((Get-Date).ToString('yyyy-MM-dd-HHmmss')).log"
Start-Transcript -Path $log | Out-Null

try {
  if (-not $Month) { $Month = Get-LatestMonth }
  Write-Host "Latest month: $Month | Using: $Month"

  $files = Get-EstabeleFiles $Month
  if (-not $files.Count) { throw "Nenhum Estabelecimentos*.zip em $Month" }

  Write-Host "ESTABELE files in ${Month}:"
  $files | ForEach-Object {
    $gb = [math]::Round($_.Size / 1GB, 2)
    Write-Host ("  {0,-28} {1,15} bytes ({2,4} GB)" -f $_.Name, $_.Size, $gb)
  }
  $totalGb = [math]::Round(($files | Measure-Object -Property Size -Sum).Sum / 1GB, 2)
  Write-Host "Total ESTABELE: $totalGb GB"

  if ($ListOnly) { return }

  $target = if ($Smoke) { @($files[0]) } else { $files }
  $destMonth = Join-Path $OutDir $Month
  New-Item -ItemType Directory -Force -Path $destMonth | Out-Null

  Write-Host "Downloading $($target.Count) file(s) -> $destMonth"
  foreach ($f in $target) {
    $out = Join-Path $destMonth $f.Name
    if ((Test-Path $out) -and -not $Force) {
      $existing = (Get-Item $out).Length
      if ($existing -eq $f.Size) {
        Write-Host "SKIP $($f.Name) (already complete)"
        continue
      }
      Remove-Item $out -Force
    }
    $auth = "${Token}:"
    $curlOut = "$out.part"
    if (Test-Path $curlOut) { Remove-Item $curlOut -Force }
    Write-Host "GET $($f.Url)"
    & curl.exe -L -u $auth -o $curlOut --retry 3 --retry-delay 5 --connect-timeout 30 $f.Url 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) { throw "curl failed for $($f.Name)" }
    $sz = (Get-Item $curlOut).Length
    if ($sz -ne $f.Size) { throw "Size mismatch $($f.Name): got $sz expected $($f.Size)" }
    Move-Item $curlOut $out -Force
    Write-Host "OK $($f.Name) ($sz bytes)"
  }

  Write-Host "Done. Next: python scripts/filter-receita-cnae-academias.py --zip-dir $destMonth"
}
finally {
  Stop-Transcript | Out-Null
}
