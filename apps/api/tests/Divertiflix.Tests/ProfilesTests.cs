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
    public async Task Watchlist_add_is_idempotent_concurrency_safe_and_remove_works()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var title = (await c.GetAsync<PagedResult<TitleDto>>("/api/titles"))!.Items[0];
        // Dix ajouts simultanés : un seul enregistrement, aucune erreur.
        var res = await Task.WhenAll(Enumerable.Range(0, 10).Select(_ => c.PutAsync($"/api/profiles/{pid}/watchlist/{title.Id}", null)));
        Assert.All(res, r => Assert.Equal(HttpStatusCode.NoContent, r.StatusCode));
        var list = (await c.GetAsync<List<CardDto>>($"/api/profiles/{pid}/watchlist"))!;
        var card = Assert.Single(list);
        Assert.True(card.InWatchlist);
        await c.DeleteAsync($"/api/profiles/{pid}/watchlist/{title.Id}");
        Assert.Empty((await c.GetAsync<List<CardDto>>($"/api/profiles/{pid}/watchlist"))!);
    }

    [Fact]
    public async Task Progress_is_clamped_upserted_and_cleared()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var t = await ApiFactory.TitleAsync(c, "Big Buck Bunny");
        Assert.Equal(HttpStatusCode.NoContent, (await c.PutAsync($"/api/profiles/{pid}/progress/{t.Id}", new ProgressUpsert(120, 600))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await c.PutAsync($"/api/profiles/{pid}/progress/{t.Id}", new ProgressUpsert(9999, 600))).StatusCode);   // plafonné
        var detail = (await c.GetAsync<TitleDetailDto>($"/api/titles/{t.Id}/detail?profileId={pid}"))!;
        Assert.Equal(600, detail.Card.Progress!.PositionSeconds);
        Assert.Equal(1.0, detail.Card.Progress.Fraction);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PutAsync($"/api/profiles/{pid}/progress/{t.Id}", new ProgressUpsert(-5, 600))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/profiles/{pid}/progress/{t.Id}")).StatusCode);
        Assert.Null((await c.GetAsync<TitleDetailDto>($"/api/titles/{t.Id}/detail?profileId={pid}"))!.Card.Progress);
    }

    [Fact]
    public async Task Ratings_toggle_between_up_down_and_none()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var t = await ApiFactory.TitleAsync(c, "Sintel");
        async Task<int> Mine() => (await c.GetAsync<TitleDetailDto>($"/api/titles/{t.Id}/detail?profileId={pid}"))!.Card.MyRating;
        await c.PutAsync($"/api/profiles/{pid}/ratings/{t.Id}", new RatingUpsert(1));
        Assert.Equal(1, await Mine());
        await c.PutAsync($"/api/profiles/{pid}/ratings/{t.Id}", new RatingUpsert(-1));
        Assert.Equal(-1, await Mine());
        await c.PutAsync($"/api/profiles/{pid}/ratings/{t.Id}", new RatingUpsert(0));
        Assert.Equal(0, await Mine());
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PutAsync($"/api/profiles/{pid}/ratings/{t.Id}", new RatingUpsert(5))).StatusCode);
    }

    [Fact]
    public async Task Other_users_profile_is_not_found_everywhere()
    {
        var (a, _) = await f.RegisterAsync();
        var (b, _) = await f.RegisterAsync();
        var pa = await ApiFactory.ProfileIdAsync(a);
        var t = await ApiFactory.TitleAsync(b, "Sintel");
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/profiles/{pa}/watchlist")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PutAsync($"/api/profiles/{pa}", new ProfileUpsert("Vol"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PutAsync($"/api/profiles/{pa}/progress/{t.Id}", new ProgressUpsert(1, 10))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PutAsync($"/api/profiles/{pa}/ratings/{t.Id}", new RatingUpsert(1))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/home?profileId={pa}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/titles/{t.Id}/detail?profileId={pa}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsync("/api/assistant/chat", new ChatRequest(pa, "bonjour", "fr"))).StatusCode);
    }
}
