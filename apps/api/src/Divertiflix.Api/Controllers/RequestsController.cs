using Divertiflix.Api.Dtos;
using Divertiflix.Api.Hubs;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

/// <summary>Demandes de contenu des abonnés. Relayées plus tard vers Jellyseerr ; en attendant, traitées par le personnel.</summary>
[ApiController, Route("api/requests"), Authorize, EnableRateLimiting("write")]
public class RequestsController(DivertiflixDbContext db, IHubContext<NotificationsHub> hub, Audit audit) : ControllerBase
{
    private const int MaxOpenPerUser = 5;

    [HttpGet("mine")]
    public async Task<List<RequestCardDto>> Mine() =>
        await db.Requests.AsNoTracking().Where(r => r.UserId == User.UserId()).OrderByDescending(r => r.UpdatedAt).Take(50)
            .Select(r => new RequestCardDto(r.Id, r.Name, r.Kind, r.Year, r.Status, r.UpdatedAt, true, r.TitleId)).ToListAsync();

    [HttpPost]
    public async Task<ActionResult<RequestCardDto>> Create(RequestCreate req)
    {
        var userId = User.UserId();
        var name = req.Name.Trim();
        var kind = req.Kind;
        var year = req.Year;
        Title? title = null;
        if (req.TitleId is { } tid)
        {
            title = await db.Titles.FindAsync(tid);
            if (title is null) return NotFound();
            if (title.IsPlayable) return this.Err(409, "Ce titre est déjà disponible.");
            name = title.Name; kind = title.Kind; year = title.Year;
        }
        var open = new[] { RequestStatus.Pending, RequestStatus.Approved, RequestStatus.Downloading };
        if (await db.Requests.CountAsync(r => r.UserId == userId && open.Contains(r.Status)) >= MaxOpenPerUser)
            return this.Err(409, $"Maximum {MaxOpenPerUser} demandes en cours.");
        var lower = name.ToLower();
        if (await db.Requests.AnyAsync(r => open.Contains(r.Status) && (r.TitleId == req.TitleId && req.TitleId != null || r.Name.ToLower() == lower)))
            return this.Err(409, "Ce titre a déjà été demandé.");

        var r = new MediaRequest { UserId = userId, TitleId = title?.Id, Name = name, Kind = kind, Year = year, Note = string.IsNullOrWhiteSpace(req.Note) ? null : req.Note.Trim() };
        db.Requests.Add(r);
        audit.Record(userId, "request.create", name);
        await db.SaveChangesAsync();
        await hub.Clients.Group(NotificationsHub.StaffGroup).SendAsync("requestCreated", new { r.Id, r.Name });
        return CreatedAtAction(nameof(Mine), new RequestCardDto(r.Id, r.Name, r.Kind, r.Year, r.Status, r.UpdatedAt, true, r.TitleId));
    }

    /// <summary>Annulation d'une demande par son auteur, tant qu'elle n'est pas prise en charge.</summary>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Cancel(Guid id)
    {
        var r = await db.Requests.FirstOrDefaultAsync(r => r.Id == id && r.UserId == User.UserId());
        if (r is null) return NotFound();
        if (r.Status != RequestStatus.Pending) return this.Err(409, "Seules les demandes en attente peuvent être annulées.");
        db.Requests.Remove(r);
        audit.Record(User.UserId(), "request.cancel", r.Name);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
