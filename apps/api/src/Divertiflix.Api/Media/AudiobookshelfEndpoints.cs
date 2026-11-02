using Divertiflix.Api.Auth;
using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Media;

/// <summary>
/// Relais vers Audiobookshelf : couvertures publiques (comme les visuels du catalogue) et flux HLS derrière un jeton signé.
/// Le navigateur ne voit jamais l'adresse d'Audiobookshelf ni son jeton.
/// </summary>
public static class AudiobookshelfEndpoints
{
    private static readonly HashSet<string> SegmentTypes = [".m3u8", ".ts", ".m4s", ".aac", ".mp4", ".mp3"];

    private static string ContentType(string ext) => ext switch
    {
        ".m3u8" => "application/vnd.apple.mpegurl",
        ".ts" => "video/mp2t",
        ".m4s" => "video/iso.segment",
        ".aac" => "audio/aac",
        ".mp4" => "audio/mp4",
        ".mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    };

    public static void Map(WebApplication app)
    {
        // Couverture : seulement pour un livre déjà au catalogue (le relais n'ouvre pas tout Audiobookshelf).
        app.MapGet("/api/media/abs/cover/{id}", async Task<IResult> (string id, DivertiflixDbContext db, AudiobookshelfClient abs, HttpContext http, CancellationToken ct) =>
        {
            if (!abs.Configured || !AudiobookshelfClient.IsSafeId(id)) return Results.NotFound();
            if (!await db.Titles.AsNoTracking().AnyAsync(t => t.ExternalSource == AudiobookshelfClient.Source && t.ExternalId == id, ct)) return Results.NotFound();
            try
            {
                using var res = await abs.GetRawAsync($"/api/items/{id}/cover?width=600&format=webp", ct);
                var type = res.Content.Headers.ContentType?.MediaType;
                if (!res.IsSuccessStatusCode || type is null || !type.StartsWith("image/", StringComparison.Ordinal)) return Results.NotFound();
                http.Response.Headers.CacheControl = "public, max-age=86400";
                return Results.File(await res.Content.ReadAsByteArrayAsync(ct), type);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested) { return Results.StatusCode(StatusCodes.Status502BadGateway); }
        }).RequireRateLimiting("media");

        // Flux HLS d'une session ouverte par /playback. Le jeton est dans le chemin : les segments (URL relatives) en héritent.
        app.MapGet("/api/media/abs/hls/{token}/{sessionId}/{file}", async Task<IResult> (string token, string sessionId, string file, StreamSigner signer, AccountGuard accounts, AudiobookshelfSessions sessions, AudiobookshelfClient abs, HttpContext http, CancellationToken ct) =>
        {
            var ext = Path.GetExtension(file).ToLowerInvariant();
            if (!AudiobookshelfClient.IsSafeId(sessionId) || file.Length > 100 || file.Contains("..") || file.IndexOfAny(['/', '\\', ':', '\0', '?', '#']) >= 0 || !SegmentTypes.Contains(ext))
                return Results.NotFound();
            if (signer.Verify(token, sessionId) is not { } userId) return Results.Unauthorized();
            if (!await accounts.IsActiveAsync(userId)) return Results.Unauthorized();
            if (!abs.Configured || !sessions.Known(sessionId)) return Results.NotFound();
            try
            {
                // Un segment pas encore transcodé (début de session, ou saut loin devant pendant qu'Audiobookshelf relance ffmpeg à cet endroit)
                // répond 404 ou 500 quelques secondes : on patiente ici, puis on répond 503, que hls.js réessaie (un 404 l'arrêterait net).
                var owner = sessions.TokenOf(sessionId);
                var res = await abs.GetRawAsync($"/hls/{sessionId}/{file}", ct, owner);
                for (var attempt = 0; ext != ".m3u8" && !res.IsSuccessStatusCode && (int)res.StatusCode is 404 or >= 500 && attempt < 8; attempt++)
                {
                    res.Dispose();
                    await Task.Delay(750, ct);
                    res = await abs.GetRawAsync($"/hls/{sessionId}/{file}", ct, owner);
                }
                using var _ = res;
                if (!res.IsSuccessStatusCode)
                {
                    if (ext == ".m3u8" && res.StatusCode == System.Net.HttpStatusCode.NotFound) return Results.NotFound();
                    http.Response.Headers.RetryAfter = "2";
                    return Results.StatusCode(StatusCodes.Status503ServiceUnavailable);
                }
                if (ext == ".m3u8")
                {
                    // Les segments doivent rester relatifs au jeton : on retire tout chemin absolu vers /hls/ qu'Audiobookshelf aurait écrit.
                    var text = (await res.Content.ReadAsStringAsync(ct)).Replace($"/hls/{sessionId}/", "");
                    http.Response.Headers.CacheControl = "private, max-age=30";
                    return Results.Text(text, ContentType(ext));
                }
                http.Response.Headers.CacheControl = "private, max-age=3600";
                return Results.File(await res.Content.ReadAsByteArrayAsync(ct), ContentType(ext));
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested) { return Results.StatusCode(StatusCodes.Status502BadGateway); }
        }).RequireRateLimiting("media");
    }
}
