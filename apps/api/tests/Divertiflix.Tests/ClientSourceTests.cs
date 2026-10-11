using System.Net;
using Divertiflix.Api.Dtos;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Tests;

/// <summary>
/// API derrière le proxy local : le serveur de test n'a pas d'adresse distante, on lui donne celle de la boucle locale (de confiance)
/// pour que l'adresse du client vienne de X-Forwarded-For, comme derrière nginx.
/// </summary>
public class ProxiedFactory : ApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureServices(services => services.AddSingleton<IStartupFilter, LoopbackProxy>());
    }

    private sealed class LoopbackProxy : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            app.Use((ctx, following) => { ctx.Connection.RemoteIpAddress = IPAddress.Loopback; return following(ctx); });
            next(app);
        };
    }
}

/// <summary>Même proxy, avec un plafond d'authentification bas pour observer le regroupement des adresses.</summary>
public class ProxiedLowLimitFactory : ProxiedFactory
{
    protected override Dictionary<string, string> Settings => new() { ["RateLimit:AuthPerMinute"] = "4" };
}

/// <summary>Les protections par source (verrou de connexion, limitation de débit) reçoivent bien l'adresse du client, pas celle du proxy.</summary>
public class ClientSourceTests(ProxiedFactory f) : IClassFixture<ProxiedFactory>
{
    private HttpClient From(string address)
    {
        var client = f.CreateClient();
        client.DefaultRequestHeaders.Add("X-Forwarded-For", address);
        return client;
    }

    private static Task<HttpResponseMessage> Login(HttpClient c, string email, string password) => c.PostAsync("/api/auth/login", new LoginRequest(email, password));

    [Fact]
    public async Task The_login_lock_tells_the_owner_from_the_attacker_by_their_addresses()
    {
        var (_, reg) = await f.RegisterAsync();
        var owner = From("198.51.100.7");
        var attacker = From("203.0.113.9");
        Assert.Equal(HttpStatusCode.OK, (await Login(owner, reg.User.Email, "Passw0rd!")).StatusCode);   // cette adresse est désormais connue

        for (var i = 0; i < 5; i++) Assert.Equal(HttpStatusCode.Unauthorized, (await Login(attacker, reg.User.Email, "faux" + i)).StatusCode);
        Assert.Equal(HttpStatusCode.TooManyRequests, (await Login(attacker, reg.User.Email, "Passw0rd!")).StatusCode);   // verrouillée, même avec le bon mot de passe
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login(owner, reg.User.Email, "faux")).StatusCode);              // le propriétaire n'est pas bloqué
        Assert.Equal(HttpStatusCode.OK, (await Login(owner, reg.User.Email, "Passw0rd!")).StatusCode);
    }
}

public class ClientSourceRateLimitTests(ProxiedLowLimitFactory f) : IClassFixture<ProxiedLowLimitFactory>
{
    private async Task<HttpStatusCode> LoginFrom(string address)
    {
        var client = f.CreateClient();
        client.DefaultRequestHeaders.Add("X-Forwarded-For", address);
        return (await client.PostAsync("/api/auth/login", new LoginRequest($"inconnu{Guid.NewGuid():N}@test.com", "faux"))).StatusCode;
    }

    [Fact]
    public async Task Addresses_of_one_ipv6_64_share_one_rate_limit_and_another_prefix_has_its_own()
    {
        // Plafond de 4 par minute. Deux adresses du même /64 (ce qu'un abonné contrôle) se partagent le même compteur.
        string[] same64 = ["2001:db8:abcd:12::2", "2001:db8:abcd:12::61"];
        for (var i = 0; i < 4; i++) Assert.Equal(HttpStatusCode.Unauthorized, await LoginFrom(same64[i % 2]));
        Assert.Equal(HttpStatusCode.TooManyRequests, await LoginFrom(same64[0]));
        Assert.Equal(HttpStatusCode.TooManyRequests, await LoginFrom(same64[1]));
        Assert.Equal(HttpStatusCode.Unauthorized, await LoginFrom("2001:db8:abcd:13::2"));   // un autre /64 a son propre plafond
    }
}
