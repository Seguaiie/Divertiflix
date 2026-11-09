using System.Net.Http.Headers;
using Divertiflix.Api.Dtos;
using Microsoft.Extensions.Options;

namespace Divertiflix.Api.Services;

/// <summary>ntfy (section « Ntfy » : Ntfy__Url, Ntfy__Topic, Ntfy__Token facultatif). Inactif tant qu'aucun sujet n'est donné.</summary>
public sealed class NtfyOptions
{
    public string Url { get; set; } = "https://ntfy.home.arpa";
    /// <summary>Sujet des alertes d'infrastructure (ex. divertiflix-alertes) : s'y abonner dans l'application ntfy du téléphone.</summary>
    public string Topic { get; set; } = "";
    /// <summary>Jeton d'accès, si le serveur ntfy n'accepte pas les publications anonymes.</summary>
    public string Token { get; set; } = "";

    public bool Configured =>
        Topic.Length > 0 && Topic.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_')
        && Uri.TryCreate(Url, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp);
}

/// <summary>
/// Alerte sur le téléphone quand un service auto-hébergé tombe ou revient (changement d'état détecté par <see cref="HomeServicesMonitor"/>).
/// Le certificat de ntfy est vérifié normalement : tant que l'autorité interne n'est pas installée, l'envoi échoue et c'est journalisé.
/// </summary>
public sealed class NtfyAlerts(IHttpClientFactory factory, IOptions<NtfyOptions> options, ILogger<NtfyAlerts> log)
{
    public const string ClientName = "ntfy";

    public async Task ServiceChangedAsync(ServiceProbeDto now, ServiceProbeDto? before)
    {
        var o = options.Value;
        if (!o.Configured || before is null) return;
        // Seules les vraies bascules comptent : en ligne ↔ perturbé ou hors ligne.
        var wasUp = before.State == "up";
        var isUp = now.State == "up";
        if (wasUp == isUp || now.State is "unknown" or "noui") return;

        var title = isUp ? $"{now.Name} de nouveau en ligne" : now.State == "down" ? $"{now.Name} hors ligne" : $"{now.Name} perturbé";
        var body = isUp ? $"Répond en {now.LatencyMs} ms." : now.Error ?? "Le service ne répond plus normalement.";
        using var req = new HttpRequestMessage(HttpMethod.Post, $"{o.Url.TrimEnd('/')}/{o.Topic}") { Content = new StringContent(body) };
        req.Headers.Add("Title", title);
        req.Headers.Add("Tags", isUp ? "white_check_mark,divertiflix" : "rotating_light,divertiflix");
        req.Headers.Add("Priority", isUp ? "default" : "high");
        if (now.Url is { } url) req.Headers.Add("Click", url);
        if (o.Token.Length > 0) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", o.Token);
        try
        {
            using var res = await factory.CreateClient(ClientName).SendAsync(req);
            if (!res.IsSuccessStatusCode) log.LogWarning("ntfy a refusé l'alerte « {Title} » : {Code}.", title, (int)res.StatusCode);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        { log.LogWarning("Alerte ntfy « {Title} » non envoyée : {Error}", title, ex.InnerException?.Message ?? ex.Message); }
    }
}
