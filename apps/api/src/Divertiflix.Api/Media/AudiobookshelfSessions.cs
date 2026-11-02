using Microsoft.Extensions.Caching.Memory;

namespace Divertiflix.Api.Media;

/// <summary>
/// Sessions de lecture Audiobookshelf ouvertes par cette API. Le relais HLS ne sert que ces sessions (le jeton d'Audiobookshelf ne doit
/// jamais ouvrir un chemin arbitraire), et chaque session est refermée côté Audiobookshelf quand elle expire.
/// </summary>
public sealed class AudiobookshelfSessions(IMemoryCache cache, IServiceProvider services)
{
    private const string Prefix = "abs-session:";

    /// <summary>Un peu plus que la durée du jeton de lecture (6 h), pour ne pas couper une écoute en cours.</summary>
    private static readonly TimeSpan Lifetime = TimeSpan.FromHours(7);

    /// <summary>Retient la session et la clé du compte qui l'a ouverte (null : compte de service) : les segments et la fermeture passent par ce compte.</summary>
    public void Track(string sessionId, string? token = null) =>
        cache.Set(Prefix + sessionId, new Entry(token), new MemoryCacheEntryOptions()
            .SetAbsoluteExpiration(Lifetime)
            .RegisterPostEvictionCallback((key, value, _, _) => { _ = CloseAsync(((string)key)[Prefix.Length..], (value as Entry)?.Token); }));

    public bool Known(string sessionId) => cache.TryGetValue(Prefix + sessionId, out _);

    /// <summary>Clé du compte propriétaire de la session (null : compte de service).</summary>
    public string? TokenOf(string sessionId) => cache.TryGetValue(Prefix + sessionId, out Entry? e) ? e?.Token : null;

    private sealed record Entry(string? Token);

    private async Task CloseAsync(string sessionId, string? token)
    {
        try { await services.GetRequiredService<AudiobookshelfClient>().CloseSessionAsync(sessionId, CancellationToken.None, token); }
        catch (Exception) { /* au mieux : Audiobookshelf nettoie ses sessions lui-même */ }
    }
}
