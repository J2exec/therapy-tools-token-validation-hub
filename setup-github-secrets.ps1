# GitHub Secrets Setup Script for Token Validation Hub
# Run this script to automatically configure GitHub secrets for deployment

Write-Host "Setting up GitHub Secrets for Token Validation Hub Deployment" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green

# Check if GitHub CLI is installed
if (!(Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "GitHub CLI (gh) is not installed." -ForegroundColor Red
    Write-Host "Please install it from: https://cli.github.com/" -ForegroundColor Yellow
    Write-Host "Or run: winget install GitHub.CLI" -ForegroundColor Yellow
    exit 1
}

# Check if user is logged into GitHub CLI
$ghAuth = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "You're not logged into GitHub CLI." -ForegroundColor Red
    Write-Host "Please run: gh auth login" -ForegroundColor Yellow
    exit 1
}

Write-Host "GitHub CLI is installed and you're logged in" -ForegroundColor Green

# Set the repository (adjust if needed)
$repo = "J2exec/therapy-tools-subscription-hub"
Write-Host "Working with repository: $repo" -ForegroundColor Cyan

# Read the publish profile
$publishProfilePath = "./publish-profile.xml"
if (!(Test-Path $publishProfilePath)) {
    Write-Host "Publish profile not found at: $publishProfilePath" -ForegroundColor Red
    Write-Host "Please make sure the publish profile is saved in the current directory" -ForegroundColor Yellow
    exit 1
}

$publishProfile = Get-Content $publishProfilePath -Raw
Write-Host "Publish profile loaded" -ForegroundColor Green

# Set GitHub secrets
Write-Host "Setting GitHub secrets..." -ForegroundColor Cyan

try {
    # Set publish profile secret
    $publishProfile | gh secret set AZURE_FUNCTIONAPP_PUBLISH_PROFILE_VALIDATION_HUB --repo $repo
    Write-Host "Set AZURE_FUNCTIONAPP_PUBLISH_PROFILE_VALIDATION_HUB" -ForegroundColor Green
    
    Write-Host "GitHub secrets have been configured successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Summary of configured secrets:" -ForegroundColor Cyan
    Write-Host "- AZURE_FUNCTIONAPP_PUBLISH_PROFILE_VALIDATION_HUB" -ForegroundColor White
    Write-Host ""
    Write-Host "Your deployment pipeline is now ready!" -ForegroundColor Green
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "1. Commit and push your changes" -ForegroundColor White
    Write-Host "2. The workflow will automatically deploy on push to main" -ForegroundColor White
    Write-Host "3. You can also trigger manual deployments from GitHub Actions" -ForegroundColor White
    
} catch {
    Write-Host "Error setting GitHub secrets: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Useful links:" -ForegroundColor Cyan
Write-Host "- GitHub Actions: https://github.com/$repo/actions" -ForegroundColor White
Write-Host "- Azure Function App: https://therapytools-token-verifier.azurewebsites.net" -ForegroundColor White
Write-Host ""
Write-Host "Setup complete! Happy deploying!" -ForegroundColor Green
