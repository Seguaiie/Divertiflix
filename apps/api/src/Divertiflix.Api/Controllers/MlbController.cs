using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Divertiflix.Api.Controllers;

/// <summary>Onglet « Domingo » : derniers résultats de la MLB.</summary>
[ApiController, Route("api/mlb"), Authorize]
public class MlbController(MlbResults mlb) : ControllerBase
{
    /// <summary>Les dernières journées de matchs (terminés ou en cours), la plus récente d'abord.</summary>
    [HttpGet("results")]
    public async Task<ActionResult<MlbResultsDto>> Results([FromQuery] int days = 7, CancellationToken ct = default)
    {
        try { return await mlb.LatestAsync(days, ct); }
        catch (Exception ex) when (ex is HttpRequestException or System.Text.Json.JsonException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        { return this.Err(502, "Les résultats de la MLB sont momentanément indisponibles."); }
    }
}
