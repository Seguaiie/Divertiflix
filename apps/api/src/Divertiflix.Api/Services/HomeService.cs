using Divertiflix.Api.Dtos;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Domain.Recommendations;
using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Services;

/// <summary>Assemble la page d'accueil d'un profil : héros, rangées ordonnées, chacune isolée des autres en cas d'erreur.</summary>
public sealed class HomeService(DivertiflixDbContext db, CatalogCache cache, ILogger<HomeService> logger)
{
    private const int RowSize = 16;

    public async Task<HomeDto> BuildAsync(Guid userId, Guid profileId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var snap = await cache.GetAsync(db, ct);
        var state = await ProfileState.LoadAsync(db, profileId, ct);
        var ctx = state.Context(now, profileId);
        var engine = snap.Engine;
        var hasTaste = engine.HasTaste(ctx);
        var cards = new CardFactory(snap, state);
        var movies = new Constraints { Kinds = new HashSet<TitleKind> { TitleKind.Movie, TitleKind.Series } };

        var rows = new List<RowDto>();
        void Add(string id, Func<RowDto?> build)
        {
            try { if (build() is { } r && (r.Items.Count > 0 || r.Requests is { Count: > 0 })) rows.Add(r); }
            catch (Exception ex) { logger.LogWarning(ex, "Rangée {Row} ignorée.", id); }
        }

        // Reprise : lectures entamées, les plus récentes d'abord.
        var resume = state.Progress.Values
            .Where(p => p.Fraction is >= 0.02 and < 0.92 && snap.ById.TryGetValue(p.TitleId, out var t) && t.IsPlayable)
            .OrderByDescending(p => p.UpdatedAt).Take(RowSize).ToList();
        Add("continue", () => new RowDto("continue", "continue", null, null, resume.Select(p => cards.Make(p.TitleId)).ToList()));

        Add("watchlist", () => new RowDto("watchlist", "watchlist", null, null,
            state.Watchlist.OrderByDescending(w => w.Value).Where(w => snap.ById.ContainsKey(w.Key)).Take(RowSize).Select(w => cards.Make(w.Key)).ToList()));

        var forYou = engine.Recommend(ctx, RowSize, movies);
        Add("for-you", () => new RowDto("for-you", "forYou", null, null, forYou.Select(cards.Make).ToList()));

        // « Parce que vous avez regardé X » : voisins de contenu des deux derniers titres appréciés.
        var seeds = state.Progress.Values.Where(p => p.Fraction >= 0.8 && snap.ById.ContainsKey(p.TitleId)).OrderByDescending(p => p.UpdatedAt)
            .Select(p => p.TitleId).Concat(state.Ratings.Where(r => r.Value > 0).Select(r => r.Key)).Distinct().Take(2).ToList();
        foreach (var seed in seeds)
            Add($"because-{seed}", () => new RowDto($"because-{seed}", "because", snap.ById[seed].Name, seed,
                engine.Similar(seed, RowSize, movies, ctx.Excluded).Select(cards.Make).ToList()));

        Add("trending", () => new RowDto("trending", "trending", null, null, engine.Trending(RowSize, movies).Select(cards.Make).ToList()));

        Add("recent", () => new RowDto("recent", "recent", null, null,
            snap.Titles.Where(t => t.IsPlayable && t.Kind != TitleKind.Audiobook).OrderByDescending(t => t.AddedAt).ThenBy(t => t.Name).Take(RowSize)
                .Select(t => cards.Make(t.Id, new Reason(ReasonType.Fresh))).ToList()));

        // Genres : d'abord ceux que le profil aime, puis les plus fournis.
        var affinity = engine.GenreAffinity(ctx);
        var genres = snap.Titles.Where(t => t.IsPlayable && t.Kind != TitleKind.Audiobook).GroupBy(t => t.Genre).Where(g => g.Count() >= 4)
            .OrderByDescending(g => affinity.GetValueOrDefault(g.Key)).ThenByDescending(g => g.Count()).ThenBy(g => g.Key)
            .Take(3).Select(g => g.Key).ToList();
        foreach (var genre in genres)
            Add($"genre-{Text.Normalize(genre).Replace(' ', '-')}", () => new RowDto($"genre-{Text.Normalize(genre).Replace(' ', '-')}", "genre", genre, null,
                engine.Search(new QuerySpec { BoostGenres = [genre], Constraints = movies }, ctx, RowSize).Select(cards.Make).ToList()));

        Add("audiobooks", () => new RowDto("audiobooks", "audiobooks", null, null,
            engine.Recommend(ctx, RowSize, new Constraints { Kinds = new HashSet<TitleKind> { TitleKind.Audiobook } }).Select(cards.Make).ToList()));

        // Demandes récentes de la communauté (sans le nom des demandeurs).
        RowDto? requestsRow = null;
        try
        {
            var recent = await db.Requests.AsNoTracking().Where(r => r.Status != RequestStatus.Declined)
                .OrderByDescending(r => r.UpdatedAt).Take(12).ToListAsync(ct);
            var mine = await db.Profiles.AsNoTracking().Where(p => p.Id == profileId).Select(p => p.UserId).FirstAsync(ct);
            requestsRow = new RowDto("requests", "requests", null, null, [],
                recent.Select(r => new RequestCardDto(r.Id, r.Name, r.Kind, r.Year, r.Status, r.UpdatedAt, r.UserId == mine, r.TitleId)).ToList());
        }
        catch (Exception ex) { logger.LogWarning(ex, "Rangée des demandes ignorée."); }
        if (requestsRow is { Requests.Count: > 0 }) rows.Add(requestsRow);

        // Héros : reprise en tête, puis les meilleures recommandations qui ont un visuel.
        var hero = new List<HeroDto>();
        var seen = new HashSet<Guid>();
        if (resume.FirstOrDefault() is { } first) { hero.Add(new HeroDto(cards.Make(first.TitleId), "continue")); seen.Add(first.TitleId); }
        var mode = hasTaste ? "recommended" : "featured";
        foreach (var s in forYou.OrderByDescending(s => snap.ById[s.Item.Id].BackdropUrl is not null).ThenByDescending(s => s.Score))
        {
            if (hero.Count >= 5) break;
            if (seen.Add(s.Item.Id)) hero.Add(new HeroDto(cards.Make(s), mode));
        }

        return new HomeDto(hero, rows, now, hasTaste);
    }

    public async Task<TitleDetailDto?> DetailAsync(Guid userId, Guid profileId, Guid titleId, CancellationToken ct)
    {
        var snap = await cache.GetAsync(db, ct);
        if (!snap.ById.ContainsKey(titleId)) return null;
        var state = await ProfileState.LoadAsync(db, profileId, ct);
        var ctx = state.Context(DateTime.UtcNow, profileId);
        var cards = new CardFactory(snap, state);

        // Raison personnalisée pour ce titre : le moteur l'explique via une recommandation ciblée.
        var scored = snap.Engine.Recommend(ctx, 200, new Constraints { PlayableOnly = false }).FirstOrDefault(s => s.Item.Id == titleId);
        var similar = snap.Engine.Similar(titleId, 12, new Constraints()).Select(cards.Make).ToList();

        var req = await db.Requests.AsNoTracking().Where(r => r.TitleId == titleId && r.Status != RequestStatus.Declined)
            .OrderByDescending(r => r.UpdatedAt).FirstOrDefaultAsync(ct);
        var owner = await db.Profiles.AsNoTracking().Where(p => p.Id == profileId).Select(p => p.UserId).FirstAsync(ct);
        var reqDto = req is null ? null : new RequestCardDto(req.Id, req.Name, req.Kind, req.Year, req.Status, req.UpdatedAt, req.UserId == owner, req.TitleId);
        return new TitleDetailDto(scored is not null ? cards.Make(scored) : cards.Make(titleId), similar, reqDto);
    }

    /// <summary>Transforme les résultats du moteur en cartes enrichies de l'état du profil.</summary>
    public sealed class CardFactory(CatalogSnapshot snap, ProfileState state)
    {
        public CardDto Make(Scored s) => Build(snap.ById[s.Item.Id], s.Reason, s.Match);
        public CardDto Make(Guid id, Reason? reason = null) => Build(snap.ById[id], reason, 0);

        private CardDto Build(Title t, Reason? reason, int match)
        {
            ProgressDto? progress = state.Progress.TryGetValue(t.Id, out var p) && p.Fraction >= 0.02
                ? new ProgressDto(p.PositionSeconds, p.DurationSeconds, Math.Round(p.Fraction, 4), p.UpdatedAt) : null;
            return new CardDto(TitleMapper.ToDto(t), progress, state.Watchlist.ContainsKey(t.Id),
                state.Ratings.TryGetValue(t.Id, out var r) ? r : 0, reason is null ? null : ToDto(reason), match);
        }

        public static ReasonDto ToDto(Reason r) => new(
            char.ToLowerInvariant(r.Type.ToString()[0]) + r.Type.ToString()[1..], r.TitleId, r.TitleName, r.Genre, r.Tags);
    }
}
