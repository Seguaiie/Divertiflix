using System.Net;
using System.Net.Http.Headers;
using System.Text.RegularExpressions;
using Divertiflix.Api.Auth;
using Divertiflix.Api.Services;

namespace Divertiflix.Api.Media;

/// <summary>
/// Relais des médias de la MLB (onglet « Domingo ») : vidéos des faits saillants, vignettes et logos des équipes passent par le portail.
/// Le navigateur ne parle qu'au site : un bloqueur de publicité, la protection contre le pistage ou les boucliers de Brave n'ont rien à
/// bloquer, et la politique de sécurité reste fermée aux domaines extérieurs pour les médias.
/// Garde-fous : hôtes fixes et chemins validés (pas de relais ouvert), vidéos derrière un jeton signé lié à la personne connectée.
/// </summary>
public static partial class MlbMediaEndpoints
{
    public const string VideoScope = "mlb-video";

    // « FORGE/2026/2026-10/28/…-asset_1280x720_59_4000K.mp4 » : le chemin des MP4 de la MLB.
    [GeneratedRegex(@"^FORGE/[A-Za-z0-9/_.-]{1,300}\.mp4$")]
    private static partial Regex VideoPath();

    // « mlb-images/image/upload/w_1920,h_1080,f_jpg,c_fill,g_auto/mlb/xxx.jpg »
    [GeneratedRegex(@"^mlb-images/[A-Za-z0-9/_.,-]{1,300}$")]
    private static partial Regex ImagePath();

    private static bool Safe(string path) => !path.Contains("..", StringComparison.Ordinal) && !path.Contains("//", StringComparison.Ordinal);

    /// <summary>Adresse relayée d'une vidéo MLB, ou null si l'adresse n'est pas une vidéo de la MLB.</summary>
    public static string? VideoPathOf(string url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps && u.Host == MlbResults.VideoHost
        && u.AbsolutePath.TrimStart('/') is var p && VideoPath().IsMatch(p) && Safe(p) ? p : null;

    /// <summary>Adresse relayée d'une vignette MLB, ou null.</summary>
    public static string? ImageUrlOf(string? url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps && u.Host == MlbResults.ImageHost
        && u.AbsolutePath.TrimStart('/') is var p && ImagePath().IsMatch(p) && Safe(p) ? $"/api/media/mlb/image/{p}" : null;

    public static void Map(WebApplication app)
    {
        // Vidéo : lecture en continu avec les requêtes partielles (Range) du lecteur, sans tout charger en mémoire.
        app.MapGet("/api/media/mlb/video/{token}/{**path}", async Task (string token, string path, StreamSigner signer, AccountGuard accounts, MlbResults mlb, HttpContext http) =>
        {
            if (!VideoPath().IsMatch(path) || !Safe(path)) { http.Response.StatusCode = StatusCodes.Status404NotFound; return; }
            if (signer.Verify(token, VideoScope) is not { } userId || !await accounts.IsActiveAsync(userId)) { http.Response.StatusCode = StatusCodes.Status401Unauthorized; return; }
            using var req = new HttpRequestMessage(HttpMethod.Get, $"https://{MlbResults.VideoHost}/{path}");
            if (http.Request.Headers.Range.Count > 0) req.Headers.TryAddWithoutValidation("Range", http.Request.Headers.Range.ToString());
            await RelayAsync(mlb, req, http, "video/mp4", "private, max-age=3600");
        }).RequireRateLimiting("media");

        // Vignette d'un fait saillant (publique, comme les visuels du catalogue).
        app.MapGet("/api/media/mlb/image/{**path}", async Task (string path, MlbResults mlb, HttpContext http) =>
        {
            if (!ImagePath().IsMatch(path) || !Safe(path)) { http.Response.StatusCode = StatusCodes.Status404NotFound; return; }
            using var req = new HttpRequestMessage(HttpMethod.Get, $"https://{MlbResults.ImageHost}/{path}");
            await RelayAsync(mlb, req, http, null, "public, max-age=86400");
        }).RequireRateLimiting("media");

        // Logo d'une équipe (SVG de la MLB).
        app.MapGet("/api/media/mlb/logo/{id:int:range(1,9999)}", async Task (int id, MlbResults mlb, HttpContext http) =>
        {
            // Un SVG peut contenir du script : ouvert seul, il ne doit jamais s'exécuter dans l'origine du site (posé avant l'envoi du corps).
            http.Response.Headers.ContentSecurityPolicy = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
            using var req = new HttpRequestMessage(HttpMethod.Get, $"https://{MlbResults.LogoHost}/team-logos/{id}.svg");
            await RelayAsync(mlb, req, http, "image/svg+xml", "public, max-age=604800");
        }).RequireRateLimiting("media");
    }

    private static async Task RelayAsync(MlbResults mlb, HttpRequestMessage req, HttpContext http, string? forcedType, string cacheControl)
    {
        var ct = http.RequestAborted;
        HttpResponseMessage res;
        try { res = await mlb.SendRawAsync(req, ct); }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        { http.Response.StatusCode = StatusCodes.Status502BadGateway; return; }
        catch (OperationCanceledException) { return; }   // le lecteur a abandonné la requête (déplacement dans la vidéo)

        using (res)
        {
            if (res.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.PartialContent))
            {
                http.Response.StatusCode = res.StatusCode == HttpStatusCode.RequestedRangeNotSatisfiable ? 416
                    : res.StatusCode == HttpStatusCode.NotFound ? 404 : StatusCodes.Status502BadGateway;
                return;
            }
            var type = forcedType ?? res.Content.Headers.ContentType?.MediaType;
            if (forcedType is null && (type is null || !type.StartsWith("image/", StringComparison.Ordinal) || type == "image/svg+xml"))
            { http.Response.StatusCode = StatusCodes.Status502BadGateway; return; }   // une vignette doit être une image matricielle

            http.Response.StatusCode = (int)res.StatusCode;
            http.Response.ContentType = type;
            http.Response.Headers.CacheControl = cacheControl;
            http.Response.Headers.AcceptRanges = "bytes";
            http.Response.Headers.XContentTypeOptions = "nosniff";
            if (res.Content.Headers.ContentLength is { } len) http.Response.ContentLength = len;
            if (res.Content.Headers.ContentRange is ContentRangeHeaderValue range) http.Response.Headers.ContentRange = range.ToString();
            try
            {
                await using var body = await res.Content.ReadAsStreamAsync(ct);
                await body.CopyToAsync(http.Response.Body, 81920, ct);
            }
            catch (Exception ex) when (ex is OperationCanceledException or IOException or HttpRequestException) { /* déplacement dans la vidéo ou onglet fermé */ }
        }
    }
}
