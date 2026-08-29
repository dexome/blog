
## Deployment

Every push to `main` triggers the
[Azure Static Web Apps workflow](.github/workflows/azure-static-web-apps-agreeable-pond-03fe8ab00.yml),
which builds the Hugo site (output in `public/`) and the `api/` Functions, then deploys them.
Pull requests get an automatic preview environment that is cleaned up on close.

## Infrastructure (Bicep)

The Azure resources are defined as code in [`infra/`](infra/):

- Static Web App (`blog`, Free, East Asia — the closest SWA-supported region to India)
- Log Analytics workspace + workspace-based Application Insights (South India)
- The `APPLICATIONINSIGHTS_CONNECTION_STRING` app setting wiring the two together

The template is idempotent against the existing resources. Preview and apply with:

```bash
# Preview changes (read-only)
az deployment group what-if -g dexome -f infra/main.bicep -p infra/main.bicepparam

# Apply
az deployment group create -g dexome -f infra/main.bicep -p infra/main.bicepparam
```

> Static Web Apps are only available in Central US, East US 2, West US 2, West Europe,
> and East Asia — not South India — so the site stays in East Asia while analytics runs
> in South India.
