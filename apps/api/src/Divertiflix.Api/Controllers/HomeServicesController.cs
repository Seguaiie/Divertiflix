using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Divertiflix.Api.Controllers;

/// <summary>Services auto-hébergés : ceux du portail pour tous, l'infrastructure complète pour les administrateurs.</summary>
[ApiController, Authorize]
public class HomeServicesController(HomeServicesMonitor monitor) : ControllerBase
{
    /// <summary>Onglet « Services » du portail : les applications ouvertes à tous, avec leur état.</summary>
    [HttpGet("api/services")]
    public List<ServiceProbeDto> Portal() =>
        monitor.Snapshot().Where(s => s.Portal)
            // Le détail technique (émetteur du certificat, code HTTP) reste dans la page d'infrastructure.
            .Select(s => s with { CertIssuer = null, HttpCode = null })
            .ToList();

    /// <summary>Page « Infrastructure » du back-office : tous les services, avec le détail.</summary>
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
