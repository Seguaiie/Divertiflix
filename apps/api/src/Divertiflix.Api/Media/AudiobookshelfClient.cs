using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Divertiflix.Api.Dtos;
using Microsoft.Extensions.Options;

namespace Divertiflix.Api.Media;

/// <summary>Session de lecture ouverte côté Audiobookshelf.</summary>
public sealed record AudiobookshelfSession(string Id, List<ChapterDto> Chapters);

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

    /// <summary>Requête au nom du compte de service (jeton de .env), ou d'un compte lié quand <paramref name="token"/> est fourni.</summary>
    private HttpRequestMessage Request(HttpMethod method, string path, string? token = null)
    {
        var req = new HttpRequestMessage(method, BaseUrl + path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token ?? options.Value.Token);
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
    /// Ouvre une session de lecture : son identifiant et les chapitres du livre. Le transcodage est forcé : Audiobookshelf assemble alors tous les
    /// fichiers du livre (un par chapitre) en un seul flux HLS continu, que le lecteur du portail lit comme un fichier unique.
    /// </summary>
    public async Task<AudiobookshelfSession> OpenSessionAsync(string itemId, CancellationToken ct, string? token = null)
    {
        if (!IsSafeId(itemId)) throw new InvalidOperationException("Identifiant Audiobookshelf invalide.");
        using var req = Request(HttpMethod.Post, $"/api/items/{itemId}/play", token);
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
            await CloseSessionAsync(sessionId!, CancellationToken.None, token);
            throw new InvalidOperationException("Audiobookshelf n'a pas ouvert de flux HLS (transcodage indisponible).");
        }
        return new AudiobookshelfSession(sessionId!, Chapters(doc.RootElement));
    }

    private static List<ChapterDto> Chapters(JsonElement session)
    {
        var chapters = new List<ChapterDto>();
        if (!session.TryGetProperty("chapters", out var list) || list.ValueKind != JsonValueKind.Array) return chapters;
        foreach (var c in list.EnumerateArray())
        {
            if (!c.TryGetProperty("start", out var start) || start.ValueKind != JsonValueKind.Number) continue;
            var end = c.TryGetProperty("end", out var e) && e.ValueKind == JsonValueKind.Number ? e.GetDouble() : start.GetDouble();
            chapters.Add(new ChapterDto(Cut(Text(c, "title"), 200) is { Length: > 0 } title ? title : $"Chapitre {chapters.Count + 1}", start.GetDouble(), end));
        }
        return chapters;
    }

    /// <summary>Ferme une session (libère le transcodage côté Audiobookshelf). Au mieux : n'échoue jamais.</summary>
    public async Task CloseSessionAsync(string sessionId, CancellationToken ct, string? token = null)
    {
        if (!IsSafeId(sessionId)) return;
        try
        {
            using var req = Request(HttpMethod.Post, $"/api/session/{sessionId}/close", token);
            req.Content = JsonContent.Create(new { });
            using var res = await http.SendAsync(req, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { /* le serveur nettoie ses sessions lui-même */ }
    }

    /// <summary>GET brut vers Audiobookshelf (images, listes et segments HLS). L'appelant libère la réponse.</summary>
    public async Task<HttpResponseMessage> GetRawAsync(string path, CancellationToken ct, string? token = null)
    {
        using var req = Request(HttpMethod.Get, path, token);
        return await http.SendAsync(req, HttpCompletionOption.ResponseContentRead, ct);
    }

    // ------------------------------------------------------------------ Comptes liés (un utilisateur Audiobookshelf par compte Divertiflix)

    /// <summary>Noms d'utilisateur déjà pris dans Audiobookshelf (comparaison sans casse).</summary>
    public async Task<HashSet<string>> UsernamesAsync(CancellationToken ct)
    {
        using var doc = await GetJsonAsync("/api/users", ct);
        return doc.RootElement.GetProperty("users").EnumerateArray()
            .Select(u => Text(u, "username")).OfType<string>().ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Crée un utilisateur simple (lecture seule : ni envoi, ni modification, ni suppression) ; renvoie son identifiant.</summary>
    public async Task<string> CreateUserAsync(string username, string password, CancellationToken ct)
    {
        using var req = Request(HttpMethod.Post, "/api/users");
        req.Content = JsonContent.Create(new
        {
            username, password, type = "user", isActive = true,
            permissions = new { download = false, update = false, delete = false, upload = false, accessAllLibraries = true, accessAllTags = true, accessExplicitContent = true },
        });
        using var res = await http.SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var id = Text(doc.RootElement.GetProperty("user"), "id");
        return IsSafeId(id) ? id! : throw new InvalidOperationException("Utilisateur Audiobookshelf créé sans identifiant exploitable.");
    }

    /// <summary>Clé d'API sans expiration au nom de l'utilisateur <paramref name="userId"/> (créée par le compte de service, administrateur).</summary>
    public async Task<string> CreateApiKeyAsync(string userId, string name, CancellationToken ct)
    {
        using var req = Request(HttpMethod.Post, "/api/api-keys");
        req.Content = JsonContent.Create(new { name, userId, isActive = true });
        using var res = await http.SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        return Text(doc.RootElement.GetProperty("apiKey"), "apiKey") is { Length: > 0 } key ? key : throw new InvalidOperationException("Clé d'API Audiobookshelf vide.");
    }

    /// <summary>Supprime un utilisateur (nettoyage quand l'enregistrement du lien a échoué). Au mieux.</summary>
    public async Task DeleteUserAsync(string userId, CancellationToken ct)
    {
        if (!IsSafeId(userId)) return;
        try { using var req = Request(HttpMethod.Delete, $"/api/users/{userId}"); using var _ = await http.SendAsync(req, ct); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException) { }
    }

    /// <summary>Enregistre la position d'écoute dans Audiobookshelf, au nom du compte lié.</summary>
    public async Task SaveProgressAsync(string token, string itemId, double currentTime, double duration, CancellationToken ct)
    {
        if (!IsSafeId(itemId) || duration <= 0) return;
        var progress = Math.Clamp(currentTime / duration, 0, 1);
        using var req = Request(HttpMethod.Patch, $"/api/me/progress/{itemId}", token);
        req.Content = JsonContent.Create(new { currentTime, duration, progress, isFinished = progress >= 0.99 });
        using var res = await http.SendAsync(req, ct);
        res.EnsureSuccessStatusCode();
    }

    /// <summary>Position d'écoute enregistrée dans Audiobookshelf (ex. depuis son application), ou null.</summary>
    public async Task<(double Current, double Duration, bool Finished)?> GetProgressAsync(string token, string itemId, CancellationToken ct)
    {
        if (!IsSafeId(itemId)) return null;
        using var req = Request(HttpMethod.Get, $"/api/me/progress/{itemId}", token);
        using var res = await http.SendAsync(req, ct);
        if (res.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
        res.EnsureSuccessStatusCode();
        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var r = doc.RootElement;
        double Num(string n) => r.TryGetProperty(n, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetDouble() : 0;
        return (Num("currentTime"), Num("duration"), Flag(r, "isFinished"));
    }

    private static string? Text(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static bool Flag(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    private static string? Cut(string? s, int max) => s is null ? null : s.Length <= max ? s : s[..max];
}
