namespace Divertiflix.Domain.Recommendations;

/// <summary>Vue minimale d'un titre pour le moteur : aucune dépendance à EF, testable en mémoire.</summary>
public sealed record CatalogItem(
    Guid Id, string Name, TitleKind Kind, string Genre, IReadOnlyList<string> Keywords, string Synopsis,
    int Year, int DurationMinutes, DateTime AddedAt, bool Playable, string? Maturity = null, double? Rating = null)
{
    public static CatalogItem From(Title t) =>
        new(t.Id, t.Name, t.Kind, t.Genre, t.Keywords, t.Synopsis, t.Year, t.DurationMinutes, t.AddedAt, t.IsPlayable, t.Maturity, t.Rating);
}

/// <summary>Un signal de goût d'un profil pour un titre. Le poids vient de <see cref="SignalWeights"/>.</summary>
public sealed record Signal(Guid TitleId, double Weight, DateTime At);

/// <summary>Poids des signaux implicites et explicites (valeurs de la spécification, section 5.2).</summary>
public static class SignalWeights
{
    public const double ThumbUp = 1.5;
    public const double ThumbDown = -2.0;
    public const double Watchlist = 0.6;

    /// <summary>Lecture terminée (>= 80 %) +1,0 ; entamée (30 à 80 %) +0,4 ; abandon (&lt; 10 %) -0,3 ; entre les deux, un léger intérêt.</summary>
    public static double FromProgress(double fraction) => fraction switch
    {
        >= 0.8 => 1.0,
        >= 0.3 => 0.4,
        >= 0.1 => 0.1,
        _ => -0.3,
    };
}

/// <summary>Interaction d'un profil, utilisée pour le filtrage collaboratif item-item.</summary>
public readonly record struct Interaction(Guid ProfileId, Guid TitleId, double Weight);

/// <summary>Activité agrégée de toute la communauté, anonymisée : tendance et co-occurrences.</summary>
public sealed class Community
{
    /// <summary>Nombre de profils distincts ayant lu le titre récemment.</summary>
    public IReadOnlyDictionary<Guid, int> Trending { get; init; } = new Dictionary<Guid, int>();
    public IReadOnlyList<Interaction> Interactions { get; init; } = [];
}

public sealed class UserContext
{
    public IReadOnlyList<Signal> Signals { get; init; } = [];
    /// <summary>Titres déjà vus ou en cours : jamais recommandés.</summary>
    public IReadOnlySet<Guid> Excluded { get; init; } = new HashSet<Guid>();
    /// <summary>Graine déterministe (profil + jour) pour l'exploration : stable sur une journée.</summary>
    public int Seed { get; init; }
}

public sealed record Constraints
{
    public int? MaxMinutes { get; init; }
    public int? MinMinutes { get; init; }
    public int? YearFrom { get; init; }
    public int? YearTo { get; init; }
    public IReadOnlySet<TitleKind>? Kinds { get; init; }
    public IReadOnlySet<string>? ExcludeGenres { get; init; }
    public IReadOnlySet<string>? ExcludeKeywords { get; init; }
    public bool PlayableOnly { get; init; } = true;

    public bool Allows(CatalogItem i)
    {
        if (PlayableOnly && !i.Playable) return false;
        if (Kinds is { Count: > 0 } && !Kinds.Contains(i.Kind)) return false;
        if (MaxMinutes is { } max && i.DurationMinutes > max) return false;
        if (MinMinutes is { } min && i.DurationMinutes < min) return false;
        if (YearFrom is { } y0 && i.Year < y0) return false;
        if (YearTo is { } y1 && i.Year > y1) return false;
        if (ExcludeGenres is { Count: > 0 } && ExcludeGenres.Contains(Text.Normalize(i.Genre))) return false;
        if (ExcludeKeywords is { Count: > 0 } && i.Keywords.Any(k => ExcludeKeywords.Contains(Text.Normalize(k)))) return false;
        return true;
    }
}

public enum ReasonType
{
    /// <summary>Proche d'un titre que le profil a aimé ou regardé (Titre = ce titre).</summary>
    SimilarTo,
    /// <summary>Genre apprécié du profil.</summary>
    GenreAffinity,
    /// <summary>Regardé par d'autres profils récemment.</summary>
    Trending,
    /// <summary>Ajout récent au catalogue.</summary>
    Fresh,
    /// <summary>Bien noté, sans historique pour personnaliser.</summary>
    Popular,
    /// <summary>Apprécié par des profils aux goûts proches.</summary>
    Community,
    /// <summary>Hors des habitudes, proposé pour élargir les horizons.</summary>
    Explore,
    /// <summary>Correspond aux critères demandés (Tags = critères reconnus).</summary>
    Matches,
    /// <summary>Choix aléatoire contrôlé du mode « surprends-moi ».</summary>
    Surprise,
}

public sealed record Reason(ReasonType Type, Guid? TitleId = null, string? TitleName = null, string? Genre = null, IReadOnlyList<string>? Tags = null);

public sealed record Scored(CatalogItem Item, double Score, Reason Reason, int Match);
