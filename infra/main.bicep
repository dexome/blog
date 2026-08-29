// Infrastructure for the Dexome blog: Static Web App + first-party visitor
// analytics (workspace-based Application Insights).
//
// Deploy:  az deployment group create -g dexome -f infra/main.bicep -p infra/main.bicepparam
//
// Note: Azure Static Web Apps can only be created in a small set of regions
// (Central US, East US 2, West US 2, West Europe, East Asia). South India is
// NOT supported, so the site stays in East Asia while the metrics resources
// live in South India.

targetScope = 'resourceGroup'

@description('Name of the Static Web App.')
param staticWebAppName string = 'blog'

@description('Region for the Static Web App. Must be a SWA-supported region.')
@allowed([
  'centralus'
  'eastus2'
  'westus2'
  'westeurope'
  'eastasia'
])
param staticWebAppLocation string = 'eastasia'

@description('Name of the Log Analytics workspace backing Application Insights.')
param logAnalyticsName string = 'blog-logs'

@description('Name of the Application Insights component.')
param appInsightsName string = 'blog-insights'

@description('Region for the metrics resources (Log Analytics + App Insights).')
param metricsLocation string = 'southindia'

@description('Log Analytics data retention in days.')
param retentionInDays int = 30

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: metricsLocation
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: metricsLocation
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

resource staticWebApp 'Microsoft.Web/staticSites@2024-04-01' = {
  name: staticWebAppName
  location: staticWebAppLocation
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {}
}

// Feeds the /api/track function so it can send PageVisit events to App Insights.
resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2024-04-01' = {
  parent: staticWebApp
  name: 'appsettings'
  properties: {
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
  }
}

output staticWebAppDefaultHostname string = staticWebApp.properties.defaultHostname
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output logAnalyticsWorkspaceId string = logAnalytics.id
