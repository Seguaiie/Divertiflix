using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Extensions.FileProviders;

namespace Divertiflix.Api.Media;

/// <summary>Sert les médias de démonstration : visuels publics, flux (HLS, audio) derrière un jeton signé.</summary>
public static class MediaEndpoints
{
    private static readonly FileExtensionContentTypeProvider Types = BuildTypes();

    private static FileExtensionContentTypeProvider BuildTypes()
    {
        var p = new FileExtensionContentTypeProvider();
        p.Mappings[".m3u8"] = "application/vnd.apple.mpegurl";
        p.Mappings[".ts"] = "video/mp2t";
        p.Mappings[".m4s"] = "video/iso.segment";
        p.Mappings[".webp"] = "image/webp";
        p.Mappings[".m4a"] = "audio/mp4";
        return p;
    }

    public static string Root(IConfiguration config) =>
        Path.GetFullPath(config["Media:Root"] ?? Path.Combine(AppContext.BaseDirectory, "media"));

    public static void Map(WebApplication app)
    {
        var root = Root(app.Configuration);
        var art = Path.Combine(root, "art");
        var stream = Path.Combine(root, "stream");

        if (Directory.Exists(art))
            app.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = new PhysicalFileProvider(art),
                RequestPath = "/api/media/art",
                ContentTypeProvider = Types,
                OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "public, max-age=604800",
            });

        app.MapGet("/api/media/stream/{token}/{**path}", (string token, string path, StreamSigner signer, HttpContext http) =>
        {
            var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2 || parts.Any(p => p is "." or ".." || p.Contains('\\') || p.Contains(':')))
                return Results.NotFound();
            if (!signer.Verify(token, parts[0])) return Results.Unauthorized();

            var full = Path.GetFullPath(Path.Combine(stream, string.Join(Path.DirectorySeparatorChar, parts)));
            if (!full.StartsWith(stream + Path.DirectorySeparatorChar, StringComparison.Ordinal) || !File.Exists(full)) return Results.NotFound();
            Types.TryGetContentType(full, out var type);
            // Les listes HLS ne doivent pas être mises en cache longtemps ; les segments sont immuables.
            http.Response.Headers.CacheControl = full.EndsWith(".m3u8", StringComparison.Ordinal) ? "private, max-age=30" : "private, max-age=3600";
            return Results.File(full, type ?? "application/octet-stream", enableRangeProcessing: true);
        }).RequireRateLimiting("media");
    }
}
