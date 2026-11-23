# Stop any running llama-server instance for this setup.

Get-Process llama-server -ErrorAction SilentlyContinue |
    ForEach-Object {
        Write-Host "stopping llama-server (pid $($_.Id))" -ForegroundColor Yellow
        $_ | Stop-Process -Force
    }

Start-Sleep -Milliseconds 500
$left = Get-Process llama-server -ErrorAction SilentlyContinue
if ($left) { Write-Host 'still running:' -ForegroundColor Red; $left | Select-Object Id } else { Write-Host 'stopped' -ForegroundColor Green }
