using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

/// <summary>Console d'exploitation (back-office Angular) : statistiques, comptes, demandes, billets.</summary>
[ApiController, Route("api/admin"), Authorize(Roles = "Admin,Support")]
public class AdminController(DivertiflixDbContext db, Notifier notifier, CatalogCache cache, Audit audit) : ControllerBase
{
    [HttpGet("stats")]
    public async Task<StatsDto> Stats()
    {
        var now = DateTime.UtcNow;
        var titles = await db.Titles.AsNoTracking().Select(t => new { t.Kind, t.Genre, Playable = t.StreamUrl != null && t.StreamUrl != "" }).ToListAsync();
        var byGenre = titles.Where(t => t.Genre != "").GroupBy(t => t.Genre).Select(g => new GenreCount(g.Key, g.Count())).OrderByDescending(g => g.Count).ThenBy(g => g.Genre).ToList();
        var open = new[] { RequestStatus.Approved, RequestStatus.Downloading };
        return new StatsDto(
            titles.Count, titles.Count(t => t.Playable),
            titles.Count(t => t.Kind == TitleKind.Movie), titles.Count(t => t.Kind == TitleKind.Series), titles.Count(t => t.Kind == TitleKind.Audiobook), byGenre,
            await db.Users.CountAsync(), await db.Users.CountAsync(u => u.IsActive), await db.Users.CountAsync(u => u.Role != Role.Subscriber),
            await db.Requests.CountAsync(r => r.Status == RequestStatus.Pending), await db.Requests.CountAsync(r => open.Contains(r.Status)),
            await db.Tickets.CountAsync(t => t.Status != TicketStatus.Resolved),
            await db.Progress.Where(p => p.UpdatedAt >= now.AddDays(-7)).Select(p => p.ProfileId).Distinct().CountAsync(),
            await db.Progress.CountAsync(p => p.UpdatedAt >= now.AddHours(-24)));
    }

    // ------------------------------------------------------------------ Comptes (Admin uniquement)

    [HttpGet("users")]
    public async Task<PagedResult<AdminUserDto>> Users([FromQuery] string? q, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        page = Math.Clamp(page, 1, 100_000);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var query = db.Users.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(q)) { var needle = q.Trim().ToLowerInvariant(); query = query.Where(u => u.Email.Contains(needle)); }
        var total = await query.CountAsync();
        var items = await query.OrderBy(u => u.Email).Skip((page - 1) * pageSize).Take(pageSize)
            .Select(u => new AdminUserDto(u.Id, u.Email, u.Role, u.Source, u.IsActive, u.CreatedAt, u.Profiles.Count)).ToListAsync();
        return new PagedResult<AdminUserDto>(items, total, page, pageSize);
    }

    [HttpPut("users/{id:guid}"), Authorize(Roles = "Admin")]
    public async Task<ActionResult<AdminUserDto>> UpdateUser(Guid id, AdminUserUpdate req)
    {
        var user = await db.Users.Include(u => u.Profiles).FirstOrDefaultAsync(u => u.Id == id);
        if (user is null) return NotFound();
        var me = User.UserId();
        if (id == me && (req.IsActive == false || (req.Role is { } r && r != Role.Admin)))
            return this.Err(409, "Vous ne pouvez pas retirer vos propres droits ni désactiver votre compte.");
        if (user.Role == Role.Admin && (req.IsActive == false || (req.Role is { } r2 && r2 != Role.Admin))
            && await db.Users.CountAsync(u => u.Role == Role.Admin && u.IsActive && u.Id != id) == 0)
            return this.Err(409, "Il doit rester au moins un administrateur actif.");

        if (req.Role is { } role) user.Role = role;
        if (req.IsActive is { } active)
        {
            user.IsActive = active;
            if (!active)   // un compte désactivé perd ses sessions renouvelables immédiatement
            {
                var now = DateTime.UtcNow;
                await db.RefreshTokens.Where(t => t.UserId == id && t.RevokedAt == null).ExecuteUpdateAsync(s => s.SetProperty(t => t.RevokedAt, now));
            }
        }
        audit.Record(me, "user.update", user.Email, $"role={user.Role} active={user.IsActive}");
        await db.SaveChangesAsync();
        return new AdminUserDto(user.Id, user.Email, user.Role, user.Source, user.IsActive, user.CreatedAt, user.Profiles.Count);
    }

    // ------------------------------------------------------------------ Demandes de contenu

    [HttpGet("requests")]
    public async Task<List<AdminRequestDto>> Requests([FromQuery] RequestStatus? status)
    {
        var q = db.Requests.AsNoTracking().Include(r => r.User).AsQueryable();
        if (status is { } s) q = q.Where(r => r.Status == s);
        var rows = await q.OrderBy(r => r.Status == RequestStatus.Pending ? 0 : r.Status == RequestStatus.Available || r.Status == RequestStatus.Declined ? 2 : 1)
            .ThenByDescending(r => r.UpdatedAt).Take(200).ToListAsync();
        return rows.Select(r => new AdminRequestDto(r.Id, r.Name, r.Kind, r.Year, r.Note, r.Status, r.TitleId, r.User!.Email, r.CreatedAt, r.UpdatedAt)).ToList();
    }

    private static readonly Dictionary<RequestStatus, RequestStatus[]> Transitions = new()
    {
        [RequestStatus.Pending] = [RequestStatus.Approved, RequestStatus.Declined],
        [RequestStatus.Approved] = [RequestStatus.Downloading, RequestStatus.Available, RequestStatus.Declined],
        [RequestStatus.Downloading] = [RequestStatus.Available, RequestStatus.Declined],
    };

    [HttpPut("requests/{id:guid}"), Authorize(Roles = "Admin")]
    public async Task<ActionResult<AdminRequestDto>> UpdateRequest(Guid id, RequestStatusUpdate req)
    {
        var r = await db.Requests.Include(r => r.User).FirstOrDefaultAsync(r => r.Id == id);
        if (r is null) return NotFound();
        if (!Transitions.TryGetValue(r.Status, out var allowed) || !allowed.Contains(req.Status))
            return this.Err(409, $"Transition impossible : {r.Status} vers {req.Status}.");

        if (req.Status == RequestStatus.Available)
        {
            var titleId = req.TitleId ?? r.TitleId;
            var title = titleId is null ? null : await db.Titles.FindAsync(titleId);
            if (title is null) return this.Err(409, "Indiquez le titre du catalogue qui satisfait la demande.");
            if (!title.IsPlayable) return this.Err(409, "Le titre lié n'a pas de source de lecture : ajoutez-la d'abord au catalogue.");
            r.TitleId = title.Id;
        }

        r.Status = req.Status;
        r.UpdatedAt = DateTime.UtcNow;
        var link = r.TitleId is { } tid ? $"/titres/{tid}" : null;
        var n = notifier.Add(r.UserId, $"request.{req.Status.ToString().ToLowerInvariant()}", r.Name, req.Status == RequestStatus.Declined ? req.Reason : null, req.Status == RequestStatus.Available ? link : null);
        audit.Record(User.UserId(), "request." + req.Status.ToString().ToLowerInvariant(), r.Name);
        await db.SaveChangesAsync();
        cache.Invalidate();
        await notifier.PushAsync(n);
        return new AdminRequestDto(r.Id, r.Name, r.Kind, r.Year, r.Note, r.Status, r.TitleId, r.User!.Email, r.CreatedAt, r.UpdatedAt);
    }

    // ------------------------------------------------------------------ Billets d'assistance

    [HttpGet("tickets")]
    public async Task<List<AdminTicketDto>> Tickets([FromQuery] TicketStatus? status)
    {
        var q = db.Tickets.AsNoTracking().AsQueryable();
        if (status is { } s) q = q.Where(t => t.Status == s);
        return await q.OrderBy(t => t.Status == TicketStatus.Resolved ? 1 : 0).ThenByDescending(t => t.UpdatedAt).Take(200)
            .Select(t => new AdminTicketDto(new TicketSummaryDto(t.Id, t.Subject, t.Category, t.Status, t.CreatedAt, t.UpdatedAt), t.User!.Email, t.Messages.Count)).ToListAsync();
    }

    [HttpPut("tickets/{id:guid}/status")]
    public async Task<ActionResult<TicketSummaryDto>> UpdateTicket(Guid id, TicketStatusUpdate req)
    {
        var t = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id);
        if (t is null) return NotFound();
        var wasResolved = t.Status == TicketStatus.Resolved;
        t.Status = req.Status;
        t.UpdatedAt = DateTime.UtcNow;
        Notification? n = req.Status == TicketStatus.Resolved && !wasResolved ? notifier.Add(t.UserId, "ticket.resolved", t.Subject, null, $"/?aide={t.Id}") : null;
        audit.Record(User.UserId(), "ticket." + req.Status.ToString().ToLowerInvariant(), t.Subject);
        await db.SaveChangesAsync();
        if (n is not null) await notifier.PushAsync(n);
        return new TicketSummaryDto(t.Id, t.Subject, t.Category, t.Status, t.CreatedAt, t.UpdatedAt);
    }
}
