using Divertiflix.Api.Dtos;
using Microsoft.Extensions.Caching.Memory;

namespace Divertiflix.Api.Services;

/// <summary>
/// Onglet « Divertissement » : les centres d'intérêt propres à chaque membre de l'équipe, chacun regroupé en rubriques (ex. « OSRS »,
/// « Scène LoL esport »). Même lecture de fils que <see cref="AiNews"/> (<see cref="RssFeeds"/>), mais sans le regroupement par
/// popularité : les rubriques sont trop spécifiques pour que plusieurs médias couvrent la même nouvelle.
/// </summary>
public sealed class HobbyNews(RssFeeds feeds, IMemoryCache cache)
{
    public sealed record Category(string Key, string Label, RssFeeds.Feed[] Feeds);

    private static readonly Dictionary<Teammate, Category[]> ByPerson = new()
    {
        [Teammate.Emilien] =
        [
            new("osrs", "Old School RuneScape", [new("r/2007scape", "https://www.reddit.com/r/2007scape/.rss", "en", Max: 20)]),
            new("lol", "Scène LoL esport", [new("Esports Insider", "https://esportsinsider.com/feed", "en", Max: 20)]),
            new("fantasy", "Fantasy (littérature)", [new("Reactor", "https://reactormag.com/feed/", "en", Max: 20)]),
        ],
        [Teammate.Alexi] =
        [
            new("idle", "Idle games", [new("r/incremental_games", "https://www.reddit.com/r/incremental_games/.rss", "en", Max: 20)]),
            new("board", "Jeux de société", [new("r/boardgames", "https://www.reddit.com/r/boardgames/.rss", "en", Max: 20)]),
            new("mailcow", "Mailcow", [new("Google Actualités", "https://news.google.com/rss/search?q=mailcow&hl=en-US&gl=US&ceid=US:en", "en", Max: 20, Aggregator: true)]),
        ],
        [Teammate.Abdoullah] =
        [
            new("cars", "Voitures", [new("The Drive", "https://www.thedrive.com/feed", "en", Max: 20)]),
            new("stocks", "Marchés boursiers", [new("MarketWatch", "http://feeds.marketwatch.com/marketwatch/topstories/", "en", Max: 20)]),
            new("habs", "Canadien de Montréal", [new("Eyes on the Prize", "https://www.habseyesontheprize.com/rss/current", "en", Max: 20)]),
        ],
        [Teammate.Maxence] =
        [
            new("cyber", "Cybersécurité",
            [
                new("The Hacker News", "https://feeds.feedburner.com/TheHackersNews", "en", Max: 15),
                new("BleepingComputer", "https://www.bleepingcomputer.com/feed/", "en", Max: 15),
            ]),
            new("sherbrooke", "Ville de Sherbrooke", [new("Google Actualités", "https://news.google.com/rss/search?q=Sherbrooke&hl=fr-CA&gl=CA&ceid=CA:fr", "fr", Max: 20, Aggregator: true)]),
            new("opensource", "Open source (Linux, Proxmox…)",
            [
                new("Phoronix", "https://www.phoronix.com/rss.php", "en", Max: 15),
                new("Forum Proxmox", "https://forum.proxmox.com/forums/-/index.rss", "en", Max: 15),
            ]),
        ],
    };

    private static readonly TimeSpan Fresh = TimeSpan.FromMinutes(20);
    private const int PerSection = 12;

    public async Task<HobbyNewsDto> ForAsync(Teammate person, CancellationToken ct)
    {
        var cacheKey = $"news:hobby:{person}";
        if (cache.TryGetValue(cacheKey, out HobbyNewsDto? hit) && hit is not null) return hit;

        var categories = ByPerson[person];
        var byUrl = (await feeds.ReadAllAsync(categories.SelectMany(c => c.Feeds), ct)).ToDictionary(p => p.Feed.Url);

        var now = DateTime.UtcNow;
        var sections = await Task.WhenAll(categories.Select(async c =>
        {
            var seen = new HashSet<string>();
            var items = c.Feeds.SelectMany(f => byUrl[f.Url].Items)
                .Where(i => i.PublishedAt <= now.AddMinutes(10))
                .OrderByDescending(i => i.PublishedAt)
                .Where(i => seen.Add(i.Url))
                .Take(PerSection)
                .ToList();
            items = await feeds.EnsureImagesAsync(items, ct);
            var sources = c.Feeds.Select(f => new NewsSourceDto(f.Name, f.Language, items.Count(i => i.Feed == f.Name), byUrl[f.Url].Ok)).ToList();
            return new HobbySectionDto(c.Key, c.Label, items, sources);
        }));

        var result = new HobbyNewsDto(sections.ToList(), now);
        cache.Set(cacheKey, result, Fresh);
        return result;
    }
}
