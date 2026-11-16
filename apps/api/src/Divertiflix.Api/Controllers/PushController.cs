using System.ComponentModel.DataAnnotations;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Divertiflix.Api.Controllers;

/// <summary>Abonnements Web Push : un navigateur qui accepte les notifications en enregistre un, qui reçoit alors les mêmes notifications qu'en direct.</summary>
[ApiController, Route("api/push"), Authorize]
public class PushController(DivertiflixDbContext db, IOptions<PushOptions> options) : ControllerBase
{
    [HttpGet("public-key")]
    public ActionResult<PushPublicKeyDto> PublicKey() =>
        options.Value.Configured ? new PushPublicKeyDto(options.Value.PublicKey) : this.Err(409, "Notifications infonuagiques non configurées.");

    [HttpPost("subscribe")]
    public async Task<IActionResult> Subscribe(PushSubscribeRequest req)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "PushSubscriptions" ("Id","UserId","Endpoint","P256dh","Auth","CreatedAt")
            VALUES ({Guid.NewGuid()},{User.UserId()},{req.Endpoint},{req.P256dh},{req.Auth},{DateTime.UtcNow})
            ON CONFLICT ("Endpoint") DO UPDATE SET "UserId" = EXCLUDED."UserId", "P256dh" = EXCLUDED."P256dh", "Auth" = EXCLUDED."Auth"
            """);
        return NoContent();
    }

    [HttpDelete("subscribe")]
    public async Task<IActionResult> Unsubscribe([FromQuery, Required, MaxLength(500)] string endpoint)
    {
        await db.PushSubscriptions.Where(s => s.UserId == User.UserId() && s.Endpoint == endpoint).ExecuteDeleteAsync();
        return NoContent();
    }
}
