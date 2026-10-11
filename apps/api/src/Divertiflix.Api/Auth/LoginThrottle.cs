using System.Collections.Concurrent;

namespace Divertiflix.Api.Auth;

/// <summary>
/// Compteur d'échecs de connexion par courriel, en mémoire (la limitation de débit par adresse ne voit pas un attaquant qui tourne
/// sur beaucoup d'adresses). À partir de 5 échecs dans une fenêtre de 15 minutes, le courriel est verrouillé 30 s, puis 1, 2, 4 min,
/// jamais plus de 5 min ; les tentatives faites pendant un verrouillage ne le prolongent pas.
/// La tentative est réservée (<see cref="Begin"/>) AVANT de vérifier le mot de passe : les tentatives en cours comptent comme des échecs
/// possibles, donc une rafale simultanée ne fait jamais vérifier plus de 5 mots de passe (une seule vérification à la fois après un verrou).
/// Un verrou par courriel permettrait à n'importe qui d'empêcher l'administrateur de se connecter en continu : il ne vaut donc que pour
/// les sources (adresse IPv4 ou /64) dont aucune connexion réussie n'est connue pour ce compte. Le propriétaire reste libre d'entrer
/// depuis ses lieux habituels (ses propres échecs comptent, ses tentatives ne sont pas bloquées).
/// Le courriel est compté qu'il existe ou non : la réponse ne révèle rien sur l'existence du compte. État perdu au redémarrage.
/// </summary>
public sealed class LoginThrottle(TimeProvider clock)
{
    public const int Threshold = 5;
    /// <summary>Nombre de courriels retenus : une inondation de courriels inventés ne grossit pas la mémoire (les plus anciens sont oubliés).</summary>
    public const int MaxEmails = 50_000;
    private const int MaxKnownSources = 8;
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(15), FirstLock = TimeSpan.FromSeconds(30), MaxLock = TimeSpan.FromMinutes(5), KnownFor = TimeSpan.FromDays(30), BusyWait = TimeSpan.FromSeconds(1);

    // Un seul objet par courriel : tout se joue sous son verrou (lock), jamais sur une copie.
    private sealed class Entry
    {
        public readonly List<DateTimeOffset> Failures = [];
        public readonly List<string> KnownSources = [];
        public DateTimeOffset LockedUntil, KnownAt, Touched;
        public int InFlight;      // tentatives réservées dont le mot de passe n'est pas encore jugé
        public bool Evicted;      // retiré par le nettoyage : à ne plus utiliser
    }

    private readonly ConcurrentDictionary<string, Entry> _entries = new();
    private int _trimming;

    /// <summary>
    /// Réserve une tentative de connexion. Null (avec le délai conseillé) si cette source doit patienter : courriel verrouillé, ou assez
    /// de tentatives déjà en cours pour atteindre le seuil. Sinon, le résultat se déclare par <see cref="Attempt.Failed"/> ou
    /// <see cref="Attempt.Succeeded"/> ; une tentative simplement disposée (erreur avant le jugement) est libérée sans compter d'échec.
    /// </summary>
    public Attempt? Begin(string email, string source, out TimeSpan wait)
    {
        while (true)
        {
            var entry = EntryOf(email);
            lock (entry)
            {
                if (entry.Evicted) continue;   // retiré à l'instant par le nettoyage : on repart sur un objet neuf
                var now = clock.GetUtcNow();
                Prune(entry, now);
                entry.Touched = now;
                if (!entry.KnownSources.Contains(source))
                {
                    wait = entry.LockedUntil - now;
                    if (wait > TimeSpan.Zero) return null;
                    // Les tentatives en cours sont des échecs possibles : on n'en laisse pas plus que ce qu'il reste avant le seuil (une seule après un verrou).
                    wait = BusyWait;
                    if (entry.InFlight >= Math.Max(1, Threshold - entry.Failures.Count)) return null;
                }
                entry.InFlight++;
                wait = default;
                return new Attempt(this, email, source);
            }
        }
    }

    /// <summary>Une tentative réservée. À disposer (using) : sans verdict, elle est libérée et ne compte pas comme un échec.</summary>
    public sealed class Attempt : IDisposable
    {
        private readonly LoginThrottle _owner;
        private readonly string _email, _source;
        private int _done;

        internal Attempt(LoginThrottle owner, string email, string source) => (_owner, _email, _source) = (owner, email, source);

        public void Failed() => Finish(false);

        /// <summary>Connexion réussie : les échecs sont oubliés et la source devient connue pour ce compte.</summary>
        public void Succeeded() => Finish(true);

        public void Dispose() => Finish(null);

        private void Finish(bool? success)
        {
            if (Interlocked.Exchange(ref _done, 1) == 0) _owner.Finish(_email, _source, success);
        }
    }

    private void Finish(string email, string source, bool? success)
    {
        var entry = _entries[email];   // une tentative en cours empêche l'éviction : l'objet est toujours là
        lock (entry)
        {
            var now = clock.GetUtcNow();
            entry.InFlight--;
            entry.Touched = now;
            Prune(entry, now);
            if (success is true)
            {
                entry.Failures.Clear();
                entry.LockedUntil = default;
                entry.KnownSources.Remove(source);
                entry.KnownSources.Add(source);
                if (entry.KnownSources.Count > MaxKnownSources) entry.KnownSources.RemoveAt(0);
                entry.KnownAt = now;
            }
            else if (success is false && entry.LockedUntil <= now)   // verrou posé entre-temps : cet essai ne le prolonge pas
            {
                entry.Failures.Add(now);
                if (entry.Failures.Count >= Threshold)
                    entry.LockedUntil = now + TimeSpan.FromTicks(Math.Min(FirstLock.Ticks << Math.Min(entry.Failures.Count - Threshold, 10), MaxLock.Ticks));
            }
        }
    }

    // Oublie ce qui a dépassé sa durée : échecs hors fenêtre, sources connues depuis plus de 30 jours.
    private static void Prune(Entry entry, DateTimeOffset now)
    {
        entry.Failures.RemoveAll(t => now - t >= Window);
        if (now - entry.KnownAt >= KnownFor) entry.KnownSources.Clear();
    }

    private Entry EntryOf(string email)
    {
        if (_entries.TryGetValue(email, out var known)) return known;
        var entry = _entries.GetOrAdd(email, static _ => new Entry());   // un seul objet par courriel, même si dix appels arrivent ensemble
        if (_entries.Count > MaxEmails) Trim();
        return entry;
    }

    /// <summary>
    /// Plein : on retire d'abord les courriels sans objet (plus d'échec ni de source connue), puis les moins récemment touchés jusqu'à 90 % de
    /// la borne, les simples échecs avant les sources connues. Une tentative en cours n'est jamais retirée. Les écritures ne sont donc jamais ignorées.
    /// </summary>
    private void Trim()
    {
        if (Interlocked.Exchange(ref _trimming, 1) == 1) return;   // un seul nettoyage à la fois
        try
        {
            var now = clock.GetUtcNow();
            var kept = new List<(string Key, Entry Entry, bool Known, DateTimeOffset Touched)>();
            foreach (var (key, entry) in _entries)
                lock (entry)
                {
                    Prune(entry, now);
                    if (entry.InFlight > 0) continue;
                    if (entry.Failures.Count == 0 && entry.KnownSources.Count == 0) Evict(key, entry);
                    else kept.Add((key, entry, entry.KnownSources.Count > 0, entry.Touched));
                }
            var excess = _entries.Count - MaxEmails / 10 * 9;
            foreach (var (key, entry, _, _) in kept.OrderBy(k => k.Known).ThenBy(k => k.Touched).Take(Math.Max(excess, 0)))
                lock (entry)
                    if (entry.InFlight == 0) Evict(key, entry);
        }
        finally { Volatile.Write(ref _trimming, 0); }
    }

    private void Evict(string key, Entry entry)
    {
        entry.Evicted = true;
        _entries.TryRemove(new KeyValuePair<string, Entry>(key, entry));
    }
}
