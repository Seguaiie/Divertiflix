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
    public async Task The_portal_lists_only_the_shared_apps_without_technical_details_and_the_infrastructure_is_admin_only()
    {
        var (admin, _) = await f.LoginAdminAsync();
        await admin.PostAsync("/api/admin/services/refresh", new { });

        var (user, _) = await f.RegisterAsync();
        var portal = (await user.GetAsync<List<ServiceProbeDto>>("/api/services"))!;
        Assert.Equal(new[] { "jellyfin", "jellyseerr", "immich", "vaultwarden", "bookstack", "ntfy", "homarr" }, portal.Select(s => s.Key));
        Assert.All(portal, s => Assert.Null(s.CertIssuer));
        Assert.All(portal, s => Assert.Null(s.HttpCode));

        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("/api/admin/services")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await user.PostAsync("/api/admin/services/refresh", new { })).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/api/services")).StatusCode);
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
