using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

[ApiController, Authorize]
public class HomeController(DivertiflixDbContext db, HomeService home, AssistantService assistant) : ControllerBase
{
    /// <summary>Page d'accueil complète d'un profil : héros et rangées assemblés côté serveur en une requête.</summary>
    [HttpGet("api/home")]
    public async Task<ActionResult<HomeDto>> Home([FromQuery] Guid profileId, CancellationToken ct)
    {
        if (!await Owns(profileId)) return NotFound();
        return await home.BuildAsync(User.UserId(), profileId, ct);
    }

    /// <summary>Assistant de recommandation : comprend une demande libre et répond avec des titres du catalogue.</summary>
    [HttpPost("api/assistant/chat"), EnableRateLimiting("assistant")]
    public async Task<ActionResult<ChatResponse>> Chat(ChatRequest req, CancellationToken ct)
    {
        if (!await Owns(req.ProfileId)) return NotFound();
        return await assistant.AskAsync(req.ProfileId, req.Message, ct);
    }

    private Task<bool> Owns(Guid profileId) => db.Profiles.AnyAsync(p => p.Id == profileId && p.UserId == User.UserId());
}
