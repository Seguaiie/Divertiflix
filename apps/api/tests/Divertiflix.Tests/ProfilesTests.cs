using System.Net;
using System.Net.Http.Json;
using Divertiflix.Api.Controllers;
using Divertiflix.Api.Dtos;

namespace Divertiflix.Tests;

public class ProfilesTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Registration_creates_one_profile_and_max_is_five()
    {
        var (c, _) = await f.RegisterAsync();
        Assert.Single((await c.GetAsync<List<ProfileDto>>("/api/profiles"))!);
        for (var i = 0; i < 4; i++)
            Assert.Equal(HttpStatusCode.Created, (await c.PostAsync("/api/profiles", new ProfileUpsert($"P{i}"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsync("/api/profiles", new ProfileUpsert("Trop"))).StatusCode);
    }

    [Fact]
    public async Task Last_profile_cannot_be_deleted()
    {
        var (c, _) = await f.RegisterAsync();
        var p = (await c.GetAsync<List<ProfileDto>>("/api/profiles"))![0];
        Assert.Equal(HttpStatusCode.Conflict, (await c.DeleteAsync($"/api/profiles/{p.Id}")).StatusCode);
    }

    [Fact]
    public async Task Watchlist_add_is_idempotent_and_remove_works()
    {
        var (c, _) = await f.RegisterAsync();
        var p = (await c.GetAsync<List<ProfileDto>>("/api/profiles"))![0];
        var title = (await c.GetAsync<PagedResult<TitleDto>>("/api/titles"))!.Items[0];
        for (var i = 0; i < 2; i++)
            Assert.Equal(HttpStatusCode.NoContent, (await c.PutAsync($"/api/profiles/{p.Id}/watchlist/{title.Id}", null)).StatusCode);
        Assert.Single((await c.GetAsync<List<TitleDto>>($"/api/profiles/{p.Id}/watchlist"))!);
        await c.DeleteAsync($"/api/profiles/{p.Id}/watchlist/{title.Id}");
        Assert.Empty((await c.GetAsync<List<TitleDto>>($"/api/profiles/{p.Id}/watchlist"))!);
    }

    [Fact]
    public async Task Other_users_profile_is_not_found()
    {
        var (a, _) = await f.RegisterAsync();
        var (b, _) = await f.RegisterAsync();
        var pa = (await a.GetAsync<List<ProfileDto>>("/api/profiles"))![0];
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/profiles/{pa.Id}/watchlist")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PutAsync($"/api/profiles/{pa.Id}", new ProfileUpsert("Vol"))).StatusCode);
    }
}
