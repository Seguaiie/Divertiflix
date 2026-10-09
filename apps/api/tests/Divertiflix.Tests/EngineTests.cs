using Divertiflix.Domain;
using Divertiflix.Domain.Recommendations;

namespace Divertiflix.Tests;

/// <summary>Moteur pur, sans base de données : jeu de données fixe et déterministe.</summary>
public class EngineTests
{
    private static readonly DateTime Now = new(2026, 10, 9, 12, 0, 0, DateTimeKind.Utc);

    private static CatalogItem Item(string name, string genre, string[] kw, string synopsis = "", int minutes = 10, int year = 2020,
        TitleKind kind = TitleKind.Movie, bool playable = true, double? rating = 7, int ageDays = 100) =>
        new(Guid.NewGuid(), name, kind, genre, kw, synopsis, year, minutes, Now.AddDays(-ageDays), playable, null, rating);

    private static readonly CatalogItem Dune = Item("Dune Station", "Science-fiction", ["espace", "futur", "solitude"], "Un technicien seul dans l'espace.");
    private static readonly CatalogItem Orbit = Item("Orbite", "Science-fiction", ["espace", "solitude", "silence"], "Une station orbitale silencieuse.");
    private static readonly CatalogItem Robot = Item("Robots", "Science-fiction", ["robot", "futur"], "Des robots dansent.");
    private static readonly CatalogItem Funny = Item("Rire", "Comédie", ["humour", "absurde"], "Un gâteau qui s'effondre.");
    private static readonly CatalogItem Funny2 = Item("Rire 2", "Comédie", ["humour", "famille"], "Un mariage mouvementé.");
    private static readonly CatalogItem Scary = Item("Peur", "Horreur", ["nuit", "gore", "sombre"], "Un dîner sanglant.");
    private static readonly CatalogItem Scary2 = Item("Peur douce", "Horreur", ["nuit", "fantôme", "sombre"], "Une radio hantée.");
    private static readonly CatalogItem Drama = Item("Marée", "Drame", ["mer", "mémoire"], "Une femme sur la plage.");
    private static readonly CatalogItem Hidden = Item("Pas encore", "Science-fiction", ["espace"], "Bientôt.", playable: false);

    private static RecommendationEngine Engine(Community? c = null, params CatalogItem[] extra) =>
        new([Dune, Orbit, Robot, Funny, Funny2, Scary, Scary2, Drama, Hidden, .. extra], c, Now);

    private static UserContext Likes(params CatalogItem[] items) => new()
    {
        Signals = [.. items.Select(i => new Signal(i.Id, SignalWeights.FromProgress(1.0), Now.AddDays(-2)))],
        Excluded = new HashSet<Guid>(items.Select(i => i.Id)),
        Seed = 7,
    };

    [Fact]
    public void Text_normalization_handles_accents_ligatures_and_plurals()
    {
        Assert.Equal("l ete des oeufs", Text.Normalize("L'Été des Œufs"));
        Assert.Equal(Text.Stem("sombres"), Text.Stem("sombre"));
        Assert.DoesNotContain("les", Text.Tokens("les hommes de la pluie"));
        Assert.Equal("a%b", Text.EscapeLike("a%b").Replace("\\", ""));
    }

    [Fact]
    public void Cold_start_never_recommends_unplayable_titles_and_explains_honestly()
    {
        var res = Engine().Recommend(new UserContext(), 5);
        Assert.DoesNotContain(res, r => r.Item.Id == Hidden.Id);
        Assert.All(res, r => Assert.True(r.Reason.Type is ReasonType.Popular or ReasonType.Fresh or ReasonType.Trending, r.Reason.Type.ToString()));
        Assert.All(res, r => Assert.Equal(0, r.Match));   // pas de pourcentage sans historique
    }

    [Fact]
    public void Taste_pulls_similar_titles_up_and_explains_with_the_seed_title()
    {
        var res = Engine().Recommend(Likes(Dune), 6);
        Assert.Equal(Orbit.Id, res[0].Item.Id);   // même genre, mêmes mots-clés
        Assert.Equal(ReasonType.SimilarTo, res[0].Reason.Type);
        Assert.Equal("Dune Station", res[0].Reason.TitleName);
        Assert.True(res[0].Match > 60);
        Assert.DoesNotContain(res, r => r.Item.Id == Dune.Id);   // déjà vu : jamais reproposé
    }

    [Fact]
    public void Dislikes_push_similar_titles_down()
    {
        var ctx = new UserContext
        {
            Signals = [new Signal(Dune.Id, SignalWeights.FromProgress(1.0), Now), new Signal(Scary.Id, SignalWeights.ThumbDown, Now)],
            Excluded = new HashSet<Guid> { Dune.Id, Scary.Id },
        };
        var order = Engine().Recommend(ctx, 8).Select(r => r.Item.Name).ToList();
        Assert.True(order.IndexOf("Peur douce") > order.IndexOf("Orbite"), string.Join(",", order));
    }

    [Fact]
    public void Diversity_re_ranking_avoids_a_wall_of_one_genre()
    {
        var res = Engine().Recommend(Likes(Dune), 5);
        Assert.True(res.Select(r => r.Item.Genre).Distinct().Count() >= 2, "MMR doit mélanger les genres");
    }

    [Fact]
    public void Exploration_slot_brings_a_genre_outside_the_top_affinities()
    {
        var many = Enumerable.Range(0, 6).Select(i => Item($"SF {i}", "Science-fiction", ["espace", "futur"], "x", rating: 7)).ToArray();
        var engine = Engine(null, many);
        var res = engine.Recommend(Likes(Dune, Orbit), 8);
        Assert.Contains(res, r => r.Reason.Type == ReasonType.Explore);
        Assert.NotEqual("Science-fiction", res.First(r => r.Reason.Type == ReasonType.Explore).Item.Genre);
    }

    [Fact]
    public void Same_inputs_give_the_same_output_and_the_seed_changes_exploration()
    {
        var a = Engine().Recommend(Likes(Dune), 6).Select(r => r.Item.Id).ToList();
        var b = Engine().Recommend(Likes(Dune), 6).Select(r => r.Item.Id).ToList();
        Assert.Equal(a, b);
    }

    [Fact]
    public void Constraints_are_hard_filters()
    {
        var res = Engine().Recommend(Likes(Dune), 10, new Constraints { ExcludeKeywords = new HashSet<string> { "gore" }, ExcludeGenres = new HashSet<string> { "comedie" } });
        Assert.DoesNotContain(res, r => r.Item.Id == Scary.Id);
        Assert.DoesNotContain(res, r => r.Item.Genre == "Comédie");
        var short5 = Engine(null, Item("Long", "Drame", ["mer"], minutes: 120)).Recommend(new UserContext(), 20, new Constraints { MaxMinutes = 15 });
        Assert.All(short5, r => Assert.True(r.Item.DurationMinutes <= 15));
    }

    [Fact]
    public void Trending_uses_distinct_recent_viewers_and_falls_back_to_ratings()
    {
        var withTrend = Engine(new Community { Trending = new Dictionary<Guid, int> { [Funny.Id] = 4, [Drama.Id] = 1 } });
        var t = withTrend.Trending(5);
        Assert.Equal(Funny.Id, t[0].Item.Id);
        Assert.All(t, x => Assert.Equal(ReasonType.Trending, x.Reason.Type));
        var none = Engine().Trending(3);
        Assert.All(none, x => Assert.Equal(ReasonType.Popular, x.Reason.Type));
    }

    [Fact]
    public void Collaborative_signal_surfaces_titles_liked_by_similar_profiles()
    {
        var p1 = Guid.NewGuid(); var p2 = Guid.NewGuid(); var p3 = Guid.NewGuid();
        var community = new Community
        {
            Interactions = [new(p1, Dune.Id, 1), new(p1, Drama.Id, 1), new(p2, Dune.Id, 1), new(p2, Drama.Id, 1), new(p3, Funny.Id, 1)],
        };
        var res = Engine(community).Recommend(Likes(Dune), 8);
        var drama = res.First(r => r.Item.Id == Drama.Id);
        var funny = res.First(r => r.Item.Id == Funny.Id);
        Assert.True(drama.Score > funny.Score, "Drame est aimé avec Dune par d'autres profils");
    }

    [Fact]
    public void Similar_excludes_the_seed_and_orders_by_closeness()
    {
        var res = Engine().Similar(Dune.Id, 4);
        Assert.DoesNotContain(res, r => r.Item.Id == Dune.Id);
        Assert.Equal(Orbit.Id, res[0].Item.Id);
        Assert.All(res, r => Assert.Equal(ReasonType.SimilarTo, r.Reason.Type));
        Assert.Empty(Engine().Similar(Guid.NewGuid(), 4));
    }

    [Fact]
    public void Genre_affinity_accumulates_positive_signals_only()
    {
        var ctx = new UserContext { Signals = [new Signal(Dune.Id, 1, Now), new Signal(Orbit.Id, 1, Now), new Signal(Scary.Id, -2, Now)] };
        var aff = Engine().GenreAffinity(ctx);
        Assert.True(aff["Science-fiction"] > 1.9);
        Assert.False(aff.ContainsKey("Horreur"));
    }

    [Fact]
    public void Signal_weights_follow_the_specification()
    {
        Assert.Equal(1.0, SignalWeights.FromProgress(0.95));
        Assert.Equal(0.4, SignalWeights.FromProgress(0.5));
        Assert.Equal(-0.3, SignalWeights.FromProgress(0.05));
        Assert.Equal(1.5, SignalWeights.ThumbUp);
        Assert.Equal(-2.0, SignalWeights.ThumbDown);
        Assert.Equal(0.6, SignalWeights.Watchlist);
    }

    [Fact]
    public void Old_signals_weigh_less_than_recent_ones()
    {
        var old = new UserContext { Signals = [new Signal(Dune.Id, 1, Now.AddDays(-400)), new Signal(Funny.Id, 1, Now.AddDays(-1))] };
        var aff = Engine().GenreAffinity(old);
        Assert.True(aff["Comédie"] > aff["Science-fiction"] * 10);
    }
}
