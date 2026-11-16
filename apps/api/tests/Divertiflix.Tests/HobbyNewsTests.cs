using System.Net;
using Divertiflix.Api.Dtos;

namespace Divertiflix.Tests;

/// <summary>Onglet « Divertissement » : les rubriques de chaque membre de l'équipe.</summary>
public class HobbyNewsTests(NewsFactory f) : IClassFixture<NewsFactory>
{
    [Fact]
    public async Task Each_teammate_has_their_own_sections_with_distinct_feeds()
    {
        var (user, _) = await f.RegisterAsync();

        var emilien = (await user.GetAsync<HobbyNewsDto>("/api/news/divertissement/Emilien"))!;
        Assert.Equal(new[] { "osrs", "lol", "fantasy" }, emilien.Sections.Select(s => s.Key));
        Assert.All(emilien.Sections, s => Assert.Single(s.Items));
        Assert.Contains("reddit.com", emilien.Sections.Single(s => s.Key == "osrs").Items[0].Url);
        Assert.Contains("esportsinsider.com", emilien.Sections.Single(s => s.Key == "lol").Items[0].Url);
        Assert.Contains("reactormag.com", emilien.Sections.Single(s => s.Key == "fantasy").Items[0].Url);

        var abdoullah = (await user.GetAsync<HobbyNewsDto>("/api/news/divertissement/Abdoullah"))!;
        Assert.Equal(new[] { "cars", "stocks", "habs" }, abdoullah.Sections.Select(s => s.Key));

        var maxence = (await user.GetAsync<HobbyNewsDto>("/api/news/divertissement/Maxence"))!;
        // Cybersécurité et open source ont chacun deux fils : les deux contribuent (ni doublon, ni l'un qui écrase l'autre).
        var cyber = maxence.Sections.Single(s => s.Key == "cyber");
        Assert.Equal(2, cyber.Items.Count);
        Assert.Equal(new[] { "The Hacker News", "BleepingComputer" }, cyber.Sources.Select(s => s.Name));
    }

    [Fact]
    public async Task Unknown_teammate_is_a_bad_request()
    {
        var (user, _) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await user.GetAsync("/api/news/divertissement/PasUnMembre")).StatusCode);
    }

    [Fact]
    public async Task Divertissement_requires_a_signed_in_user()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/api/news/divertissement/Alexi")).StatusCode);
    }
}
