# Token Validation Hub - Deployment Setup

This document explains how to set up the CI/CD pipeline for the Token Validation Hub Azure Function.

## Prerequisites

1. Azure Function App ending with "validation-hub"
2. GitHub repository with proper access
3. Azure service principal for deployment

## GitHub Secrets Setup

You need to configure the following secrets in your GitHub repository:

### Required Secrets

1. **AZURE_CREDENTIALS**: Azure service principal credentials
   ```json
   {
     "clientId": "your-client-id",
     "clientSecret": "your-client-secret",
     "subscriptionId": "your-subscription-id",
     "tenantId": "your-tenant-id"
   }
   ```

2. **AZURE_FUNCTIONAPP_PUBLISH_PROFILE_VALIDATION_HUB**: The publish profile for your validation hub function app
   - Download from Azure Portal: Function App → Overview → Get publish profile

### Required Variables

1. **AZURE_FUNCTIONAPP_NAME_VALIDATION_HUB**: The name of your Azure Function App (e.g., "my-app-validation-hub")

## Setting up GitHub Secrets and Variables

### Via GitHub Web Interface:
1. Go to your repository on GitHub
2. Navigate to Settings → Secrets and variables → Actions
3. Add the secrets under "Repository secrets"
4. Add the variables under "Repository variables"

### Via GitHub CLI:
```bash
# Set secrets
gh secret set AZURE_CREDENTIALS --body "@azure-credentials.json"
gh secret set AZURE_FUNCTIONAPP_PUBLISH_PROFILE_VALIDATION_HUB --body "@publish-profile.xml"

# Set variables
gh variable set AZURE_FUNCTIONAPP_NAME_VALIDATION_HUB --body "your-function-app-name"
```

## Azure Service Principal Setup

Create an Azure service principal with the necessary permissions:

```bash
az ad sp create-for-rbac --name "github-actions-validation-hub" \
  --role "Contributor" \
  --scopes "/subscriptions/{subscription-id}/resourceGroups/{resource-group-name}" \
  --json-auth
```

## Deployment Trigger

The workflow triggers on:
- Push to `main` branch with changes in the `online-therapy-tools-token-validation-hub/` directory
- Manual trigger via GitHub Actions UI

## Local Development

### Environment Setup
1. Copy `local.settings.json` and configure your local settings
2. Install dependencies: `npm install`
3. Start local development: `npm start`

### Testing Locally
```bash
# Start the function locally
func start

# Test the endpoint
curl http://localhost:7071/api/verifytokens?token=test-token
```

## Environment Variables

The function app needs these environment variables configured in Azure:

- `EXPIRED_TOKEN_PAGE_URL`: URL to redirect when tokens are expired
- `AzureWebJobsStorage`: Azure Storage connection string
- `FUNCTIONS_WORKER_RUNTIME`: Set to "node"

## Monitoring and Troubleshooting

1. Check GitHub Actions tab for deployment status
2. Monitor Azure Function logs in Application Insights
3. Verify function app settings in Azure Portal

## Security Notes

- Never commit `local.settings.json` to the repository
- Regularly rotate service principal credentials
- Use managed identities when possible for Azure resource access
