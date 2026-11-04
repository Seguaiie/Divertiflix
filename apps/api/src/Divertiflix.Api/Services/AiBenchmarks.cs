using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using Divertiflix.Api.Dtos;
using Microsoft.Extensions.Caching.Memory;

namespace Divertiflix.Api.Services;

/// <summary>
/// Onglet « Nicolas » : classement des modèles d'IA, d'après les données publiques d'Epoch AI (epoch.ai/benchmarks, licence CC BY 4.0 :
/// la source est toujours affichée). L'archive est relue toutes les 6 heures ; aucun score n'est inventé ni recopié à la main.
/// - Classement général : Epoch Capabilities Index (ECI), qui combine les bancs d'essai, avec son intervalle de confiance.
/// - Bancs d'essai : les 10 meilleurs modèles de chacun (meilleure version d'un même modèle).
/// </summary>
public sealed partial class AiBenchmarks(HttpClient http, IMemoryCache cache, ILogger<AiBenchmarks> log)
{
    public const string ArchiveUrl = "https://epoch.ai/data/benchmark_data.zip";
    public const string SourceUrl = "https://epoch.ai/benchmarks";
    private const long MaxArchive = 50 * 1024 * 1024;

    /// <summary>Bancs d'essai affichés : fichier de l'archive, nom, et ce qu'ils mesurent (le texte est traduit côté portail par son identifiant).</summary>
    public static readonly (string Id, string File, string Name)[] Selected =
    [
        ("gpqa", "gpqa_diamond.csv", "GPQA Diamond"),
        ("swe", "swe_bench_verified.csv", "SWE-bench Verified"),
        ("frontiermath", "frontiermath_tiers_1_3_v2.csv", "FrontierMath"),
        ("aime", "otis_mock_aime_2024_2025.csv", "AIME (OTIS)"),
        ("simpleqa", "simpleqa_verified.csv", "SimpleQA Verified"),
        ("arcagi2", "arc_agi_2_external.csv", "ARC-AGI-2"),
    ];

    [GeneratedRegex(@"[^a-z0-9]+")] private static partial Regex NotAlnum();

    public async Task<AiBenchmarksDto> LatestAsync(CancellationToken ct)
    {
        if (cache.TryGetValue("bench:ai", out AiBenchmarksDto? hit) && hit is not null) return hit;

        using var res = await http.GetAsync(ArchiveUrl, HttpCompletionOption.ResponseHeadersRead, ct);
        res.EnsureSuccessStatusCode();
        if (res.Content.Headers.ContentLength > MaxArchive) throw new InvalidOperationException("Archive Epoch AI trop volumineuse.");
        var bytes = await res.Content.ReadAsByteArrayAsync(ct);
        if (bytes.Length > MaxArchive) throw new InvalidOperationException("Archive Epoch AI trop volumineuse.");

        using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        string? Read(string name)
        {
            // Recherche par nom de fichier (l'archive peut changer d'arborescence) ; jamais d'extraction sur disque.
            var entry = zip.Entries.FirstOrDefault(e => e.FullName.EndsWith("/" + name, StringComparison.Ordinal) || e.FullName == name);
            if (entry is null || entry.Length > 10 * 1024 * 1024) return null;
            using var r = new StreamReader(entry.Open(), Encoding.UTF8);
            return r.ReadToEnd();
        }

        // Classement général (ECI) : noms lisibles, organisation, date, intervalle de confiance.
        var eci = Csv(Read("eci_scores.csv") ?? throw new InvalidOperationException("Index ECI absent de l'archive."))
            .Select(r => (Name: r.GetValueOrDefault("Display name") is { Length: > 0 } d ? d : r.GetValueOrDefault("Model") ?? "",
                          Org: r.GetValueOrDefault("Organization") ?? "", Date: r.GetValueOrDefault("date"),
                          Score: Num(r.GetValueOrDefault("eci")), Low: Num(r.GetValueOrDefault("eci_ci_low")), High: Num(r.GetValueOrDefault("eci_ci_high"))))
            .Where(m => m.Score is not null && m.Name.Length > 0)
            .ToList();
        var display = eci.GroupBy(m => Key(m.Name)).ToDictionary(g => g.Key, g => g.First().Name);

        var leaderboard = eci.OrderByDescending(m => m.Score).Take(10)
            .Select(m => new BenchModelDto(m.Name, null, m.Org, m.Date, Math.Round(m.Score!.Value, 1), Round(m.Low), Round(m.High))).ToList();
        var latest = eci.Where(m => m.Date is not null).OrderByDescending(m => m.Date, StringComparer.Ordinal).ThenByDescending(m => m.Score).Take(8)
            .Select(m => new BenchLatestDto(m.Name, m.Org, m.Date, Math.Round(m.Score!.Value, 1))).ToList();

        var benchmarks = new List<BenchmarkDto>();
        foreach (var (id, file, name) in Selected)
        {
            if (Read(file) is not { } text) { log.LogInformation("Banc d'essai {File} absent de l'archive Epoch AI.", file); continue; }
            var rows = Csv(text);
            var col = new[] { "Best score (across scorers)", "Score", "mean_score" }.FirstOrDefault(c => rows.Count > 0 && rows[0].ContainsKey(c));
            if (col is null) continue;
            // Meilleure version de chaque modèle (« gpt-6.1-terra_max » et « gpt-6.1-terra_high » sont le même modèle).
            var top = rows
                .Select(r => (Version: r.GetValueOrDefault("Model version") ?? "", Score: Num(r.GetValueOrDefault(col)), Org: r.GetValueOrDefault("Organization") ?? "", Date: r.GetValueOrDefault("Release date")))
                .Where(r => r.Score is >= 0 and <= 1.0001 && r.Version.Length > 0)
                .GroupBy(r => Key(Base(r.Version)))
                .Select(g => g.OrderByDescending(r => r.Score).First())
                .OrderByDescending(r => r.Score).Take(10)
                .Select(r => new BenchEntryDto(display.GetValueOrDefault(Key(Base(r.Version))) ?? Pretty(Base(r.Version)), Effort(r.Version), r.Org,
                    string.IsNullOrEmpty(r.Date) ? null : r.Date, Math.Round(r.Score!.Value * 100, 1)))
                .ToList();
            if (top.Count > 0) benchmarks.Add(new BenchmarkDto(id, name, top));
        }

        var result = new AiBenchmarksDto(leaderboard, latest, benchmarks, "Epoch AI", SourceUrl, "CC BY 4.0", DateTime.UtcNow);
        cache.Set("bench:ai", result, TimeSpan.FromHours(6));
        return result;
    }

    private static double? Round(double? v) => v is { } x ? Math.Round(x, 1) : null;

    private static double? Num(string? s) =>
        double.TryParse(s?.Trim().TrimEnd('%'), NumberStyles.Float, CultureInfo.InvariantCulture, out var v) && double.IsFinite(v) ? v : null;

    /// <summary>« claude-opus-4-8_max » → « claude-opus-4-8 » (le niveau d'effort est à part).</summary>
    private static string Base(string version) => version.Contains('_') ? version[..version.LastIndexOf('_')] : version;
    private static string? Effort(string version) => version.Contains('_') ? version[(version.LastIndexOf('_') + 1)..] : null;

    /// <summary>Clé de rapprochement : « GPT-6.1 Terra » et « gpt-6.1-terra » donnent toutes deux « gpt61terra ».</summary>
    private static string Key(string name) => NotAlnum().Replace(name.ToLowerInvariant(), "");

    private static readonly Dictionary<string, string> Brands = new(StringComparer.OrdinalIgnoreCase)
    {
        ["gpt"] = "GPT", ["claude"] = "Claude", ["gemini"] = "Gemini", ["deepseek"] = "DeepSeek", ["glm"] = "GLM", ["qwen"] = "Qwen", ["grok"] = "Grok",
        ["llama"] = "Llama", ["mistral"] = "Mistral", ["kimi"] = "Kimi", ["doubao"] = "Doubao", ["oss"] = "OSS", ["pro"] = "Pro", ["flash"] = "Flash",
    };

    /// <summary>Nom lisible à défaut d'entrée dans l'index : « claude-opus-4-8 » → « Claude Opus 4.8 ».</summary>
    private static string Pretty(string id)
    {
        var parts = id.Split('-', StringSplitOptions.RemoveEmptyEntries);
        var words = new List<string>();
        foreach (var p in parts)
        {
            // Numéros de version consécutifs : « 4-8 » → « 4.8 ».
            if (words.Count > 0 && p.All(char.IsDigit) && p.Length <= 2 && words[^1].Length > 0 && char.IsDigit(words[^1][^1]) && !words[^1].Contains('.'))
            { words[^1] += "." + p; continue; }
            words.Add(Brands.TryGetValue(p, out var b) ? b : p.Length > 0 && char.IsLetter(p[0]) ? char.ToUpperInvariant(p[0]) + p[1..] : p);
        }
        // « GPT » suivi de son numéro s'écrit d'un bloc : « GPT-6.1 ».
        var text = string.Join(' ', words);
        return text.StartsWith("GPT ", StringComparison.Ordinal) ? "GPT-" + text[4..] : text;
    }

    /// <summary>Lecteur CSV (RFC 4180 : guillemets, virgules et retours à la ligne dans un champ).</summary>
    public static List<Dictionary<string, string>> Csv(string text)
    {
        var records = new List<List<string>>();
        var row = new List<string>();
        var field = new StringBuilder();
        var quoted = false;
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (quoted)
            {
                if (c == '"' && i + 1 < text.Length && text[i + 1] == '"') { field.Append('"'); i++; }
                else if (c == '"') quoted = false;
                else field.Append(c);
            }
            else if (c == '"') quoted = true;
            else if (c == ',') { row.Add(field.ToString()); field.Clear(); }
            else if (c == '\n' || c == '\r')
            {
                if (c == '\r' && i + 1 < text.Length && text[i + 1] == '\n') i++;
                row.Add(field.ToString()); field.Clear();
                if (row.Count > 1 || row[0].Length > 0) records.Add(row);
                row = [];
            }
            else field.Append(c);
        }
        if (field.Length > 0 || row.Count > 0) { row.Add(field.ToString()); records.Add(row); }
        if (records.Count == 0) return [];
        var header = records[0].Select(h => h.Trim().TrimStart('﻿')).ToList();
        return records.Skip(1)
            .Select(r => header.Select((h, i) => (h, v: i < r.Count ? r[i] : "")).GroupBy(x => x.h).ToDictionary(g => g.Key, g => g.First().v))
            .ToList();
    }
}
