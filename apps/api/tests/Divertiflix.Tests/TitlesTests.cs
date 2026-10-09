using System.Net;
using System.Net.Http.Json;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;

namespace Divertiflix.Tests;

public class TitlesTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static TitleUpsert Sample(string name) => new(name, "Synopsis", 2020, TitleKind.Movie, "Drame", 90, null, null);

    [Fact]
    public async Task Seeded_catalog_is_searchable_paged_and_hides_stream_urls()
    {
        var (c, _) = await f.RegisterAsync();
        var all = (await c.GetAsync<PagedResult<TitleDto>>("/api/titles?pageSize=2"))!;
        Assert.True(all.Total >= 20);
        Assert.Equal(2, all.Items.Count);
        var found = (await c.GetAsync<PagedResult<TitleDto>>("/api/titles?q=sintel"))!;
        Assert.Contains(found.Items, t => t.Name == "Sintel");
        // La fiche publique n'expose jamais l'URL de lecture.
        var raw = await c.GetStringAsync("/api/titles?q=sintel");
        Assert.DoesNotContain("streamUrl", raw);
    }

    [Theory]
    [InlineData("maree basse")]
    [InlineData("MARÉE")]
    [InlineData("hommes pluie")]
    [InlineData("pluie hommes")]       // ordre des mots indifférent
    [InlineData("Les Hommes-Pluie")]
    public async Task Search_ignores_case_accents_and_word_order(string query)
    {
        var (c, _) = await f.RegisterAsync();
        var r = (await c.GetAsync<PagedResult<TitleDto>>($"/api/titles?q={Uri.EscapeDataString(query)}"))!;
        Assert.NotEmpty(r.Items);
    }

    [Theory]
    [InlineData("%")]
    [InlineData("_")]
    [InlineData("'; DROP TABLE Titles; --")]
    public async Task Search_treats_wildcards_and_injection_literally(string query)
    {
        var (c, _) = await f.RegisterAsync();
        var res = await c.GetAsync($"/api/titles?q={Uri.EscapeDataString(query)}");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Empty((await res.Content.ReadAsync<PagedResult<TitleDto>>())!.Items);
    }

    [Fact]
    public async Task Extreme_page_numbers_do_not_overflow()
    {
        var (c, _) = await f.RegisterAsync();
        var res = await c.GetAsync("/api/titles?page=2147483647&pageSize=100");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }

    [Fact]
    public async Task Filters_sort_and_availability_work()
    {
        var (c, _) = await f.RegisterAsync();
        var onlyAvailable = (await c.GetAsync<PagedResult<TitleDto>>("/api/titles?available=true&pageSize=100"))!;
        Assert.All(onlyAvailable.Items, t => Assert.True(t.IsPlayable));
        var all = (await c.GetAsync<PagedResult<TitleDto>>("/api/titles?pageSize=100"))!;
        Assert.Contains(all.Items, t => t.Name == "Sintel" && !t.IsPlayable);
        var recent = (await c.GetAsync<PagedResult<TitleDto>>("/api/titles?sort=recent&pageSize=100"))!;
        Assert.Equal(recent.Items.OrderByDescending(t => t.AddedAt).Select(t => t.Id), recent.Items.Select(t => t.Id));
        var books = (await c.GetAsync<PagedResult<TitleDto>>("/api/titles?kind=Audiobook"))!;
        Assert.All(books.Items, t => Assert.Equal(TitleKind.Audiobook, t.Kind));
        Assert.NotEmpty(books.Items);
    }

    [Fact]
    public async Task Genres_endpoint_counts_without_downloading_the_catalog()
    {
        var (c, _) = await f.RegisterAsync();
        var genres = (await c.GetAsync<List<GenreCount>>("/api/titles/genres"))!;
        Assert.Contains(genres, g => g.Genre == "Animation" && g.Count >= 4);
        Assert.Equal(genres.OrderByDescending(g => g.Count).Select(g => g.Count), genres.Select(g => g.Count));   // effectifs décroissants
    }

    [Fact]
    public async Task Subscriber_cannot_use_admin_catalog_endpoints()
    {
        var (c, _) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await c.PostAsync("/api/admin/titles", Sample("Interdit"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await c.GetAsync("/api/admin/titles")).StatusCode);
        // L'ancienne écriture publique n'existe plus.
        Assert.Equal(HttpStatusCode.MethodNotAllowed, (await c.PostAsync("/api/titles", Sample("Interdit"))).StatusCode);
    }

    [Fact]
    public async Task Admin_can_create_update_delete_and_validation_applies()
    {
        var (c, _) = await f.LoginAdminAsync();
        var created = await c.PostAsync("/api/admin/titles", Sample("Nouveau"));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var dto = (await created.Content.ReadAsync<AdminTitleDto>())!;
        Assert.False(dto.IsPlayable);

        var upd = await c.PutAsync($"/api/admin/titles/{dto.Id}", Sample("Renommé") with { StreamUrl = "https://example.org/v/index.m3u8", Keywords = ["Nuit", "nuit", " mer "] });
        var updated = (await upd.Content.ReadAsync<AdminTitleDto>())!;
        Assert.Equal("Renommé", updated.Name);
        Assert.True(updated.IsPlayable);
        Assert.Equal(StreamKind.Hls, updated.StreamKind);
        Assert.Equal(["Nuit", "mer"], updated.Keywords);   // dédoublonné, nettoyé

        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync("/api/admin/titles", Sample("") with { Name = "" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync("/api/admin/titles", Sample("X") with { Year = 1500 })).StatusCode);

        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/admin/titles/{dto.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync($"/api/titles/{dto.Id}")).StatusCode);
    }

    [Fact]
    public async Task Playback_signs_local_media_and_serves_it_only_with_a_valid_token()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var created = (await (await admin.PostAsync("/api/admin/titles", Sample("Local") with { StreamUrl = "media:demo/index.m3u8" })).Content.ReadAsync<AdminTitleDto>())!;
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);

        var pb = (await c.GetAsync<PlaybackDto>($"/api/titles/{created.Id}/playback?profileId={pid}"))!;
        Assert.Equal(StreamKind.Hls, pb.Kind);
        Assert.StartsWith("/api/media/stream/", pb.Url);

        var anon = f.CreateClient();
        var playlist = await anon.GetAsync(pb.Url);
        Assert.Equal(HttpStatusCode.OK, playlist.StatusCode);
        Assert.Equal("application/vnd.apple.mpegurl", playlist.Content.Headers.ContentType?.MediaType);
        // Les segments (URL relative de la liste) héritent du jeton porté par le chemin.
        var seg = await anon.GetAsync(pb.Url.Replace("index.m3u8", "seg0.ts"));
        Assert.Equal(HttpStatusCode.OK, seg.StatusCode);

        // Jeton falsifié, autre dossier, traversée de chemin : refusés.
        var token = pb.Url.Split('/')[4];
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync($"/api/media/stream/{token[..^2]}xx/demo/index.m3u8")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync($"/api/media/stream/{token}/autre/index.m3u8")).StatusCode);
        Assert.Contains((await anon.GetAsync($"/api/media/stream/{token}/demo/%2e%2e/%2e%2e/secret")).StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.BadRequest });
        Assert.Contains((await anon.GetAsync($"/api/media/stream/{token}/demo/..%5c..%5csecret")).StatusCode, new[] { HttpStatusCode.NotFound, HttpStatusCode.BadRequest });
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync("/api/media/stream/0.0.x/demo/index.m3u8")).StatusCode);

        // Les requêtes partielles (lecture au curseur) sont supportées.
        var range = new HttpRequestMessage(HttpMethod.Get, pb.Url.Replace("index.m3u8", "seg0.ts"));
        range.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 99);
        Assert.Equal(HttpStatusCode.PartialContent, (await anon.SendAsync(range)).StatusCode);
    }

    [Fact]
    public async Task Playback_of_an_unavailable_title_is_a_conflict_and_resumes_from_progress()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var sintel = await ApiFactory.TitleAsync(c, "Sintel");
        Assert.Equal(HttpStatusCode.Conflict, (await c.GetAsync($"/api/titles/{sintel.Id}/playback")).StatusCode);

        var tears = await ApiFactory.TitleAsync(c, "Big Buck Bunny");
        await c.PutAsync($"/api/profiles/{pid}/progress/{tears.Id}", new ProgressUpsert(300, 720));
        var pb = (await c.GetAsync<PlaybackDto>($"/api/titles/{tears.Id}/playback?profileId={pid}"))!;
        Assert.Equal(300, pb.StartSeconds);
        Assert.StartsWith("https://", pb.Url);   // flux distant : URL directe, non signée
    }
}
