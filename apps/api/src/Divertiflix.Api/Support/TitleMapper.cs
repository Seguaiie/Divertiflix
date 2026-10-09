using Divertiflix.Api.Dtos;
using Divertiflix.Domain;

namespace Divertiflix.Api.Support;

public static class TitleMapper
{
    private static readonly HashSet<string> VideoExt = [".mp4", ".webm", ".mov", ".m4v", ".mkv"];
    private static readonly HashSet<string> AudioExt = [".mp3", ".m4a", ".m4b", ".ogg", ".opus", ".aac", ".wav", ".flac"];

    /// <summary>Déduit la nature de la source à partir de son extension ; tout le reste est un lien externe (ex. page Audiobookshelf).</summary>
    public static StreamKind? KindOf(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        var path = url.Split('?', '#')[0];
        var ext = Path.GetExtension(path).ToLowerInvariant();
        if (ext == ".m3u8") return StreamKind.Hls;
        if (VideoExt.Contains(ext)) return StreamKind.Video;
        if (AudioExt.Contains(ext)) return StreamKind.Audio;
        return StreamKind.External;
    }

    public static TitleDto ToDto(Title t) => new(
        t.Id, t.Name, t.Synopsis, t.Year, t.Kind, t.Genre, t.DurationMinutes, t.PosterUrl, t.BackdropUrl, t.Author, t.Narrator,
        t.ExternalSource, t.Keywords, t.Cast, t.Director, t.Rating, t.Maturity, t.AddedAt, t.IsPlayable, KindOf(t.StreamUrl), t.Credits);

    public static AdminTitleDto ToAdmin(Title t) => new(
        t.Id, t.Name, t.Synopsis, t.Year, t.Kind, t.Genre, t.DurationMinutes, t.PosterUrl, t.BackdropUrl, t.StreamUrl, t.Author, t.Narrator,
        t.ExternalSource, t.Keywords, t.Cast, t.Director, t.Rating, t.Maturity, t.AddedAt, t.IsPlayable, KindOf(t.StreamUrl), t.Credits);

    /// <summary>Applique une fiche d'édition à un titre et recalcule le texte de recherche.</summary>
    public static Title Apply(Title t, TitleUpsert r)
    {
        t.Name = r.Name.Trim(); t.Synopsis = r.Synopsis ?? ""; t.Year = r.Year; t.Kind = r.Kind; t.Genre = r.Genre.Trim();
        t.DurationMinutes = r.DurationMinutes;
        t.PosterUrl = Clean(r.PosterUrl); t.BackdropUrl = Clean(r.BackdropUrl); t.StreamUrl = Clean(r.StreamUrl);
        t.Author = Clean(r.Author); t.Narrator = Clean(r.Narrator); t.Director = Clean(r.Director); t.Maturity = Clean(r.Maturity); t.Credits = Clean(r.Credits);
        t.Rating = r.Rating;
        t.Keywords = (r.Keywords ?? []).Select(k => k.Trim()).Where(k => k.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        t.Cast = (r.Cast ?? []).Select(k => k.Trim()).Where(k => k.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        t.RefreshSearchText();
        return t;
    }

    private static string? Clean(string? s) => string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
