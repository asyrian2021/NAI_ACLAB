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
    # Use argument separators so paths containing spaces are remapped intact.
    $remapFlags = @("--remap-path-prefix=$env:USERPROFILE=/build-user", "--remap-path-prefix=$PWD=/app")
    if ($env:CARGO_HOME) { $remapFlags += "--remap-path-prefix=$env:CARGO_HOME=/cargo" }
    if ($env:RUSTUP_HOME) { $remapFlags += "--remap-path-prefix=$env:RUSTUP_HOME=/rustup" }
    $remapFlags += @('-C', 'link-arg=/PDBALTPATH:nai-aclab.pdb')
    $separator = [char]31
    if ($env:CARGO_ENCODED_RUSTFLAGS) {
        $env:CARGO_ENCODED_RUSTFLAGS += $separator + ($remapFlags -join $separator)
    } else { $env:CARGO_ENCODED_RUSTFLAGS = $remapFlags -join $separator }
    npm run build
    if ($LASTEXITCODE) { throw 'Frontend build failed.' }
    python scripts/build_sidecar.py
    if ($LASTEXITCODE) { throw 'Engine build failed.' }
    npx tauri build
    if ($LASTEXITCODE) { throw 'Desktop build failed.' }
    python scripts/audit_release_privacy.py
    if ($LASTEXITCODE) { throw 'Release privacy check failed.' }
    python scripts/prepare_update.py
    if ($LASTEXITCODE) { throw 'Update preparation failed.' }
} finally { Pop-Location }
