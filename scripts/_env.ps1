# Shared config for the LFM3-Omni-2B local setup.
# Dot-source this from other scripts: . "$PSScriptRoot\_env.ps1"

# Model weights and the llama.cpp build live in their own folder, outside this
# repository, so a clone stays source-only. Override LFM3_OMNI_ROOT to relocate.
$env:LFM3_OMNI_ROOT = if ($env:LFM3_OMNI_ROOT) {
    $env:LFM3_OMNI_ROOT
} else {
    'D:\workspace\20261123_lfm3_omni'
}

$root = $env:LFM3_OMNI_ROOT
$env:LFM3_MODEL = Join-Path $root 'models\LFM3-Omni-2B-Q8_0.gguf'
$env:LFM3_MMPROJ = Join-Path $root 'models\mmproj-LFM3-Omni-2B-Q8_0.gguf'

# EmbeddingGemma 2 answers the notes search path on its own server, because a
# llama-server process is bound to one model at a time.
$env:LFM3_EMBED_MODEL = Join-Path $root 'models\embeddinggemma-2-Q8_0.gguf'
$env:LFM3_EMBED_MMPROJ = Join-Path $root 'models\mmproj-embeddinggemma-2-Q8_0.gguf'
$env:LFM3_EMBED_PORT = if ($env:LFM3_EMBED_PORT) { $env:LFM3_EMBED_PORT } else { '8091' }

$env:LFM3_NGL = if ($env:LFM3_NGL) { $env:LFM3_NGL } else { '99' }
# Two GPUs are present (RTX 3080 as CUDA0, RTX 3060 as CUDA1) and llama.cpp
# splits layers across both by default. Pin the card so the 3060 stays free.
$env:LFM3_DEVICE = if ($env:LFM3_DEVICE) { $env:LFM3_DEVICE } else { 'CUDA0' }

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
        # WinGet links directory, where newer ffmpeg builds land on Windows.
        $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links' })
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

$env:PATH = (@((Join-Path $root 'runtime')) + $cudaDirs + $ffmpegDirs + @($env:PATH)) -join ';'
