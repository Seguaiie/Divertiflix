using Microsoft.Extensions.Caching.Memory;

namespace Divertiflix.Api.Auth;

/// <summary>
/// Compteur d'échecs de connexion par courriel, en mémoire (la limitation de débit par adresse ne voit pas un attaquant qui tourne
/// sur beaucoup d'adresses). À partir de 5 échecs dans une fenêtre de 15 minutes, le courriel est verrouillé 30 s, puis 1, 2, 4 min,
/// jamais plus de 5 min ; les tentatives faites pendant un verrouillage ne le prolongent pas.
/// Un verrou par courriel permettrait à n'importe qui d'empêcher l'administrateur de se connecter en continu : il ne vaut donc que pour
/// les sources (adresse IPv4 ou /64) dont aucune connexion réussie n'est connue pour ce compte. Le propriétaire reste libre d'entrer
/// depuis ses lieux habituels (ses propres échecs comptent, ses tentatives ne sont pas bloquées).
/// Le courriel est compté qu'il existe ou non : la réponse ne révèle rien sur l'existence du compte. État perdu au redémarrage.
/// </summary>
public sealed class LoginThrottle(TimeProvider clock)
{
    public const int Threshold = 5;
    private const int MaxKnownSources = 8;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15), FirstLock = TimeSpan.FromSeconds(30), MaxLock = TimeSpan.FromMinutes(5), KnownFor = TimeSpan.FromDays(30);

    private sealed class Entry
    {
        public readonly List<DateTimeOffset> Failures = [];
        public readonly List<string> KnownSources = [];
        public DateTimeOffset LockedUntil;
    }

    // Borné : une inondation de courriels inventés ne grossit pas la mémoire (au-delà, les entrées ne sont plus retenues).
    private readonly MemoryCache _entries = new(new MemoryCacheOptions { SizeLimit = 50_000 });

    /// <summary>Durée restante du verrouillage pour cette source, ou null si elle peut tenter sa chance.</summary>
    public TimeSpan? LockedFor(string email, string source)
    {
        if (!_entries.TryGetValue(email, out Entry? entry) || entry is null) return null;
        lock (entry)
        {
            var left = entry.LockedUntil - clock.GetUtcNow();
            return left > TimeSpan.Zero && !entry.KnownSources.Contains(source) ? left : null;
        }
    }

    public void Failed(string email, string source)
    {
        var entry = Get(email);
        lock (entry)
        {
            var now = clock.GetUtcNow();
            entry.Failures.RemoveAll(t => now - t >= Window);
            if (entry.LockedUntil > now) return;   // refusé sans être examiné : ne prolonge pas le verrou
            entry.Failures.Add(now);
            if (entry.Failures.Count >= Threshold)
                entry.LockedUntil = now + TimeSpan.FromTicks(Math.Min(FirstLock.Ticks << Math.Min(entry.Failures.Count - Threshold, 10), MaxLock.Ticks));
            Store(email, entry);
        }
    }

    /// <summary>Connexion réussie : les échecs sont oubliés et la source devient connue pour ce compte.</summary>
    public void Succeeded(string email, string source)
    {
        var entry = Get(email);
        lock (entry)
        {
            entry.Failures.Clear();
            entry.LockedUntil = default;
            entry.KnownSources.Remove(source);
            entry.KnownSources.Add(source);
            if (entry.KnownSources.Count > MaxKnownSources) entry.KnownSources.RemoveAt(0);
            Store(email, entry);
        }
    }

    private Entry Get(string email) => _entries.TryGetValue(email, out Entry? entry) && entry is not null ? entry : new Entry();

    private void Store(string email, Entry entry) =>
        _entries.Set(email, entry, new MemoryCacheEntryOptions
        {
            Size = 1,
            AbsoluteExpirationRelativeToNow = entry.KnownSources.Count > 0 ? KnownFor : Window + MaxLock,
            Priority = entry.KnownSources.Count > 0 ? CacheItemPriority.High : CacheItemPriority.Low,   // sous pression, on oublie d'abord les simples échecs
        });
}
