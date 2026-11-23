# Shared config for the LFM3-Omni-2B local setup.
# Dot-source this from other scripts: . "$PSScriptRoot\_env.ps1"

$Root = Split-Path -Parent $PSScriptRoot

$env:LFM3_ROOT = $Root
$env:LFM3_MODEL = Join-Path $Root 'models\LFM3-Omni-2B-Q8_0.gguf'
$env:LFM3_MMPROJ = Join-Path $Root 'models\mmproj-LFM3-Omni-2B-Q8_0.gguf'

# EmbeddingGemma 2 answers the notes search path on its own server, because a
# llama-server process is bound to one model at a time.
$env:LFM3_EMBED_MODEL = Join-Path $Root 'models\embeddinggemma-2-Q8_0.gguf'
$env:LFM3_EMBED_MMPROJ = Join-Path $Root 'models\mmproj-embeddinggemma-2-Q8_0.gguf'
$env:LFM3_EMBED_PORT = if ($env:LFM3_EMBED_PORT) { $env:LFM3_EMBED_PORT } else { '8091' }

$env:LFM3_NGL = if ($env:LFM3_NGL) { $env:LFM3_NGL } else { '99' }

# The CUDA llama.cpp build links cudart64_13 / cublas64_13. Without those DLLs on
# PATH the binary silently falls back to CPU only, so always add them.
$cudaDirs = @(
    (Join-Path $env:CUDA_PATH 'bin\x64'),
    'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.0\bin\x64'
) | Where-Object { $_ -and (Test-Path $_) }

<#
  Video input shells out to both ffmpeg and ffprobe. Stale ffprobe builds (an
  ancient one lives in Python\Scripts here) shadow the modern pair on PATH and
  break every video prompt, so prepend a directory that holds a matching pair.
#>
function Resolve-FfmpegDir {
    if ($env:LFM3_FFMPEG_DIR -and (Test-Path (Join-Path $env:LFM3_FFMPEG_DIR 'ffprobe.exe'))) {
        return $env:LFM3_FFMPEG_DIR
    }

    $candidates = @(
        (Get-Command ffmpeg.exe -CommandType Application -All -ErrorAction SilentlyContinue |
            ForEach-Object {
                $item = Get-Item -LiteralPath $_.Source -ErrorAction SilentlyContinue
                if ($item -and $item.LinkType) { Split-Path -Parent $item.Target }
                else { Split-Path -Parent $_.Source }
            }),
        'C:\Users\user\AppData\Local\Microsoft\WinGet\Links'
    )

    foreach ($dir in $candidates) {
        if (-not $dir) { continue }
        if ((Test-Path (Join-Path $dir 'ffmpeg.exe')) -and (Test-Path (Join-Path $dir 'ffprobe.exe'))) {
            return $dir
        }
    }
}

$ffmpegDir = Resolve-FfmpegDir
$ffmpegDirs = if ($ffmpegDir) { @($ffmpegDir) } else { @() }

$env:PATH = (@((Join-Path $Root 'runtime')) + $cudaDirs + $ffmpegDirs + @($env:PATH)) -join ';'
