using System.Globalization;
using System.Text.RegularExpressions;

namespace Divertiflix.Domain.Recommendations;

public enum Intent { Help, Recommend, Similar, Surprise }

/// <summary>Critère reconnu, affiché en puce dans l'interface. Kind : genre, tag, avoid, maxMinutes, minMinutes, short, long, before, after, decade, recent, classic, kind, similar.</summary>
public sealed record Chip(string Kind, string Label);

public sealed record ParsedQuery(Intent Intent, QuerySpec Spec, IReadOnlyList<Chip> Chips, string? UnknownTitle);

/// <summary>
/// Compréhension de requêtes libres FR/EN sans modèle de langage : lexiques de genres, d'ambiances,
/// de négations (« pas trop gore »), de durées, d'époques et de références (« comme Sintel »).
/// Déterministe, auditable, et incapable d'halluciner : tout critère reconnu correspond à une donnée du catalogue.
/// </summary>
public sealed class QueryParser
{
    private static readonly Dictionary<string, string> GenreSynonyms = new()
    {
        ["sf"] = "science-fiction", ["scifi"] = "science-fiction", ["sci fi"] = "science-fiction", ["science fiction"] = "science-fiction",
        ["anticipation"] = "science-fiction", ["horror"] = "horreur", ["epouvante"] = "horreur", ["horreur"] = "horreur",
        ["effrayant"] = "horreur", ["fait peur"] = "horreur", ["faire peur"] = "horreur", ["scary"] = "horreur", ["terrifiant"] = "horreur",
        ["comedy"] = "comedie", ["comedie"] = "comedie", ["drama"] = "drame", ["drame"] = "drame",
        ["dessin anime"] = "animation", ["animation"] = "animation", ["cartoon"] = "animation", ["animated"] = "animation",
        ["fantasy"] = "fantastique", ["fantastique"] = "fantastique", ["documentary"] = "documentaire", ["documentaire"] = "documentaire",
        ["adventure"] = "aventure", ["aventure"] = "aventure", ["romance"] = "romance", ["romantique"] = "romance", ["romantic"] = "romance",
        ["thriller"] = "thriller", ["suspense"] = "thriller", ["musical"] = "musical", ["experimental"] = "experimental",
        ["abstrait"] = "experimental", ["abstract"] = "experimental", ["policier"] = "thriller",
    };

    // Ambiances : déclencheur -> mots-clés du catalogue (vocabulaire contrôlé).
    private static readonly Dictionary<string, string[]> Moods = new()
    {
        ["reconfortant"] = ["reconfortant", "tendresse", "famille", "amitié", "nostalgique"], ["comforting"] = ["reconfortant", "tendresse", "famille", "amitié"],
        ["cosy"] = ["reconfortant", "tendresse", "famille"], ["doux"] = ["tendresse", "reconfortant", "contemplatif"], ["apaisant"] = ["contemplatif", "reconfortant", "silence"],
        ["feel good"] = ["reconfortant", "humour", "amitié"], ["tendre"] = ["tendresse", "reconfortant"],
        ["sombre"] = ["sombre", "tension", "nuit", "mystère"], ["dark"] = ["sombre", "tension", "nuit"], ["noir"] = ["sombre", "nuit", "mystère"], ["glauque"] = ["sombre", "tension"],
        ["tendu"] = ["tension", "mystère", "enquête"], ["angoissant"] = ["tension", "sombre", "mystère"], ["haletant"] = ["tension", "rythmé"], ["tense"] = ["tension", "mystère"],
        ["drole"] = ["humour", "absurde"], ["rigolo"] = ["humour", "absurde"], ["funny"] = ["humour", "absurde"], ["humour"] = ["humour"], ["rire"] = ["humour"],
        ["leger"] = ["humour", "reconfortant", "tendresse"], ["light"] = ["humour", "reconfortant"], ["lighthearted"] = ["humour", "reconfortant"],
        ["epique"] = ["épique", "voyage", "guerre"], ["epic"] = ["épique", "voyage"], ["grandiose"] = ["épique", "lumière"], ["spectaculaire"] = ["épique", "rythmé"],
        ["contemplatif"] = ["contemplatif", "silence", "nature", "poésie", "lumière"], ["meditatif"] = ["contemplatif", "silence", "poésie"], ["calme"] = ["contemplatif", "silence", "nature"],
        ["zen"] = ["contemplatif", "silence", "nature"], ["lent"] = ["contemplatif", "silence"], ["slow"] = ["contemplatif", "silence"], ["peaceful"] = ["contemplatif", "silence", "nature"],
        ["onirique"] = ["onirique", "rêve", "poésie"], ["reveur"] = ["onirique", "rêve"], ["psychedelique"] = ["onirique", "lumière"], ["dreamy"] = ["onirique", "rêve", "poésie"],
        ["nostalgique"] = ["nostalgique", "mémoire", "enfance"], ["nostalgic"] = ["nostalgique", "mémoire", "enfance"],
        ["pluie"] = ["pluie", "nuit", "contemplatif"], ["pluvieux"] = ["pluie", "nuit"], ["rain"] = ["pluie", "nuit"], ["rainy"] = ["pluie", "nuit"],
        ["mysterieux"] = ["mystère", "enquête", "nuit"], ["mystery"] = ["mystère", "enquête"], ["enquete"] = ["enquête", "mystère"], ["detective"] = ["enquête", "mystère"],
        ["depaysant"] = ["voyage", "évasion", "nature"], ["evasion"] = ["évasion", "voyage"], ["escape"] = ["évasion", "voyage"],
        ["futuriste"] = ["futur", "robot", "espace"], ["futuristic"] = ["futur", "robot", "espace"], ["futur"] = ["futur", "robot"], ["future"] = ["futur", "robot"],
        ["espace"] = ["espace"], ["space"] = ["espace"], ["robot"] = ["robot"], ["robots"] = ["robot"], ["foret"] = ["forêt", "nature"], ["forest"] = ["forêt", "nature"],
        ["mer"] = ["mer", "voyage"], ["ocean"] = ["mer", "voyage"], ["desert"] = ["désert", "solitude"], ["montagne"] = ["montagne", "nature"], ["nuit"] = ["nuit"], ["night"] = ["nuit"],
        ["ville"] = ["ville", "nuit"], ["city"] = ["ville", "nuit"], ["famille"] = ["famille", "tendresse"], ["family"] = ["famille", "tendresse"],
        ["amitie"] = ["amitié"], ["friendship"] = ["amitié"], ["solitude"] = ["solitude", "silence"], ["lonely"] = ["solitude", "silence"],
        ["fantome"] = ["fantôme", "mystère"], ["ghost"] = ["fantôme", "mystère"], ["magie"] = ["magie", "onirique"], ["magic"] = ["magie", "onirique"],
        ["creature"] = ["créature", "sombre"], ["monstre"] = ["créature", "sombre"], ["monster"] = ["créature", "sombre"], ["apocalypse"] = ["apocalypse", "sombre"],
        ["musique"] = ["musique", "danse"], ["music"] = ["musique", "danse"], ["danse"] = ["danse", "musique"], ["dance"] = ["danse", "musique"],
        ["guerre"] = ["guerre"], ["war"] = ["guerre"], ["vengeance"] = ["vengeance", "tension"], ["revenge"] = ["vengeance", "tension"],
        ["nature"] = ["nature"], ["poesie"] = ["poésie", "contemplatif"], ["poetic"] = ["poésie", "contemplatif"], ["enfance"] = ["enfance", "nostalgique"], ["kids"] = ["enfance", "famille"],
        ["rythme"] = ["rythmé"], ["rapide"] = ["rythmé"], ["fast"] = ["rythmé"],
        ["gore"] = ["gore"], ["sanglant"] = ["gore"], ["bloody"] = ["gore"], ["violent"] = ["gore", "guerre"], ["violence"] = ["gore", "guerre"],
        ["absurde"] = ["absurde", "humour"], ["absurd"] = ["absurde", "humour"], ["amour"] = ["tendresse", "romance"], ["love"] = ["tendresse", "romance"],
    };

    private static readonly HashSet<string> NegMarkers = ["pas", "sans", "aucun", "aucune", "no", "not", "without", "ni", "evite", "eviter", "avoid", "non", "jamais"];
    private static readonly HashSet<string> NegSkip = ["trop", "de", "d", "du", "des", "too", "any", "very", "tres", "beaucoup", "un", "une", "le", "la", "les", "of", "a", "an", "the", "peu"];
    private static readonly HashSet<string> NegStop = ["et", "mais", "ou", "avec", "plus", "and", "but", "or", "comme", "like", "qui", "que", "pour", "for", "with"];
    private static readonly HashSet<string> Filler = [
        "quelque","quelques","chose","soir","ce","film","films","truc","regarder","voir","envie","veux","voudrais","cherche","propose","suggere","donne","moi","mettre",
        "bon","bien","super","cool","something","watch","want","looking","give","show","recommend","suggest","night","tonight","movie","movies","please","svp","plait","un","une",
        "des","j","ai","aimerais","pourrais","tu","peux","can","you","some","need","find","trouve","trouver","avoir","etre","faire","idee","ideas","suggestion","suggestions","pour","ca","cela","ceci",
        "plus","moins","mais","vraiment","un peu","genre","style","esprit","comme","like","similar","similaire","semblable","aime","aimes","regarde","vu","deja",
        "bonjour","bonsoir","salut","hello","hey","coucou","merci","thanks","aide","aider","help","peux","peut","pouvez","puis","vous","hi","sil","tout","toi",
    ];
    private static readonly HashSet<string> SurprisePhrases = ["surprends moi", "surprend moi", "surprise moi", "surprise me", "au hasard", "random", "n importe quoi", "peu importe", "choisis pour moi", "pick for me", "choose for me"];

    private readonly IReadOnlyList<CatalogItem> _catalog;
    private readonly Dictionary<string, string> _genreByKey;     // clé normalisée -> libellé du catalogue
    private readonly Dictionary<string, string> _tagByKey;       // clé normalisée -> libellé du catalogue
    private readonly int _shortMax;
    private readonly int _longMin;
    private readonly int _currentYear;

    public QueryParser(IReadOnlyList<CatalogItem> catalog, DateTime now)
    {
        _catalog = catalog;
        _currentYear = now.Year;
        _genreByKey = catalog.Select(c => c.Genre).Where(g => g != "").Distinct()
            .ToDictionary(g => RecommendationEngine.KeywordKey(g), g => g);
        _tagByKey = catalog.SelectMany(c => c.Keywords).Distinct()
            .GroupBy(RecommendationEngine.KeywordKey).ToDictionary(g => g.Key, g => g.First());
        var durations = catalog.Where(c => c.Playable && c.DurationMinutes > 0).Select(c => c.DurationMinutes).OrderBy(x => x).ToList();
        _shortMax = durations.Count == 0 ? 20 : Math.Max(2, durations[(int)(durations.Count * 0.35)]);
        _longMin = durations.Count == 0 ? 90 : Math.Max(_shortMax + 1, durations[Math.Min(durations.Count - 1, (int)(durations.Count * 0.65))]);
    }

    public int ShortMax => _shortMax;

    public ParsedQuery Parse(string message)
    {
        var norm = Text.Normalize(message);
        var padded = $" {norm} ";
        var chips = new List<Chip>();
        var boostTags = new List<string>(); var boostGenres = new List<string>();
        var avoidTags = new List<string>(); var avoidGenres = new List<string>();
        var exTags = new HashSet<string>(); var exGenres = new HashSet<string>();
        var labels = new List<string>();
        int? maxMin = null, minMin = null, yFrom = null, yTo = null;
        var kinds = new HashSet<TitleKind>();
        Guid? similar = null; string? unknownTitle = null;

        // 1. Surprise.
        var surprise = SurprisePhrases.Any(p => padded.Contains($" {p} "));

        // 2. Référence à un titre du catalogue (la plus longue correspondance gagne).
        var hit = _catalog.Select(c => (C: c, N: Text.Normalize(c.Name))).Where(x => x.N.Length >= 3 && padded.Contains($" {x.N} ") && IsReference(padded, x.N))
            .OrderByDescending(x => x.N.Length).Cast<(CatalogItem C, string N)?>().FirstOrDefault();
        if (hit is { } h)
        {
            similar = h.C.Id; chips.Add(new Chip("similar", h.C.Name));
            padded = padded.Replace($" {h.N} ", " ");
        }
        else
        {
            var m = Regex.Match(padded, @" (?:comme|like|similar to|similaire a|dans le style de|dans l esprit de) (?<t>[a-z0-9 ]{3,40}?)(?= mais | but | avec | and | et | pour |\s*$)");
            if (m.Success)
            {
                unknownTitle = m.Groups["t"].Value.Trim();
                padded = padded.Remove(m.Index, m.Length).Insert(m.Index, " ");   // ses mots ne doivent pas devenir des critères de recherche
            }
        }

        // 3a. Type de contenu (avant « court » : « court métrage » est un type, pas une durée).
        foreach (var (rx, kind, label) in new[] {
            (@" (livre audio|livres audio|audiobook|audiobooks|livre|livres|roman|romans|ecouter|listen) ", TitleKind.Audiobook, "Audiobook"),
            (@" (serie|series|show|shows|episodes?) ", TitleKind.Series, "Series"),
            (@" (court metrage|court metrages|short film|short films) ", TitleKind.Movie, "Movie"),
            (@" (film|films|movie|movies|cinema) ", TitleKind.Movie, "Movie") })
            if (Regex.IsMatch(padded, rx)) { kinds.Add(kind); if (chips.All(c => c.Kind != "kind" || c.Label != label)) chips.Add(new Chip("kind", label)); padded = Regex.Replace(padded, rx, " "); }

        // 3. Durée, époque (expressions chiffrées d'abord).
        padded = ExtractNumbers(padded, ref maxMin, ref minMin, ref yFrom, ref yTo, chips, labels);
        if (Regex.IsMatch(padded, @" (court|courts|courte|short|rapide|quick|bref|brief) "))
        { maxMin ??= _shortMax; chips.Add(new Chip("short", _shortMax.ToString(CultureInfo.InvariantCulture))); labels.Add("court"); padded = Regex.Replace(padded, @" (court|courts|courte|short|rapide|quick|bref|brief) ", " "); }
        if (Regex.IsMatch(padded, @" (long|longue|longs|longues|lengthy|epique de longue duree) ") && !padded.Contains(" plus long"))
        { minMin ??= _longMin; chips.Add(new Chip("long", _longMin.ToString(CultureInfo.InvariantCulture))); labels.Add("long"); padded = Regex.Replace(padded, @" (long|longue|longs|longues|lengthy) ", " "); }
        if (Regex.IsMatch(padded, @" (recent|recents|recente|recentes|nouveau|nouveaute|nouveautes|new|latest) "))
        { yFrom ??= _currentYear - 3; chips.Add(new Chip("recent", (_currentYear - 3).ToString(CultureInfo.InvariantCulture))); padded = Regex.Replace(padded, @" (recent|recents|recente|recentes|nouveau|nouveaute|nouveautes|new|latest) ", " "); }
        if (Regex.IsMatch(padded, @" (classique|classiques|classic|ancien|anciens|vieux|retro|old) "))
        { yTo ??= 1999; chips.Add(new Chip("classic", "1999")); padded = Regex.Replace(padded, @" (classique|classiques|classic|ancien|anciens|vieux|retro|old) ", " "); }

        // 5. Négations puis critères positifs, mot à mot.
        var words = padded.Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
        var free = new List<string>();
        for (var i = 0; i < words.Count; i++)
        {
            var w = words[i];
            if (NegMarkers.Contains(w))
            {
                var soft = false; var j = i + 1; var taken = 0;
                while (j < words.Count && NegSkip.Contains(words[j])) { if (words[j] is "trop" or "too" or "peu") soft = true; j++; }
                while (j < words.Count && taken < 3 && !NegStop.Contains(words[j]) && !NegMarkers.Contains(words[j]))
                {
                    var term = words[j];
                    var pair = j + 1 < words.Count ? $"{term} {words[j + 1]}" : term;
                    var resolvedPair = GenreSynonyms.ContainsKey(pair);
                    var consumed = resolvedPair ? 2 : 1;
                    var key = resolvedPair ? pair : term;
                    if (TryGenre(key, out var g))
                    { if (soft) avoidGenres.Add(g); else { exGenres.Add(Text.Normalize(g)); avoidGenres.Add(g); } chips.Add(new Chip("avoid", g)); taken++; }
                    else if (Moods.TryGetValue(key, out var tags))
                    {
                        foreach (var t in tags.Where(t => _tagByKey.ContainsKey(RecommendationEngine.KeywordKey(t))))
                        { var lab = _tagByKey[RecommendationEngine.KeywordKey(t)]; if (soft) avoidTags.Add(lab); else { exTags.Add(Text.Normalize(lab)); avoidTags.Add(lab); } }
                        chips.Add(new Chip("avoid", tags.Select(t => _tagByKey.GetValueOrDefault(RecommendationEngine.KeywordKey(t), t)).First())); taken++;
                    }
                    j += consumed;
                }
                i = j - 1;
                continue;
            }
            var two = i + 1 < words.Count ? $"{w} {words[i + 1]}" : null;
            if (two is not null && TryGenre(two, out var g2)) { boostGenres.Add(g2); chips.Add(new Chip("genre", g2)); i++; continue; }
            if (two is not null && Moods.TryGetValue(two, out var t2)) { AddMood(two, t2, boostTags, chips); i++; continue; }
            if (TryGenre(w, out var g1)) { boostGenres.Add(g1); chips.Add(new Chip("genre", g1)); continue; }
            if (Moods.TryGetValue(w, out var t1)) { AddMood(w, t1, boostTags, chips); continue; }
            if (_tagByKey.TryGetValue(RecommendationEngine.KeywordKey(w), out var direct)) { boostTags.Add(direct); chips.Add(new Chip("tag", direct)); continue; }
            if (!Filler.Contains(w) && w.Length >= 3) free.Add(w);
        }

        var spec = new QuerySpec
        {
            Text = string.Join(' ', free),
            BoostTags = boostTags.Distinct().ToList(), BoostGenres = boostGenres.Distinct().ToList(),
            AvoidTags = avoidTags.Distinct().ToList(), AvoidGenres = avoidGenres.Distinct().ToList(),
            ConstraintLabels = labels,
            SimilarTo = similar, Surprise = surprise,
            Constraints = new Constraints
            {
                MaxMinutes = maxMin, MinMinutes = minMin, YearFrom = yFrom, YearTo = yTo,
                Kinds = kinds.Count > 0 ? kinds : null,
                ExcludeGenres = exGenres.Count > 0 ? exGenres : null,
                ExcludeKeywords = exTags.Count > 0 ? exTags : null,
            },
        };

        var hasCriteria = boostTags.Count + boostGenres.Count + avoidTags.Count + avoidGenres.Count > 0 || free.Count > 0
            || maxMin is not null || minMin is not null || yFrom is not null || yTo is not null || kinds.Count > 0;
        var intent = surprise ? Intent.Surprise : similar is not null ? Intent.Similar : hasCriteria ? Intent.Recommend : Intent.Help;
        if (intent == Intent.Surprise && chips.Count == 0) chips = [];
        return new ParsedQuery(intent, spec, DistinctChips(chips), unknownTitle);
    }

    private static readonly string[] ReferenceMarkers = ["comme", "like", "similar to", "similaire a", "semblable a", "dans le style de", "dans l esprit de", "aime", "adore", "aimes", "vu", "regarde", "watched", "loved", "liked", "enjoyed"];

    /// <summary>
    /// Un titre court d'un seul mot (« Long », « Rire ») peut être un mot courant : on ne le prend pour une référence
    /// que s'il suit un marqueur (« comme X », « j'ai adoré X »). Les titres longs ou à plusieurs mots suffisent seuls.
    /// </summary>
    private static bool IsReference(string padded, string normName)
    {
        if (normName.Length >= 6 || normName.Contains(' ')) return true;
        return ReferenceMarkers.Any(m => padded.Contains($" {m} {normName} "));
    }

    private bool TryGenre(string key, out string genre)
    {
        genre = "";
        var canon = GenreSynonyms.TryGetValue(key, out var c) ? c : key;
        if (_genreByKey.TryGetValue(RecommendationEngine.KeywordKey(canon), out var g)) { genre = g; return true; }
        return false;
    }

    private void AddMood(string trigger, string[] tags, List<string> boostTags, List<Chip> chips)
    {
        var known = tags.Select(t => _tagByKey.GetValueOrDefault(RecommendationEngine.KeywordKey(t))).Where(t => t is not null).Cast<string>().ToList();
        if (known.Count == 0) return;
        boostTags.AddRange(known);
        chips.Add(new Chip("tag", known[0]));
    }

    private string ExtractNumbers(string padded, ref int? maxMin, ref int? minMin, ref int? yFrom, ref int? yTo, List<Chip> chips, List<string> labels)
    {
        static int ToMinutes(string num, string unit, string? tail)
        {
            var n = int.Parse(num, CultureInfo.InvariantCulture);
            if (unit.StartsWith('h')) { var extra = tail is { Length: > 0 } ? int.Parse(tail, CultureInfo.InvariantCulture) : 0; return n * 60 + extra; }
            return n;
        }
        // « moins de 90 min », « under 2 h », « max 1h30 »
        var m = Regex.Match(padded, @" (?:moins de|maximum|max|under|less than|sous|pas plus de|jusqu a) (\d{1,3}) ?(h|heure|heures|hours?|hrs?|min|mins|minutes?)(?: ?(\d{1,2}))? ");
        if (m.Success) { var v = ToMinutes(m.Groups[1].Value, m.Groups[2].Value, m.Groups[3].Value); maxMin = v; chips.Add(new Chip("maxMinutes", v.ToString(CultureInfo.InvariantCulture))); labels.Add($"≤ {v} min"); padded = padded.Remove(m.Index, m.Length).Insert(m.Index, " "); }
        m = Regex.Match(padded, @" (?:plus de|au moins|over|more than|minimum|min|at least) (\d{1,3}) ?(h|heure|heures|hours?|hrs?|min|mins|minutes?)(?: ?(\d{1,2}))? ");
        if (m.Success) { var v = ToMinutes(m.Groups[1].Value, m.Groups[2].Value, m.Groups[3].Value); minMin = v; chips.Add(new Chip("minMinutes", v.ToString(CultureInfo.InvariantCulture))); labels.Add($"≥ {v} min"); padded = padded.Remove(m.Index, m.Length).Insert(m.Index, " "); }
        m = Regex.Match(padded, @" (\d{1,3}) ?(?:min|mins|minutes?) (?:max|maximum) ");
        if (m.Success) { var v = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture); maxMin = v; chips.Add(new Chip("maxMinutes", v.ToString(CultureInfo.InvariantCulture))); labels.Add($"≤ {v} min"); padded = padded.Remove(m.Index, m.Length).Insert(m.Index, " "); }
        // « des années 80 », « années 2010 », « 1990s »
        m = Regex.Match(padded, @" (?:annees|annee|years|the) (\d{2}|\d{4})(?:s| ) ?");
        if (m.Success)
        {
            var d = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
            if (m.Groups[1].Value.Length == 2) d += d < 30 ? 2000 : 1900;
            yFrom = d; yTo = d + 9; chips.Add(new Chip("decade", d.ToString(CultureInfo.InvariantCulture))); labels.Add($"{d}-{d + 9}");
            padded = padded.Remove(m.Index, m.Length).Insert(m.Index, " ");
        }
        m = Regex.Match(padded, @" (?:avant|before) (\d{4}) ");
        if (m.Success) { yTo = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) - 1; chips.Add(new Chip("before", m.Groups[1].Value)); labels.Add($"< {m.Groups[1].Value}"); padded = padded.Remove(m.Index, m.Length).Insert(m.Index, " "); }
        m = Regex.Match(padded, @" (?:apres|depuis|after|since) (\d{4}) ");
        if (m.Success) { yFrom = int.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture) + (m.Value.Contains("depuis") || m.Value.Contains("since") ? 0 : 1); chips.Add(new Chip("after", m.Groups[1].Value)); labels.Add($"> {m.Groups[1].Value}"); padded = padded.Remove(m.Index, m.Length).Insert(m.Index, " "); }
        return padded;
    }

    private static List<Chip> DistinctChips(List<Chip> chips) =>
        chips.GroupBy(c => (c.Kind, Text.Normalize(c.Label))).Select(g => g.First()).ToList();
}
