using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Divertiflix.Api.Dtos;
using Microsoft.Extensions.Options;

namespace Divertiflix.Api.Media;

/// <summary>
/// Client de l'API REST d'Audiobookshelf. Le jeton est posé ici, à chaque requête : le navigateur ne parle jamais à Audiobookshelf.
/// </summary>
public sealed partial class AudiobookshelfClient(HttpClient http, IOptions<AudiobookshelfOptions> options)
{
    /// <summary>Source des titres importés (colonne Title.ExternalSource).</summary>
    public const string Source = "Audiobookshelf";

    /// <summary>Préfixe de Title.StreamUrl pour un livre servi par Audiobookshelf : « abs:{identifiant de l'item} ».</summary>
    public const string StreamPrefix = "abs:";

    public bool Configured => options.Value.Configured;

    private string BaseUrl => options.Value.Url.TrimEnd('/');

    /// <summary>Identifiants Audiobookshelf (items, sessions) : lettres, chiffres, tiret et soulignement. Tout le reste est refusé avant d'aller dans une URL.</summary>
    public static bool IsSafeId(string? id) => !string.IsNullOrEmpty(id) && id.Length <= 64 && SafeId().IsMatch(id);

    [GeneratedRegex("^[A-Za-z0-9_-]+$")]
    private static partial Regex SafeId();

    [GeneratedRegex("<[^>]+>")]
    private static partial Regex Tags();

    private HttpRequestMessage Request(HttpMethod method, string path)
    {
        var req = new HttpRequestMessage(method, BaseUrl + path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", options.Value.Token);
        return req;
    }

    private async Task<JsonDocument> GetJsonAsync(string path, CancellationToken ct)
    {
        using var req = Request(HttpMethod.Get, path);
        using var res = await http.SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
        await using var body = await res.Content.ReadAsStreamAsync(ct);
        return await JsonDocument.ParseAsync(body, cancellationToken: ct);
    }

    /// <summary>Les livres (pas les balados) de toutes les bibliothèques, au format d'ingestion du catalogue.</summary>
    public async Task<List<AudiobookItemDto>> ListBooksAsync(CancellationToken ct)
    {
        var books = new List<AudiobookItemDto>();
        using var libraries = await GetJsonAsync("/api/libraries", ct);
        foreach (var lib in libraries.RootElement.GetProperty("libraries").EnumerateArray())
        {
            var libraryId = Text(lib, "id");
            if (Text(lib, "mediaType") != "book" || !IsSafeId(libraryId)) continue;
            for (var page = 0; page < 1000; page++)
            {
                using var doc = await GetJsonAsync($"/api/libraries/{libraryId}/items?limit=100&page={page}", ct);
                var results = doc.RootElement.GetProperty("results");
                foreach (var item in results.EnumerateArray())
                    if (ToBook(item) is { } book) books.Add(book);
                if (results.GetArrayLength() < 100) break;
            }
        }
        return books;
    }

    private static AudiobookItemDto? ToBook(JsonElement item)
    {
        var id = Text(item, "id");
        if (!IsSafeId(id) || Flag(item, "isMissing") || Flag(item, "isInvalid")) return null;
        if (!item.TryGetProperty("media", out var media) || !media.TryGetProperty("metadata", out var meta)) return null;

        var title = Cut(Text(meta, "title"), 200);
        var genre = meta.TryGetProperty("genres", out var genres) && genres.ValueKind == JsonValueKind.Array && genres.GetArrayLength() > 0
            ? Cut(genres[0].GetString(), 60) : null;
        var seconds = media.TryGetProperty("duration", out var d) && d.ValueKind == JsonValueKind.Number ? d.GetDouble() : 0;
        var cover = Text(media, "coverPath") is { Length: > 0 } ? $"/api/media/abs/cover/{id}" : null;

        return new AudiobookItemDto(
            id!,
            string.IsNullOrWhiteSpace(title) ? "Sans titre" : title,
            Cut(Tags().Replace(Text(meta, "description") ?? "", " ").Trim(), 4000),
            Cut(Text(meta, "authorName"), 200),
            Cut(Text(meta, "narratorName"), 200),
            (int)Math.Clamp(Math.Round(seconds / 60), 0, 100000),
            cover,
            StreamPrefix + id,
            genre);
    }

    /// <summary>
    /// Ouvre une session de lecture et renvoie son identifiant. Le transcodage est forcé : Audiobookshelf assemble alors tous les
    /// fichiers du livre (un par chapitre) en un seul flux HLS continu, que le lecteur du portail lit comme un fichier unique.
    /// </summary>
    public async Task<string> OpenSessionAsync(string itemId, CancellationToken ct)
    {
        if (!IsSafeId(itemId)) throw new InvalidOperationException("Identifiant Audiobookshelf invalide.");
        using var req = Request(HttpMethod.Post, $"/api/items/{itemId}/play");
        req.Content = JsonContent.Create(new
        {
            deviceInfo = new { clientName = "Divertiflix", deviceId = "divertiflix-server" },
            forceDirectPlay = false,
            forceTranscode = true,
            supportedMimeTypes = Array.Empty<string>(),
            mediaPlayer = "html5",
        });
        using var res = await http.SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
        await using var body = await res.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(body, cancellationToken: ct);

        var sessionId = Text(doc.RootElement, "id");
        if (!IsSafeId(sessionId)) throw new InvalidOperationException("Session Audiobookshelf sans identifiant exploitable.");
        // Si Audiobookshelf a quand même répondu en lecture directe, le flux HLS n'existe pas : on le dit tout de suite.
        if (doc.RootElement.TryGetProperty("audioTracks", out var tracks) && tracks.ValueKind == JsonValueKind.Array && tracks.GetArrayLength() > 0
            && Text(tracks[0], "contentUrl") is { } url && !url.Contains("/hls/", StringComparison.Ordinal))
        {
            await CloseSessionAsync(sessionId!, CancellationToken.None);
            throw new InvalidOperationException("Audiobookshelf n'a pas ouvert de flux HLS (transcodage indisponible).");
        }
        return sessionId!;
    }

    /// <summary>Ferme une session (libère le transcodage côté Audiobookshelf). Au mieux : n'échoue jamais.</summary>
    public async Task CloseSessionAsync(string sessionId, CancellationToken ct)
    {
        if (!IsSafeId(sessionId)) return;
        try
        {
            using var req = Request(HttpMethod.Post, $"/api/session/{sessionId}/close");
            req.Content = JsonContent.Create(new { });
            using var res = await http.SendAsync(req, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { /* le serveur nettoie ses sessions lui-même */ }
    }

    /// <summary>GET brut vers Audiobookshelf (images, listes et segments HLS). L'appelant libère la réponse.</summary>
    public async Task<HttpResponseMessage> GetRawAsync(string path, CancellationToken ct)
    {
        using var req = Request(HttpMethod.Get, path);
        return await http.SendAsync(req, HttpCompletionOption.ResponseContentRead, ct);
    }

    private static string? Text(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static bool Flag(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static string? Cut(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];
}
