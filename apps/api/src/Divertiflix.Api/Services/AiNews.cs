using System.Globalization;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;
using Divertiflix.Api.Dtos;
using Microsoft.Extensions.Caching.Memory;

namespace Divertiflix.Api.Services;

/// <summary>
/// Onglet « Nicholas » : les nouvelles du jour sur l'intelligence artificielle, rassemblées depuis les fils RSS/Atom de sites reconnus (en
/// français et en anglais). L'API lit les fils en parallèle, en garde le texte seulement (jamais de HTML vers le navigateur), retire les
/// doublons et met le tout en cache 15 minutes. Les images sont relayées par le portail, et seulement celles trouvées dans les fils.
/// </summary>
public sealed partial class AiNews(HttpClient http, IMemoryCache cache, ILogger<AiNews> log)
{
    public sealed record Feed(string Name, string Url, string Language, int Max = 40, bool Aggregator = false);

    /// <summary>Fils suivis. Google Actualités rassemble la presse francophone (Canada) des dernières 24 h.</summary>
    public static readonly Feed[] Feeds =
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
    private const string ImagePrefix = "news:img:";

    [GeneratedRegex("<[^>]+>")] private static partial Regex Tags();
    [GeneratedRegex(@"<(script|style|noscript)\b[^>]*>.*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)] private static partial Regex Blocks();
    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();
    [GeneratedRegex("<img[^>]+src=[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)] private static partial Regex FirstImage();
    [GeneratedRegex(@"([+-]\d{2})(\d{2})$")] private static partial Regex NumericZone();
    [GeneratedRegex(@"[^\p{L}\p{N}]+")] private static partial Regex NotAlnum();

    public async Task<AiNewsDto> TodayAsync(CancellationToken ct)
    {
        if (cache.TryGetValue("news:ai", out AiNewsDto? hit) && hit is not null) return hit;

        // Un fil en panne ou trop lent n'empêche pas les autres.
        var perFeed = await Task.WhenAll(Feeds.Select(async f =>
        {
            try { return (f, Items: await ReadAsync(f, ct), Ok: true); }
            catch (Exception ex) when (ex is HttpRequestException or XmlException or InvalidOperationException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
            {
                log.LogInformation("Fil {Feed} indisponible : {Error}", f.Name, ex.Message);
                return (f, Items: new List<NewsItemDto>(), Ok: false);
            }
        }));

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
        var items = Popular(recent, now, Top);

        var sources = perFeed
            .Select(p => new NewsSourceDto(p.f.Name, p.f.Language, items.Count(i => i.Feed == p.f.Name), p.Ok))
            .ToList();
        var result = new AiNewsDto(items, sources, window, now);
        cache.Set("news:ai", result, Fresh);
        return result;
    }

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
    public static List<NewsItemDto> Popular(List<NewsItemDto> items, DateTime now, int take)
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

    private async Task<List<NewsItemDto>> ReadAsync(Feed feed, CancellationToken ct)
    {
        using var res = await http.GetAsync(feed.Url, HttpCompletionOption.ResponseHeadersRead, ct);
        res.EnsureSuccessStatusCode();
        await using var body = await res.Content.ReadAsStreamAsync(ct);
        // Pas de DTD ni d'entité externe, taille bornée : un fil reste une donnée extérieure.
        using var reader = XmlReader.Create(body, new XmlReaderSettings
        {
            DtdProcessing = DtdProcessing.Ignore, XmlResolver = null, MaxCharactersInDocument = 8_000_000, Async = true,
        });
        var doc = await XDocument.LoadAsync(reader, LoadOptions.None, ct);
        var root = doc.Root ?? throw new XmlException("Fil vide.");

        var entries = root.Name.LocalName == "feed"
            ? root.Elements().Where(e => e.Name.LocalName == "entry")                                   // Atom
            : root.Descendants().Where(e => e.Name.LocalName == "item");                                // RSS 2.0 / RDF
        var list = new List<NewsItemDto>();
        foreach (var e in entries)
        {
            if (Parse(feed, e) is { } item) list.Add(item);
            if (list.Count >= feed.Max) break;
        }
        return list;
    }

    private NewsItemDto? Parse(Feed feed, XElement e)
    {
        string? Child(string name) => e.Elements().FirstOrDefault(x => x.Name.LocalName == name)?.Value;

        var title = Clean(Child("title"), 300);
        var url = e.Elements().Where(x => x.Name.LocalName == "link")
            .Select(x => (string?)x.Attribute("href") is { } href && ((string?)x.Attribute("rel") ?? "alternate") == "alternate" ? href : x.Value)
            .Select(v => v?.Trim()).FirstOrDefault(v => !string.IsNullOrEmpty(v));
        if (string.IsNullOrEmpty(title) || !IsWeb(url)) return null;

        var date = Date(Child("pubDate") ?? Child("published") ?? Child("updated") ?? Child("date"));
        if (date is null) return null;

        var source = feed.Name;
        if (feed.Aggregator)
        {
            // Google Actualités : le média d'origine est dans <source>, et répété à la fin du titre (« Titre - Le Devoir »).
            if (Clean(Child("source"), 80) is { Length: > 0 } outlet)
            {
                source = outlet;
                if (title.EndsWith(" - " + outlet, StringComparison.Ordinal)) title = title[..^(outlet.Length + 3)];
            }
        }

        var html = Child("encoded") ?? Child("content") ?? Child("description") ?? Child("summary") ?? "";
        // Le résumé d'un agrégateur n'est qu'une liste de liens : rien à montrer.
        var summary = feed.Aggregator ? null : Clean(Child("description") ?? Child("summary") ?? html, 280, ellipsis: true);
        if (summary is { Length: 0 }) summary = null;

        var image = e.Descendants().Where(x => x.Name.LocalName is "content" or "thumbnail" && x.Name.NamespaceName.Contains("search.yahoo.com/mrss", StringComparison.Ordinal))
                        .Select(x => (string?)x.Attribute("url")).FirstOrDefault(IsWeb)
                    ?? e.Elements().Where(x => x.Name.LocalName == "enclosure" && ((string?)x.Attribute("type") ?? "image/").StartsWith("image/", StringComparison.Ordinal))
                        .Select(x => (string?)x.Attribute("url")).FirstOrDefault(IsWeb)
                    ?? (FirstImage().Match(html) is { Success: true } m && IsWeb(WebUtility.HtmlDecode(m.Groups[1].Value)) ? WebUtility.HtmlDecode(m.Groups[1].Value) : null);

        return new NewsItemDto(
            Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(url!)))[..16].ToLowerInvariant(),
            title, summary, url!, source, feed.Name, feed.Language, date.Value, image is null ? null : ImageUrl(image));
    }

    /// <summary>Adresse relayée d'une image trouvée dans un fil ; le relais ne sert que ces images-là (voir <see cref="ImageSource"/>).</summary>
    private string? ImageUrl(string original)
    {
        if (!Uri.TryCreate(original, UriKind.Absolute, out var u) || u.Scheme != Uri.UriSchemeHttps || u.HostNameType != UriHostNameType.Dns || u.IsLoopback) return null;
        var id = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(original)))[..24].ToLowerInvariant();
        cache.Set(ImagePrefix + id, original, TimeSpan.FromHours(24));
        return $"/api/media/news/image/{id}";
    }

    /// <summary>Image d'origine d'un identifiant relayé (null : inconnue ou expirée). Jamais une adresse fournie par le navigateur.</summary>
    public string? ImageSource(string id) => cache.TryGetValue(ImagePrefix + id, out string? url) ? url : null;

    /// <summary>Requête brute pour le relais d'images (en-têtes d'abord ; l'appelant lit le corps et libère la réponse).</summary>
    public Task<HttpResponseMessage> SendRawAsync(HttpRequestMessage req, CancellationToken ct) =>
        http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);

    private static bool IsWeb(string? url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp);

    /// <summary>Texte seul : balises retirées, entités décodées, espaces resserrés, coupé proprement.</summary>
    private static string Clean(string? html, int max, bool ellipsis = false)
    {
        if (string.IsNullOrWhiteSpace(html)) return "";
        var decoded = WebUtility.HtmlDecode(html);
        var text = Spaces().Replace(WebUtility.HtmlDecode(Tags().Replace(Blocks().Replace(decoded, " "), " ")), " ").Trim();
        if (text.Length <= max) return text;
        var cut = text[..max];
        var space = cut.LastIndexOf(' ');
        return (space > max / 2 ? cut[..space] : cut).TrimEnd(',', ';', ':', '.', ' ') + (ellipsis ? "…" : "");
    }

    /// <summary>Dates RSS (« Wed, 04 Nov 2026 13:00:00 +0000 », « … GMT ») et Atom (ISO 8601), en UTC.</summary>
    private static DateTime? Date(string? s)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = NumericZone().Replace(s.Trim(), "$1:$2");
        var styles = DateTimeStyles.AllowWhiteSpaces | DateTimeStyles.AssumeUniversal;
        if (DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, styles, out var d)) return d.UtcDateTime;
        // « Wed, 04 Nov 2026 … » : le jour de la semaine gêne parfois l'analyse.
        var comma = s.IndexOf(',');
        return comma > 0 && DateTimeOffset.TryParse(s[(comma + 1)..], CultureInfo.InvariantCulture, styles, out d) ? d.UtcDateTime : null;
    }
}
