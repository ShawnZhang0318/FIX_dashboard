param([switch]$BackendOnly)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$stateDir = Join-Path $repo '.local-integration'
$python = Join-Path $repo '.venv-model\Scripts\python.exe'
if (!(Test-Path -LiteralPath $python)) { throw 'First create .venv-model and install ai/requirements-dev.txt; see docs/local-integration-zh.md.' }
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$env:FIX_LOCAL_STATE = $stateDir
$services = @(
    @{Name='ai'; Port=8001; Exe=$python; Args=@('-m','uvicorn','local_backend.ai_service:app','--host','127.0.0.1','--port','8001')},
    @{Name='api'; Port=8000; Exe=$python; Args=@('-m','uvicorn','local_backend.service:app','--host','127.0.0.1','--port','8000')},
    @{Name='worker'; Port=0; Exe=$python; Args=@('-m','local_backend.worker')}
)
if (!$BackendOnly) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $node = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
    if (!(Test-Path -LiteralPath $node)) { throw 'Node.js is required for the dashboard.' }
    Push-Location $repo
    try {
        & $node node_modules/vite/bin/vite.js build
        if ($LASTEXITCODE -ne 0) { throw 'Dashboard build failed.' }
    } finally { Pop-Location }
    $services += @{Name='dashboard'; Port=5174; Exe=$node; Args=@('node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5174','--strictPort')}
}
$pidFile = Join-Path $stateDir 'processes.json'
if (Test-Path -LiteralPath $pidFile) {
    $saved = @(Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json)
    foreach ($item in $saved) {
        $running = Get-Process -Id $item.Id -ErrorAction SilentlyContinue
        if ($running -and $running.StartTime.ToUniversalTime().Ticks -eq ([datetime]$item.StartTime).ToUniversalTime().Ticks) {
            throw 'An earlier local demo is running. Use scripts/stop-local-demo.ps1 before restarting.'
        }
    }
}
foreach ($service in $services) {
    if ($service.Port -and (Get-NetTCPConnection -LocalPort $service.Port -State Listen -ErrorAction SilentlyContinue)) {
        throw "Port $($service.Port) is already occupied; no service was started."
    }
}
$started = @()
foreach ($service in $services) {
    $process = Start-Process -FilePath $service.Exe -ArgumentList $service.Args -WorkingDirectory $repo -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $stateDir "$($service.Name)-stdout.log") `
        -RedirectStandardError (Join-Path $stateDir "$($service.Name)-stderr.log")
    $started += @{Name=$service.Name; Id=$process.Id; StartTime=$process.StartTime.ToUniversalTime().ToString('o')}
    $started | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding utf8
}
Write-Output 'Local services launched. Check http://127.0.0.1:8001/health/ready and http://127.0.0.1:8000/health/ready.'
Write-Output 'First run: .\.venv-model\Scripts\python.exe -m local_backend.import_csv'
Write-Output 'Dashboard: http://127.0.0.1:5174/FIX_dashboard/#/analysis'
