using System.Net;
using System.Net.Http.Json;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;

namespace Divertiflix.Tests;

public class DirectorySyncTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static HttpRequestMessage Req(string key, DirectorySyncRequest body, string query = "")
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/admin/directory-sync" + query) { Content = JsonContent.Create(body, options: Json.Options) };
        if (key.Length > 0) msg.Headers.Add("X-Sync-Key", key);
        return msg;
    }

    private static DirectoryAccountDto Acc(string email, params string[] groups) => new(email, "Personne AD", [.. groups]);

    [Fact]
    public async Task Missing_or_wrong_key_is_unauthorized()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().SendAsync(Req("", new DirectorySyncRequest([])))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().SendAsync(Req("nope", new DirectorySyncRequest([])))).StatusCode);
    }

    [Fact]
    public async Task Creates_account_with_role_from_group_and_it_cannot_log_in_locally()
    {
        var email = $"ad{Guid.NewGuid():N}@corp.test";
        var res = await f.CreateClient().SendAsync(Req(ApiFactory.SyncKey, new DirectorySyncRequest([Acc(email, "Divertiflix-Admins")]), "?force=true"));
        Assert.Equal(1, (await res.Content.ReadAsync<DirectorySyncResult>())!.Created);
        var login = await f.CreateClient().PostAsync("/api/auth/login", new LoginRequest(email, "peu importe"));
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }

    [Fact]
    public async Task A_local_account_with_the_same_email_is_never_taken_over()
    {
        // Un attaquant s'inscrit avec le courriel d'une future personne de l'annuaire, avant la synchronisation.
        var email = $"ceo{Guid.NewGuid():N}@corp.test";
        var (attacker, reg) = await f.RegisterAsync(email);
        var res = await f.CreateClient().SendAsync(Req(ApiFactory.SyncKey, new DirectorySyncRequest([Acc(email, "Divertiflix-Admins")]), "?force=true"));
        var result = (await res.Content.ReadAsync<DirectorySyncResult>())!;
        Assert.Equal(1, result.Conflicts);
        Assert.Equal(0, result.Created + result.Updated);

        // Le compte reste un abonné local : aucune élévation de privilèges.
        var (c, login) = await f.LoginAsync(email, "Passw0rd!");
        Assert.Equal(Role.Subscriber, login.User.Role);
        Assert.Equal(HttpStatusCode.Forbidden, (await c.GetAsync("/api/admin/stats")).StatusCode);
    }

    [Fact]
    public async Task Deactivates_absent_accounts_but_refuses_mass_deactivation()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var keep = $"keep{Guid.NewGuid():N}@corp.test";
        var drop = $"drop{Guid.NewGuid():N}@corp.test";
        await f.CreateClient().SendAsync(Req(ApiFactory.SyncKey, new DirectorySyncRequest([Acc(keep), Acc(drop)]), "?force=true"));

        async Task<List<string>> ActiveAd() => (await admin.GetAsync<PagedResult<AdminUserDto>>("/api/admin/users?pageSize=100"))!.Items
            .Where(u => u.Source == AccountSource.ActiveDirectory && u.IsActive).Select(u => u.Email).ToList();

        // Un envoi vide désactiverait tout : refusé (annuaire injoignable ou script en erreur).
        var empty = await f.CreateClient().SendAsync(Req(ApiFactory.SyncKey, new DirectorySyncRequest([])));
        Assert.Equal(HttpStatusCode.Conflict, empty.StatusCode);
        Assert.Contains(drop, await ActiveAd());   // rien n'a changé

        // Retirer une seule personne reste permis.
        var present = (await ActiveAd()).Where(e => e != drop).Select(e => Acc(e)).ToList();
        var ok = await f.CreateClient().SendAsync(Req(ApiFactory.SyncKey, new DirectorySyncRequest(present)));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(1, (await ok.Content.ReadAsync<DirectorySyncResult>())!.Deactivated);
        Assert.DoesNotContain(drop, await ActiveAd());
        Assert.Contains(keep, await ActiveAd());

        // Avec ?force=true, on peut tout désactiver.
        var forced = await f.CreateClient().SendAsync(Req(ApiFactory.SyncKey, new DirectorySyncRequest([]), "?force=true"));
        Assert.Equal(HttpStatusCode.OK, forced.StatusCode);
        Assert.Empty(await ActiveAd());
    }
}
