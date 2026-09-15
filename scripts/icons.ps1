$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cli = Join-Path $root 'node_modules\.bin\tauri.cmd'
if (-not (Test-Path -LiteralPath $cli)) { throw 'Run npm ci before generating icons.' }
& $cli icon (Join-Path $root 'assets\branding\icon.png') --output (Join-Path $root 'src-tauri\icons')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Copy-Item -LiteralPath (Join-Path $root 'src-tauri\icons\128x128@2x.png') -Destination (Join-Path $root 'public\icon.png')
