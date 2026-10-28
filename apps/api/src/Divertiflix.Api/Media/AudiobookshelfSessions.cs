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

    public void Track(string sessionId) =>
        cache.Set(Prefix + sessionId, true, new MemoryCacheEntryOptions()
            .SetAbsoluteExpiration(Lifetime)
            .RegisterPostEvictionCallback((key, _, _, _) => { _ = CloseAsync(((string)key)[Prefix.Length..]); }));

    public bool Known(string sessionId) => cache.TryGetValue(Prefix + sessionId, out _);

    private async Task CloseAsync(string sessionId)
    {
        try { await services.GetRequiredService<AudiobookshelfClient>().CloseSessionAsync(sessionId, CancellationToken.None); }
        catch (Exception) { /* au mieux : Audiobookshelf nettoie ses sessions lui-même */ }
    }
}
