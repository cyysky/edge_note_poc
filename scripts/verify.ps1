<#
.SYNOPSIS
  Verify the local LFM3-Omni-2B install: file hashes, GPU visibility, and a short generation.
#>
[CmdletBinding()]
param([switch]$SkipGeneration)

. "$PSScriptRoot\_env.ps1"

$expected = @{
    'LFM3-Omni-2B-Q8_0.gguf'        = '59118f661eaacb93d204723d76355b53347f0940b508c11412f6290fd49158d4'
    'mmproj-LFM3-Omni-2B-Q8_0.gguf' = '8a25f9d1931244429de404fccacfb7fb933970a36aa5688d2f5069f29c6b27b1'
}

$failed = 0
foreach ($name in $expected.Keys) {
    $path = Join-Path $env:LFM3_ROOT "models\$name"
    if (-not (Test-Path $path)) {
        Write-Host "MISSING $name" -ForegroundColor Red
        $failed++
        continue
    }
    $actual = (Get-FileHash $path -Algorithm SHA256).Hash.ToLower()
    if ($actual -eq $expected[$name]) {
        Write-Host "OK      $name" -ForegroundColor Green
    } else {
        Write-Host "BADHASH $name`n  expected $($expected[$name])`n  actual   $actual" -ForegroundColor Red
        $failed++
    }
}

Write-Host "`nDevices:" -ForegroundColor Cyan
& (Join-Path $env:LFM3_ROOT 'runtime\llama-cli.exe') --list-devices | ForEach-Object { "  $_" }

if ($SkipGeneration) {
    if ($failed) { exit 1 }
    return
}

Write-Host "`nGeneration smoke test:" -ForegroundColor Cyan
$output = & (Join-Path $env:LFM3_ROOT 'runtime\llama-cli.exe') `
    -m $env:LFM3_MODEL -mm $env:LFM3_MMPROJ -ngl $env:LFM3_NGL `
    --temp 0 -p "Reply with exactly: MODEL OK" -n 16 2>&1
$output | Select-String -Pattern 'MODEL OK' | Out-Null
if ($LASTEXITCODE -eq 0 -and ($output -join "`n") -match 'MODEL OK') {
    Write-Host 'OK      generation' -ForegroundColor Green
} else {
    Write-Host 'FAIL    generation' -ForegroundColor Red
    $output | Select-Object -Last 10
    $failed++
}

if ($failed) { exit 1 }
Write-Host "`nAll checks passed." -ForegroundColor Green
