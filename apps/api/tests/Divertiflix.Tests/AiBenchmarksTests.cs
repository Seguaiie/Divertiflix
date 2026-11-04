using System.IO.Compression;
using System.Net;
using System.Text;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Tests;

/// <summary>Fausse archive Epoch AI, construite en mémoire avec la même arborescence que la vraie.</summary>
internal sealed class FakeEpoch : HttpMessageHandler
{
    public static bool Down;

    private static byte[] Zip()
    {
        var files = new Dictionary<string, string>
        {
            ["benchmark_data/epoch_capabilities_index/eci_scores.csv"] =
                "Model,Display name,eci,eci_ci_low,eci_ci_high,date,Organization,Country (of organization),Model accessibility,Accessibility group,model_versions\n" +
                "GPT-6.1 Terra,GPT-6.1 Terra,168.11,164.94,172.94,2026-10-26,OpenAI,United States of America,API access,Closed,\n" +
                "Claude Opus 5.5,Claude Opus 5.5,168.4,165.37,173.03,2026-09-22,Anthropic,United States of America,API access,Closed,\n" +
                "\"Mistral Large 4, OSS\",\"Mistral Large 4, OSS\",150.2,147,153,2026-10-29,Mistral AI,France,Open weights,Open,\n" +
                "Sans score,Sans score,,,,2026-11-01,X,Y,,,\n",
            ["benchmark_data/gpqa_diamond.csv"] =
                "Model version,mean_score,Best score (across scorers),Release date,Organization,Country\n" +
                "gpt-6.1-terra_high,0.90,0.91,2026-10-26,OpenAI,USA\n" +
                "gpt-6.1-terra_max,0.94,0.9431818,2026-10-26,OpenAI,USA\n" +
                "claude-opus-4-8_max,0.88,0.885,2026-05-28,Anthropic,USA\n" +
                "broken-model,abc,,2026-01-01,X,Y\n" +
                "weird-model,7,7,2026-01-01,X,Y\n",
            ["benchmark_data/arc_agi_2_external.csv"] =
                "Model version,Score,Release date,Organization,Country\n" +
                "claude-opus-5-5_max,0.95,2026-09-22,Anthropic,USA\n",
        };
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            foreach (var (name, text) in files)
                using (var w = new StreamWriter(zip.CreateEntry(name).Open(), Encoding.UTF8)) w.Write(text);
        return ms.ToArray();
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct) =>
        Task.FromResult(Down
            ? new HttpResponseMessage(HttpStatusCode.ServiceUnavailable)
            : new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Zip()) });
}

public class BenchFactory : ApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s => s.AddHttpClient<AiBenchmarks>().ConfigurePrimaryHttpMessageHandler(() => new FakeEpoch()));
    }
}

public class AiBenchmarksTests(BenchFactory f) : IClassFixture<BenchFactory>
{
    [Fact]
    public async Task Benchmarks_rank_models_from_epoch_data_with_readable_names_and_best_version_only()
    {
        FakeEpoch.Down = false;
        var (user, _) = await f.RegisterAsync();
        var b = (await user.GetAsync<AiBenchmarksDto>("/api/news/ai/benchmarks"))!;

        // Source et licence toujours fournies (CC BY 4.0 : créditer Epoch AI).
        Assert.Equal(("Epoch AI", "CC BY 4.0", "https://epoch.ai/benchmarks"), (b.Source, b.License, b.SourceUrl));

        // Classement général : par ECI, intervalle de confiance, champ CSV avec virgule ; un modèle sans score est écarté.
        Assert.Equal(new[] { "Claude Opus 5.5", "GPT-6.1 Terra", "Mistral Large 4, OSS" }, b.Leaderboard.Select(m => m.Name));
        Assert.Equal((168.4, 165.4, 173.0), (b.Leaderboard[0].Score, b.Leaderboard[0].Low!.Value, b.Leaderboard[0].High!.Value));
        // Derniers modèles : du plus récent au plus ancien.
        Assert.Equal("Mistral Large 4, OSS", b.Latest[0].Name);

        // GPQA : meilleure version de GPT-6.1 Terra seulement, nom lisible pris dans l'index, effort à part, score en %.
        var gpqa = b.Benchmarks.Single(x => x.Id == "gpqa");
        Assert.Equal(new[] { "GPT-6.1 Terra", "Claude Opus 4.8" }, gpqa.Top.Select(m => m.Name));   // « claude-opus-4-8 » mis en forme
        Assert.Equal((94.3, "max"), (gpqa.Top[0].Score, gpqa.Top[0].Effort));
        // Score illisible ou hors de [0, 1] : ignoré.
        Assert.DoesNotContain(gpqa.Top, m => m.Name.Contains("Weird", StringComparison.OrdinalIgnoreCase) || m.Name.Contains("Broken", StringComparison.OrdinalIgnoreCase));

        // ARC-AGI-2 : colonne « Score » ; bancs absents de l'archive simplement omis.
        Assert.Equal(95.0, b.Benchmarks.Single(x => x.Id == "arcagi2").Top.Single().Score);
        Assert.DoesNotContain(b.Benchmarks, x => x.Id == "swe");
    }

    [Fact]
    public async Task Benchmarks_require_a_signed_in_user()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/api/news/ai/benchmarks")).StatusCode);
    }
}
