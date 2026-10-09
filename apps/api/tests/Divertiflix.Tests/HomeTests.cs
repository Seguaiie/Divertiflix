using System.Net;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;

namespace Divertiflix.Tests;

public class HomeTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static async Task<HomeDto> HomeAsync(HttpClient c, Guid pid) => (await c.GetAsync<HomeDto>($"/api/home?profileId={pid}"))!;

    [Fact]
    public async Task Cold_start_home_is_complete_playable_and_honest()
    {
        var (c, _) = await f.RegisterAsync();
        var home = await HomeAsync(c, await ApiFactory.ProfileIdAsync(c));
        Assert.False(home.HasTaste);
        Assert.NotEmpty(home.Hero);
        Assert.All(home.Hero, h => Assert.Equal("featured", h.Mode));
        var types = home.Rows.Select(r => r.Type).ToList();
        Assert.Contains("forYou", types); Assert.Contains("trending", types); Assert.Contains("recent", types); Assert.Contains("audiobooks", types);
        Assert.DoesNotContain("continue", types);
        // Aucune carte non lisible dans les rangées ni dans le héros, et aucun pourcentage sans historique.
        var cards = home.Rows.SelectMany(r => r.Items).Concat(home.Hero.Select(h => h.Card)).ToList();
        Assert.All(cards, k => { Assert.True(k.Title.IsPlayable); Assert.Equal(0, k.Match); });
        // Les rangées « genre » ne portent que des films, jamais des livres audio.
        Assert.All(home.Rows.Where(r => r.Type == "genre").SelectMany(r => r.Items), k => Assert.NotEqual(TitleKind.Audiobook, k.Title.Kind));
        // Une rangée sans éléments n'est jamais renvoyée.
        Assert.All(home.Rows, r => Assert.True(r.Items.Count > 0 || r.Requests is { Count: > 0 }));
        // Ordre de « recent » : du plus récent au plus ancien.
        var recent = home.Rows.First(r => r.Type == "recent").Items.Select(k => k.Title.AddedAt).ToList();
        Assert.Equal(recent.OrderByDescending(d => d), recent);
    }

    [Fact]
    public async Task Watching_builds_continue_row_hero_and_personalized_recommendations()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var started = await ApiFactory.TitleAsync(c, "Orbite silencieuse");
        var finished = await ApiFactory.TitleAsync(c, "Marée basse");
        await c.PutAsync($"/api/profiles/{pid}/progress/{started.Id}", new ProgressUpsert(120, 360));
        await c.PutAsync($"/api/profiles/{pid}/progress/{finished.Id}", new ProgressUpsert(235, 240));

        var home = await HomeAsync(c, pid);
        Assert.True(home.HasTaste);
        var cont = home.Rows.First(r => r.Type == "continue");
        Assert.Equal(started.Id, Assert.Single(cont.Items).Title.Id);       // le film fini n'y est pas
        Assert.Equal(started.Id, home.Hero[0].Card.Title.Id);
        Assert.Equal("continue", home.Hero[0].Mode);
        Assert.Equal(120, home.Hero[0].Card.Progress!.PositionSeconds);

        // Ni la reprise ni le film terminé ne sont reproposés dans « Pour vous ».
        var forYou = home.Rows.First(r => r.Type == "forYou").Items;
        Assert.DoesNotContain(forYou, k => k.Title.Id == started.Id || k.Title.Id == finished.Id);
        Assert.Contains(forYou, k => k.Match > 0);                          // pourcentage seulement avec un goût connu
        Assert.Contains(home.Rows, r => r.Type == "because" && r.SeedTitleId == finished.Id);
    }

    [Fact]
    public async Task Thumbs_down_removes_the_title_and_thumbs_up_seeds_a_because_row()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var down = await ApiFactory.TitleAsync(c, "Dernier festin");
        var up = await ApiFactory.TitleAsync(c, "Sucre filé");
        await c.PutAsync($"/api/profiles/{pid}/ratings/{down.Id}", new RatingUpsert(-1));
        await c.PutAsync($"/api/profiles/{pid}/ratings/{up.Id}", new RatingUpsert(1));
        var home = await HomeAsync(c, pid);
        var all = home.Rows.Where(r => r.Type is "forYou" or "because").SelectMany(r => r.Items);
        Assert.DoesNotContain(all, k => k.Title.Id == down.Id);
        Assert.Contains(home.Rows, r => r.Type == "because" && r.SeedTitleId == up.Id);
    }

    [Fact]
    public async Task Profiles_are_independent_and_requests_row_hides_requesters()
    {
        var (c, _) = await f.RegisterAsync();
        var p1 = await ApiFactory.ProfileIdAsync(c);
        var p2 = (await (await c.PostAsync("/api/profiles", new Divertiflix.Api.Controllers.ProfileUpsert("Second"))).Content.ReadAsync<ProfileDto>())!.Id;
        var t = await ApiFactory.TitleAsync(c, "Ligne 9");
        await c.PutAsync($"/api/profiles/{p1}/progress/{t.Id}", new ProgressUpsert(60, 180));
        Assert.Contains("continue", (await HomeAsync(c, p1)).Rows.Select(r => r.Type));
        Assert.DoesNotContain("continue", (await HomeAsync(c, p2)).Rows.Select(r => r.Type));

        await c.PostAsync("/api/requests", new RequestCreate("Un film absent", TitleKind.Movie, 2001, null, null));
        var (other, _) = await f.RegisterAsync();
        var row = (await HomeAsync(other, await ApiFactory.ProfileIdAsync(other))).Rows.First(r => r.Type == "requests");
        var req = row.Requests!.First(r => r.Name == "Un film absent");
        Assert.False(req.Mine);
        Assert.DoesNotContain("@", await other.GetStringAsync($"/api/home?profileId={await ApiFactory.ProfileIdAsync(other)}"));
    }

    [Fact]
    public async Task Detail_returns_similar_titles_reason_and_hides_unavailable_from_similar()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var t = await ApiFactory.TitleAsync(c, "Orbite silencieuse");
        var d = (await c.GetAsync<TitleDetailDto>($"/api/titles/{t.Id}/detail?profileId={pid}"))!;
        Assert.Equal(t.Id, d.Card.Title.Id);
        Assert.NotEmpty(d.Similar);
        Assert.DoesNotContain(d.Similar, s => s.Title.Id == t.Id);
        Assert.All(d.Similar, s => Assert.True(s.Title.IsPlayable));
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync($"/api/titles/{Guid.NewGuid()}/detail?profileId={pid}")).StatusCode);
    }
}
