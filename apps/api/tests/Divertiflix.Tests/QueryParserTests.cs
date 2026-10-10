using Divertiflix.Domain;
using Divertiflix.Domain.Recommendations;

namespace Divertiflix.Tests;

public class QueryParserTests
{
    private static readonly DateTime Now = new(2026, 10, 9, 12, 0, 0, DateTimeKind.Utc);

    private static CatalogItem Item(string name, string genre, string[] kw, int minutes, int year = 2020, TitleKind kind = TitleKind.Movie) =>
        new(Guid.NewGuid(), name, kind, genre, kw, "", year, minutes, Now, true);

    private static readonly CatalogItem Sintel = Item("Sintel", "Fantastique", ["épique", "voyage", "créature"], 15, 2010);
    private static readonly QueryParser Parser = new(
    [
        Sintel,
        Item("Peur", "Horreur", ["nuit", "gore", "sombre", "tension"], 5), Item("Peur douce", "Horreur", ["nuit", "fantôme", "sombre"], 4),
        Item("Rire", "Comédie", ["humour", "absurde", "réconfortant"], 3), Item("Marée", "Drame", ["mer", "mémoire", "contemplatif", "pluie"], 20),
        Item("Orbite", "Science-fiction", ["espace", "futur", "solitude"], 6, 2023), Item("Long", "Drame", ["famille"], 90, 1975),
        Item("Livre", "Poésie", ["poésie"], 2, 1857, TitleKind.Audiobook),
    ], Now);

    [Fact]
    public void The_example_from_the_specification_is_understood()
    {
        var p = Parser.Parse("un film d'horreur pas trop gore, court, comme Hereditary mais plus léger");
        Assert.Equal(Intent.Recommend, p.Intent);
        Assert.Contains("Horreur", p.Spec.BoostGenres);
        Assert.Contains("gore", p.Spec.AvoidTags);             // "pas trop" : pénalité douce, pas exclusion
        Assert.Null(p.Spec.Constraints.ExcludeKeywords);
        Assert.NotNull(p.Spec.Constraints.MaxMinutes);          // "court"
        Assert.Equal("hereditary", p.UnknownTitle);             // reconnu comme titre absent du catalogue, pas inventé
        Assert.Contains(p.Spec.BoostTags, t => t is "humour" or "réconfortant");   // "léger"
        Assert.Contains(p.Chips, c => c.Kind == "avoid" && c.Label == "gore");
    }

    [Theory]
    [InlineData("sans gore svp")]
    [InlineData("pas de gore")]
    [InlineData("no gore")]
    [InlineData("without gore")]
    public void Hard_negation_excludes_the_keyword(string msg)
    {
        var p = Parser.Parse(msg);
        Assert.Contains("gore", p.Spec.Constraints.ExcludeKeywords!);
    }

    [Theory]
    [InlineData("pas d'horreur")]
    [InlineData("sans horreur")]
    [InlineData("no horror")]
    public void Negated_genre_is_excluded(string msg) =>
        Assert.Contains("horreur", Parser.Parse(msg).Spec.Constraints.ExcludeGenres!);

    [Theory]
    [InlineData("de la science fiction", "Science-fiction")]
    [InlineData("une sf", "Science-fiction")]
    [InlineData("un truc qui fait peur", "Horreur")]
    [InlineData("something scary", "Horreur")]
    [InlineData("une comedie", "Comédie")]
    [InlineData("a drama", "Drame")]
    public void Genre_synonyms_resolve_to_catalog_genres(string msg, string genre) =>
        Assert.Contains(genre, Parser.Parse(msg).Spec.BoostGenres);

    [Theory]
    [InlineData("moins de 10 min", 10)]
    [InlineData("under 10 minutes", 10)]
    [InlineData("max 1h30", 90)]
    [InlineData("moins de 2 heures", 120)]
    [InlineData("5 minutes max", 5)]
    public void Durations_are_parsed(string msg, int minutes) =>
        Assert.Equal(minutes, Parser.Parse(msg).Spec.Constraints.MaxMinutes);

    [Fact]
    public void Short_and_long_are_relative_to_the_catalog()
    {
        var s = Parser.Parse("quelque chose de court ce soir");
        Assert.Equal(Parser.ShortMax, s.Spec.Constraints.MaxMinutes);
        Assert.Equal(Intent.Recommend, s.Intent);
        Assert.NotNull(Parser.Parse("un film long").Spec.Constraints.MinMinutes);
    }

    [Theory]
    [InlineData("1h30 max", 90)]
    [InlineData("2h max", 120)]
    [InlineData("2 heures maximum", 120)]
    [InlineData("90 min max", 90)]
    [InlineData("a film of 1h30 max", 90)]
    public void Duration_ceiling_can_come_after_the_number(string msg, int minutes) =>
        Assert.Equal(minutes, Parser.Parse(msg).Spec.Constraints.MaxMinutes);

    [Theory]
    [InlineData("pas trop long")]
    [InlineData("not too long")]
    [InlineData("pas long")]
    [InlineData("une comédie qui ne soit pas trop longue")]
    public void Negated_long_caps_the_duration_below_the_long_threshold(string msg)
    {
        var p = Parser.Parse(msg);
        Assert.Equal(Parser.LongMin - 1, p.Spec.Constraints.MaxMinutes);
        Assert.Null(p.Spec.Constraints.MinMinutes);
        Assert.DoesNotContain(p.Chips, c => c.Kind == "long");
        Assert.Contains(p.Chips, c => c.Kind == "maxMinutes" && c.Label == (Parser.LongMin - 1).ToString());
    }

    [Theory]
    [InlineData("un film pas trop court")]
    [InlineData("not too short")]
    [InlineData("pas court")]
    public void Negated_short_floors_the_duration_above_the_short_threshold(string msg)
    {
        var p = Parser.Parse(msg);
        Assert.Equal(Parser.ShortMax + 1, p.Spec.Constraints.MinMinutes);
        Assert.Null(p.Spec.Constraints.MaxMinutes);
        Assert.DoesNotContain(p.Chips, c => c.Kind == "short");
    }

    [Theory]
    [InlineData("pas récent")]
    [InlineData("not recent")]
    public void Negated_recent_means_before_the_recent_years(string msg)
    {
        var c = Parser.Parse(msg).Spec.Constraints;
        Assert.Equal(Now.Year - 4, c.YearTo);
        Assert.Null(c.YearFrom);
    }

    [Theory]
    [InlineData("pas classique")]
    [InlineData("no old movies")]
    public void Negated_classic_means_from_2000(string msg)
    {
        var c = Parser.Parse(msg).Spec.Constraints;
        Assert.Equal(2000, c.YearFrom);
        Assert.Null(c.YearTo);
    }

    [Fact]
    public void Plain_long_short_recent_and_classic_are_unchanged()
    {
        Assert.Equal(Parser.LongMin, Parser.Parse("un film long").Spec.Constraints.MinMinutes);
        Assert.Equal(Parser.ShortMax, Parser.Parse("un film court").Spec.Constraints.MaxMinutes);
        Assert.Equal(Now.Year - 3, Parser.Parse("un film récent").Spec.Constraints.YearFrom);
        Assert.Equal(1999, Parser.Parse("un classique").Spec.Constraints.YearTo);
    }

    [Theory]
    [InlineData("pas de série", new[] { TitleKind.Movie, TitleKind.Audiobook })]
    [InlineData("no movies please", new[] { TitleKind.Series, TitleKind.Audiobook })]
    [InlineData("sans livre audio", new[] { TitleKind.Movie, TitleKind.Series })]
    [InlineData("ni film ni série", new[] { TitleKind.Audiobook })]
    [InlineData("des films mais pas de série", new[] { TitleKind.Movie })]
    public void Negated_content_type_keeps_the_other_types(string msg, TitleKind[] expected)
    {
        var p = Parser.Parse(msg);
        Assert.Equal(expected.OrderBy(k => k), p.Spec.Constraints.Kinds!.OrderBy(k => k));
        Assert.Equal(Intent.Recommend, p.Intent);
        // Les puces annoncent les types réellement cherchés, jamais le type écarté.
        Assert.Equal(expected.Select(k => k.ToString()).Order(), p.Chips.Where(c => c.Kind == "kind").Select(c => c.Label).Order());
    }

    [Theory]
    [InlineData("pas de série ce soir", new[] { TitleKind.Movie, TitleKind.Audiobook })]
    [InlineData("pas de série s'il vous plaît", new[] { TitleKind.Movie, TitleKind.Audiobook })]
    [InlineData("pas de série mais un film", new[] { TitleKind.Movie })]
    public void Negated_content_type_ends_the_clause(string msg, TitleKind[] expected) =>
        Assert.Equal(expected.OrderBy(k => k), Parser.Parse(msg).Spec.Constraints.Kinds!.OrderBy(k => k));

    [Theory]
    [InlineData("pas de film d'horreur")]
    [InlineData("pas de film triste")]
    public void A_content_type_followed_by_a_qualifier_is_not_a_negated_type(string msg)
    {
        // Le qualificatif nie un genre ou une ambiance ; le type, lui, reste demandé.
        var p = Parser.Parse(msg);
        Assert.Equal([TitleKind.Movie], p.Spec.Constraints.Kinds!);
    }

    [Fact]
    public void Horror_films_are_excluded_as_a_genre_not_as_a_type()
    {
        var p = Parser.Parse("pas de film d'horreur");
        Assert.Contains("horreur", p.Spec.Constraints.ExcludeGenres!);
    }

    [Theory]
    [InlineData("show me something funny")]
    [InlineData("show me a funny one")]
    public void Show_alone_is_not_a_request_for_series(string msg) =>
        Assert.Null(Parser.Parse(msg).Spec.Constraints.Kinds);

    [Fact]
    public void Show_me_a_scary_movie_asks_for_movies_only()
    {
        var p = Parser.Parse("show me a scary movie");
        Assert.Equal([TitleKind.Movie], p.Spec.Constraints.Kinds!);
        Assert.Contains("Horreur", p.Spec.BoostGenres);
        Assert.DoesNotContain(p.Chips, c => c.Kind == "kind" && c.Label == "Series");
    }

    [Theory]
    [InlineData("une série")]
    [InlineData("a tv show")]
    [InlineData("some tv shows")]
    [InlineData("des épisodes")]
    public void Series_are_still_recognized(string msg) =>
        Assert.Contains(TitleKind.Series, Parser.Parse(msg).Spec.Constraints.Kinds!);

    [Theory]
    [InlineData("des films des années 80", 1980, 1989)]
    [InlineData("annees 2010", 2010, 2019)]
    [InlineData("avant 2000", null, 1999)]
    [InlineData("apres 2015", 2016, null)]
    [InlineData("depuis 2020", 2020, null)]
    public void Years_and_decades_are_parsed(string msg, int? from, int? to)
    {
        var c = Parser.Parse(msg).Spec.Constraints;
        Assert.Equal(from, c.YearFrom);
        Assert.Equal(to, c.YearTo);
    }

    [Fact]
    public void Reference_to_a_catalog_title_becomes_a_similarity_query()
    {
        var p = Parser.Parse("j'ai adoré Sintel, quelque chose de semblable");
        Assert.Equal(Intent.Similar, p.Intent);
        Assert.Equal(Sintel.Id, p.Spec.SimilarTo);
        Assert.Contains(p.Chips, c => c.Kind == "similar" && c.Label == "Sintel");
    }

    [Theory]
    [InlineData("surprends-moi")]
    [InlineData("Surprise me")]
    [InlineData("au hasard")]
    public void Surprise_is_detected(string msg) => Assert.Equal(Intent.Surprise, Parser.Parse(msg).Intent);

    [Theory]
    [InlineData("réconfortant", "réconfortant")]
    [InlineData("quelque chose de sombre", "sombre")]
    [InlineData("film de pluie contemplatif", "pluie")]
    [InlineData("a rainy mood", "pluie")]
    public void Moods_expand_to_catalog_keywords(string msg, string tag) =>
        Assert.Contains(tag, Parser.Parse(msg).Spec.BoostTags);

    [Fact]
    public void Content_type_is_detected()
    {
        Assert.Contains(TitleKind.Audiobook, Parser.Parse("un livre audio de poésie").Spec.Constraints.Kinds!);
        Assert.Contains(TitleKind.Movie, Parser.Parse("un court métrage").Spec.Constraints.Kinds!);
    }

    [Theory]
    [InlineData("")]
    [InlineData("bonjour")]
    [InlineData("salut, tu peux m'aider ?")]
    public void Greetings_and_empty_input_are_help(string msg) => Assert.Equal(Intent.Help, Parser.Parse(msg).Intent);

    [Fact]
    public void Unknown_words_never_become_catalog_facts()
    {
        var p = Parser.Parse("zxqvbn");
        Assert.Empty(p.Spec.BoostGenres);
        Assert.Empty(p.Spec.BoostTags);
    }
}
