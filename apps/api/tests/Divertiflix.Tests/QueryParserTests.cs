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

    [Theory]
    [InlineData("un film pas trop long hein")]
    [InlineData("un film pas trop long, j'ai sommeil")]
    [InlineData("not too long, something fun")]
    [InlineData("un film pas trop long quand même")]
    [InlineData("un film pas trop long demain je travaille")]
    [InlineData("pas trop long, j'ai deux heures")]
    [InlineData("pas de long métrage")]
    public void Chatter_after_a_read_negation_is_not_free_text(string msg)
    {
        // Un mot libre inconnu viderait la réponse (« nothing ») : après une négation lue, le bavardage est ignoré,
        // comme l'ancienne boucle de négation l'avalait.
        var p = Parser.Parse(msg);
        Assert.Equal("", p.Spec.Text);
        Assert.Equal(Parser.LongMin - 1, p.Spec.Constraints.MaxMinutes);
        Assert.Equal(Intent.Recommend, p.Intent);
    }

    [Theory]
    [InlineData("no new releases", "")]
    [InlineData("old movies, not new ones", "")]
    [InlineData("pas récent du tout", "")]
    public void The_object_of_a_negated_expression_is_not_free_text(string msg, string text) =>
        Assert.Equal(text, Parser.Parse(msg).Spec.Text);

    [Fact]
    public void Words_before_a_negation_and_recognized_criteria_after_it_still_count()
    {
        Assert.Contains("dragons", Parser.Parse("un film sur les dragons pas trop long").Spec.Text);
        var after = Parser.Parse("pas trop long, quelque chose de drôle");
        Assert.Contains("humour", after.Spec.BoostTags);       // « drôle » reste demandé : il suit la négation sans en faire partie
        Assert.Empty(after.Spec.AvoidTags);
        var genre = Parser.Parse("un film de science fiction pas trop long");
        Assert.Contains("Science-fiction", genre.Spec.BoostGenres);
        Assert.Empty(genre.Spec.AvoidGenres);
        // Un mot d'arrêt rend la parole : ce qui suit « mais » est lu normalement.
        Assert.Contains("zxqvbn", Parser.Parse("un film pas trop long mais zxqvbn").Spec.Text);
    }

    [Theory]
    [InlineData("un long métrage")]
    public void Feature_film_wording_is_not_free_text(string msg) =>
        Assert.Equal("", Parser.Parse(msg).Spec.Text);

    [Theory]
    [InlineData("un classique pas trop récent", 1999)]
    [InlineData("old movies, not new ones", 1999)]
    [InlineData("un classique des années 80", 1989)]
    public void A_negation_and_a_positive_bound_on_the_same_field_keep_the_tighter_one(string msg, int yearTo)
    {
        // Avant : la négation lue d'abord (≤ 2022) écrasait « classique » (≤ 1999), dont la puce restait affichée.
        var p = Parser.Parse(msg);
        Assert.Equal(yearTo, p.Spec.Constraints.YearTo);
        AssertChipsAreApplied(p);
    }

    [Fact]
    public void Bounds_from_several_expressions_are_combined_never_overwritten()
    {
        Assert.Equal(Now.Year - 3, Parser.Parse("récent, depuis 2020").Spec.Constraints.YearFrom);
        Assert.Equal(Now.Year - 3, Parser.Parse("depuis 2020, récent").Spec.Constraints.YearFrom);
        Assert.Equal(Parser.LongMin - 1, Parser.Parse("pas trop long, moins de 3 heures").Spec.Constraints.MaxMinutes);
        Assert.Equal(10, Parser.Parse("pas trop long, moins de 10 minutes").Spec.Constraints.MaxMinutes);
        Assert.Equal(Math.Min(Parser.ShortMax, 100), Parser.Parse("un film court, moins de 100 minutes").Spec.Constraints.MaxMinutes);
        Assert.Equal(Now.Year - 3, Parser.Parse("pas classique, plutôt récent").Spec.Constraints.YearFrom);
        var range = Parser.Parse("pas trop récent mais pas trop vieux").Spec.Constraints;
        Assert.Equal((2000, Now.Year - 4), (range.YearFrom, range.YearTo));
        var decade = Parser.Parse("années 80 avant 1985").Spec.Constraints;
        Assert.Equal((1980, 1984), (decade.YearFrom, decade.YearTo));
    }

    [Theory]
    [InlineData("un classique pas trop récent")]
    [InlineData("pas classique, plutôt récent")]
    [InlineData("un film court, moins de 100 minutes")]
    [InlineData("un film long mais pas trop long")]
    [InlineData("pas trop long, moins de 3 heures")]
    [InlineData("récent, depuis 2020")]
    [InlineData("un film d'horreur pas trop gore, court, comme Hereditary mais plus léger")]
    public void Chips_only_announce_bounds_that_are_applied(string msg) => AssertChipsAreApplied(Parser.Parse(msg));

    private static void AssertChipsAreApplied(ParsedQuery p)
    {
        var c = p.Spec.Constraints;
        foreach (var chip in p.Chips)
        {
            var applied = chip.Kind switch
            {
                "maxMinutes" or "short" => c.MaxMinutes <= int.Parse(chip.Label),
                "minMinutes" or "long" => c.MinMinutes >= int.Parse(chip.Label),
                "recent" or "after" => c.YearFrom >= int.Parse(chip.Label),
                "classic" => c.YearTo <= int.Parse(chip.Label),
                "before" => c.YearTo < int.Parse(chip.Label),
                _ => true,
            };
            Assert.True(applied, $"la puce {chip.Kind}:{chip.Label} annonce une borne que la requête n'applique pas");
        }
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
    [InlineData("pas de série, plutôt une comédie", new[] { TitleKind.Movie, TitleKind.Audiobook })]
    [InlineData("pas de série : un film d'animation", new[] { TitleKind.Movie })]
    [InlineData("pas de film, un livre audio", new[] { TitleKind.Audiobook })]
    [InlineData("pas de série, un film", new[] { TitleKind.Movie })]
    [InlineData("no series, a movie", new[] { TitleKind.Movie })]
    [InlineData("pas de série. J'ai envie de rire", new[] { TitleKind.Movie, TitleKind.Audiobook })]
    [InlineData("no movies, rather an audiobook", new[] { TitleKind.Audiobook })]
    public void Negated_content_type_ends_the_clause(string msg, TitleKind[] expected) =>
        Assert.Equal(expected.OrderBy(k => k), Parser.Parse(msg).Spec.Constraints.Kinds!.OrderBy(k => k));

    [Fact]
    public void The_genre_after_a_negated_type_is_wanted_not_avoided()
    {
        // Avant : « pas de série, plutôt une comédie » laissait la série demandée et retournait la comédie en exclusion.
        var p = Parser.Parse("pas de série, plutôt une comédie");
        Assert.Contains("Comédie", p.Spec.BoostGenres);
        Assert.Empty(p.Spec.AvoidGenres);
        Assert.Null(p.Spec.Constraints.ExcludeGenres);
        Assert.DoesNotContain(p.Chips, c => c.Kind == "kind" && c.Label == "Series");
    }

    [Fact]
    public void Punctuation_does_not_break_a_title_reference()
    {
        // La ponctuation sépare les propositions, mais un titre du catalogue tapé avec sa ponctuation reste reconnu.
        var p = Parser.Parse("comme Peur, douce");
        Assert.Equal(Intent.Similar, p.Intent);
        Assert.Equal("", p.Spec.Text);
    }

    [Fact]
    public void A_requested_type_that_is_also_negated_does_not_empty_the_request()
    {
        // Demandé et nié à la fois : le type nié est écarté, les autres restent permis (jamais « aucun critère »).
        var p = Parser.Parse("un film mais pas de film");
        Assert.Equal(Intent.Recommend, p.Intent);
        Assert.DoesNotContain(TitleKind.Movie, p.Spec.Constraints.Kinds!);
        Assert.Equal(Intent.Recommend, Parser.Parse("un film d'horreur, pas de film").Intent);
    }

    [Theory]
    [InlineData("no series today")]
    [InlineData("pas de série stp")]
    [InlineData("no series but a movie")]
    [InlineData("no movies please")]
    [InlineData("pas de série ce soir")]
    public void The_words_that_end_a_negated_type_are_not_free_text(string msg) =>
        Assert.Equal("", Parser.Parse(msg).Spec.Text);   // un mot libre inconnu viderait la réponse

    [Theory]
    [InlineData("pas de film à l'eau de rose")]
    [InlineData("pas de série à la télé")]
    public void The_french_preposition_a_does_not_end_a_negated_type(string msg)
    {
        // « à » est une préposition, pas un début de nouvelle demande : le type n'est pas nié, et ce qui suit n'est pas du texte libre.
        var p = Parser.Parse(msg);
        Assert.Equal("", p.Spec.Text);
        Assert.Equal(Intent.Recommend, p.Intent);
    }

    [Theory]
    [InlineData("pas de gore, plutôt une comédie")]
    [InlineData("pas de gore plutôt une comédie")]
    [InlineData("sans gore, une comédie")]
    [InlineData("not too dark, rather a comedy")]
    [InlineData("pas d'horreur, une comédie")]
    public void A_new_request_ends_the_scope_of_a_negation(string msg)
    {
        // Avant : la négation avalait la suite et « une comédie » ressortait en genre évité (ou exclu).
        var p = Parser.Parse(msg);
        Assert.Contains("Comédie", p.Spec.BoostGenres);
        Assert.DoesNotContain("Comédie", p.Spec.AvoidGenres);
        Assert.True(p.Spec.Constraints.ExcludeGenres?.Contains("comedie") != true);
    }

    [Fact]
    public void A_negation_still_covers_a_list_of_terms()
    {
        var p = Parser.Parse("sans gore, sombre");
        Assert.Contains("gore", p.Spec.Constraints.ExcludeKeywords!);
        Assert.Contains("sombre", p.Spec.Constraints.ExcludeKeywords!);
        Assert.Empty(p.Spec.BoostTags);
    }

    [Theory]
    [InlineData("comme Dune: Part Two", "dune part two")]
    [InlineData("like Spider-Man: No Way Home", "spider man no way home")]
    [InlineData("comme Hereditary mais plus léger", "hereditary")]
    public void Punctuation_does_not_cut_an_unknown_title(string msg, string title)
    {
        // Le titre inconnu est lu sans ponctuation : ses mots ne deviennent ni du texte libre ni une recherche vide.
        var p = Parser.Parse(msg);
        Assert.Equal(title, p.UnknownTitle);
        Assert.Equal("", p.Spec.Text);
    }

    [Theory]
    [InlineData("pas de film d'horreur")]
    [InlineData("pas de film triste")]
    public void A_content_type_followed_by_a_qualifier_is_not_a_negated_type(string msg)
    {
        // Le qualificatif nie un genre ou une ambiance ; le type, lui, reste demandé.
        var p = Parser.Parse(msg);
        Assert.Equal([TitleKind.Movie], p.Spec.Constraints.Kinds!);
    }

    [Theory]
    [InlineData("pas de court métrage")]
    [InlineData("un film mais pas de court métrage")]
    [InlineData("un film, pas de court métrage")]
    [InlineData("no short films")]
    [InlineData("sans court-métrage")]
    public void Negated_short_film_is_a_duration_floor_not_a_negated_type(string msg)
    {
        // « court métrage » nié veut dire « pas court », pas « pas de films » : le type Movie n'est jamais écarté.
        var p = Parser.Parse(msg);
        Assert.Equal(Intent.Recommend, p.Intent);
        Assert.Equal(Parser.ShortMax + 1, p.Spec.Constraints.MinMinutes);
        Assert.True(p.Spec.Constraints.Kinds is null || p.Spec.Constraints.Kinds.Contains(TitleKind.Movie));
        Assert.Equal("", p.Spec.Text);
        Assert.DoesNotContain(p.Chips, c => c.Kind == "kind" && c.Label != "Movie");
    }

    [Fact]
    public void A_movie_request_with_a_negated_short_film_keeps_the_movie_type()
    {
        var p = Parser.Parse("un film, pas de court métrage");
        Assert.Equal([TitleKind.Movie], p.Spec.Constraints.Kinds!);
        Assert.Contains(p.Chips, c => c.Kind == "kind" && c.Label == "Movie");
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

    [Theory]
    [InlineData("recommend a show")]
    [InlineData("some shows tonight")]
    [InlineData("I want some shows tonight")]
    [InlineData("a show about space")]
    [InlineData("recommend a funny show")]
    [InlineData("bonjour, a show ce soir")]
    [InlineData("je cherche a show svp")]
    public void Show_as_a_noun_is_a_series(string msg)
    {
        var p = Parser.Parse(msg);
        Assert.Equal([TitleKind.Series], p.Spec.Constraints.Kinds!);
        Assert.Equal(Intent.Recommend, p.Intent);
    }

    [Theory]
    [InlineData("show me a funny one")]
    [InlineData("can you show us something scary")]
    [InlineData("show them a comedy")]
    public void Show_as_a_verb_is_not_a_series(string msg) =>
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
