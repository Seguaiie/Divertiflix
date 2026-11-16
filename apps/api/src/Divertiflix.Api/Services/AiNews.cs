using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Divertiflix.Api.Dtos;
using Microsoft.Extensions.Caching.Memory;

namespace Divertiflix.Api.Services;

/// <summary>
/// Onglet « Nicolas » : les nouvelles du jour sur l'intelligence artificielle, rassemblées depuis les fils RSS/Atom de sites reconnus (en
/// français et en anglais). La lecture des fils est partagée (<see cref="RssFeeds"/>) ; ce service n'ajoute que ce qui est propre à l'IA :
/// la liste des fils suivis et le regroupement par sujet populaire (plusieurs médias qui couvrent la même nouvelle).
/// </summary>
public sealed partial class AiNews(RssFeeds feeds, IMemoryCache cache)
{
    /// <summary>Fils suivis. Google Actualités rassemble la presse francophone (Canada) des dernières 24 h.</summary>
    public static readonly RssFeeds.Feed[] Feeds =
    [
        new("TechCrunch", "https://techcrunch.com/category/artificial-intelligence/feed/", "en"),
        new("The Verge", "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", "en"),
        new("MIT Technology Review", "https://www.technologyreview.com/topic/artificial-intelligence/feed", "en"),
        new("Ars Technica", "https://arstechnica.com/ai/feed/", "en"),
        new("Wired", "https://www.wired.com/feed/tag/ai/latest/rss", "en"),
        new("The Guardian", "https://www.theguardian.com/technology/artificialintelligenceai/rss", "en"),
        new("Journal du Geek", "https://www.journaldugeek.com/tag/intelligence-artificielle/feed/", "fr"),
        new("Google Actualités", "https://news.google.com/rss/search?q=intelligence+artificielle+when:1d&hl=fr-CA&gl=CA&ceid=CA:fr", "fr", Max: 50, Aggregator: true),
    ];

    private static readonly TimeSpan Fresh = TimeSpan.FromMinutes(15);

    public async Task<AiNewsDto> TodayAsync(CancellationToken ct)
    {
        if (cache.TryGetValue("news:ai", out AiNewsDto? hit) && hit is not null) return hit;

        var perFeed = await feeds.ReadAllAsync(Feeds, ct);

        var now = DateTime.UtcNow;
        var all = perFeed.SelectMany(p => p.Items).Where(i => i.PublishedAt <= now.AddMinutes(10)).ToList();
        // « Du jour » : les dernières 24 h ; un jour creux (fin de semaine), on élargit à 72 h plutôt que d'afficher trois articles.
        var window = all.Count(i => i.PublishedAt >= now.AddHours(-24)) >= 12 ? 24 : 72;

        var seen = new HashSet<string>();
        var recent = all
            .Where(i => i.PublishedAt >= now.AddHours(-window))
            .OrderByDescending(i => i.PublishedAt)
            .Where(i => seen.Add(i.Url))   // même adresse dans deux fils ; les titres identiques de médias différents comptent pour la popularité
            .ToList();
        var items = await feeds.EnsureImagesAsync(Popular(recent, Top), ct);

        var sources = perFeed
            .Select(p => new NewsSourceDto(p.Feed.Name, p.Feed.Language, items.Count(i => i.Feed == p.Feed.Name), p.Ok))
            .ToList();
        var result = new AiNewsDto(items, sources, window, now);
        cache.Set("news:ai", result, Fresh);
        return result;
    }

    [GeneratedRegex(@"[^\p{L}\p{N}]+")] private static partial Regex NotAlnum();

    private static string Key(string title) => NotAlnum().Replace(title.ToLowerInvariant(), "");

    /// <summary>Nombre d'articles gardés : les plus populaires seulement.</summary>
    public const int Top = 25;

    private static readonly HashSet<string> StopWords = new(StringComparer.Ordinal)
    {
        // Mots trop courants pour distinguer un sujet (dont « IA » et « AI », présents partout ici).
        "the", "and", "for", "with", "that", "this", "from", "into", "about", "after", "over", "will", "what", "your", "their", "have", "says", "said",
        "les", "des", "une", "pour", "dans", "avec", "sur", "est", "qui", "que", "son", "ses", "aux", "plus", "par", "pas", "cette", "comme",
        "intelligence", "artificielle", "artificial", "new", "nouvelle", "nouveau",
    };

    /// <summary>Mots significatifs d'un titre (minuscules, sans accents, 3 lettres et plus, hors mots vides).</summary>
    private static HashSet<string> Words(string title)
    {
        var plain = new string(title.ToLowerInvariant().Normalize(NormalizationForm.FormD)
            .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray());
        return NotAlnum().Split(plain).Where(w => w.Length >= 3 && !StopWords.Contains(w)).ToHashSet(StringComparer.Ordinal);
    }

    /// <summary>
    /// Popularité : les fils ne donnent pas de nombre de lectures, alors un sujet est « populaire » quand plusieurs médias le couvrent.
    /// Les titres proches (assez de mots significatifs en commun) forment un même sujet ; on garde un article par sujet (de préférence
    /// avec image et résumé), puis les <paramref name="take"/> sujets couverts par le plus de médias, le plus récent d'abord à égalité.
    /// </summary>
    public static List<NewsItemDto> Popular(List<NewsItemDto> items, int take)
    {
        var groups = new List<(HashSet<string> Words, List<NewsItemDto> Items)>();
        foreach (var item in items)
        {
            var words = Words(item.Title);
            var match = groups.FirstOrDefault(g =>
            {
                var common = g.Words.Count(words.Contains);
                // Deux mots significatifs en commun au moins, et une part suffisante du plus court des deux titres.
                return common >= 2 && common >= 0.4 * Math.Min(g.Words.Count, words.Count);
            });
            if (match.Items is null) groups.Add((words, [item]));
            else { match.Items.Add(item); match.Words.UnionWith(words); }
        }
        return groups
            .Select(g =>
            {
                var coverage = g.Items.Select(i => i.Source).Distinct(StringComparer.OrdinalIgnoreCase).Count();
                var best = g.Items.OrderByDescending(i => (i.ImageUrl is null ? 0 : 2) + (i.Summary is null ? 0 : 1)).ThenByDescending(i => i.PublishedAt).First();
                return (Item: best with { Coverage = coverage }, Latest: g.Items.Max(i => i.PublishedAt));
            })
            .OrderByDescending(x => x.Item.Coverage).ThenByDescending(x => x.Latest)
            .Take(take)
            .Select(x => x.Item)
            .ToList();
    }
}
