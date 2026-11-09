using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using Divertiflix.Api.Dtos;
using Microsoft.Extensions.Options;

namespace Divertiflix.Api.Services;

/// <summary>Services auto-hébergés (section « HomeServices » : HomeServices__Domain, HomeServices__IntervalSeconds).</summary>
public sealed class HomeServicesOptions
{
    /// <summary>Domaine interne : chaque service répond sur https://{clé}.{domaine}.</summary>
    public string Domain { get; set; } = "home.arpa";
    public int IntervalSeconds { get; set; } = 60;
    public bool Enabled { get; set; } = true;
}

/// <summary>Un service : clé (= nom d'hôte), nom affiché, public visé. Portal : visible de tous ; sinon réservé à l'infrastructure (Admin).</summary>
public sealed record SelfHostedService(string Key, string Name, bool Portal, bool HasWebUi = true);

/// <summary>
/// Surveille les services auto-hébergés (Jellyfin, Jellyseerr, Sonarr…) derrière Traefik : une requête HTTPS par service et par minute.
/// La sonde n'envoie rien (ni jeton ni cookie) et ignore le contenu des réponses : elle mesure seulement si le service répond, en combien
/// de temps, et dans quel état est son certificat. Le certificat est vérifié comme d'habitude ; s'il ne l'est pas (autorité interne pas
/// encore installée sur ce serveur, nom incorrect, certificat par défaut de Traefik), la sonde le dit dans l'état au lieu de l'ignorer.
/// </summary>
public sealed class HomeServicesMonitor(IOptions<HomeServicesOptions> options, IServiceScopeFactory scopes, ILogger<HomeServicesMonitor> log) : BackgroundService
{
    public static readonly SelfHostedService[] Catalog =
    [
        new("jellyfin", "Jellyfin", Portal: true),
        new("jellyseerr", "Jellyseerr", Portal: true),
        new("immich", "Immich", Portal: true),
        new("vaultwarden", "Vaultwarden", Portal: true),
        new("bookstack", "BookStack", Portal: true),
        new("ntfy", "ntfy", Portal: true),
        new("homarr", "Homarr", Portal: true),
        new("sonarr", "Sonarr", Portal: false),
        new("radarr", "Radarr", Portal: false),
        new("bazarr", "Bazarr", Portal: false),
        new("prowlarr", "Prowlarr", Portal: false),
        new("cleanuparr", "Cleanuparr", Portal: false),
        new("glpi", "GLPI", Portal: false),
        new("traefik", "Traefik", Portal: false),
        new("step-ca", "Step CA", Portal: false),
        new("flaresolverr", "FlareSolverr", Portal: false, HasWebUi: false),
        new("dnsmasq", "dnsmasq", Portal: false, HasWebUi: false),
    ];

    private readonly ConcurrentDictionary<string, ServiceProbeDto> _last = new();

    /// <summary>Dernier état connu de chaque service, dans l'ordre du catalogue (états « unknown » avant la première sonde).</summary>
    public IReadOnlyList<ServiceProbeDto> Snapshot() =>
        Catalog.Select(s => _last.TryGetValue(s.Key, out var p) ? p : Unknown(s)).ToList();

    public string UrlOf(SelfHostedService s) => $"https://{s.Key}.{options.Value.Domain}/";

    private ServiceProbeDto Unknown(SelfHostedService s) =>
        new(s.Key, s.Name, s.HasWebUi ? UrlOf(s) : null, s.Portal, s.HasWebUi ? "unknown" : "noui", null, null, null, null, null, null, null);

    /// <summary>Événement levé quand un service change d'état (en ligne ↔ hors ligne) : alertes (ntfy), temps réel.</summary>
    public event Func<ServiceProbeDto, ServiceProbeDto?, Task>? Changed;

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!options.Value.Enabled) { log.LogInformation("Surveillance des services auto-hébergés désactivée."); return; }
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Max(15, options.Value.IntervalSeconds)));
            do { await ProbeAllAsync(stop); }
            while (await timer.WaitForNextTickAsync(stop));
        }
        catch (OperationCanceledException) { /* arrêt de l'API */ }
    }

    public async Task ProbeAllAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var prober = scope.ServiceProvider.GetRequiredService<HomeServiceProber>();
        var results = await Task.WhenAll(Catalog.Where(s => s.HasWebUi).Select(s => prober.ProbeAsync(s, UrlOf(s), ct)));
        foreach (var r in results)
        {
            var before = _last.TryGetValue(r.Key, out var b) ? b : null;
            var changed = before is null || before.State != r.State;
            var next = changed ? r with { Since = r.CheckedAt } : r with { Since = before!.Since };
            _last[r.Key] = next;
            if (changed && before is not null && Changed is { } handler)
            {
                try { await handler(next, before); }
                catch (Exception ex) { log.LogWarning(ex, "Alerte de changement d'état non envoyée pour {Service}.", r.Name); }
            }
        }
    }
}

/// <summary>
/// Sonde HTTPS d'un service. Une connexion neuve par sonde (pas de réutilisation) pour toujours voir le certificat ; sans redirection,
/// sans cookies, délai court. Rien n'est envoyé au service et le contenu de la réponse n'est pas lu.
/// </summary>
public class HomeServiceProber
{
    /// <summary>
    /// Ce que vaut le certificat : vérifié, autorité inconnue (autorité interne pas encore installée ici), nom faux, expiré, ou certificat
    /// par défaut de Traefik (route absente). La sonde aboutit quand même : elle ne transporte aucune donnée, elle mesure la disponibilité.
    /// </summary>
    public static string Classify(X509Certificate2? cert, X509Chain? chain, SslPolicyErrors errors) =>
        cert?.GetNameInfo(X509NameType.SimpleName, false) == "TRAEFIK DEFAULT CERT" ? "traefik-default"
        : errors == SslPolicyErrors.None ? "verified"
        : errors.HasFlag(SslPolicyErrors.RemoteCertificateNameMismatch) ? "name-mismatch"
        : chain?.ChainStatus.Any(c => c.Status.HasFlag(X509ChainStatusFlags.NotTimeValid)) == true ? "expired"
        : "untrusted";

    /// <summary>État et explication à partir du code HTTP et du certificat.</summary>
    public static (string State, string? Error) Evaluate(int code, string? tls) =>
        tls == "traefik-default" ? ("down", "Route absente dans Traefik (certificat par défaut)")
        : code >= 500 ? ("degraded", $"Erreur {code} du service")
        : tls is "name-mismatch" ? ("degraded", "Certificat au mauvais nom")
        : tls is "expired" ? ("degraded", "Certificat expiré")
        : ("up", null);   // une redirection vers la page de connexion compte : le service répond

    /// <summary>Requête de sonde ; remplaçable dans les tests.</summary>
    protected virtual async Task<(int Code, string? Tls, DateTime? NotAfter, string? Issuer)> SendAsync(string url, CancellationToken ct)
    {
        string? tls = null; DateTime? notAfter = null; string? issuer = null;
        using var handler = new SocketsHttpHandler
        {
            AllowAutoRedirect = false,
            UseCookies = false,
            ConnectTimeout = TimeSpan.FromSeconds(5),
            PooledConnectionLifetime = TimeSpan.Zero,
            SslOptions = new SslClientAuthenticationOptions
            {
                RemoteCertificateValidationCallback = (_, certificate, chain, errors) =>
                {
                    var cert = certificate as X509Certificate2 ?? (certificate is null ? null : new X509Certificate2(certificate));
                    tls = Classify(cert, chain, errors);
                    notAfter = cert?.NotAfter.ToUniversalTime();
                    issuer = cert?.Issuer;
                    return true;
                },
            },
        };
        using var client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.UserAgent.ParseAdd("Divertiflix-Monitor/1.0");
        using var res = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        return ((int)res.StatusCode, tls, notAfter, issuer);
    }

    public async Task<ServiceProbeDto> ProbeAsync(SelfHostedService s, string url, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(6));
        try
        {
            var (code, tls, notAfter, issuer) = await SendAsync(url, cts.Token);
            sw.Stop();
            var (state, error) = Evaluate(code, tls);
            return new ServiceProbeDto(s.Key, s.Name, url, s.Portal, state, (int)sw.ElapsedMilliseconds, code, tls, notAfter, issuer, error, DateTime.UtcNow);
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is OperationCanceledException && !ct.IsCancellationRequested))
        {
            var reason = ex is HttpRequestException { InnerException: System.Net.Sockets.SocketException se } ? se.SocketErrorCode switch
            {
                System.Net.Sockets.SocketError.HostNotFound or System.Net.Sockets.SocketError.NoData or System.Net.Sockets.SocketError.TryAgain => "Nom introuvable (DNS)",
                System.Net.Sockets.SocketError.ConnectionRefused => "Connexion refusée",
                _ => "Injoignable",
            } : ex is OperationCanceledException ? "Pas de réponse en 6 s" : "Injoignable";
            return new ServiceProbeDto(s.Key, s.Name, url, s.Portal, "down", null, null, null, null, null, reason, DateTime.UtcNow);
        }
    }
}
