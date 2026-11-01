$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
        $signingKey = Join-Path $PWD '.tools/updater/private.key'
        if (-not (Test-Path -LiteralPath $signingKey)) { throw 'Update signing key is missing.' }
        $env:TAURI_SIGNING_PRIVATE_KEY = $signingKey
    }
    if (Test-Path -LiteralPath '.tools/rustup') { $env:RUSTUP_HOME = Join-Path $PWD '.tools/rustup' }
    if (Test-Path -LiteralPath '.tools/cargo') {
        $env:CARGO_HOME = Join-Path $PWD '.tools/cargo'
        $env:PATH = (Join-Path $PWD '.tools/cargo/bin') + ';' + $env:PATH
    }
    npm run build
    if ($LASTEXITCODE) { throw 'Frontend build failed.' }
    python scripts/build_sidecar.py
    if ($LASTEXITCODE) { throw 'Engine build failed.' }
    npx tauri build
    if ($LASTEXITCODE) { throw 'Desktop build failed.' }
    python scripts/prepare_update.py
    if ($LASTEXITCODE) { throw 'Update preparation failed.' }
} finally { Pop-Location }
