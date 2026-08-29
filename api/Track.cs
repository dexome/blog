using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using Microsoft.ApplicationInsights;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Http;
using Microsoft.Extensions.Logging;

namespace api
{
    // Records a page visit sent by the site's first-party beacon into Application Insights.
    public class Track
    {
        private readonly TelemetryClient _telemetry;
        private readonly ILogger<Track> _logger;

        public Track(TelemetryClient telemetry, ILogger<Track> logger)
        {
            _telemetry = telemetry;
            _logger = logger;
        }

        [Function("track")]
        public async Task<HttpResponseData> RunAsync(
            [HttpTrigger(AuthorizationLevel.Anonymous, "post")] HttpRequestData req)
        {
            var beacon = await ReadBeaconAsync(req);

            var properties = new Dictionary<string, string>
            {
                ["clientIp"] = GetClientIp(req),
                ["path"] = beacon.Path ?? "",
                ["title"] = beacon.Title ?? "",
                ["referrer"] = beacon.Referrer ?? Header(req, "Referer"),
                ["userAgent"] = Header(req, "User-Agent"),
                ["language"] = Header(req, "Accept-Language"),
            };

            _telemetry.TrackEvent("PageVisit", properties);
            _logger.LogInformation("PageVisit tracked for {Path}", properties["path"]);

            // 204: nothing for the beacon to read, keeps the client lightweight.
            return req.CreateResponse(HttpStatusCode.NoContent);
        }

        private static async Task<Beacon> ReadBeaconAsync(HttpRequestData req)
        {
            if (req.Body == Stream.Null)
            {
                return new Beacon();
            }

            var body = await new StreamReader(req.Body).ReadToEndAsync();
            if (string.IsNullOrWhiteSpace(body))
            {
                return new Beacon();
            }

            try
            {
                return JsonSerializer.Deserialize<Beacon>(body, JsonOptions) ?? new Beacon();
            }
            catch (JsonException)
            {
                return new Beacon();
            }
        }

        private static string GetClientIp(HttpRequestData req)
        {
            var forwarded = Header(req, "X-Forwarded-For");
            if (string.IsNullOrEmpty(forwarded))
            {
                return "";
            }

            // First hop is the real client; entries may be "ip" or "ip:port".
            var first = forwarded.Split(',')[0].Trim();
            var lastColon = first.LastIndexOf(':');
            if (lastColon > 0 && first.IndexOf(':') == lastColon)
            {
                // Single colon => IPv4:port, strip the port.
                first = first[..lastColon];
            }

            return first;
        }

        private static string Header(HttpRequestData req, string name)
            => req.Headers.TryGetValues(name, out var values)
                ? values.FirstOrDefault() ?? ""
                : "";

        private static readonly JsonSerializerOptions JsonOptions = new()
        {
            PropertyNameCaseInsensitive = true,
        };

        private sealed class Beacon
        {
            public string? Path { get; set; }
            public string? Title { get; set; }
            public string? Referrer { get; set; }
        }
    }
}
