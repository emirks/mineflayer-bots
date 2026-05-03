# deploy.ps1
# First time: .\deploy.ps1 -First
# Re-deploys:  .\deploy.ps1

param([switch]$First)

$flyLocal = "$env:LOCALAPPDATA\flyctl\flyctl.exe"

if (Get-Command flyctl -ErrorAction SilentlyContinue) {
    $fly = "flyctl"
} elseif (Get-Command fly -ErrorAction SilentlyContinue) {
    $fly = "fly"
} elseif (Test-Path $flyLocal) {
    $fly = $flyLocal
} else {
    Write-Host "flyctl not found - downloading..."
    $rel = Invoke-RestMethod "https://api.github.com/repos/superfly/flyctl/releases/latest"
    $asset = $rel.assets | Where-Object { $_.name -like "*Windows*x86_64*" } | Select-Object -First 1
    New-Item -ItemType Directory -Path "$env:LOCALAPPDATA\flyctl" -Force | Out-Null
    Invoke-WebRequest $asset.browser_download_url -OutFile "$env:TEMP\flyctl.zip" -UseBasicParsing
    Expand-Archive "$env:TEMP\flyctl.zip" -DestinationPath "$env:LOCALAPPDATA\flyctl" -Force
    $fly = $flyLocal
}

Write-Host "Using: $fly"

if ($First) {
    Write-Host ""
    Write-Host "Logging in..."
    & $fly auth login

    Write-Host ""
    Write-Host "Creating app mine-bots..."
    & $fly apps create mine-bots

    Write-Host ""
    Write-Host "Creating 1 GB persistent volume in Amsterdam..."
    & $fly volumes create bot_data --region ams --size 1 --app mine-bots

    Write-Host ""
    $origin = Read-Host "Enter your Vercel URL (e.g. https://mine-dashboard.vercel.app)"
    & $fly secrets set "GUI_ALLOWED_ORIGINS=$origin" --app mine-bots
}

Write-Host ""
Write-Host "Deploying (Docker build runs remotely, takes 3-5 min first time)..."
& $fly deploy --remote-only --app mine-bots

Write-Host ""
Write-Host "Done! Backend: https://mine-bots.fly.dev"
Write-Host "Set VITE_API_URL=https://mine-bots.fly.dev in your Vercel env vars."
