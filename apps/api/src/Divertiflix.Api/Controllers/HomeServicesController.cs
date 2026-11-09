using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Divertiflix.Api.Controllers;

/// <summary>Services auto-hébergés : page « Services » du back-office, réservée aux administrateurs (rien dans le portail).</summary>
[ApiController, Authorize(Roles = "Admin")]
public class HomeServicesController(HomeServicesMonitor monitor) : ControllerBase
{
    /// <summary>Page « Services » du back-office : tous les services, avec le détail.</summary>
    [HttpGet("api/admin/services"), Authorize(Roles = "Admin")]
    public List<ServiceProbeDto> All() => monitor.Snapshot().ToList();

    /// <summary>Sonde immédiate (bouton « Vérifier maintenant »), sans attendre le passage de la minute.</summary>
    [HttpPost("api/admin/services/refresh"), Authorize(Roles = "Admin"), EnableRateLimiting("write")]
    public async Task<List<ServiceProbeDto>> Refresh(CancellationToken ct)
    {
        await monitor.ProbeAllAsync(ct);
        return monitor.Snapshot().ToList();
    }
}
