using System.Globalization;
using System.Text.Json;
using Divertiflix.Api.Dtos;
using Microsoft.Extensions.Caching.Memory;

namespace Divertiflix.Api.Services;

/// <summary>
/// Derniers résultats de la MLB (onglet « Domingo »), lus dans l'API publique statsapi.mlb.com (sans clé). Le navigateur ne parle qu'au
/// portail : l'API relaie et garde la réponse quelques minutes en mémoire, pour ne pas solliciter la MLB à chaque visite.
/// Hors saison, on remonte jusqu'aux derniers matchs joués (ex. la Série mondiale) plutôt que d'afficher une page vide.
/// </summary>
public sealed class MlbResults(HttpClient http, IMemoryCache cache, ILogger<MlbResults> log)
{
    public const string BaseUrl = "https://statsapi.mlb.com";
    private static readonly TimeSpan Fresh = TimeSpan.FromMinutes(5);
    private static readonly TimeZoneInfo Eastern = TryZone("America/New_York");

    private static TimeZoneInfo TryZone(string id) { try { return TimeZoneInfo.FindSystemTimeZoneById(id); } catch { return TimeZoneInfo.Utc; } }

    /// <summary>Les <paramref name="days"/> dernières journées où des matchs ont été joués (ou sont en cours), la plus récente d'abord.</summary>
    public async Task<MlbResultsDto> LatestAsync(int days, CancellationToken ct)
    {
        days = Math.Clamp(days, 1, 14);
        var key = $"mlb:latest:{days}";
        if (cache.TryGetValue(key, out MlbResultsDto? hit) && hit is not null) return hit;

        // Date du jour à New York : c'est elle qui découpe le calendrier de la MLB.
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, Eastern));
        var found = new List<MlbDayDto>();
        // Fenêtre courte d'abord (saison en cours), puis de plus en plus loin (intersaison : ~5 mois sans match).
        foreach (var back in new[] { 21, 120, 240 })
        {
            found = await ScheduleAsync(today.AddDays(-back), today, ct);
            if (found.Count >= days || back == 240) break;
        }
        var result = new MlbResultsDto(found.OrderByDescending(d => d.Date, StringComparer.Ordinal).Take(days).ToList(), DateTime.UtcNow);
        cache.Set(key, result, Fresh);
        return result;
    }

    /// <summary>Hôtes autorisés pour les vidéos et vignettes : celles de la MLB seulement (la politique de sécurité du site n'ouvre que ces domaines).</summary>
    public const string VideoHost = "mlb-cuts-diamond.mlb.com";
    public const string ImageHost = "img.mlbstatic.com";
    public const string LogoHost = "www.mlbstatic.com";

    /// <summary>Requête brute vers la MLB (relais des médias) : en-têtes d'abord, le corps est lu en continu par l'appelant, qui libère la réponse.</summary>
    public Task<HttpResponseMessage> SendRawAsync(HttpRequestMessage req, CancellationToken ct) =>
        http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);

    /// <summary>
    /// Derniers faits saillants vidéo : quelques clips par match (les mis en avant par la MLB : résumé, match condensé…), du match le plus
    /// récent au plus ancien. Vidéos MP4 lues directement par le navigateur depuis la MLB.
    /// </summary>
    public async Task<List<MlbHighlightDto>> HighlightsAsync(int limit, CancellationToken ct)
    {
        limit = Math.Clamp(limit, 1, 30);
        var key = $"mlb:highlights:{limit}";
        if (cache.TryGetValue(key, out List<MlbHighlightDto>? hit) && hit is not null) return hit;

        var latest = await LatestAsync(3, ct);
        var games = latest.Days.SelectMany(d => d.Games).Take(6).ToList();
        // Contenus des matchs en parallèle ; un match sans vidéo (ou une erreur ponctuelle) n'empêche pas les autres.
        var perGame = await Task.WhenAll(games.Select(async g =>
        {
            try { return await GameHighlightsAsync(g, ct); }
            catch (Exception ex) when (ex is HttpRequestException or JsonException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
            { log.LogDebug(ex, "Faits saillants du match {Game} indisponibles.", g.Id); return []; }
        }));
        var result = perGame.SelectMany(x => x).Take(limit).ToList();
        cache.Set(key, result, TimeSpan.FromMinutes(10));
        return result;
    }

    private async Task<List<MlbHighlightDto>> GameHighlightsAsync(MlbGameDto game, CancellationToken ct)
    {
        using var res = await http.GetAsync($"{BaseUrl}/api/v1/game/{game.Id}/content", ct);
        res.EnsureSuccessStatusCode();
        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var list = new List<MlbHighlightDto>();
        if (!doc.RootElement.TryGetProperty("highlights", out var h) || !h.TryGetProperty("highlights", out var hh) || !hh.TryGetProperty("items", out var items)) return list;
        var matchup = $"{game.Away.Abbreviation} @ {game.Home.Abbreviation}";
        foreach (var it in items.EnumerateArray())
        {
            var video = it.TryGetProperty("playbacks", out var pbs) && pbs.ValueKind == JsonValueKind.Array
                ? pbs.EnumerateArray().Where(p => Str(p, "name") == "mp4Avc").Select(p => Str(p, "url")).FirstOrDefault(u => OnHost(u, VideoHost))
                : null;
            if (video is null) continue;
            string? poster = null;
            if (it.TryGetProperty("image", out var img) && img.TryGetProperty("cuts", out var cuts) && cuts.ValueKind == JsonValueKind.Array)
                poster = cuts.EnumerateArray().Select(c => Str(c, "src")).FirstOrDefault(u => OnHost(u, ImageHost));
            list.Add(new MlbHighlightDto(
                Str(it, "id") ?? video,
                Str(it, "headline") ?? Str(it, "title") ?? matchup,
                Str(it, "blurb") ?? Str(it, "description"),
                Seconds(Str(it, "duration")),
                DateTime.TryParse(Str(it, "date"), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var at) ? at : null,
                video,
                poster,
                matchup,
                game.Id));
            if (list.Count >= 4) break;   // les premiers clips sont ceux que la MLB met en avant
        }
        return list;
    }

    private static bool OnHost(string? url, string host) =>
        Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps && u.Host.Equals(host, StringComparison.OrdinalIgnoreCase);

    /// <summary>« 00:07:28 » → 448.</summary>
    private static int Seconds(string? hms) => TimeSpan.TryParse(hms, CultureInfo.InvariantCulture, out var t) ? (int)t.TotalSeconds : 0;

    private async Task<List<MlbDayDto>> ScheduleAsync(DateOnly from, DateOnly to, CancellationToken ct)
    {
        var url = $"{BaseUrl}/api/v1/schedule?sportId=1&startDate={from:yyyy-MM-dd}&endDate={to:yyyy-MM-dd}&hydrate=linescore,team";
        using var res = await http.GetAsync(url, ct);
        res.EnsureSuccessStatusCode();
        using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(ct), cancellationToken: ct);

        var days = new List<MlbDayDto>();
        if (!doc.RootElement.TryGetProperty("dates", out var dates)) return days;
        foreach (var day in dates.EnumerateArray())
        {
            var games = new List<MlbGameDto>();
            foreach (var g in day.GetProperty("games").EnumerateArray())
                if (Game(g) is { } game) games.Add(game);
            if (games.Count > 0) days.Add(new MlbDayDto(Str(day, "date") ?? "", games));
        }
        return days;
    }

    /// <summary>Un match terminé ou en cours ; les matchs à venir, reportés ou annulés ne sont pas des résultats.</summary>
    private MlbGameDto? Game(JsonElement g)
    {
        try
        {
            var status = g.GetProperty("status");
            var state = Str(status, "abstractGameState");   // Preview, Live, Final
            var detailed = Str(status, "detailedState") ?? "";
            if (state is not ("Final" or "Live") || detailed.StartsWith("Postponed", StringComparison.Ordinal) || detailed.StartsWith("Cancelled", StringComparison.Ordinal))
                return null;

            var teams = g.GetProperty("teams");
            int? inning = g.TryGetProperty("linescore", out var ls) && ls.TryGetProperty("currentInning", out var ci) && ci.ValueKind == JsonValueKind.Number ? ci.GetInt32() : null;
            var inningHalf = g.TryGetProperty("linescore", out var ls2) ? Str(ls2, "inningHalf") : null;
            var series = Str(g, "seriesDescription");
            var gameNumber = g.TryGetProperty("seriesGameNumber", out var sg) && sg.ValueKind == JsonValueKind.Number ? sg.GetInt32() : (int?)null;
            return new MlbGameDto(
                g.GetProperty("gamePk").GetInt64(),
                state == "Live" ? "Live" : "Final",
                detailed,
                Str(g, "gameType") ?? "R",
                series,
                Str(g, "gameType") is "R" or "S" ? null : gameNumber,
                DateTime.TryParse(Str(g, "gameDate"), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var at) ? at : null,
                g.TryGetProperty("venue", out var v) ? Str(v, "name") : null,
                inning,
                inningHalf,
                Team(teams.GetProperty("away"), LineTeam(g, "away")),
                Team(teams.GetProperty("home"), LineTeam(g, "home")),
                Innings(g));
        }
        catch (Exception ex) when (ex is KeyNotFoundException or InvalidOperationException or FormatException)
        {
            log.LogDebug(ex, "Match MLB ignoré (format inattendu).");
            return null;
        }
    }

    /// <summary>Totaux de la feuille de match d'une équipe (points, coups sûrs, erreurs), s'ils sont publiés.</summary>
    private static JsonElement? LineTeam(JsonElement g, string side) =>
        g.TryGetProperty("linescore", out var ls) && ls.TryGetProperty("teams", out var t) && t.TryGetProperty(side, out var v) && v.ValueKind == JsonValueKind.Object ? v : null;

    private static int? Int(JsonElement? e, string name) =>
        e is { } o && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : null;

    /// <summary>Points manche par manche ; null si la feuille n'est pas publiée.</summary>
    private static List<MlbInningDto>? Innings(JsonElement g)
    {
        if (!g.TryGetProperty("linescore", out var ls) || !ls.TryGetProperty("innings", out var inn) || inn.ValueKind != JsonValueKind.Array) return null;
        var list = new List<MlbInningDto>();
        foreach (var i in inn.EnumerateArray())
        {
            if (!i.TryGetProperty("num", out var n) || n.ValueKind != JsonValueKind.Number) continue;
            JsonElement? Side(string s) => i.TryGetProperty(s, out var v) && v.ValueKind == JsonValueKind.Object ? v : null;
            list.Add(new MlbInningDto(n.GetInt32(), Int(Side("away"), "runs"), Int(Side("home"), "runs")));
        }
        return list.Count > 0 ? list : null;
    }

    private static MlbTeamDto Team(JsonElement side, JsonElement? line)
    {
        var team = side.GetProperty("team");
        var id = team.GetProperty("id").GetInt32();
        string? record = side.TryGetProperty("leagueRecord", out var r) && r.TryGetProperty("wins", out var w) && r.TryGetProperty("losses", out var l)
            ? $"{w.GetInt32()}-{l.GetInt32()}" : null;
        return new MlbTeamDto(
            id,
            Str(team, "name") ?? "",
            Str(team, "abbreviation") ?? Str(team, "teamName") ?? "",
            side.TryGetProperty("score", out var s) && s.ValueKind == JsonValueKind.Number ? s.GetInt32() : null,
            side.TryGetProperty("isWinner", out var win) && win.ValueKind == JsonValueKind.True,
            record,
            $"/api/media/mlb/logo/{id}",   // relayé par le portail (voir MlbMediaEndpoints)
            Int(line, "hits"),
            Int(line, "errors"));
    }

    private static string? Str(JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
