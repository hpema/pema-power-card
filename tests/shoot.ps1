# Screenshot every harness scenario with headless Chrome (Windows). Usage: powershell -File tests\shoot.ps1 [-Out dir]
param([string]$Out = "$PSScriptRoot\..\shots", [int]$Width = 430, [int]$Height = 1180)
New-Item -ItemType Directory -Force $Out | Out-Null
node --check "$PSScriptRoot\..\dist\pema-power-card.js"; if (-not $?) { throw "syntax error in dist/pema-power-card.js" }
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$url = "file:///" + ((Resolve-Path "$PSScriptRoot\harness.html").Path -replace "\\", "/")
$prof = Join-Path $env:TEMP "ppc-chrome-profile"
foreach ($sc in "sunny", "evening", "eskom", "lsday", "unknown", "lowunits", "evening-light") {
  $png = Join-Path $Out "$sc.png"; Remove-Item $png -ErrorAction SilentlyContinue
  & $chrome --headless=new --disable-gpu --hide-scrollbars --no-first-run "--user-data-dir=$prof" --virtual-time-budget=3000 `
    "--window-size=$Width,$Height" "--screenshot=$png" "$url#$sc" 2>&1 | Out-Null
  if (Test-Path $png) { "$sc ok" } else { "$sc FAILED" }
}
