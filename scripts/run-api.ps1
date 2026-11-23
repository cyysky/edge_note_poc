# Start the API against the local model servers, in the foreground.
# The web app talks to it through Next's /api rewrite.
. "$PSScriptRoot\_env.ps1"

$env:PORT = if ($env:PORT) { $env:PORT } else { '3001' }
$env:DATABASE_PATH = if ($env:DATABASE_PATH) { $env:DATABASE_PATH } else { Join-Path $PSScriptRoot '..\data\displayer.db' }
$env:MODEL_BASE_URL = if ($env:MODEL_BASE_URL) { $env:MODEL_BASE_URL } else { 'http://127.0.0.1:8080' }
$env:NOTES_API_URL = if ($env:NOTES_API_URL) { $env:NOTES_API_URL } else { "http://127.0.0.1:$env:PORT" }

Set-Location (Join-Path $PSScriptRoot '..\apps\api')
node dist/main.js
