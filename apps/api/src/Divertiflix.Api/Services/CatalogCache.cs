using Divertiflix.Domain;
using Divertiflix.Domain.Recommendations;
using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Services;

public sealed record CatalogSnapshot(IReadOnlyList<Title> Titles, IReadOnlyDictionary<Guid, Title> ById, RecommendationEngine Engine, QueryParser Parser);

/// <summary>
/// Catalogue + moteur de recommandation en mémoire (singleton). Reconstruit après 30 s ou dès qu'un titre change :
/// l'activité communautaire (tendances, co-occurrences) peut ainsi être légèrement en retard, jamais le catalogue.
/// </summary>
public sealed class CatalogCache
{
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(30);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private CatalogSnapshot? _snap;
    private DateTime _builtAt;
    private volatile bool _dirty = true;

    public void Invalidate() => _dirty = true;

    public async Task<CatalogSnapshot> GetAsync(DivertiflixDbContext db, CancellationToken ct = default)
    {
        if (!_dirty && _snap is not null && DateTime.UtcNow - _builtAt < Ttl) return _snap;
        await _gate.WaitAsync(ct);
        try
        {
            if (!_dirty && _snap is not null && DateTime.UtcNow - _builtAt < Ttl) return _snap;
            _dirty = false;   // avant la construction : une invalidation pendant celle-ci provoquera une reconstruction
            _snap = await BuildAsync(db, ct);
            _builtAt = DateTime.UtcNow;
            return _snap;
        }
        finally { _gate.Release(); }
    }

    private static async Task<CatalogSnapshot> BuildAsync(DivertiflixDbContext db, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var titles = await db.Titles.AsNoTracking().ToListAsync(ct);
        var progress = await db.Progress.AsNoTracking().Select(p => new { p.ProfileId, p.TitleId, p.PositionSeconds, p.DurationSeconds, p.UpdatedAt }).ToListAsync(ct);
        var ratings = await db.Ratings.AsNoTracking().Select(r => new { r.ProfileId, r.TitleId, r.Value }).ToListAsync(ct);
        var watch = await db.Watchlist.AsNoTracking().Select(w => new { w.ProfileId, w.TitleId }).ToListAsync(ct);

        double Frac(int pos, int dur) => dur <= 0 ? 0 : Math.Clamp((double)pos / dur, 0, 1);
        var since = now.AddDays(-14);
        var trending = progress.Where(p => p.UpdatedAt >= since && Frac(p.PositionSeconds, p.DurationSeconds) >= 0.1)
            .GroupBy(p => p.TitleId).ToDictionary(g => g.Key, g => g.Select(p => p.ProfileId).Distinct().Count());

        var interactions = new List<Interaction>();
        interactions.AddRange(progress.Select(p => new Interaction(p.ProfileId, p.TitleId, SignalWeights.FromProgress(Frac(p.PositionSeconds, p.DurationSeconds)))));
        interactions.AddRange(ratings.Select(r => new Interaction(r.ProfileId, r.TitleId, r.Value > 0 ? SignalWeights.ThumbUp : SignalWeights.ThumbDown)));
        interactions.AddRange(watch.Select(w => new Interaction(w.ProfileId, w.TitleId, SignalWeights.Watchlist)));

        var engine = new RecommendationEngine(titles.Select(CatalogItem.From), new Community { Trending = trending, Interactions = interactions }, now);
        return new CatalogSnapshot(titles, titles.ToDictionary(t => t.Id), engine, new QueryParser(engine.Items, now));
    }
}
