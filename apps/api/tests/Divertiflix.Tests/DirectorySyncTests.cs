using System.Net;
using System.Net.Http.Headers;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;

namespace Divertiflix.Tests;

public class DirectorySyncTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static HttpRequestMessage Req(string key, DirectorySyncRequest body)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/admin/directory-sync") { Content = JsonContent(body) };
        if (key.Length > 0) msg.Headers.Add("X-Sync-Key", key);
        return msg;
    }

    private static System.Net.Http.Json.JsonContent JsonContent(DirectorySyncRequest body) =>
        System.Net.Http.Json.JsonContent.Create(body, options: Json.Options);

    [Fact]
    public async Task Missing_key_is_unauthorized()
    {
        var res = await f.CreateClient().SendAsync(Req("", new DirectorySyncRequest([])));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Wrong_key_is_unauthorized()
    {
        var res = await f.CreateClient().SendAsync(Req("nope", new DirectorySyncRequest([])));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Creates_account_with_role_from_group_then_deactivates_when_absent()
    {
        var email = $"ad{Guid.NewGuid():N}@corp.test";
        var payload = new DirectorySyncRequest([new DirectoryAccountDto(email, "Personne AD", ["Divertiflix-Admins"])]);
        var created = await f.CreateClient().SendAsync(Req(ApiFactory.SyncKey, payload));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        var result = (await created.Content.ReadAsync<DirectorySyncResult>())!;
        Assert.Equal(1, result.Created);

        var (client, _) = await f.LoginAsync(ApiFactory.AdminEmail, ApiFactory.AdminPassword);
        var list = await client.GetAsync<PagedResult<TitleDto>>("/api/titles?pageSize=1"); // sanity: admin toujours fonctionnel
        Assert.NotNull(list);

        // Deuxième synchro sans ce compte -> désactivé (pas supprimé).
        var second = await f.CreateClient().SendAsync(Req(ApiFactory.SyncKey, new DirectorySyncRequest([])));
        var secondResult = (await second.Content.ReadAsync<DirectorySyncResult>())!;
        Assert.Equal(1, secondResult.Deactivated);

        var login = await f.CreateClient().PostAsync("/api/auth/login", new LoginRequest(email, "peu importe"));
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }
}
