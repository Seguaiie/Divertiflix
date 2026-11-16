using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Divertiflix.Api.Controllers;

/// <summary>Onglet « Nicolas » (intelligence artificielle) et onglet « Divertissement » (centres d'intérêt de l'équipe).</summary>
[ApiController, Route("api/news"), Authorize]
public class NewsController(AiNews news, AiBenchmarks benchmarks, HobbyNews hobby) : ControllerBase
{
    [HttpGet("ai")]
    public async Task<ActionResult<AiNewsDto>> Ai(CancellationToken ct)
    {
        var result = await news.TodayAsync(ct);
        // Tous les fils en panne : le dire plutôt que d'afficher une page vide « sans nouvelles ».
        if (result.Items.Count == 0 && result.Sources.All(s => !s.Ok)) return this.Err(502, "Les sources de nouvelles ne répondent pas pour le moment.");
        return result;
    }

    /// <summary>Classement des modèles d'IA (Epoch AI, relu toutes les 6 h).</summary>
    [HttpGet("ai/benchmarks")]
    public async Task<ActionResult<AiBenchmarksDto>> Benchmarks(CancellationToken ct)
    {
        try { return await benchmarks.LatestAsync(ct); }
        catch (Exception ex) when (ex is HttpRequestException or InvalidOperationException or InvalidDataException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        { return this.Err(502, "Le classement des modèles est momentanément indisponible."); }
    }

    /// <summary>Onglet « Divertissement » : les rubriques suivies par un membre de l'équipe.</summary>
    [HttpGet("divertissement/{person}")]
    public async Task<ActionResult<HobbyNewsDto>> Divertissement(Teammate person, CancellationToken ct)
    {
        var result = await hobby.ForAsync(person, ct);
        if (result.Sections.All(s => s.Items.Count == 0 && s.Sources.All(src => !src.Ok)))
            return this.Err(502, "Les sources de nouvelles ne répondent pas pour le moment.");
        return result;
    }
}
