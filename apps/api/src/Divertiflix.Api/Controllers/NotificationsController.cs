using Divertiflix.Api.Dtos;
using Divertiflix.Api.Support;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

[ApiController, Route("api/notifications"), Authorize]
public class NotificationsController(DivertiflixDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<NotificationsDto> List()
    {
        var uid = User.UserId();
        var items = await db.Notifications.AsNoTracking().Where(n => n.UserId == uid).OrderByDescending(n => n.CreatedAt).Take(30)
            .Select(n => new NotificationDto(n.Id, n.Kind, n.Title, n.Body, n.Link, n.CreatedAt, n.ReadAt != null)).ToListAsync();
        var unread = await db.Notifications.CountAsync(n => n.UserId == uid && n.ReadAt == null);
        return new NotificationsDto(items, unread);
    }

    /// <summary>Marque comme lues les notifications données, ou toutes si aucune liste n'est fournie.</summary>
    [HttpPost("read")]
    public async Task<IActionResult> MarkRead(MarkReadRequest req)
    {
        var uid = User.UserId();
        var now = DateTime.UtcNow;
        var q = db.Notifications.Where(n => n.UserId == uid && n.ReadAt == null);
        if (req.Ids is { Count: > 0 } ids) q = q.Where(n => ids.Contains(n.Id));
        await q.ExecuteUpdateAsync(s => s.SetProperty(n => n.ReadAt, now));
        return NoContent();
    }
}
