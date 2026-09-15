# Development launcher only. The shipped app never runs PowerShell or Node.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$localCargo = Join-Path $root '.tools\cargo\bin\cargo.exe'
if (Test-Path -LiteralPath $localCargo) {
    $env:CARGO_HOME = Join-Path $root '.tools\cargo'
    $env:RUSTUP_HOME = Join-Path $root '.tools\rustup'
    $env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
}
$cli = Join-Path $root 'node_modules\.bin\tauri.cmd'
if (-not (Test-Path -LiteralPath $cli)) { throw 'Run npm ci before launching the desktop app.' }
Push-Location -LiteralPath $root
try {
    if ($args.Count -gt 0 -and $args[0] -eq 'build') {
        & node (Join-Path $root 'scripts\collect-licenses.mjs')
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'src-tauri\icons\icon.ico'))) {
        & (Join-Path $PSScriptRoot 'icons.ps1')
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    if ($args.Count -eq 0) { & $cli dev } else { & $cli @args }
    exit $LASTEXITCODE
} finally { Pop-Location }
