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
        + "\"venue\":{\"name\":\"Tropicana Field\"},\"linescore\":{\"currentInning\":7,\"inningHalf\":\"Top\"},"
        + "\"teams\":{\"away\":" + Team(158, "Milwaukee Brewers", "MIL", away, away > home) + ",\"home\":" + Team(139, "Tampa Bay Rays", "TB", home, home > away) + "}}";

    private static string Clip(string id, string headline, string videoHost) =>
        "{\"id\":\"" + id + "\",\"headline\":\"" + headline + "\",\"blurb\":\"Résumé\",\"duration\":\"00:07:28\",\"date\":\"2026-10-29T05:08:26Z\","
        + "\"image\":{\"cuts\":[{\"src\":\"https://img.mlbstatic.com/mlb-images/" + id + ".jpg\"}]},"
        + "\"playbacks\":[{\"name\":\"hlsCloud\",\"url\":\"https://" + videoHost + "/" + id + ".m3u8\"},{\"name\":\"mp4Avc\",\"url\":\"https://" + videoHost + "/" + id + "_1280x720.mp4\"}]}";

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Interlocked.Increment(ref Calls);
        var path = request.RequestUri!.AbsolutePath;
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
        Assert.Equal("https://www.mlbstatic.com/team-logos/139.svg", game3.Home.LogoUrl);

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
        Assert.Equal("https://img.mlbstatic.com/mlb-images/g3-a.jpg", clips[0].PosterUrl);
        Assert.All(clips, c => Assert.StartsWith("https://mlb-cuts-diamond.mlb.com/", c.VideoUrl));
        Assert.All(clips, c => Assert.EndsWith(".mp4", c.VideoUrl));   // MP4, lu directement par le navigateur
        Assert.DoesNotContain(clips, c => c.Title == "Ailleurs");

        var few = (await user.GetAsync<List<MlbHighlightDto>>("/api/mlb/highlights?limit=5"))!;
        Assert.Equal(5, few.Count);
    }
}
