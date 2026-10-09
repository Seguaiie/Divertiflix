namespace Divertiflix.Domain.Recommendations;

/// <summary>Critères structurés d'une requête libre (produits par l'assistant) ou d'une rangée thématique.</summary>
public sealed record QuerySpec
{
    public string Text { get; init; } = "";
    public IReadOnlyList<string> BoostTags { get; init; } = [];
    public IReadOnlyList<string> BoostGenres { get; init; } = [];
    public IReadOnlyList<string> AvoidTags { get; init; } = [];
    public IReadOnlyList<string> AvoidGenres { get; init; } = [];
    /// <summary>Libellés lisibles des contraintes dures reconnues (« court », « avant 2000 »...), repris dans la raison.</summary>
    public IReadOnlyList<string> ConstraintLabels { get; init; } = [];
    public Constraints Constraints { get; init; } = new();
    public Guid? SimilarTo { get; init; }
    public bool Surprise { get; init; }
}

/// <summary>
/// Moteur de recommandation hybride, déterministe et explicable.
/// Contenu : vecteurs creux TF-IDF (genre, mots-clés, synopsis, type, époque) comparés par cosinus.
/// Collaboratif : similarité item-item sur les interactions de la communauté.
/// Tendance : profils distincts récents. Puis re-classement MMR (diversité) et une place d'exploration.
/// Chaque résultat porte la raison réelle de sa position, jamais une phrase inventée.
/// </summary>
public sealed class RecommendationEngine
{
    private const double Lambda = 0.72;           // compromis pertinence / diversité (MMR)
    private const double HalfLifeDays = 60;       // un signal perd la moitié de son poids en 60 jours

    private readonly CatalogItem[] _items;
    private readonly Dictionary<Guid, int> _index = [];
    private readonly Dictionary<string, int> _featureIds = [];
    private readonly List<double> _idf = [];
    private readonly Vec[] _vecs;
    private readonly IReadOnlyDictionary<Guid, int> _trending;
    private readonly int _maxTrend;
    private readonly Dictionary<Guid, Dictionary<Guid, double>> _audience = [];   // titre -> (profil -> poids)
    private readonly Dictionary<Guid, double> _audienceNorm = [];
    private readonly DateTime _now;

    public RecommendationEngine(IEnumerable<CatalogItem> catalog, Community? community = null, DateTime? now = null)
    {
        _items = catalog.ToArray();
        _now = now ?? DateTime.UtcNow;
        for (var i = 0; i < _items.Length; i++) _index[_items[i].Id] = i;

        // Pass 1 : fréquences documentaires pour l'IDF.
        var raw = new List<Dictionary<string, double>>(_items.Length);
        var df = new Dictionary<string, int>();
        foreach (var it in _items)
        {
            var f = Features(it);
            raw.Add(f);
            foreach (var k in f.Keys) df[k] = df.GetValueOrDefault(k) + 1;
        }
        var n = Math.Max(1, _items.Length);
        foreach (var (feat, c) in df)
        {
            _featureIds[feat] = _idf.Count;
            _idf.Add(Math.Log((n + 1.0) / (c + 1.0)) + 1.0);
        }
        _vecs = raw.Select(f => ToVec(f.Select(kv => (kv.Key, kv.Value)))).ToArray();

        community ??= new Community();
        _trending = community.Trending;
        _maxTrend = _trending.Count == 0 ? 0 : _trending.Values.Max();
        foreach (var g in community.Interactions.Where(x => x.Weight > 0).GroupBy(x => x.TitleId))
        {
            var perProfile = g.GroupBy(x => x.ProfileId).ToDictionary(p => p.Key, p => p.Sum(x => x.Weight));
            _audience[g.Key] = perProfile;
            _audienceNorm[g.Key] = Math.Sqrt(perProfile.Values.Sum(v => v * v));
        }
    }

    public IReadOnlyList<CatalogItem> Items => _items;
    public CatalogItem? Find(Guid id) => _index.TryGetValue(id, out var i) ? _items[i] : null;

    // ------------------------------------------------------------------ Goût

    public bool HasTaste(UserContext ctx) => Taste(ctx).Pos.Norm > 0;

    /// <summary>Affinité par genre (poids cumulés avec dégradation temporelle), seulement les positives.</summary>
    public IReadOnlyDictionary<string, double> GenreAffinity(UserContext ctx)
    {
        var map = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in ctx.Signals)
        {
            if (!_index.TryGetValue(s.TitleId, out var i)) continue;
            var w = s.Weight * Decay(s.At);
            if (w <= 0) continue;
            map[_items[i].Genre] = map.GetValueOrDefault(_items[i].Genre) + w;
        }
        return map;
    }

    // ------------------------------------------------------------------ Recommandations personnalisées

    public IReadOnlyList<Scored> Recommend(UserContext ctx, int n, Constraints? constraints = null)
    {
        constraints ??= new Constraints();
        var (pos, neg) = Taste(ctx);
        var hasTaste = pos.Norm > 0;
        var seeds = Seeds(ctx);
        var affinity = GenreAffinity(ctx);
        var topGenres = affinity.OrderByDescending(kv => kv.Value).Take(2).Select(kv => Text.Normalize(kv.Key)).ToHashSet();
        var liked = ctx.Signals.Where(s => s.Weight >= 0.4).GroupBy(s => s.TitleId)
            .Select(g => (Id: g.Key, W: g.Sum(s => s.Weight * Decay(s.At)))).ToList();
        var hasCollab = _audience.Count > 0 && liked.Count > 0;

        // Poids : sans historique, on retombe sur tendance, fraîcheur et notes ; sans communauté, le contenu prend le relais.
        var (wContent, wCollab, wTrend, wFresh, wRating) = !hasTaste ? (0.0, 0.0, 0.55, 0.25, 0.20)
            : hasCollab ? (0.62, 0.14, 0.12, 0.07, 0.05)
            : (0.76, 0.0, 0.12, 0.07, 0.05);

        var cands = new List<(int I, double Score, double Content, Reason Reason)>();
        for (var i = 0; i < _items.Length; i++)
        {
            var it = _items[i];
            if (ctx.Excluded.Contains(it.Id) || !constraints.Allows(it)) continue;

            var content = hasTaste ? Cos(pos, _vecs[i]) - (neg.Norm > 0 ? 0.6 * Cos(neg, _vecs[i]) : 0) : 0;
            content = Math.Max(content, -0.5);
            var collab = hasCollab ? Collab(liked, it.Id) : 0;
            var trend = _maxTrend > 0 ? _trending.GetValueOrDefault(it.Id) / (double)_maxTrend : 0;
            var fresh = Freshness(it);
            var rating = (it.Rating ?? 6.0) / 10.0;

            var parts = (Content: wContent * Math.Max(content, 0), Collab: wCollab * collab, Trend: wTrend * trend, Fresh: wFresh * fresh);
            var score = wContent * content + wCollab * collab + wTrend * trend + wFresh * fresh + wRating * rating;
            cands.Add((i, score, content, Explain(i, parts, content, seeds, affinity)));
        }
        if (cands.Count == 0) return [];

        var ordered = cands.OrderByDescending(c => c.Score).ThenBy(c => _items[c.I].Name, StringComparer.Ordinal).ToList();
        var picked = Mmr(ordered.Select(c => (c.I, c.Score)).ToList(), n);

        var result = picked.Select(i => ordered.First(c => c.I == i)).ToList();

        // Exploration : une place vers un genre hors des habitudes, déterministe sur la journée.
        if (hasTaste && n >= 6)
        {
            var slot = Math.Min(3, result.Count - 1);
            var inPick = result.Select(r => r.I).ToHashSet();
            var explore = ordered.Where(c => !inPick.Contains(c.I) && !topGenres.Contains(Text.Normalize(_items[c.I].Genre)) && c.Content > -0.05)
                .Take(5).OrderBy(c => Hash(ctx.Seed, _items[c.I].Id)).FirstOrDefault();
            if (explore.Reason is not null && result.Count > slot)
                result[slot] = (explore.I, explore.Score, explore.Content, new Reason(ReasonType.Explore, Genre: _items[explore.I].Genre));
        }

        return result.Select(c => new Scored(_items[c.I], c.Score, c.Reason, hasTaste ? MatchPercent(c.Content) : 0)).ToList();
    }

    // ------------------------------------------------------------------ Similaires

    public IReadOnlyList<Scored> Similar(Guid titleId, int n, Constraints? constraints = null, IReadOnlySet<Guid>? exclude = null)
    {
        if (!_index.TryGetValue(titleId, out var seed)) return [];
        constraints ??= new Constraints();
        var cands = new List<(int I, double Score)>();
        for (var i = 0; i < _items.Length; i++)
        {
            if (i == seed || (exclude?.Contains(_items[i].Id) ?? false) || !constraints.Allows(_items[i])) continue;
            var s = Dot(_vecs[seed], _vecs[i]);
            if (s <= 0.02) continue;
            cands.Add((i, s));
        }
        var ordered = cands.OrderByDescending(c => c.Score).ToList();
        var reason = new Reason(ReasonType.SimilarTo, _items[seed].Id, _items[seed].Name);
        return Mmr(ordered, n, 0.85).Select(i => new Scored(_items[i], ordered.First(c => c.I == i).Score, reason, 0)).ToList();
    }

    // ------------------------------------------------------------------ Tendances

    public IReadOnlyList<Scored> Trending(int n, Constraints? constraints = null, IReadOnlySet<Guid>? exclude = null)
    {
        constraints ??= new Constraints();
        var any = _maxTrend > 0;
        return _items.Where(it => !(exclude?.Contains(it.Id) ?? false) && constraints.Allows(it))
            .Select(it => (It: it, T: any ? _trending.GetValueOrDefault(it.Id) / (double)_maxTrend : 0))
            .Where(x => !any || x.T > 0)
            .Select(x => (x.It, Score: x.T + 0.15 * ((x.It.Rating ?? 6) / 10.0)))
            .OrderByDescending(x => x.Score).ThenBy(x => x.It.Name, StringComparer.Ordinal).Take(n)
            .Select(x => new Scored(x.It, x.Score, new Reason(any ? ReasonType.Trending : ReasonType.Popular), 0)).ToList();
    }

    // ------------------------------------------------------------------ Recherche guidée (assistant)

    public IReadOnlyList<Scored> Search(QuerySpec spec, UserContext ctx, int n)
    {
        var (pos, _) = Taste(ctx);
        var hasTaste = pos.Norm > 0;
        var cons = spec.Constraints;
        var boostTags = spec.BoostTags.Select(KeywordKey).ToHashSet();
        var boostGenres = spec.BoostGenres.Select(Text.Normalize).ToHashSet();
        var avoidTags = spec.AvoidTags.Select(KeywordKey).ToHashSet();
        var avoidGenres = spec.AvoidGenres.Select(Text.Normalize).ToHashSet();

        var qFeats = new List<(string, double)>();
        foreach (var tok in Text.Tokens(spec.Text).Distinct())
        {
            qFeats.Add(("t:" + tok, 1.0));
            qFeats.Add(("k:" + tok, 1.4));
            qFeats.Add(("g:" + tok, 1.4));
        }
        foreach (var t in boostTags) qFeats.Add(("k:" + t, 2.0));
        foreach (var g in boostGenres) qFeats.Add(("g:" + KeywordKey(g), 2.5));
        var qvec = ToVec(qFeats);
        var seedIdx = spec.SimilarTo is { } sid && _index.TryGetValue(sid, out var si) ? si : -1;
        // Un mot libre que le catalogue ne connaît pas est une demande sans réponse, pas « tout le catalogue ».
        // « Surprends-moi » porte son propre texte (la formule elle-même) : seuls les genres et mots-clés demandés cadrent la recherche.
        var intent = boostTags.Count > 0 || boostGenres.Count > 0 || (!spec.Surprise && Text.Tokens(spec.Text).Any());

        var rows = new List<(int I, double Score, Reason Reason)>();
        for (var i = 0; i < _items.Length; i++)
        {
            var it = _items[i];
            if (i == seedIdx) continue;
            if (!cons.Allows(it)) continue;

            var keys = it.Keywords.Select(KeywordKey).ToHashSet();
            var genreKey = Text.Normalize(it.Genre);
            var matchedTags = boostTags.Where(keys.Contains).ToList();
            var genreHit = boostGenres.Contains(genreKey);

            var lexical = qvec.Norm > 0 ? Dot(qvec, _vecs[i]) : 0;
            var nameHit = !string.IsNullOrWhiteSpace(spec.Text) && Text.Normalize(it.Name).Contains(Text.Normalize(spec.Text)) ? 0.5 : 0;
            var boost = (boostTags.Count > 0 ? 0.30 * matchedTags.Count / boostTags.Count : 0) + (genreHit ? 0.35 : 0);
            var taste = hasTaste ? Math.Max(0, Cos(pos, _vecs[i])) : 0;
            var penalty = 0.35 * avoidTags.Count(keys.Contains) + (avoidGenres.Contains(genreKey) ? 0.5 : 0);
            var seedSim = seedIdx >= 0 ? Dot(_vecs[seedIdx], _vecs[i]) : 0;

            if (seedIdx >= 0 && seedSim <= 0.02) continue;
            if (seedIdx < 0 && intent && lexical <= 0 && matchedTags.Count == 0 && !genreHit && nameHit == 0) continue;
            // Déjà vu : jamais reproposé, sauf si l'utilisateur demande ce titre par son nom.
            if (ctx.Excluded.Contains(it.Id) && nameHit == 0) continue;

            var score = 0.5 * lexical + nameHit + boost + 0.25 * taste + 0.06 * Freshness(it) + 0.04 * ((it.Rating ?? 6) / 10.0)
                      + (seedIdx >= 0 ? 0.8 * seedSim : 0) - penalty;

            Reason reason;
            if (seedIdx >= 0) reason = new Reason(ReasonType.SimilarTo, _items[seedIdx].Id, _items[seedIdx].Name);
            else
            {
                var tags = new List<string>(spec.ConstraintLabels);
                if (genreHit) tags.Add(it.Genre);
                tags.AddRange(it.Keywords.Where(k => matchedTags.Contains(KeywordKey(k))));
                reason = tags.Count > 0 ? new Reason(ReasonType.Matches, Tags: tags.Distinct().ToList())
                    : new Reason(hasTaste ? ReasonType.GenreAffinity : ReasonType.Popular, Genre: it.Genre);
            }
            rows.Add((i, score, reason));
        }
        if (rows.Count == 0) return [];

        if (spec.Surprise)
        {
            var pool = rows.Select(r => (r.I, Score: 0.4 * (hasTaste ? Math.Max(0, Cos(pos, _vecs[r.I])) : 0.3) + 0.6 * Hash(ctx.Seed, _items[r.I].Id)))
                .OrderByDescending(r => r.Score).ToList();
            return Mmr(pool, n, 0.5).Select(i => new Scored(_items[i], pool.First(r => r.I == i).Score, new Reason(ReasonType.Surprise), 0)).ToList();
        }

        var ordered = rows.OrderByDescending(r => r.Score).ThenBy(r => _items[r.I].Name, StringComparer.Ordinal).ToList();
        var picks = Mmr(ordered.Select(r => (r.I, r.Score)).ToList(), n, 0.8);
        return picks.Select(i => { var r = ordered.First(x => x.I == i); return new Scored(_items[i], r.Score, r.Reason, 0); }).ToList();
    }

    // ------------------------------------------------------------------ Internes

    private Reason Explain(int i, (double Content, double Collab, double Trend, double Fresh) parts, double content,
        List<(Guid Id, string Name, Vec Vec, double W)> seeds, IReadOnlyDictionary<string, double> affinity)
    {
        var best = Math.Max(Math.Max(parts.Content, parts.Collab), Math.Max(parts.Trend, parts.Fresh));
        if (best <= 0) return new Reason(ReasonType.Popular);

        if (parts.Content >= best && content >= 0.04)
        {
            var seed = seeds.Where(s => s.Id != _items[i].Id)
                .Select(s => (S: s, Sim: Dot(s.Vec, _vecs[i]))).Where(x => x.Sim >= 0.12)
                .OrderByDescending(x => x.Sim * x.S.W).FirstOrDefault();
            if (seed.S.Name is not null) return new Reason(ReasonType.SimilarTo, seed.S.Id, seed.S.Name);
            if (affinity.ContainsKey(_items[i].Genre)) return new Reason(ReasonType.GenreAffinity, Genre: _items[i].Genre);
        }
        if (parts.Collab >= best && parts.Collab > 0) return new Reason(ReasonType.Community);
        if (parts.Trend >= best && parts.Trend > 0) return new Reason(ReasonType.Trending);
        if (parts.Fresh >= best) return new Reason(ReasonType.Fresh);
        if (affinity.ContainsKey(_items[i].Genre)) return new Reason(ReasonType.GenreAffinity, Genre: _items[i].Genre);
        return new Reason(ReasonType.Popular);
    }

    private List<(Guid Id, string Name, Vec Vec, double W)> Seeds(UserContext ctx) =>
        ctx.Signals.Where(s => s.Weight >= 0.4 && _index.ContainsKey(s.TitleId))
            .GroupBy(s => s.TitleId)
            .Select(g => (Id: g.Key, W: g.Sum(s => s.Weight * Decay(s.At))))
            .OrderByDescending(x => x.W).Take(8)
            .Select(x => (x.Id, _items[_index[x.Id]].Name, _vecs[_index[x.Id]], x.W)).ToList();

    private (Vec Pos, Vec Neg) Taste(UserContext ctx)
    {
        var pos = new Dictionary<int, double>();
        var neg = new Dictionary<int, double>();
        foreach (var s in ctx.Signals)
        {
            if (!_index.TryGetValue(s.TitleId, out var i)) continue;
            var w = s.Weight * Decay(s.At);
            var target = w >= 0 ? pos : neg;
            var mag = Math.Abs(w);
            var v = _vecs[i];
            for (var k = 0; k < v.Ids.Length; k++) target[v.Ids[k]] = target.GetValueOrDefault(v.Ids[k]) + mag * v.Vals[k];
        }
        return (FromDense(pos), FromDense(neg));
    }

    private double Collab(List<(Guid Id, double W)> liked, Guid candidate)
    {
        if (!_audience.TryGetValue(candidate, out var ac)) return 0;
        var total = 0.0; var weights = 0.0;
        foreach (var (id, w) in liked)
        {
            weights += w;
            if (!_audience.TryGetValue(id, out var al)) continue;
            var dot = 0.0;
            var (small, big) = al.Count <= ac.Count ? (al, ac) : (ac, al);
            foreach (var (p, v) in small) if (big.TryGetValue(p, out var u)) dot += v * u;
            var denom = _audienceNorm[id] * _audienceNorm[candidate];
            if (denom > 0) total += w * dot / denom;
        }
        return weights > 0 ? total / weights : 0;
    }

    /// <summary>Re-classement MMR : maximise pertinence normalisée moins similarité au déjà choisi.</summary>
    private List<int> Mmr(List<(int I, double Score)> ordered, int n, double lambda = Lambda)
    {
        var pool = ordered.Take(Math.Max(n * 4, 40)).ToList();
        if (pool.Count == 0) return [];
        var max = Math.Max(1e-9, pool.Max(p => p.Score));
        var min = pool.Min(p => p.Score);
        double Norm(double s) => max - min < 1e-9 ? 1 : (s - min) / (max - min);
        var chosen = new List<int>();
        while (chosen.Count < n && pool.Count > 0)
        {
            var best = pool.Select(p => (P: p, V: lambda * Norm(p.Score) - (1 - lambda) * (chosen.Count == 0 ? 0 : chosen.Max(c => Dot(_vecs[c], _vecs[p.I])))))
                .OrderByDescending(x => x.V).First();
            chosen.Add(best.P.I);
            pool.Remove(best.P);
        }
        return chosen;
    }

    private static Dictionary<string, double> Features(CatalogItem it)
    {
        var f = new Dictionary<string, double>();
        void Add(string k, double w) => f[k] = f.GetValueOrDefault(k) + w;
        Add("g:" + KeywordKey(it.Genre), 3.0);
        foreach (var k in it.Keywords) Add("k:" + KeywordKey(k), 2.0);
        foreach (var g in Text.Tokens(it.Synopsis).GroupBy(t => t)) Add("t:" + g.Key, 1.0 + Math.Log(g.Count()));
        foreach (var t in Text.Tokens(it.Name).Distinct()) Add("t:" + t, 0.6);
        Add("kind:" + it.Kind, 1.0);
        if (it.Year > 0) Add("era:" + it.Year / 10 * 10, 0.6);
        return f;
    }

    /// <summary>Clé stable d'un mot-clé ou d'un genre : normalisé, chaque mot ramené à son radical.</summary>
    public static string KeywordKey(string s) => string.Join('_', Text.Normalize(s).Split(' ', StringSplitOptions.RemoveEmptyEntries).Select(Text.Stem));

    private Vec ToVec(IEnumerable<(string Feature, double Weight)> feats)
    {
        var d = new Dictionary<int, double>();
        foreach (var (f, w) in feats)
            if (_featureIds.TryGetValue(f, out var id)) d[id] = d.GetValueOrDefault(id) + w * _idf[id];
        return FromDense(d);
    }

    private static Vec FromDense(Dictionary<int, double> d)
    {
        if (d.Count == 0) return Vec.Empty;
        var norm = Math.Sqrt(d.Values.Sum(v => v * v));
        if (norm <= 0) return Vec.Empty;
        var keys = d.Keys.OrderBy(k => k).ToArray();
        return new Vec(keys, keys.Select(k => (float)(d[k] / norm)).ToArray(), norm);
    }

    private static double Dot(Vec a, Vec b)
    {
        double s = 0; int i = 0, j = 0;
        while (i < a.Ids.Length && j < b.Ids.Length)
        {
            if (a.Ids[i] == b.Ids[j]) { s += a.Vals[i] * b.Vals[j]; i++; j++; }
            else if (a.Ids[i] < b.Ids[j]) i++; else j++;
        }
        return s;
    }

    private static double Cos(Vec a, Vec b) => Dot(a, b); // vecteurs déjà normalisés

    private double Decay(DateTime at) => Math.Pow(0.5, Math.Max(0, (_now - at).TotalDays) / HalfLifeDays);

    private double Freshness(CatalogItem it) => Math.Exp(-Math.Max(0, (_now - it.AddedAt).TotalDays) / 45.0);

    private static int MatchPercent(double content) =>
        content < 0.08 ? 0 : (int)Math.Min(98, Math.Round(100 * (0.5 + 0.5 * Math.Tanh(3.2 * content))));

    /// <summary>Hachage déterministe (graine, identifiant) vers [0, 1).</summary>
    private static double Hash(int seed, Guid id)
    {
        var b = id.ToByteArray();
        uint h = (uint)seed ^ 2166136261u;
        foreach (var x in b) { h ^= x; h *= 16777619u; }
        h ^= h >> 15; h *= 2246822519u; h ^= h >> 13;
        return h / (double)uint.MaxValue;
    }

    private readonly record struct Vec(int[] Ids, float[] Vals, double Norm)
    {
        public static readonly Vec Empty = new([], [], 0);
    }
}
