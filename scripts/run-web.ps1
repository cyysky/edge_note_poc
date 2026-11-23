# Start the production build of the web app on 3100.
# 3000 is avoided on purpose: next dev does not hydrate reliably here.
. "$PSScriptRoot\_env.ps1"

$env:PORT = if ($env:PORT) { $env:PORT } else { '3100' }

Set-Location (Join-Path $PSScriptRoot '..\apps\web')
pnpm start
