param(
    [string]$AppName = "NAI Artist Lab"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Dist = Join-Path $Root "dist"
$Release = Join-Path $Root "release"
$AppDir = Join-Path $Dist $AppName
$ZipPath = Join-Path $Release "NAI-Artist-Lab-windows.zip"

Set-Location $Root

if (Test-Path $Release) {
    Remove-Item -LiteralPath $Release -Recurse -Force
}
New-Item -ItemType Directory -Path $Release | Out-Null

python -m PyInstaller `
    --noconfirm `
    --clean `
    --windowed `
    --name $AppName `
    --exclude-module tkinter `
    --exclude-module _tkinter `
    --add-data "web;web" `
    launcher.py

if (-not (Test-Path $AppDir)) {
    throw "Build output was not found: $AppDir"
}

Compress-Archive -LiteralPath $AppDir -DestinationPath $ZipPath -Force
Write-Host "Built: $ZipPath"
