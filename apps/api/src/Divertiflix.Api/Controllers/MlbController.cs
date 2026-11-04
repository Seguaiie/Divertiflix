using Divertiflix.Api.Dtos;
using Divertiflix.Api.Media;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Divertiflix.Api.Controllers;

/// <summary>Onglet « Domingo » : derniers résultats de la MLB.</summary>
[ApiController, Route("api/mlb"), Authorize]
public class MlbController(MlbResults mlb, StreamSigner signer) : ControllerBase
{
    /// <summary>Les dernières journées de matchs (terminés ou en cours), la plus récente d'abord.</summary>
    [HttpGet("results")]
    public async Task<ActionResult<MlbResultsDto>> Results([FromQuery] int days = 7, CancellationToken ct = default)
    {
        try { return await mlb.LatestAsync(days, ct); }
        catch (Exception ex) when (ex is HttpRequestException or System.Text.Json.JsonException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        { return this.Err(502, "Les résultats de la MLB sont momentanément indisponibles."); }
    }

    /// <summary>Derniers faits saillants vidéo, du match le plus récent au plus ancien.</summary>
    [HttpGet("highlights")]
    public async Task<ActionResult<List<MlbHighlightDto>>> Highlights([FromQuery] int limit = 16, CancellationToken ct = default)
    {
        List<MlbHighlightDto> clips;
        try { clips = await mlb.HighlightsAsync(limit, ct); }
        catch (Exception ex) when (ex is HttpRequestException or System.Text.Json.JsonException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        { return this.Err(502, "Les faits saillants de la MLB sont momentanément indisponibles."); }

        // Vidéos et vignettes relayées par le portail : le navigateur ne contacte jamais la MLB (rien à bloquer pour un bloqueur de publicité).
        // Le jeton (6 h) est propre à la personne : la liste en cache est partagée, les adresses signées ne le sont pas.
        var (token, _) = signer.Sign(User.UserId(), MlbMediaEndpoints.VideoScope, TimeSpan.FromHours(6));
        return clips
            .Select(c => MlbMediaEndpoints.VideoPathOf(c.VideoUrl) is { } path
                ? c with { VideoUrl = $"/api/media/mlb/video/{token}/{path}", PosterUrl = MlbMediaEndpoints.ImageUrlOf(c.PosterUrl) }
                : null)
            .OfType<MlbHighlightDto>()
            .ToList();
    }
}
