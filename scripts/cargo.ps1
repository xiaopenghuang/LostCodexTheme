# Development convenience only. Production code never invokes PowerShell.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$localCargo = Join-Path $root '.tools\cargo\bin\cargo.exe'
if (Test-Path -LiteralPath $localCargo) {
    $env:CARGO_HOME = Join-Path $root '.tools\cargo'
    $env:RUSTUP_HOME = Join-Path $root '.tools\rustup'
    $env:PATH = (Join-Path $env:CARGO_HOME 'bin') + ';' + $env:PATH
    & $localCargo @args
} else {
    & cargo @args
}
exit $LASTEXITCODE
