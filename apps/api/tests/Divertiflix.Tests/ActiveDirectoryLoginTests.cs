using System.Net;
using Divertiflix.Api.Auth;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Divertiflix.Tests;

/// <summary>Faux contrôleur de domaine : un seul compte valide, et un interrupteur « injoignable ».</summary>
public sealed class FakeDirectory(IOptions<ActiveDirectoryOptions> o) : ActiveDirectoryAuth(o, NullLogger<ActiveDirectoryAuth>.Instance)
{
    public static volatile bool Down;
    public static readonly List<string> Binds = [];

    public override Task<bool?> VerifyAsync(string upn, string password, CancellationToken ct)
    {
        lock (Binds) Binds.Add(upn);
        if (Down) return Task.FromResult<bool?>(null);
        return Task.FromResult<bool?>(upn == "jdupont@ad.home.arpa" && password == "Ad-Passw0rd!");
    }
}

public class AdFactory : ApiFactory
{
    protected override Dictionary<string, string> Settings => new(base.Settings)
    {
        ["ActiveDirectory:Host"] = "192.0.2.10",
        ["ActiveDirectory:Domain"] = "ad.home.arpa",
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s => s.Replace(ServiceDescriptor.Singleton<ActiveDirectoryAuth, FakeDirectory>()));
    }
}

public class ActiveDirectoryLoginTests(AdFactory f) : IClassFixture<AdFactory>
{
    private async Task<HttpResponseMessage> Login(string login, string password) =>
        await f.CreateClient().PostAsync("/api/auth/login", new LoginRequest(login, password));

    [Fact]
    public async Task An_ad_account_signs_in_with_its_directory_password_and_gets_admin_once()
    {
        FakeDirectory.Down = false;
        var first = await Login("jdupont", "Ad-Passw0rd!");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var auth = (await first.Content.ReadAsync<AuthResponse>())!;
        Assert.Equal("jdupont@ad.home.arpa", auth.User.Email);
        Assert.Equal(Role.Admin, auth.User.Role);   // tout l'annuaire a accès au back-office

        // Les autres écritures du même compte mènent au même utilisateur (pas de doublon).
        foreach (var login in new[] { "JDupont@AD.home.arpa", "AD\\jdupont" })
        {
            var again = (await (await Login(login, "Ad-Passw0rd!")).Content.ReadAsync<AuthResponse>())!;
            Assert.Equal(auth.User.Id, again.User.Id);
        }

        // Le jeton ouvre bien les routes réservées aux administrateurs.
        var (admin, _) = await f.LoginAsync("jdupont", "Ad-Passw0rd!");
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/admin/users")).StatusCode);
    }

    [Fact]
    public async Task A_wrong_password_or_an_unknown_account_is_refused()
    {
        FakeDirectory.Down = false;
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login("jdupont", "mauvais")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login("inconnu", "Ad-Passw0rd!")).StatusCode);
    }

    [Fact]
    public async Task The_local_root_account_and_other_domains_never_go_to_the_directory()
    {
        FakeDirectory.Down = true;   // même annuaire en panne, les comptes locaux se connectent
        lock (FakeDirectory.Binds) FakeDirectory.Binds.Clear();
        var (_, root) = await f.LoginAdminAsync();
        Assert.Equal("root", root.User.Email);

        var (_, reg) = await f.RegisterAsync();   // courriel d'un autre domaine : compte local
        Assert.Equal(HttpStatusCode.OK, (await Login(reg.User.Email, "Passw0rd!")).StatusCode);
        lock (FakeDirectory.Binds) Assert.Empty(FakeDirectory.Binds);
        FakeDirectory.Down = false;
    }

    [Fact]
    public async Task An_unreachable_directory_is_reported_and_odd_names_never_reach_ldap()
    {
        FakeDirectory.Down = true;
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await Login("jdupont", "Ad-Passw0rd!")).StatusCode);
        FakeDirectory.Down = false;

        lock (FakeDirectory.Binds) FakeDirectory.Binds.Clear();
        Assert.Equal(HttpStatusCode.Unauthorized, (await Login("a*)(objectClass=*", "x")).StatusCode);
        lock (FakeDirectory.Binds) Assert.Empty(FakeDirectory.Binds);
    }
}
