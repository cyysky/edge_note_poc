<#
.SYNOPSIS
  Download EmbeddingGemma 2 GGUF weights used by the notes search path.

.DESCRIPTION
  The files are large and gitignored. This script downloads them into models/
  only when they are missing, so re-running it costs nothing after the first
  time. Both the model and its multimodal projector are required: without the
  projector, image and audio embeddings silently fail.

.EXAMPLE
  .\scripts\download-embeddings.ps1
#>
[CmdletBinding()]
param(
    [string]$Repo = 'unsloth/embeddinggemma-2-GGUF',
    [string]$Quant = 'Q8_0',
    [string]$Revision = 'main'
)

. "$PSScriptRoot\_env.ps1"

$files = @(
    "embeddinggemma-2-$Quant.gguf",
    "mmproj-$Quant.gguf"
)

$localNames = @{
    "embeddinggemma-2-$Quant.gguf" = "embeddinggemma-2-$Quant.gguf"
    "mmproj-$Quant.gguf"           = "mmproj-embeddinggemma-2-$Quant.gguf"
}

foreach ($name in $files) {
    # The projector is published as mmproj-*.gguf, but several models share that
    # name locally, so it is stored under a model-specific name in models/.
    $destination = Join-Path $env:LFM3_OMNI_ROOT "models\$($localNames[$name])"
    if (Test-Path $destination) {
        $size = [math]::Round((Get-Item $destination).Length / 1MB)
        Write-Host "SKIP    $name ($size MB already present)" -ForegroundColor DarkGray
        continue
    }

    $url = "https://huggingface.co/$Repo/resolve/$Revision/$name"
    Write-Host "GET     $url" -ForegroundColor Green
    Invoke-WebRequest -Uri $url -OutFile $destination -UseBasicParsing
}

Write-Host "`nDone. Start the embedding server with:" -ForegroundColor Cyan
Write-Host "  .\scripts\serve.ps1 -Embeddings"
