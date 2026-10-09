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

/// <summary>Billets d'assistance des abonnés (sera relayé vers GLPI ; le fil de discussion reste ici).</summary>
[ApiController, Route("api/support/tickets"), Authorize, EnableRateLimiting("write")]
public class SupportController(DivertiflixDbContext db, Notifier notifier, IHubContext<NotificationsHub> hub, Audit audit) : ControllerBase
{
    private const int MaxOpenPerUser = 3;

    private static TicketSummaryDto Summary(SupportTicket t) => new(t.Id, t.Subject, t.Category, t.Status, t.CreatedAt, t.UpdatedAt);

    [HttpGet]
    public async Task<List<TicketSummaryDto>> Mine() =>
        await db.Tickets.AsNoTracking().Where(t => t.UserId == User.UserId()).OrderByDescending(t => t.UpdatedAt).Take(50)
            .Select(t => new TicketSummaryDto(t.Id, t.Subject, t.Category, t.Status, t.CreatedAt, t.UpdatedAt)).ToListAsync();

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<TicketDetailDto>> Get(Guid id)
    {
        var uid = User.UserId();
        var t = await db.Tickets.AsNoTracking().Include(t => t.Messages).FirstOrDefaultAsync(t => t.Id == id && (t.UserId == uid || User.IsStaff()));
        if (t is null) return NotFound();
        return new TicketDetailDto(Summary(t), t.Messages.OrderBy(m => m.At).Select(m => new TicketMessageDto(m.Id, m.FromStaff, m.Body, m.At)).ToList());
    }

    [HttpPost]
    public async Task<ActionResult<TicketDetailDto>> Create(TicketCreate req)
    {
        var uid = User.UserId();
        if (await db.Tickets.CountAsync(t => t.UserId == uid && t.Status != TicketStatus.Resolved) >= MaxOpenPerUser)
            return this.Err(409, $"Maximum {MaxOpenPerUser} billets ouverts. Répondez à un billet existant.");
        var t = new SupportTicket { UserId = uid, Subject = req.Subject.Trim(), Category = req.Category };
        t.Messages.Add(new TicketMessage { AuthorId = uid, FromStaff = false, Body = req.Message.Trim() });
        db.Tickets.Add(t);
        audit.Record(uid, "ticket.create", t.Subject);
        await db.SaveChangesAsync();
        await hub.Clients.Group(NotificationsHub.StaffGroup).SendAsync("ticketCreated", new { t.Id, t.Subject });
        return CreatedAtAction(nameof(Get), new { id = t.Id }, new TicketDetailDto(Summary(t), t.Messages.Select(m => new TicketMessageDto(m.Id, false, m.Body, m.At)).ToList()));
    }

    /// <summary>Réponse de l'abonné, ou du personnel (qui prend alors le billet en charge et prévient l'abonné).</summary>
    [HttpPost("{id:guid}/messages")]
    public async Task<ActionResult<TicketMessageDto>> Reply(Guid id, TicketReply req)
    {
        var uid = User.UserId();
        var staff = User.IsStaff();
        var t = await db.Tickets.FirstOrDefaultAsync(t => t.Id == id && (t.UserId == uid || staff));
        if (t is null) return NotFound();
        var fromStaff = staff && t.UserId != uid;
        var m = new TicketMessage { TicketId = t.Id, AuthorId = uid, FromStaff = fromStaff, Body = req.Body.Trim() };
        db.TicketMessages.Add(m);
        t.UpdatedAt = DateTime.UtcNow;
        if (fromStaff && t.Status == TicketStatus.Open) t.Status = TicketStatus.InProgress;
        if (!fromStaff && t.Status == TicketStatus.Resolved) t.Status = TicketStatus.Open;   // une réponse rouvre le billet
        audit.Record(uid, fromStaff ? "ticket.staffReply" : "ticket.reply", t.Subject);
        Notification? n = fromStaff ? notifier.Add(t.UserId, "ticket.reply", t.Subject, null, $"/?aide={t.Id}") : null;
        await db.SaveChangesAsync();
        if (n is not null) await notifier.PushAsync(n);
        else await hub.Clients.Group(NotificationsHub.StaffGroup).SendAsync("ticketReplied", new { t.Id, t.Subject });
        return new TicketMessageDto(m.Id, m.FromStaff, m.Body, m.At);
    }
}
