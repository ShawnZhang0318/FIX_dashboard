$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
$bundledPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
Write-Host 'Open http://127.0.0.1:5173 in your browser. Press Ctrl+C to stop.'
if ($pythonCommand) { & $pythonCommand.Source -m http.server 5173 --bind 127.0.0.1 }
elseif (Test-Path -LiteralPath $bundledPython) { & $bundledPython -m http.server 5173 --bind 127.0.0.1 }
else { throw 'Python is required. Install Python or serve this folder with another static HTTP server.' }
