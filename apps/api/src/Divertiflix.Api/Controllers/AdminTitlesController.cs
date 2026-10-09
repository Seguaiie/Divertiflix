using Divertiflix.Api.Dtos;
using Divertiflix.Api.Hubs;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

/// <summary>Gestion du catalogue : lecture pour le personnel, écriture réservée à l'administrateur.</summary>
[ApiController, Route("api/admin/titles"), Authorize(Roles = "Admin,Support")]
public class AdminTitlesController(DivertiflixDbContext db, IHubContext<NotificationsHub> hub, CatalogCache cache, Audit audit) : ControllerBase
{
    [HttpGet]
    public async Task<PagedResult<AdminTitleDto>> List([FromQuery] string? q, [FromQuery] TitleKind? kind, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        page = Math.Clamp(page, 1, 100_000);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var query = db.Titles.AsNoTracking().AsQueryable();
        var words = Text.Normalize(q).Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(8).ToList();
        if (!string.IsNullOrWhiteSpace(q) && words.Count == 0) query = query.Where(t => false);   // « % » ou « _ » : rien d'exploitable, pas tout le catalogue
        foreach (var word in words)
        {
            var w = word;
            query = query.Where(t => t.SearchText.Contains(w));
        }
        if (kind is not null) query = query.Where(t => t.Kind == kind);
        var total = await query.CountAsync();
        var items = await query.OrderBy(t => t.Name).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return new PagedResult<AdminTitleDto>(items.Select(TitleMapper.ToAdmin).ToList(), total, page, pageSize);
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<AdminTitleDto>> Get(Guid id)
    {
        var t = await db.Titles.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id);
        return t is null ? NotFound() : TitleMapper.ToAdmin(t);
    }

    [HttpPost, Authorize(Roles = "Admin")]
    public async Task<ActionResult<AdminTitleDto>> Create(TitleUpsert req)
    {
        var t = TitleMapper.Apply(new Title(), req);
        db.Titles.Add(t);
        audit.Record(User.UserId(), "title.create", t.Name);
        await db.SaveChangesAsync();
        cache.Invalidate();
        if (t.IsPlayable) await hub.Clients.All.SendAsync("titleAdded", TitleMapper.ToDto(t));
        return CreatedAtAction(nameof(Get), new { id = t.Id }, TitleMapper.ToAdmin(t));
    }

    [HttpPut("{id:guid}"), Authorize(Roles = "Admin")]
    public async Task<ActionResult<AdminTitleDto>> Update(Guid id, TitleUpsert req)
    {
        var t = await db.Titles.FindAsync(id);
        if (t is null) return NotFound();
        var wasPlayable = t.IsPlayable;
        TitleMapper.Apply(t, req);
        audit.Record(User.UserId(), "title.update", t.Name);
        await db.SaveChangesAsync();
        cache.Invalidate();
        if (!wasPlayable && t.IsPlayable) await hub.Clients.All.SendAsync("titleAdded", TitleMapper.ToDto(t));
        return TitleMapper.ToAdmin(t);
    }

    [HttpDelete("{id:guid}"), Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var t = await db.Titles.FindAsync(id);
        if (t is null) return NotFound();
        db.Titles.Remove(t);
        audit.Record(User.UserId(), "title.delete", t.Name);
        await db.SaveChangesAsync();
        cache.Invalidate();
        return NoContent();
    }
}
