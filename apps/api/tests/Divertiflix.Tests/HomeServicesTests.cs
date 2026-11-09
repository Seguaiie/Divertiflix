using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Divertiflix.Tests;

/// <summary>Fausse sonde : les cas vus sur le vrai réseau (certificat non vérifié, route Traefik absente, erreur 500, nom introuvable).</summary>
public sealed class FakeProber : HomeServiceProber
{
    protected override Task<(int Code, string? Tls, DateTime? NotAfter, string? Issuer)> SendAsync(string url, CancellationToken ct)
    {
        var host = new Uri(url).Host;
        var notAfter = new DateTime(2026, 11, 10, 0, 0, 0, DateTimeKind.Utc);
        return host switch
        {
            "jellyfin.home.arpa" => Task.FromResult((302, (string?)"untrusted", (DateTime?)notAfter, (string?)"CN=divertiflixCA Intermediate CA")),
            "homarr.home.arpa" => Task.FromResult((404, (string?)"traefik-default", (DateTime?)null, (string?)"CN=TRAEFIK DEFAULT CERT")),
            "bookstack.home.arpa" => Task.FromResult((500, (string?)"verified", (DateTime?)notAfter, (string?)"CN=divertiflixCA Intermediate CA")),
            "sonarr.home.arpa" => Task.FromException<(int, string?, DateTime?, string?)>(new HttpRequestException("dns", new SocketException((int)SocketError.HostNotFound))),
            _ => Task.FromResult((200, (string?)"verified", (DateTime?)notAfter, (string?)"CN=divertiflixCA Intermediate CA")),
        };
    }
}

public class ServicesFactory : ApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s => s.Replace(ServiceDescriptor.Scoped<HomeServiceProber, FakeProber>()));
    }
}

public class HomeServicesTests(ServicesFactory f) : IClassFixture<ServicesFactory>
{
    [Fact]
    public async Task Admins_see_every_service_with_its_measured_state_and_the_reason()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var all = (await (await admin.PostAsync("/api/admin/services/refresh", new { })).Content.ReadAsync<List<ServiceProbeDto>>())!;
        ServiceProbeDto S(string key) => all.Single(s => s.Key == key);

        Assert.Equal(("up", "untrusted", 302), (S("jellyfin").State, S("jellyfin").Tls, S("jellyfin").HttpCode));   // répond, autorité pas encore installée ici
        Assert.Equal("https://jellyfin.home.arpa/", S("jellyfin").Url);
        Assert.Equal(("down", "Route absente dans Traefik (certificat par défaut)"), (S("homarr").State, S("homarr").Error));
        Assert.Equal(("degraded", "Erreur 500 du service"), (S("bookstack").State, S("bookstack").Error));
        Assert.Equal(("down", "Nom introuvable (DNS)"), (S("sonarr").State, S("sonarr").Error));
        Assert.Equal(("noui", (string?)null), (S("flaresolverr").State, S("flaresolverr").Url));   // pas d'interface : jamais sondé
        Assert.Equal(("up", "verified"), (S("radarr").State, S("radarr").Tls));
        Assert.NotNull(S("radarr").Since);
        Assert.Equal(17, all.Count);
    }

    [Fact]
    public async Task Services_are_for_administrators_only_and_absent_from_the_portal()
    {
        var (user, _) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("/api/admin/services")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.PostAsync("/api/admin/services/refresh", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/api/admin/services")).StatusCode);
        // L'ancienne route du portail n'existe plus : l'état des services n'est pas exposé aux abonnés.
        Assert.Equal(HttpStatusCode.NotFound, (await user.GetAsync("/api/services")).StatusCode);
    }

    private static X509Certificate2 Cert(string cn, DateTimeOffset from, DateTimeOffset to)
    {
        using var key = RSA.Create(2048);
        return new CertificateRequest($"CN={cn}", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1).CreateSelfSigned(from, to);
    }

    [Fact]
    public void Certificates_are_classified_honestly()
    {
        var now = DateTimeOffset.UtcNow;
        using var ok = Cert("jellyfin.home.arpa", now.AddDays(-1), now.AddDays(30));
        using var traefik = Cert("TRAEFIK DEFAULT CERT", now.AddDays(-1), now.AddDays(30));

        Assert.Equal("verified", HomeServiceProber.Classify(ok, null, SslPolicyErrors.None));
        Assert.Equal("traefik-default", HomeServiceProber.Classify(traefik, null, SslPolicyErrors.RemoteCertificateChainErrors));
        Assert.Equal("name-mismatch", HomeServiceProber.Classify(ok, null, SslPolicyErrors.RemoteCertificateNameMismatch));
        Assert.Equal("untrusted", HomeServiceProber.Classify(ok, null, SslPolicyErrors.RemoteCertificateChainErrors));

        // Évaluation : une redirection vers la page de connexion compte comme « en ligne ».
        Assert.Equal(("up", (string?)null), HomeServiceProber.Evaluate(302, "untrusted"));
        Assert.Equal("degraded", HomeServiceProber.Evaluate(200, "expired").State);
        Assert.Equal("down", HomeServiceProber.Evaluate(404, "traefik-default").State);
    }
}

/// <summary>Sonde dont Jellyfin tombe et revient à la demande ; faux serveur ntfy qui note chaque publication.</summary>
public sealed class FlappingProber : HomeServiceProber
{
    public static volatile bool JellyfinDown;
    protected override Task<(int Code, string? Tls, DateTime? NotAfter, string? Issuer)> SendAsync(string url, CancellationToken ct) =>
        new Uri(url).Host == "jellyfin.home.arpa" && JellyfinDown
            ? Task.FromException<(int, string?, DateTime?, string?)>(new HttpRequestException("refused", new SocketException((int)SocketError.ConnectionRefused)))
            : Task.FromResult((200, (string?)"verified", (DateTime?)null, (string?)null));
}

internal sealed class FakeNtfy : HttpMessageHandler
{
    public static readonly List<(string Url, string Title, string Priority, string? Click, string Body, string? Auth)> Posts = [];
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage r, CancellationToken ct)
    {
        var body = await r.Content!.ReadAsStringAsync(ct);
        lock (Posts) Posts.Add((r.RequestUri!.ToString(), r.Headers.GetValues("Title").Single(), r.Headers.GetValues("Priority").Single(),
            r.Headers.TryGetValues("Click", out var c) ? c.Single() : null, body, r.Headers.Authorization?.ToString()));
        return new HttpResponseMessage(HttpStatusCode.OK);
    }
}

public class NtfyFactory : ApiFactory
{
    protected override Dictionary<string, string> Settings => new(base.Settings)
    {
        ["Ntfy:Url"] = "https://ntfy.test", ["Ntfy:Topic"] = "divertiflix-alertes", ["Ntfy:Token"] = "tk_test",
    };
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s =>
        {
            s.Replace(ServiceDescriptor.Scoped<HomeServiceProber, FlappingProber>());
            s.AddHttpClient(NtfyAlerts.ClientName).ConfigurePrimaryHttpMessageHandler(() => new FakeNtfy());
        });
    }
}

public class NtfyAlertsTests(NtfyFactory f) : IClassFixture<NtfyFactory>
{
    [Fact]
    public async Task A_service_going_down_then_up_sends_one_alert_each_way_and_nothing_otherwise()
    {
        var (admin, _) = await f.LoginAdminAsync();
        async Task Probe() => Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync("/api/admin/services/refresh", new { })).StatusCode);

        FlappingProber.JellyfinDown = false;
        await Probe();   // premier relevé : pas d'alerte
        await Probe();   // rien ne change : pas d'alerte
        lock (FakeNtfy.Posts) Assert.Empty(FakeNtfy.Posts);

        FlappingProber.JellyfinDown = true;
        await Probe();
        await Probe();   // toujours hors ligne : une seule alerte
        FlappingProber.JellyfinDown = false;
        await Probe();

        lock (FakeNtfy.Posts)
        {
            Assert.Equal(2, FakeNtfy.Posts.Count);
            var down = FakeNtfy.Posts[0];
            Assert.Equal(("https://ntfy.test/divertiflix-alertes", "Jellyfin hors ligne", "high", "https://jellyfin.home.arpa/", "Connexion refusée", "Bearer tk_test"),
                (down.Url, down.Title, down.Priority, down.Click, down.Body, down.Auth));
            Assert.Equal(("Jellyfin de nouveau en ligne", "default"), (FakeNtfy.Posts[1].Title, FakeNtfy.Posts[1].Priority));
        }
    }
}
