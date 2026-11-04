using System.Net;
using System.Text;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Tests;

/// <summary>Faux statsapi.mlb.com : trois journées, dont un match à venir et un match reporté qui ne sont pas des résultats.</summary>
internal sealed class FakeMlb : HttpMessageHandler
{
    public static int Calls;

    private static string Team(int id, string name, string abbr, int? score, bool winner) =>
        "{\"team\":{\"id\":" + id + ",\"name\":\"" + name + "\",\"abbreviation\":\"" + abbr + "\"},\"leagueRecord\":{\"wins\":90,\"losses\":72}"
        + (score is { } s ? ",\"score\":" + s : "") + ",\"isWinner\":" + (winner ? "true" : "false") + "}";

    private static string Game(long pk, string state, string detailed, string type, int? away, int? home, string? series = null, int? number = null) =>
        "{\"gamePk\":" + pk + ",\"gameType\":\"" + type + "\",\"gameDate\":\"2026-10-28T00:08:00Z\","
        + "\"status\":{\"abstractGameState\":\"" + state + "\",\"detailedState\":\"" + detailed + "\"},"
        + "\"seriesDescription\":" + (series is null ? "null" : "\"" + series + "\"") + ",\"seriesGameNumber\":" + (number?.ToString() ?? "null") + ","
        + "\"venue\":{\"name\":\"Tropicana Field\"},\"linescore\":{\"currentInning\":7,\"inningHalf\":\"Top\",\"teams\":{\"away\":{\"runs\":3,\"hits\":8,\"errors\":2},\"home\":{\"runs\":4,\"hits\":9,\"errors\":0}},"
        + "\"innings\":[{\"num\":1,\"away\":{\"runs\":0},\"home\":{\"runs\":2}},{\"num\":2,\"away\":{\"runs\":3},\"home\":{}}]},"
        + "\"teams\":{\"away\":" + Team(158, "Milwaukee Brewers", "MIL", away, away > home) + ",\"home\":" + Team(139, "Tampa Bay Rays", "TB", home, home > away) + "}}";

    private static string Clip(string id, string headline, string videoHost) =>
        "{\"id\":\"" + id + "\",\"headline\":\"" + headline + "\",\"blurb\":\"Résumé\",\"duration\":\"00:07:28\",\"date\":\"2026-10-29T05:08:26Z\","
        + "\"image\":{\"cuts\":[{\"src\":\"https://img.mlbstatic.com/mlb-images/" + id + ".jpg\"}]},"
        + "\"playbacks\":[{\"name\":\"hlsCloud\",\"url\":\"https://" + videoHost + "/" + id + ".m3u8\"},{\"name\":\"mp4Avc\",\"url\":\"https://" + videoHost + "/FORGE/2026/" + id + "_1280x720.mp4\"}]}";

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Interlocked.Increment(ref Calls);
        var path = request.RequestUri!.AbsolutePath;
        var host = request.RequestUri!.Host;
        if (host == "mlb-cuts-diamond.mlb.com")
        {
            // 100 octets de « vidéo » ; la plage demandée est respectée comme le ferait le CDN de la MLB.
            var all = Enumerable.Range(0, 100).Select(i => (byte)i).ToArray();
            if (request.Headers.Range?.Ranges.FirstOrDefault() is { } r)
            {
                var from = (int)(r.From ?? 0); var to = (int)(r.To ?? 99);
                var part = new HttpResponseMessage(HttpStatusCode.PartialContent) { Content = new ByteArrayContent(all[from..(to + 1)]) };
                part.Content.Headers.ContentType = new("video/mp4");
                part.Content.Headers.ContentRange = new System.Net.Http.Headers.ContentRangeHeaderValue(from, to, 100);
                return Task.FromResult(part);
            }
            var full = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(all) };
            full.Content.Headers.ContentType = new("video/mp4");
            return Task.FromResult(full);
        }
        if (host == "img.mlbstatic.com")
        {
            var img = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent([0xFF, 0xD8, 0xFF]) };
            img.Content.Headers.ContentType = new("image/jpeg");
            return Task.FromResult(img);
        }
        if (host == "www.mlbstatic.com")
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<svg xmlns=\"http://www.w3.org/2000/svg\"/>", Encoding.UTF8, "image/svg+xml") });
        if (path.EndsWith("/content", StringComparison.Ordinal))
        {
            var pk = path.Split('/')[^2];
            // 6 clips par match, dont un hébergé ailleurs que chez la MLB (écarté).
            var clips = new[] { Clip($"g{pk}-a", $"Résumé {pk}", "mlb-cuts-diamond.mlb.com"), Clip($"g{pk}-x", "Ailleurs", "evil.example.com") }
                .Concat(Enumerable.Range(1, 5).Select(i => Clip($"g{pk}-{i}", $"Clip {i}", "mlb-cuts-diamond.mlb.com")));
            var content = "{\"highlights\":{\"highlights\":{\"items\":[" + string.Join(",", clips) + "]}}}";
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(content, Encoding.UTF8, "application/json") });
        }
        var body = $$"""
            {"dates":[
              {"date":"2026-10-26","games":[{{Game(1, "Final", "Final", "W", 10, 1, "World Series", 2)}}]},
              {"date":"2026-10-27","games":[{{Game(2, "Final", "Final", "W", 3, 4, "World Series", 3)}},{{Game(9, "Final", "Postponed", "W", null, null)}}]},
              {"date":"2026-10-28","games":[{{Game(3, "Live", "In Progress", "W", 4, 1, "World Series", 4)}},{{Game(4, "Preview", "Scheduled", "W", null, null)}}]},
              {"date":"2026-10-29","games":[{{Game(5, "Preview", "Scheduled", "W", null, null)}}]}
            ]}
            """;
        return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") });
    }
}

public class MlbFactory : ApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s => s.AddHttpClient<MlbResults>().ConfigurePrimaryHttpMessageHandler(() => new FakeMlb()));
    }
}

public class MlbTests(MlbFactory f) : IClassFixture<MlbFactory>
{
    [Fact]
    public async Task Results_list_the_latest_game_days_newest_first_without_scheduled_or_postponed_games()
    {
        var (user, _) = await f.RegisterAsync();
        var res = (await user.GetAsync<MlbResultsDto>("/api/mlb/results?days=7"))!;

        Assert.Equal(new[] { "2026-10-28", "2026-10-27", "2026-10-26" }, res.Days.Select(d => d.Date));   // le 29 n'a que des matchs à venir
        Assert.All(res.Days, d => Assert.Single(d.Games));   // à venir et reporté écartés

        var live = res.Days[0].Games[0];
        Assert.Equal("Live", live.Status);
        Assert.Equal(7, live.Inning);
        Assert.Equal(4, live.SeriesGameNumber);

        var game3 = res.Days[1].Games[0];
        Assert.Equal("Final", game3.Status);
        Assert.Equal("World Series", game3.SeriesDescription);
        Assert.Equal((3, 4), (game3.Away.Score, game3.Home.Score));
        Assert.True(game3.Home.IsWinner);
        Assert.False(game3.Away.IsWinner);
        Assert.Equal("TB", game3.Home.Abbreviation);
        Assert.Equal("/api/media/mlb/logo/139", game3.Home.LogoUrl);   // relayé par le portail

        // Feuille de match : R / H / E et points manche par manche (une manche non jouée reste vide).
        Assert.Equal((8, 2), (game3.Away.Hits, game3.Away.Errors));
        Assert.Equal((9, 0), (game3.Home.Hits, game3.Home.Errors));
        Assert.Equal(2, game3.Innings!.Count);
        Assert.Equal(new MlbInningDto(1, 0, 2), game3.Innings[0]);
        Assert.Equal(new MlbInningDto(2, 3, null), game3.Innings[1]);

        // Mis en cache : une seconde visite ne rappelle pas la MLB.
        var before = FakeMlb.Calls;
        await user.GetAsync<MlbResultsDto>("/api/mlb/results?days=7");
        Assert.Equal(before, FakeMlb.Calls);

        // Moins de jours demandés : les plus récents.
        var two = (await user.GetAsync<MlbResultsDto>("/api/mlb/results?days=2"))!;
        Assert.Equal(new[] { "2026-10-28", "2026-10-27" }, two.Days.Select(d => d.Date));
    }

    [Fact]
    public async Task Results_require_a_signed_in_user()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/api/mlb/results")).StatusCode);
    }

    [Fact]
    public async Task Highlights_take_the_first_mlb_hosted_clips_of_each_recent_game_newest_game_first()
    {
        var (user, _) = await f.RegisterAsync();
        var clips = (await user.GetAsync<List<MlbHighlightDto>>("/api/mlb/highlights?limit=16"))!;

        // 3 matchs avec résultats (le 28, le 27, le 26) × 4 premiers clips chacun.
        Assert.Equal(12, clips.Count);
        Assert.Equal(new long[] { 3, 2, 1 }, clips.Select(c => c.GameId).Distinct());
        Assert.Equal("Résumé 3", clips[0].Title);
        Assert.Equal(448, clips[0].DurationSeconds);
        Assert.Equal("MIL @ TB", clips[0].Matchup);
        // Tout passe par le portail : le navigateur ne contacte jamais la MLB.
        Assert.Equal("/api/media/mlb/image/mlb-images/g3-a.jpg", clips[0].PosterUrl);
        Assert.All(clips, c => Assert.StartsWith("/api/media/mlb/video/", c.VideoUrl));
        Assert.All(clips, c => Assert.EndsWith(".mp4", c.VideoUrl));
        Assert.DoesNotContain(clips, c => c.Title == "Ailleurs");

        var few = (await user.GetAsync<List<MlbHighlightDto>>("/api/mlb/highlights?limit=5"))!;
        Assert.Equal(5, few.Count);
    }

    [Fact]
    public async Task The_portal_relays_mlb_videos_with_ranges_behind_a_signed_token_and_only_mlb_paths()
    {
        var (user, _) = await f.RegisterAsync();
        var clip = (await user.GetAsync<List<MlbHighlightDto>>("/api/mlb/highlights?limit=1"))!.Single();
        var anonymous = f.CreateClient();   // la balise <video> n'envoie pas d'en-tête d'autorisation : le jeton est dans l'adresse

        var whole = await anonymous.GetAsync(clip.VideoUrl);
        Assert.Equal(HttpStatusCode.OK, whole.StatusCode);
        Assert.Equal("video/mp4", whole.Content.Headers.ContentType?.MediaType);
        Assert.Equal(100, (await whole.Content.ReadAsByteArrayAsync()).Length);

        // Déplacement dans la vidéo : requête partielle relayée telle quelle.
        var req = new HttpRequestMessage(HttpMethod.Get, clip.VideoUrl);
        req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(10, 19);
        var part = await anonymous.SendAsync(req);
        Assert.Equal(HttpStatusCode.PartialContent, part.StatusCode);
        Assert.Equal(Enumerable.Range(10, 10).Select(i => (byte)i).ToArray(), await part.Content.ReadAsByteArrayAsync());
        Assert.Equal("bytes 10-19/100", part.Content.Headers.ContentRange?.ToString());

        // Jeton falsifié ou absent : refusé. Chemin qui ne ressemble pas à une vidéo de la MLB : introuvable (pas de relais ouvert).
        var forged = System.Text.RegularExpressions.Regex.Replace(clip.VideoUrl, "/video/[^/]+/", "/video/0.0.faux/");
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync(forged)).StatusCode);
        var token = clip.VideoUrl.Split('/')[5];
        Assert.False((await anonymous.GetAsync($"/api/media/mlb/video/{token}/FORGE/../../secret.mp4")).IsSuccessStatusCode);
        Assert.False((await anonymous.GetAsync($"/api/media/mlb/video/{token}/FORGE/%2E%2E/%2E%2E/secret.mp4")).IsSuccessStatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"/api/media/mlb/video/{token}/autre/chose.txt")).StatusCode);

        // Vignette et logo relayés ; le logo SVG est servi en bac à sable.
        var poster = await anonymous.GetAsync(clip.PosterUrl);
        Assert.Equal(HttpStatusCode.OK, poster.StatusCode);
        Assert.Equal("image/jpeg", poster.Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/media/mlb/image/ailleurs/x.jpg")).StatusCode);
        var logo = await anonymous.GetAsync("/api/media/mlb/logo/139");
        Assert.Equal(HttpStatusCode.OK, logo.StatusCode);
        Assert.Equal("image/svg+xml", logo.Content.Headers.ContentType?.MediaType);
        Assert.Contains("sandbox", logo.Headers.GetValues("Content-Security-Policy").Single());
    }
}
