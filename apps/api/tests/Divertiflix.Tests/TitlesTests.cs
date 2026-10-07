using System.Net;
using System.Net.Http.Json;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;

namespace Divertiflix.Tests;

public class TitlesTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static TitleUpsert Sample(string name) => new(name, "Synopsis", 2020, TitleKind.Movie, "Drame", 90, null, null);

    [Fact]
    public async Task Seeded_catalog_is_searchable_and_paged()
    {
        var (c, _) = await f.RegisterAsync();
        var all = (await c.GetAsync<PagedResult<TitleDto>>("/api/titles?pageSize=2"))!;
        Assert.True(all.Total >= 4);
        Assert.Equal(2, all.Items.Count);
        var found = (await c.GetAsync<PagedResult<TitleDto>>("/api/titles?q=sintel"))!;
        Assert.Contains(found.Items, t => t.Name == "Sintel");
    }

    [Fact]
    public async Task Subscriber_cannot_create_title()
    {
        var (c, _) = await f.RegisterAsync();
        var res = await c.PostAsync("/api/titles", Sample("Interdit"));
        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
    }

    [Fact]
    public async Task Admin_can_create_update_delete()
    {
        var (c, _) = await f.LoginAsync(ApiFactory.AdminEmail, ApiFactory.AdminPassword);
        var created = await c.PostAsync("/api/titles", Sample("Nouveau"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var dto = (await created.Content.ReadAsync<TitleDto>())!;

        var upd = await c.PutAsync($"/api/titles/{dto.Id}", Sample("Renommé"));
        Assert.Equal("Renommé", (await upd.Content.ReadAsync<TitleDto>())!.Name);

        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/titles/{dto.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync($"/api/titles/{dto.Id}")).StatusCode);
    }
}
