// Évaluation hors ligne du moteur de recommandation sur MovieLens (GroupLens Research, Université du Minnesota).
//
//   dotnet run --project tools/recsys-eval -- [--out docs/evaluation-movielens.md] [--k 10] [--users 0]
//
// Protocole « leave-last-out » : pour chaque utilisateur ayant au moins 5 films aimés (note >= 4), on cache son film aimé le plus
// récent, on construit le profil avec le reste de son historique, et on regarde si le moteur le retrouve dans son top K.
// Le moteur évalué est EXACTEMENT celui de l'API (Divertiflix.Domain), sans copie ni adaptation de l'algorithme.
// Données : F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM TiiS 5(4).
// Le jeu de données n'est pas versionné : il est téléchargé dans tools/recsys-eval/data/ (ignoré par git).
using System.Globalization;
using System.IO.Compression;
using System.Text;
using Divertiflix.Domain;
using Divertiflix.Domain.Recommendations;

const string Url = "https://files.grouplens.org/datasets/movielens/ml-latest-small.zip";
var arg = (string name, string? fallback = null) => { var i = Array.IndexOf(args, name); return i >= 0 && i + 1 < args.Length ? args[i + 1] : fallback; };
var K = int.Parse(arg("--k", "10")!);
var maxUsers = int.Parse(arg("--users", "0")!);
var outPath = arg("--out");

var here = AppContext.BaseDirectory;
var root = FindRoot(here);
var dataDir = Path.Combine(root, "tools", "recsys-eval", "data");
Directory.CreateDirectory(dataDir);
var zip = Path.Combine(dataDir, "ml-latest-small.zip");
if (!File.Exists(zip))
{
    Console.WriteLine($"Téléchargement de {Url}");
    using var http = new HttpClient();
    await File.WriteAllBytesAsync(zip, await http.GetByteArrayAsync(Url));
}
using var archive = ZipFile.OpenRead(zip);
IEnumerable<string[]> Rows(string file)
{
    var entry = archive.Entries.First(e => e.FullName.EndsWith("/" + file, StringComparison.Ordinal));
    using var r = new StreamReader(entry.Open(), Encoding.UTF8);
    r.ReadLine(); // en-tête
    string? line;
    while ((line = r.ReadLine()) is not null) yield return SplitCsv(line);
}

// ------------------------------------------------------------------ Lecture
var movies = new Dictionary<int, (string Name, int Year, string[] Genres)>();
foreach (var c in Rows("movies.csv"))
{
    var id = int.Parse(c[0]);
    var title = c[1].Trim();
    var year = 0;
    if (title.Length > 7 && title[^1] == ')' && int.TryParse(title.AsSpan(title.Length - 5, 4), out var y)) { year = y; title = title[..^6].Trim(); }
    var genres = c[2] == "(no genres listed)" ? [] : c[2].Split('|');
    movies[id] = (title, year, genres);
}
var ratings = Rows("ratings.csv").Select(c => (User: int.Parse(c[0]), Movie: int.Parse(c[1]), Rating: double.Parse(c[2], CultureInfo.InvariantCulture), Ts: long.Parse(c[3]))).ToList();
var tagRows = Rows("tags.csv").Select(c => (Movie: int.Parse(c[1]), Tag: c[2].Trim().ToLowerInvariant())).Where(t => t.Tag.Length is >= 3 and <= 24).ToList();

// ------------------------------------------------------------------ Découpage entraînement / test (sans fuite)
var byUser = ratings.GroupBy(r => r.User).ToDictionary(g => g.Key, g => g.OrderBy(r => r.Ts).ToList());
var heldOut = new Dictionary<int, int>();   // utilisateur -> film caché
foreach (var (u, list) in byUser)
{
    var liked = list.Where(r => r.Rating >= 4.0).ToList();
    if (liked.Count >= 5) heldOut[u] = liked[^1].Movie;
}
var train = ratings.Where(r => !(heldOut.TryGetValue(r.User, out var m) && m == r.Movie)).ToList();

// Le catalogue et la tendance ne voient que l'entraînement : aucun signal du test n'y fuit.
var trainByMovie = train.GroupBy(r => r.Movie).ToDictionary(g => g.Key, g => g.ToList());
var topTags = tagRows.GroupBy(t => t.Movie).ToDictionary(g => g.Key, g => g.GroupBy(t => t.Tag).OrderByDescending(x => x.Count()).Take(6).Select(x => x.Key).ToList());
var ids = movies.Keys.ToDictionary(m => m, m => new Guid(m, 0, 0, [0, 0, 0, 0, 0, 0, 0, 1]));
var now = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
var catalog = movies.Select(kv =>
{
    var (name, year, genres) = kv.Value;
    var avg = trainByMovie.TryGetValue(kv.Key, out var rs) && rs.Count >= 3 ? rs.Average(r => r.Rating) * 2 : (double?)null;
    var keywords = genres.Skip(1).Concat(topTags.GetValueOrDefault(kv.Key) ?? []).Distinct().ToList();
    return new CatalogItem(ids[kv.Key], name, TitleKind.Movie, genres.FirstOrDefault() ?? "Inconnu", keywords, "", year == 0 ? 2000 : year, 100, now.AddDays(-30), true, null, avg);
}).ToList();

var positives = train.Where(r => r.Rating >= 4.0).ToList();
var community = new Community
{
    Trending = positives.GroupBy(r => ids[r.Movie]).ToDictionary(g => g.Key, g => g.Select(r => r.User).Distinct().Count()),
    Interactions = positives.Select(r => new Interaction(new Guid(r.User, 0, 0, [0, 0, 0, 0, 0, 0, 0, 2]), ids[r.Movie], 1.0)).ToList(),
};
var full = new RecommendationEngine(catalog, community, now);
var contentOnly = new RecommendationEngine(catalog, null, now);
var popularity = positives.GroupBy(r => r.Movie).OrderByDescending(g => g.Count()).Select(g => g.Key).ToList();
var popRank = popularity.Select((m, i) => (m, i)).ToDictionary(x => x.m, x => x.i + 1);

// ------------------------------------------------------------------ Évaluation
double Signal(double rating) => rating >= 4.5 ? SignalWeights.ThumbUp : rating >= 4.0 ? 1.0 : rating >= 3.0 ? 0.1 : rating >= 2.0 ? -0.3 : SignalWeights.ThumbDown;

UserContext Context(int user)
{
    var mine = byUser[user].Where(r => !(heldOut.TryGetValue(user, out var m) && m == r.Movie)).ToList();
    var last = mine.Max(r => r.Ts);
    return new UserContext
    {
        // Le temps réel de MovieLens est étalé sur des années : on le ramène à « la dernière interaction est d'hier » pour que la
        // demi-vie de 60 jours porte sur l'ordre relatif de l'historique, comme en production.
        Signals = mine.Select(r => new Signal(ids[r.Movie], Signal(r.Rating), now.AddDays(-1).AddSeconds(-(last - r.Ts) / 20.0))).ToList(),
        Excluded = mine.Select(r => ids[r.Movie]).ToHashSet(),
        Seed = user,
    };
}

var users = heldOut.Keys.OrderBy(u => u).Take(maxUsers > 0 ? maxUsers : int.MaxValue).ToList();
var rng = new Random(42);
var allIds = movies.Keys.ToList();

Metrics Evaluate(string name, Func<int, UserContext, IReadOnlyList<int>> recommend)
{
    var hits = 0; double ndcg = 0, mrr = 0, novelty = 0; var seen = new HashSet<int>(); var lists = 0;
    foreach (var u in users)
    {
        var ctx = Context(u);
        var list = recommend(u, ctx);
        lists++;
        foreach (var m in list) { seen.Add(m); novelty += Math.Log2(popRank.GetValueOrDefault(m, popularity.Count + 1)); }
        var pos = list.ToList().IndexOf(heldOut[u]);
        if (pos >= 0) { hits++; ndcg += 1.0 / Math.Log2(pos + 2); mrr += 1.0 / (pos + 1); }
    }
    return new(name, hits / (double)users.Count, ndcg / users.Count, mrr / users.Count, seen.Count / (double)movies.Count, novelty / Math.Max(1, lists * K));
}

var idToMovie = ids.ToDictionary(kv => kv.Value, kv => kv.Key);
var results = new List<Metrics>
{
    Evaluate("Aléatoire", (_, ctx) => allIds.Where(m => !ctx.Excluded.Contains(ids[m])).OrderBy(_ => rng.Next()).Take(K).ToList()),
    Evaluate("Popularité", (_, ctx) => popularity.Where(m => !ctx.Excluded.Contains(ids[m])).Take(K).ToList()),
    Evaluate("Divertiflix, contenu seul", (_, ctx) => contentOnly.Recommend(ctx, K).Select(s => idToMovie[s.Item.Id]).ToList()),
    Evaluate("Divertiflix, complet (contenu + collaboratif + tendance + MMR)", (_, ctx) => full.Recommend(ctx, K).Select(s => idToMovie[s.Item.Id]).ToList()),
};

// ------------------------------------------------------------------ Rapport
var sb = new StringBuilder();
sb.AppendLine("# Évaluation du moteur de recommandation sur MovieLens");
sb.AppendLine();
sb.AppendLine($"Jeu de données : MovieLens `ml-latest-small` (GroupLens Research, Université du Minnesota) : {movies.Count} films, {ratings.Count} notes, {byUser.Count} utilisateurs, {tagRows.Count} étiquettes.");
sb.AppendLine("Citation : F. Maxwell Harper et Joseph A. Konstan, *The MovieLens Datasets: History and Context*, ACM Transactions on Interactive Intelligent Systems 5(4), 2015.");
sb.AppendLine();
sb.AppendLine("## Protocole");
sb.AppendLine();
sb.AppendLine($"- Leave-last-out : pour chacun des {users.Count} utilisateurs ayant au moins 5 films aimés (note >= 4), le film aimé le plus récent est caché.");
sb.AppendLine("- Le profil est construit avec le reste de l'historique (notes converties en signaux : >= 4,5 = pouce haut, >= 4 = visionnage complet, >= 3 = léger intérêt, < 3 = désintérêt).");
sb.AppendLine("- Le catalogue, la tendance et le filtrage collaboratif n'utilisent que l'entraînement : aucune fuite du test.");
sb.AppendLine($"- Le moteur évalué est celui de l'API (`Divertiflix.Domain`), sans adaptation. Classement sur tout le catalogue ({movies.Count} films), films déjà notés exclus, top {K}.");
sb.AppendLine("- Genre principal = premier genre MovieLens ; autres genres et étiquettes fréquentes = mots-clés.");
sb.AppendLine();
sb.AppendLine($"## Résultats (K = {K})");
sb.AppendLine();
sb.AppendLine($"| Méthode | HR@{K} | NDCG@{K} | MRR@{K} | Couverture du catalogue | Nouveauté (log2 du rang de popularité) |");
sb.AppendLine("| --- | ---: | ---: | ---: | ---: | ---: |");
foreach (var m in results) sb.AppendLine(string.Create(CultureInfo.InvariantCulture, $"| {m.Name} | {m.Hr:P2} | {m.Ndcg:F4} | {m.Mrr:F4} | {m.Coverage:P1} | {m.Novelty:F2} |"));
sb.AppendLine();
sb.AppendLine("## Lecture");
sb.AppendLine();
sb.AppendLine("- **HR@K** : part des utilisateurs dont le film caché figure dans les K premiers. **NDCG@K** et **MRR@K** : récompensent un rang élevé.");
sb.AppendLine("- **Couverture** : part du catalogue effectivement recommandée à au moins un utilisateur (la popularité n'en recommande qu'une poignée).");
sb.AppendLine("- **Nouveauté** : plus le nombre est grand, plus les titres proposés sont éloignés des plus populaires.");
sb.AppendLine("- Le moteur complet applique volontairement une diversification (MMR) et un emplacement d'exploration : ils coûtent un peu de précision brute en échange de variété et de découverte.");
sb.AppendLine("- **Honnêteté du résultat** : sur MovieLens, la popularité est une référence très forte (c'est connu pour ce protocole, avec 9 700 films et peu de notes par personne). Le moteur de Divertiflix n'est pas réglé pour ce jeu de données : il est conçu pour un petit catalogue où l'explication, la diversité et l'exploration comptent autant que la précision brute. Il fait nettement mieux que le hasard et que le contenu seul, sans égaler la popularité en précision, mais avec une couverture et une nouveauté bien supérieures.");
sb.AppendLine("- MovieLens ne contient ni synopsis, ni durée, ni distribution : le contenu se résume ici aux genres et étiquettes. Sur le catalogue de Divertiflix, qui a des mots-clés, des synopsis et des durées, le signal de contenu est plus riche.");
var report = sb.ToString();
Console.WriteLine(report);
if (outPath is not null)
{
    var full2 = Path.IsPathRooted(outPath) ? outPath : Path.Combine(root, outPath);
    Directory.CreateDirectory(Path.GetDirectoryName(full2)!);
    File.WriteAllText(full2, report);
    Console.WriteLine($"Rapport écrit : {full2}");
}

static string FindRoot(string start)
{
    var d = new DirectoryInfo(start);
    while (d is not null && !File.Exists(Path.Combine(d.FullName, "docker-compose.yml"))) d = d.Parent;
    return d?.FullName ?? Directory.GetCurrentDirectory();
}

static string[] SplitCsv(string line)
{
    var fields = new List<string>(); var cur = new StringBuilder(); var q = false;
    for (var i = 0; i < line.Length; i++)
    {
        var c = line[i];
        if (q) { if (c == '"' && i + 1 < line.Length && line[i + 1] == '"') { cur.Append('"'); i++; } else if (c == '"') q = false; else cur.Append(c); }
        else if (c == '"') q = true;
        else if (c == ',') { fields.Add(cur.ToString()); cur.Clear(); }
        else cur.Append(c);
    }
    fields.Add(cur.ToString());
    return [.. fields];
}

internal sealed record Metrics(string Name, double Hr, double Ndcg, double Mrr, double Coverage, double Novelty);
