<#
.SYNOPSIS
  Start llama-server with LFM3-Omni-2B (OpenAI-compatible API + web chat UI).

.DESCRIPTION
  Binds to both 127.0.0.1 and [::1] by default. Browsers resolve "localhost" to
  ::1 first on Windows, so an IPv4-only bind makes the URL look unreachable even
  though the server is fine.

.EXAMPLE
  .\scripts\serve.ps1
  .\scripts\serve.ps1 -Port 8080 -Ctx 16384

.EXAMPLE
  .\scripts\serve.ps1 -Embeddings
#>
[CmdletBinding()]
param(
    [int]$Port = 8080,
    [string]$HostName = '127.0.0.1,::1',
    [int]$Ctx = 0,
    [int]$Parallel = 1,
    [string]$Reasoning = 'off',
    [double]$Temp = 0,
    [switch]$Embeddings,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Extra
)

. "$PSScriptRoot\_env.ps1"

if ($Embeddings) {
    # One llama-server process loads one model, so EmbeddingGemma runs on its own
    # port next to the chat model rather than replacing it.
    $embedArgs = @(
        '-m', $env:LFM3_EMBED_MODEL,
        '-mm', $env:LFM3_EMBED_MMPROJ,
        '--embeddings',
        '-c', '8192',
        '-ngl', $env:LFM3_NGL,
        '--device', $env:LFM3_DEVICE,
        '--host', $HostName,
        '--port', $env:LFM3_EMBED_PORT,
        '-np', '1'
    )
    if ($Extra) { $embedArgs += $Extra }

    Write-Host "Starting EmbeddingGemma 2 on port $($env:LFM3_EMBED_PORT) ($HostName)" -ForegroundColor Green
    Write-Host "  model  : $env:LFM3_EMBED_MODEL"
    Write-Host "  mmproj : $env:LFM3_EMBED_MMPROJ"
    & (Join-Path $env:LFM3_OMNI_ROOT 'runtime\llama-server.exe') @embedArgs
    return
}

$cliArgs = @(
    '-m', $env:LFM3_MODEL,
    '-mm', $env:LFM3_MMPROJ,
    '-ngl', $env:LFM3_NGL,
    '--device', $env:LFM3_DEVICE,
    '--reasoning', $Reasoning,
    '--temp', "$Temp",
    '--host', $HostName,
    '--port', "$Port",
    '-np', "$Parallel"
)
if ($Ctx -gt 0) { $cliArgs += @('-c', "$Ctx") }
if ($Extra) { $cliArgs += $Extra }

Write-Host "Starting llama-server on port $Port ($HostName)" -ForegroundColor Green
Write-Host "  web UI : http://127.0.0.1:$Port"
Write-Host "  model  : $env:LFM3_MODEL"
Write-Host "  mmproj : $env:LFM3_MMPROJ"
Write-Host "  GPU    : -ngl $env:LFM3_NGL"

& (Join-Path $env:LFM3_OMNI_ROOT 'runtime\llama-server.exe') @cliArgs
