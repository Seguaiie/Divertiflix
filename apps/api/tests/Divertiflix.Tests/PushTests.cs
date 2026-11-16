using System.Net;
using System.Security.Cryptography;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Tests;

/// <summary>Une clé publique EC P-256 et un secret « auth », au format d'un vrai abonnement PushManager du navigateur.</summary>
internal static class FakeBrowserKeys
{
    public static (string P256dh, string Auth) Generate()
    {
        using var ec = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var p = ec.ExportParameters(false);
        var point = new byte[65];
        point[0] = 0x04;
        p.Q.X!.CopyTo(point, 1 + (32 - p.Q.X!.Length));
        p.Q.Y!.CopyTo(point, 33 + (32 - p.Q.Y!.Length));
        var auth = RandomNumberGenerator.GetBytes(16);
        return (Base64Url(point), Base64Url(auth));
    }

    private static string Base64Url(byte[] b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}

/// <summary>Faux serveur de notification push : 201 pour tout abonnement, sauf celui marqué "gone" (410, simule un abonnement mort).</summary>
internal sealed class FakePushService : HttpMessageHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
        Task.FromResult(new HttpResponseMessage(request.RequestUri!.ToString().Contains("/gone/") ? HttpStatusCode.Gone : HttpStatusCode.Created));
}

public class PushFactory : ApiFactory
{
    protected override Dictionary<string, string> Settings => new(base.Settings)
    {
        ["Push:PublicKey"] = "BOYZQF4H-KpjT0EnarEiUKLj4rTqO25o6DvWTHAaHQ_zRioDvSNH4tlDsj7W1lpTcNQIdJR4fdNZdUt2Eo1xzxw",
        ["Push:PrivateKey"] = "AYxd28wLhHLQhsT3HRs2gC7mCSus_51FSbR3gf4WSWo",
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s => s.AddHttpClient<Divertiflix.Api.Services.WebPushSender>().ConfigurePrimaryHttpMessageHandler(() => new FakePushService()));
    }
}

public class PushTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Public_key_is_unavailable_until_configured()
    {
        var (c, _) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await c.GetAsync("/api/push/public-key")).StatusCode);
    }

    [Fact]
    public async Task Subscribe_is_upserted_by_endpoint_and_unsubscribe_removes_it_for_its_owner_only()
    {
        var (a, _) = await f.RegisterAsync();
        var (b, _) = await f.RegisterAsync();
        var (p256dh, auth) = FakeBrowserKeys.Generate();
        const string endpoint = "https://push.test/ep/subscribe-upsert";

        Assert.Equal(HttpStatusCode.NoContent, (await a.PostAsync("/api/push/subscribe", new PushSubscribeRequest(endpoint, p256dh, auth))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await a.PostAsync("/api/push/subscribe", new PushSubscribeRequest(endpoint, p256dh, auth))).StatusCode);   // même point de terminaison : mis à jour, pas dupliqué

        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>();
            Assert.Single(await db.PushSubscriptions.Where(s => s.Endpoint == endpoint).ToListAsync());
        }

        // Un autre compte ne peut pas désabonner l'abonnement de quelqu'un d'autre.
        await b.DeleteAsync($"/api/push/subscribe?endpoint={Uri.EscapeDataString(endpoint)}");
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>();
            Assert.NotNull(await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == endpoint));
        }

        Assert.Equal(HttpStatusCode.NoContent, (await a.DeleteAsync($"/api/push/subscribe?endpoint={Uri.EscapeDataString(endpoint)}")).StatusCode);
        using (var scope = f.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>();
            Assert.Null(await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == endpoint));
        }
    }
}

/// <summary>Bout en bout, avec les clés VAPID configurées et un faux serveur de notification.</summary>
public class PushDeliveryTests(PushFactory f) : IClassFixture<PushFactory>
{
    [Fact]
    public async Task Approving_a_request_sends_a_web_push_and_forgets_dead_subscriptions()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var (user, auth) = await f.RegisterAsync();
        var (p256dh, auth2) = FakeBrowserKeys.Generate();
        var alive = $"https://push.test/ep/alive-{Guid.NewGuid():N}";
        var gone = $"https://push.test/gone/dead-{Guid.NewGuid():N}";
        await user.PostAsync("/api/push/subscribe", new PushSubscribeRequest(alive, p256dh, auth2));
        await user.PostAsync("/api/push/subscribe", new PushSubscribeRequest(gone, p256dh, auth2));

        var card = (await (await user.PostAsync("/api/requests", new RequestCreate("Poussée", TitleKind.Movie, null, null, null))).Content.ReadAsync<RequestCardDto>())!;
        // L'envoi (vers le faux serveur) est attendu avant que l'API ne réponde : à ce point, les deux abonnements ont déjà été tentés.
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsync($"/api/admin/requests/{card.Id}", new RequestStatusUpdate(RequestStatus.Approved, null, null))).StatusCode);

        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>();
        Assert.NotNull(await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == alive));
        Assert.Null(await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == gone));   // 410 reçu : oublié
    }
}
