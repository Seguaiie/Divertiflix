using System.Diagnostics;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Realtime;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

[ApiController]
public class StatusController(DivertiflixDbContext db, MqttStatus mqtt) : ControllerBase
{
    private static readonly string Version = typeof(StatusController).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

    /// <summary>Sonde minimale pour Docker, systemd et nginx : la base répond-elle ?</summary>
    [HttpGet("health"), AllowAnonymous]
    public async Task<IActionResult> Health() =>
        await db.Database.CanConnectAsync() ? Ok(new { status = "ok" }) : StatusCode(503, new { status = "down" });

    /// <summary>État réel des services pour le badge du pied de page. Aucune valeur inventée : chaque état vient d'une mesure.</summary>
    [HttpGet("api/status"), Authorize]
    public async Task<StatusDto> Status()
    {
        var sw = Stopwatch.StartNew();
        var dbUp = false;
        try { dbUp = await db.Database.CanConnectAsync(); } catch { /* indisponible */ }
        sw.Stop();
        var services = new List<ServiceStatus>
        {
            new("api", "up", null),
            new("database", dbUp ? "up" : "down", dbUp ? (int)sw.ElapsedMilliseconds : null),
            new("sensors", mqtt.Connected ? "up" : "down", null),
        };
        // Les capteurs sont un service annexe : leur absence dégrade sans arrêter le portail.
        var state = !dbUp ? "down" : services.Any(s => s.State != "up") ? "degraded" : "up";
        return new StatusDto(Version, state, services, DateTime.UtcNow);
    }
}
