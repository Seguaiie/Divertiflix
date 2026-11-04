using System.Net;
using Divertiflix.Api.Services;

namespace Divertiflix.Api.Media;

/// <summary>
/// Relais des images des nouvelles (onglet « Nicholas »). Le navigateur ne contacte pas les sites de presse ; le relais ne sert que des
/// images trouvées dans les fils suivis (identifiant opaque, jamais une adresse fournie par le client), en HTTPS, images matricielles
/// seulement (pas de SVG), 5 Mo au plus.
/// </summary>
public static class NewsMediaEndpoints
{
    private const long MaxBytes = 5 * 1024 * 1024;

    public static void Map(WebApplication app)
    {
        app.MapGet("/api/media/news/image/{id:regex(^[a-f0-9]{{24}}$)}", async Task (string id, AiNews news, HttpContext http) =>
        {
            var ct = http.RequestAborted;
            if (news.ImageSource(id) is not { } url) { http.Response.StatusCode = StatusCodes.Status404NotFound; return; }
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            HttpResponseMessage res;
            try { res = await news.SendRawAsync(req, ct); }
            catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
            { http.Response.StatusCode = StatusCodes.Status502BadGateway; return; }
            catch (OperationCanceledException) { return; }
            using (res)
            {
                var type = res.Content.Headers.ContentType?.MediaType;
                // Après redirection, l'image doit toujours venir d'une adresse HTTPS.
                var final = res.RequestMessage?.RequestUri;
                if (res.StatusCode != HttpStatusCode.OK || type is null || !type.StartsWith("image/", StringComparison.Ordinal) || type.Contains("svg", StringComparison.Ordinal)
                    || final?.Scheme != Uri.UriSchemeHttps || res.Content.Headers.ContentLength > MaxBytes)
                { http.Response.StatusCode = StatusCodes.Status502BadGateway; return; }

                http.Response.ContentType = type;
                http.Response.Headers.CacheControl = "public, max-age=86400";
                http.Response.Headers.XContentTypeOptions = "nosniff";
                if (res.Content.Headers.ContentLength is { } len) http.Response.ContentLength = len;
                try
                {
                    await using var body = await res.Content.ReadAsStreamAsync(ct);
                    var buffer = new byte[81920];
                    long total = 0;
                    int read;
                    while ((read = await body.ReadAsync(buffer, ct)) > 0)
                    {
                        if ((total += read) > MaxBytes) { http.Abort(); return; }   // taille annoncée mensongère
                        await http.Response.Body.WriteAsync(buffer.AsMemory(0, read), ct);
                    }
                }
                catch (Exception ex) when (ex is OperationCanceledException or IOException or HttpRequestException) { }
            }
        }).RequireRateLimiting("media");
    }
}
