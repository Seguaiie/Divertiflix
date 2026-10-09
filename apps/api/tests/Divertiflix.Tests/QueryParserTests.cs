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
