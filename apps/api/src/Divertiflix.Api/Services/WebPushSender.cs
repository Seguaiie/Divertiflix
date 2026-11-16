using System.Net;
using Microsoft.Extensions.Options;
using WebPush;
using DomainPushSubscription = Divertiflix.Domain.PushSubscription;

namespace Divertiflix.Api.Services;

/// <summary>Notifications infonuagiques (section « Push » : Push__PublicKey, Push__PrivateKey, Push__Subject). Inactif tant que les clés VAPID ne sont pas fournies.</summary>
public sealed class PushOptions
{
    public string PublicKey { get; set; } = "";
    public string PrivateKey { get; set; } = "";
    /// <summary>« mailto:... » ou une URL du site, exigé par la norme Web Push pour s'identifier auprès des serveurs de notification.</summary>
    public string Subject { get; set; } = "mailto:admin@home.arpa";

    public bool Configured => PublicKey.Length > 0 && PrivateKey.Length > 0;
}

/// <summary>Envoie les notifications sur les navigateurs abonnés (Web Push). Au mieux : un envoi raté n'empêche jamais la notification en direct (SignalR).</summary>
public sealed class WebPushSender(HttpClient http, IOptions<PushOptions> options, ILogger<WebPushSender> log)
{
    private readonly WebPushClient client = new(http);

    public bool Configured => options.Value.Configured;

    /// <summary>Envoie une notification à un abonnement. Renvoie vrai si l'abonnement est mort (410/404) : l'appelant doit l'oublier.</summary>
    public async Task<bool> SendAsync(DomainPushSubscription sub, string payload, CancellationToken ct)
    {
        var o = options.Value;
        try
        {
            await client.SendNotificationAsync(new PushSubscription(sub.Endpoint, sub.P256dh, sub.Auth), payload,
                new VapidDetails(o.Subject, o.PublicKey, o.PrivateKey), ct);
            return false;
        }
        catch (WebPushException ex) when (ex.StatusCode is HttpStatusCode.Gone or HttpStatusCode.NotFound) { return true; }
        catch (Exception ex) when (ex is WebPushException or HttpRequestException or TaskCanceledException)
        { log.LogDebug(ex, "Notification infonuagique non livrée."); return false; }
    }
}
