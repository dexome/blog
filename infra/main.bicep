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

// One-click visitor dashboard. Placeholder __AI_ID__ is swapped for the App
// Insights resource id so the queries resolve when the workbook is opened.
var workbookData = '''
{
  "version": "Notebook/1.0",
  "items": [
    {
      "type": 1,
      "content": { "json": "# Blog Visitor Analytics\n\nFirst-party page visits collected via `/api/track` into Application Insights." },
      "name": "title"
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "customEvents | where name == 'PageVisit' | summarize Visits = count() by bin(timestamp, 1h) | order by timestamp asc",
        "size": 0,
        "title": "Visits over time",
        "timeContext": { "durationMs": 604800000 },
        "queryType": 0,
        "resourceType": "microsoft.insights/components",
        "visualization": "timechart"
      },
      "name": "visits-over-time"
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "customEvents | where name == 'PageVisit' | summarize UniqueVisitors = dcount(tostring(customDimensions.clientIp)) by bin(timestamp, 1d) | order by timestamp asc",
        "size": 0,
        "title": "Unique visitors per day",
        "timeContext": { "durationMs": 2592000000 },
        "queryType": 0,
        "resourceType": "microsoft.insights/components",
        "visualization": "barchart"
      },
      "name": "unique-visitors"
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "customEvents | where name == 'PageVisit' | summarize Hits = count() by Path = tostring(customDimensions.path) | top 20 by Hits",
        "size": 0,
        "title": "Top pages",
        "timeContext": { "durationMs": 604800000 },
        "queryType": 0,
        "resourceType": "microsoft.insights/components",
        "visualization": "table"
      },
      "name": "top-pages"
    },
    {
      "type": 3,
      "content": {
        "version": "KqlItem/1.0",
        "query": "customEvents | where name == 'PageVisit' | project timestamp, IP = tostring(customDimensions.clientIp), Path = tostring(customDimensions.path), PageTitle = tostring(customDimensions['title']), UserAgent = tostring(customDimensions.userAgent) | order by timestamp desc | take 100",
        "size": 0,
        "title": "Recent visits",
        "timeContext": { "durationMs": 86400000 },
        "queryType": 0,
        "resourceType": "microsoft.insights/components",
        "visualization": "table"
      },
      "name": "recent-visits"
    }
  ],
  "fallbackResourceIds": ["__AI_ID__"],
  "$schema": "https://github.com/Microsoft/Application-Insights-Workbooks/blob/master/schema/workbook.json"
}
'''

resource visitorWorkbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  name: guid(resourceGroup().id, appInsightsName, 'visitor-workbook')
  location: metricsLocation
  kind: 'shared'
  properties: {
    displayName: 'Blog Visitor Analytics'
    serializedData: replace(workbookData, '__AI_ID__', appInsights.id)
    version: 'Notebook/1.0'
    category: 'workbook'
    sourceId: appInsights.id
  }
}

output staticWebAppDefaultHostname string = staticWebApp.properties.defaultHostname
output appInsightsConnectionString string = appInsights.properties.ConnectionString
output logAnalyticsWorkspaceId string = logAnalytics.id
output workbookId string = visitorWorkbook.id
