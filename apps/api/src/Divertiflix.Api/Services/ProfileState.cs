using Divertiflix.Domain;
using Divertiflix.Domain.Recommendations;
using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Services;

/// <summary>Tout ce que le moteur et l'interface savent d'un profil : reprise, notes, liste.</summary>
public sealed class ProfileState
{
    public required Dictionary<Guid, PlaybackProgress> Progress { get; init; }
    public required Dictionary<Guid, short> Ratings { get; init; }
    public required Dictionary<Guid, DateTime> Watchlist { get; init; }

    public static async Task<ProfileState> LoadAsync(DivertiflixDbContext db, Guid profileId, CancellationToken ct) => new()
    {
        Progress = await db.Progress.AsNoTracking().Where(p => p.ProfileId == profileId).ToDictionaryAsync(p => p.TitleId, ct),
        Ratings = await db.Ratings.AsNoTracking().Where(r => r.ProfileId == profileId).ToDictionaryAsync(r => r.TitleId, r => r.Value, ct),
        Watchlist = await db.Watchlist.AsNoTracking().Where(w => w.ProfileId == profileId).ToDictionaryAsync(w => w.TitleId, w => w.AddedAt, ct),
    };

    public List<Signal> Signals(DateTime now)
    {
        var list = new List<Signal>();
        foreach (var p in Progress.Values)
        {
            // Une lecture à peine entamée il y a moins d'un jour n'est pas encore un abandon.
            if (p.Fraction < 0.1 && now - p.UpdatedAt < TimeSpan.FromDays(1)) continue;
            list.Add(new Signal(p.TitleId, SignalWeights.FromProgress(p.Fraction), p.UpdatedAt));
        }
        foreach (var (id, v) in Ratings) list.Add(new Signal(id, v > 0 ? SignalWeights.ThumbUp : SignalWeights.ThumbDown, now));
        foreach (var (id, at) in Watchlist) list.Add(new Signal(id, SignalWeights.Watchlist, at));
        return list;
    }

    /// <summary>Déjà vus, en cours ou rejetés : jamais proposés dans les recommandations.</summary>
    public HashSet<Guid> Excluded()
    {
        var set = Progress.Values.Where(p => p.Fraction >= 0.02).Select(p => p.TitleId).ToHashSet();
        foreach (var (id, v) in Ratings) if (v < 0) set.Add(id);
        return set;
    }

    public UserContext Context(DateTime now, Guid profileId) => new()
    {
        Signals = Signals(now),
        Excluded = Excluded(),
        Seed = HashCode.Combine(profileId.GetHashCode(), DateOnly.FromDateTime(now).DayNumber) & 0x7fffffff,
    };
}
