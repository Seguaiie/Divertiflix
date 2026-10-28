using System.ComponentModel.DataAnnotations;

namespace Divertiflix.Api.Support;

public static class SafeUrl
{
    /// <summary>
    /// Liste blanche : http(s), les préfixes « media: » (fichier servi par l'API) et « abs: » (livre Audiobookshelf) et, si <paramref name="sitePath"/>, un chemin du
    /// site (« /api/media/art/... », écrit par le catalogue de démonstration). Tout le reste, « javascript: » en tête, est refusé :
    /// le portail ouvre ces adresses dans le navigateur.
    /// </summary>
    public static bool IsAllowed(string? url, bool sitePath = false)
    {
        var u = url?.Trim();
        if (string.IsNullOrEmpty(u)) return true;   // pas de source : rien à vérifier
        if (u.StartsWith("media:", StringComparison.Ordinal)) return u.Length > "media:".Length;
        if (u.StartsWith("abs:", StringComparison.Ordinal)) return Media.AudiobookshelfClient.IsSafeId(u["abs:".Length..]);   // livre servi par Audiobookshelf
        if (sitePath && u[0] == '/') return u.Length == 1 || (u[1] != '/' && u[1] != '\\');
        return (u.StartsWith("http://", StringComparison.OrdinalIgnoreCase) || u.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
               && Uri.TryCreate(u, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https";
    }
}

/// <summary>Valide une adresse de média ou d'image avec <see cref="SafeUrl"/>.</summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Parameter)]
public sealed class SafeUrlAttribute : ValidationAttribute
{
    /// <summary>Accepte aussi un chemin du site (images du catalogue).</summary>
    public bool SitePath { get; init; }

    public override bool IsValid(object? value) => value is not string s || SafeUrl.IsAllowed(s, SitePath);

    public override string FormatErrorMessage(string name) => $"{name} : seuls les schémas http, https, media: et abs: sont acceptés.";
}
