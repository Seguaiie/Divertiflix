using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Security.Authentication;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Divertiflix.Api.Services;

/// <summary>Jellyseerr (section « Jellyseerr » : Jellyseerr__Url, Jellyseerr__ApiKey dans .env). Inactif tant que la clé manque.</summary>
public sealed class JellyseerrOptions
{
    public string Url { get; set; } = "https://jellyseerr.home.arpa";
    /// <summary>Clé d'API (Jellyseerr → Paramètres → Général → Clé d'API). Reste côté serveur.</summary>
    public string ApiKey { get; set; } = "";
    /// <summary>Lien donné dans la notification « disponible ».</summary>
    public string JellyfinUrl { get; set; } = "https://jellyfin.home.arpa/";
    public int SyncMinutes { get; set; } = 2;

    public bool Configured =>
        ApiKey.Length > 0 && Uri.TryCreate(Url, UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp);
}

/// <summary>Résultat de recherche : film ou série, avec son identifiant TMDB et sa disponibilité dans Jellyseerr.</summary>
public sealed record SeerrResult(int TmdbId, string MediaType, string Title, string? OriginalTitle, int? Year, int? MediaStatus);

/// <summary>Échec lisible pour l'administrateur (stocké dans la demande).</summary>
public sealed class SeerrException(string message, bool final = false, Exception? inner = null) : Exception(message, inner)
{
    /// <summary>Inutile de réessayer (ex. aucun résultat) ; sinon nouvel essai au passage suivant.</summary>
    public bool Final { get; } = final;
}

/// <summary>
/// Client de l'API Jellyseerr 2.x (en-tête X-Api-Key). Le certificat est vérifié normalement : tant que l'autorité interne (Step CA) n'est
/// pas installée sur ce serveur, les appels échouent avec un message qui le dit, et rien n'est transmis.
/// </summary>
public sealed partial class JellyseerrClient(HttpClient http, IOptions<JellyseerrOptions> options)
{
    /// <summary>Disponibilité d'un média : 5 = disponible, 4 = en partie (séries), 3 = en cours, 2 = en attente.</summary>
    public const int Available = 5, PartiallyAvailable = 4;
    /// <summary>État d'une demande : 3 = refusée.</summary>
    public const int Declined = 3;

    public bool Configured => options.Value.Configured;

    private HttpRequestMessage Req(HttpMethod method, string path)
    {
        var req = new HttpRequestMessage(method, options.Value.Url.TrimEnd('/') + "/api/v1" + path);
        req.Headers.Add("X-Api-Key", options.Value.ApiKey);
        return req;
    }

    private async Task<JsonDocument> SendAsync(HttpRequestMessage req, CancellationToken ct, bool allowConflict = false)
    {
        HttpResponseMessage res;
        try { res = await http.SendAsync(req, ct); }
        catch (HttpRequestException ex) when (ex.InnerException is AuthenticationException)
        { throw new SeerrException("Certificat de Jellyseerr non reconnu : installer l'autorité interne (Step CA) sur le serveur Divertiflix.", inner: ex); }
        catch (HttpRequestException ex) { throw new SeerrException("Jellyseerr injoignable.", inner: ex); }
        catch (TaskCanceledException ex) when (!ct.IsCancellationRequested) { throw new SeerrException("Jellyseerr ne répond pas.", inner: ex); }
        using (res)
        {
            if (res.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) throw new SeerrException("Clé d'API Jellyseerr refusée.");
            if (allowConflict && res.StatusCode == HttpStatusCode.Conflict) return JsonDocument.Parse("{}");
            if (!res.IsSuccessStatusCode) throw new SeerrException($"Jellyseerr a répondu {(int)res.StatusCode}.");
            return await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        }
    }

    public async Task<List<SeerrResult>> SearchAsync(string query, CancellationToken ct)
    {
        // Jellyseerr refuse certains caractères non encodés : tout passe par EscapeDataString.
        using var doc = await SendAsync(Req(HttpMethod.Get, $"/search?query={Uri.EscapeDataString(query)}&page=1"), ct);
        var list = new List<SeerrResult>();
        if (!doc.RootElement.TryGetProperty("results", out var results) || results.ValueKind != JsonValueKind.Array) return list;
        foreach (var r in results.EnumerateArray())
        {
            var type = Str(r, "mediaType");
            if (type is not ("movie" or "tv") || !r.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.Number) continue;
            var date = Str(r, type == "movie" ? "releaseDate" : "firstAirDate");
            list.Add(new SeerrResult(id.GetInt32(), type, Str(r, type == "movie" ? "title" : "name") ?? "", Str(r, type == "movie" ? "originalTitle" : "originalName"),
                date is { Length: >= 4 } && int.TryParse(date[..4], NumberStyles.None, CultureInfo.InvariantCulture, out var y) ? y : null,
                MediaStatus(r)));
        }
        return list;
    }

    /// <summary>Crée la demande (toutes les saisons pour une série). Null : déjà demandée par ailleurs (409), on suit alors le média.</summary>
    public async Task<int?> RequestAsync(string mediaType, int tmdbId, CancellationToken ct)
    {
        using var req = Req(HttpMethod.Post, "/request");
        req.Content = mediaType == "tv"
            ? JsonContent.Create(new { mediaType, mediaId = tmdbId, seasons = "all" })
            : JsonContent.Create(new { mediaType, mediaId = tmdbId });
        using var doc = await SendAsync(req, ct, allowConflict: true);
        return doc.RootElement.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.Number ? id.GetInt32() : null;
    }

    /// <summary>Disponibilité actuelle du média (null : inconnu de Jellyseerr pour l'instant).</summary>
    public async Task<int?> MediaStatusAsync(string mediaType, int tmdbId, CancellationToken ct)
    {
        using var doc = await SendAsync(Req(HttpMethod.Get, $"/{(mediaType == "tv" ? "tv" : "movie")}/{tmdbId}"), ct);
        return MediaStatus(doc.RootElement);
    }

    /// <summary>État de la demande (1 en attente, 2 approuvée, 3 refusée).</summary>
    public async Task<int?> RequestStatusAsync(int requestId, CancellationToken ct)
    {
        using var doc = await SendAsync(Req(HttpMethod.Get, $"/request/{requestId}"), ct);
        return doc.RootElement.TryGetProperty("status", out var s) && s.ValueKind == JsonValueKind.Number ? s.GetInt32() : null;
    }

    private static int? MediaStatus(JsonElement e) =>
        e.TryGetProperty("mediaInfo", out var mi) && mi.ValueKind == JsonValueKind.Object && mi.TryGetProperty("status", out var s) && s.ValueKind == JsonValueKind.Number
            ? s.GetInt32() : null;

    private static string? Str(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    [GeneratedRegex(@"[^\p{L}\p{N}]+")] private static partial Regex NotAlnum();

    private static string Norm(string? s) =>
        NotAlnum().Replace(new string((s ?? "").ToLowerInvariant().Normalize(NormalizationForm.FormD)
            .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark).ToArray()), "");

    /// <summary>
    /// Le bon résultat pour une demande : du bon type (film ou série), titre identique (traduit ou original) et année à un an près si elle
    /// est connue ; à défaut, la bonne année ; à défaut, le premier résultat du bon type si aucune année n'est demandée. Sinon rien : mieux
    /// vaut « introuvable » qu'un mauvais film téléchargé.
    /// </summary>
    public static SeerrResult? Pick(IEnumerable<SeerrResult> results, TitleKind kind, string name, int? year)
    {
        var type = kind == TitleKind.Series ? "tv" : "movie";
        var candidates = results.Where(r => r.MediaType == type).ToList();
        var want = Norm(name);
        bool SameTitle(SeerrResult r) => want.Length > 0 && (Norm(r.Title) == want || Norm(r.OriginalTitle) == want);
        bool SameYear(SeerrResult r) => year is null || r.Year is { } y && Math.Abs(y - year.Value) <= 1;
        return candidates.FirstOrDefault(r => SameTitle(r) && SameYear(r))
            ?? (year is not null ? candidates.FirstOrDefault(SameYear) : null)
            ?? (year is null ? candidates.FirstOrDefault(SameTitle) ?? candidates.FirstOrDefault() : null);
    }
}

/// <summary>
/// Demandes Divertiflix ↔ Jellyseerr. Une demande de film ou de série approuvée dans le back-office est transmise à Jellyseerr (qui la
/// confie à Radarr ou Sonarr) et passe « en téléchargement » ; quand Jellyseerr annonce le média disponible, la demande passe
/// « disponible » et la personne est prévenue, avec un lien vers Jellyfin. Passage toutes les 2 minutes, et tout de suite après une approbation.
/// </summary>
public sealed class JellyseerrSync(IServiceScopeFactory scopes, IOptions<JellyseerrOptions> options, ILogger<JellyseerrSync> log) : BackgroundService
{
    private readonly SemaphoreSlim _kick = new(0, 1);

    /// <summary>Demande un passage immédiat (après une approbation).</summary>
    public void Kick() { if (_kick.CurrentCount == 0) try { _kick.Release(); } catch (SemaphoreFullException) { } }

    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        if (!options.Value.Configured) { log.LogInformation("Jellyseerr non configuré (Jellyseerr__ApiKey) : demandes traitées à la main."); return; }
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(30), stop);
            while (!stop.IsCancellationRequested)
            {
                await RunOnceAsync(stop);
                await _kick.WaitAsync(TimeSpan.FromMinutes(Math.Max(1, options.Value.SyncMinutes)), stop);
            }
        }
        catch (OperationCanceledException) { /* arrêt de l'API */ }
    }

    public async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>();
        var seerr = scope.ServiceProvider.GetRequiredService<JellyseerrClient>();
        var notifier = scope.ServiceProvider.GetRequiredService<Notifier>();
        var audit = scope.ServiceProvider.GetRequiredService<Audit>();
        if (!seerr.Configured) return;

        var kinds = new[] { TitleKind.Movie, TitleKind.Series };
        // 1. Demandes approuvées pas encore transmises (ou dont la transmission a échoué pour une raison passagère).
        var toSend = await db.Requests.Where(r => r.Status == RequestStatus.Approved && kinds.Contains(r.Kind) && (r.SeerrState == null || r.SeerrState == "error"))
            .Select(r => r.Id).Take(20).ToListAsync(ct);
        foreach (var id in toSend) await WithLockAsync(db, notifier, id, ct, r => SendAsync(seerr, notifier, audit, r, ct));

        // 2. Demandes transmises : disponibles ? refusées ?
        var toWatch = await db.Requests.Where(r => (r.Status == RequestStatus.Downloading || r.Status == RequestStatus.Approved) && r.SeerrState == "sent")
            .Select(r => r.Id).Take(50).ToListAsync(ct);
        foreach (var id in toWatch) await WithLockAsync(db, notifier, id, ct, r => WatchAsync(seerr, notifier, audit, r, ct));
    }

    /// <summary>Un verrou par demande : une décision prise en même temps dans le back-office passe avant ou après, jamais au milieu.</summary>
    private async Task WithLockAsync(DivertiflixDbContext db, Notifier notifier, Guid id, CancellationToken ct, Func<MediaRequest, Task<Notification?>> work)
    {
        try
        {
            Notification? n;
            await using (var tx = await db.BeginLockedAsync($"request:{id}", ct))
            {
                var r = await db.Requests.FirstOrDefaultAsync(x => x.Id == id, ct);
                if (r is null) return;
                n = await work(r);
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
            }
            if (n is not null) await notifier.PushAsync(n);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw; }
        catch (Exception ex) { log.LogWarning(ex, "Synchronisation Jellyseerr de la demande {Id} échouée.", id); db.ChangeTracker.Clear(); }
    }

    private async Task<Notification?> SendAsync(JellyseerrClient seerr, Notifier notifier, Audit audit, MediaRequest r, CancellationToken ct)
    {
        if (r.Status != RequestStatus.Approved || r.SeerrState is not (null or "error")) return null;   // changée entre-temps
        try
        {
            var match = JellyseerrClient.Pick(await seerr.SearchAsync(r.Name, ct), r.Kind, r.Name, r.Year);
            if (match is null) throw new SeerrException("Introuvable dans Jellyseerr : à traiter à la main.", final: true);
            r.SeerrMediaType = match.MediaType;
            r.SeerrTmdbId = match.TmdbId;
            if (match.MediaStatus is not (JellyseerrClient.Available or JellyseerrClient.PartiallyAvailable))
                r.SeerrRequestId = await seerr.RequestAsync(match.MediaType, match.TmdbId, ct);
            r.SeerrState = "sent";
            r.SeerrNote = $"{match.Title}{(match.Year is { } y ? $" ({y})" : "")} · TMDB {match.TmdbId}";
            r.UpdatedAt = DateTime.UtcNow;
            audit.Record(null, "request.seerr.sent", r.Name, r.SeerrNote);
            // Déjà dans la médiathèque : disponible tout de suite. Sinon : en téléchargement.
            return match.MediaStatus is JellyseerrClient.Available or JellyseerrClient.PartiallyAvailable
                ? MarkAvailable(r, notifier) : MarkDownloading(r, notifier);
        }
        catch (SeerrException ex)
        {
            r.SeerrState = ex.Final ? "notfound" : "error";
            r.SeerrNote = ex.Message;
            r.UpdatedAt = DateTime.UtcNow;
            return null;
        }
    }

    private async Task<Notification?> WatchAsync(JellyseerrClient seerr, Notifier notifier, Audit audit, MediaRequest r, CancellationToken ct)
    {
        if (r.SeerrTmdbId is not { } tmdb || r.SeerrMediaType is not { } type || r.Status is not (RequestStatus.Approved or RequestStatus.Downloading)) return null;
        try
        {
            var status = await seerr.MediaStatusAsync(type, tmdb, ct);
            if (status is JellyseerrClient.Available || (type == "tv" && status is JellyseerrClient.PartiallyAvailable))
            {
                audit.Record(null, "request.seerr.available", r.Name);
                return MarkAvailable(r, notifier);
            }
            if (r.SeerrRequestId is { } rid && await seerr.RequestStatusAsync(rid, ct) == JellyseerrClient.Declined)
            {
                r.Status = RequestStatus.Declined;
                r.UpdatedAt = DateTime.UtcNow;
                audit.Record(null, "request.seerr.declined", r.Name);
                return notifier.Add(r.UserId, "request.declined", r.Name, "Refusée dans Jellyseerr.", null);
            }
            return null;
        }
        catch (SeerrException ex) { log.LogInformation("Suivi Jellyseerr de « {Name} » : {Error}", r.Name, ex.Message); return null; }
    }

    private Notification? MarkDownloading(MediaRequest r, Notifier notifier)
    {
        if (r.Status == RequestStatus.Downloading) return null;
        r.Status = RequestStatus.Downloading;
        return notifier.Add(r.UserId, "request.downloading", r.Name, null, null);
    }

    private Notification MarkAvailable(MediaRequest r, Notifier notifier)
    {
        r.Status = RequestStatus.Available;
        r.UpdatedAt = DateTime.UtcNow;
        return notifier.Add(r.UserId, "request.available", r.Name, "Disponible sur Jellyfin.", options.Value.JellyfinUrl);
    }
}
