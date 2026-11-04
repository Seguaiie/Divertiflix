using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Divertiflix.Api.Controllers;

/// <summary>Onglet « Nicholas » : les nouvelles du jour sur l'intelligence artificielle.</summary>
[ApiController, Route("api/news"), Authorize]
public class NewsController(AiNews news) : ControllerBase
{
    [HttpGet("ai")]
    public async Task<ActionResult<AiNewsDto>> Ai(CancellationToken ct)
    {
        var result = await news.TodayAsync(ct);
        // Tous les fils en panne : le dire plutôt que d'afficher une page vide « sans nouvelles ».
        if (result.Items.Count == 0 && result.Sources.All(s => !s.Ok)) return this.Err(502, "Les sources de nouvelles ne répondent pas pour le moment.");
        return result;
    }
}
