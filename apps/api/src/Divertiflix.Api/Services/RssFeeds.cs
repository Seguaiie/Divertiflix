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
/// Lecture de fils RSS/Atom externes, partagée par les onglets qui en montrent (« Nicolas », « Divertissement ») : texte seul
/// (jamais de HTML vers le navigateur), relais d'images par identifiant opaque (jamais une adresse fournie par le client). Un fil
/// en panne ou trop lent n'empêche jamais les autres (voir les appelants, qui isolent chaque fil).
/// </summary>
public sealed partial class RssFeeds(HttpClient http, IMemoryCache cache, ILogger<RssFeeds> log)
{
    public sealed record Feed(string Name, string Url, string Language, int Max = 40, bool Aggregator = false);

    private const string ImagePrefix = "news:img:";

    [GeneratedRegex("<[^>]+>")] private static partial Regex Tags();
    [GeneratedRegex(@"<(script|style|noscript)\b[^>]*>.*?</\1\s*>", RegexOptions.IgnoreCase | RegexOptions.Singleline)] private static partial Regex Blocks();
    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();
    [GeneratedRegex("<img[^>]+src=[\"']([^\"']+)[\"']", RegexOptions.IgnoreCase)] private static partial Regex FirstImage();
    [GeneratedRegex(@"([+-]\d{2})(\d{2})$")] private static partial Regex NumericZone();

    /// <summary>Lit un fil ; lève si le réseau ou le XML échoue (l'appelant décide quoi faire d'un fil en panne).</summary>
    public async Task<List<NewsItemDto>> ReadAsync(Feed feed, CancellationToken ct)
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

    /// <summary>Lit plusieurs fils en parallèle ; un fil en panne ou trop lent n'empêche jamais les autres.</summary>
    public async Task<List<(Feed Feed, List<NewsItemDto> Items, bool Ok)>> ReadAllAsync(IEnumerable<Feed> feeds, CancellationToken ct) =>
        (await Task.WhenAll(feeds.Select(async f =>
        {
            try { return (f, Items: await ReadAsync(f, ct), Ok: true); }
            catch (Exception ex) when (ex is HttpRequestException or XmlException or InvalidOperationException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
            {
                log.LogInformation("Fil {Feed} indisponible : {Error}", f.Name, ex.Message);
                return (f, Items: new List<NewsItemDto>(), Ok: false);
            }
        }))).ToList();
}
