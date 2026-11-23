<#
.SYNOPSIS
  One-shot prompts against LFM3-Omni-2B: text, image, audio (ASR), video or TTS.

.DESCRIPTION
  Wraps llama-cli / llama-tts. Text and media can be combined, and multiple
  media flags may be repeated via -ExtraMedia @('--image','a.png').

.EXAMPLE
  .\scripts\ask.ps1 -Prompt "Explain GGUF quantization in two sentences."

.EXAMPLE
  .\scripts\ask.ps1 -Image .\out\photo.png -Prompt "Describe this image."

.EXAMPLE
  .\scripts\ask.ps1 -Audio .\out\speech.wav -System "Perform ASR in English."

.EXAMPLE
  .\scripts\ask.ps1 -Prompt "Hello there" -Tts -TtsOut .\out\hello.wav

.EXAMPLE
  .\scripts\ask.ps1 -Interactive
#>
[CmdletBinding()]
param(
    [string]$Prompt,
    [string]$System,
    [string]$Image,
    [string]$Audio,
    [string]$Video,
    [int]$MaxTokens = 512,
    [switch]$Tts,
    [string]$TtsOut = 'output.wav',
    [string]$TtsVoice = 'female',
    [string]$TtsLang = 'en',
    [switch]$Interactive,
    [string[]]$ExtraMedia
)

. "$PSScriptRoot\_env.ps1"

$runtime = Join-Path $env:LFM3_ROOT 'runtime'

if ($Tts) {
    if (-not $Prompt) { throw '-Tts requires -Prompt with the text to speak.' }
    & (Join-Path $runtime 'llama-tts.exe') `
        -m $env:LFM3_MODEL -mm $env:LFM3_MMPROJ -ngl $env:LFM3_NGL `
        -p $Prompt -o $TtsOut --tts-voice $TtsVoice --tts-lang $TtsLang
    return
}

if (-not $Prompt -and -not ($Image -or $Audio -or $Video) -and -not $Interactive) {
    throw 'Provide -Prompt, a media file, or -Interactive.'
}

$cliArgs = @(
    '-m', $env:LFM3_MODEL,
    '-mm', $env:LFM3_MMPROJ,
    '-ngl', $env:LFM3_NGL,
    '--temp', '0'
)
if (-not $Interactive) { $cliArgs += @('-n', "$MaxTokens") }
if ($System) { $cliArgs += @('-sys', $System) }
if ($Image) { $cliArgs += @('--image', (Resolve-Path $Image).Path) }
if ($Audio) { $cliArgs += @('--audio', (Resolve-Path $Audio).Path) }
if ($Video) { $cliArgs += @('--video', (Resolve-Path $Video).Path) }
if ($ExtraMedia) { $cliArgs += $ExtraMedia }

# A media-only prompt needs the model's placeholder token to anchor the input.
$effectivePrompt = if ($Prompt) { $Prompt }
elseif ($Audio) { '<__media__>' }
elseif ($Interactive) { $null }
else { '<__media__>' }
if ($effectivePrompt) { $cliArgs += @('-p', $effectivePrompt) }

& (Join-Path $runtime 'llama-cli.exe') @cliArgs
