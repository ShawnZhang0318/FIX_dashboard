$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $repo '.local-integration\processes.json'
if (!(Test-Path -LiteralPath $pidFile)) { Write-Output 'No recorded demo services.'; return }
$saved = @(Get-Content -LiteralPath $pidFile -Raw | ConvertFrom-Json)
foreach ($item in $saved) {
    $process = Get-Process -Id $item.Id -ErrorAction SilentlyContinue
    if (!$process -or $process.StartTime.ToUniversalTime().Ticks -ne ([datetime]$item.StartTime).ToUniversalTime().Ticks) { continue }
    # Windows virtualenv Python has a launcher child. Only stop descendants of
    # this exact recorded process, after verifying its start time (PID reuse).
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($item.Id)")
    foreach ($child in $children) {
        if ($child.Name -eq 'python.exe' -and $child.CommandLine -match 'local_backend\.') {
            Stop-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
        }
    }
    Stop-Process -Id $item.Id -ErrorAction SilentlyContinue
    Write-Output "Stopped $($item.Name)."
}
Write-Output 'Database, model artifacts and stored application logs were retained.'
