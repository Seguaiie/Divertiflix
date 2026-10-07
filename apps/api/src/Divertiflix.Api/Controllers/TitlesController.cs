using Divertiflix.Api.Dtos;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

[ApiController, Route("api/titles")]
public class TitlesController(DivertiflixDbContext db) : ControllerBase
{
    [HttpGet, Authorize]
    public async Task<PagedResult<TitleDto>> List([FromQuery] string? q, [FromQuery] string? genre, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var query = db.Titles.AsNoTracking().AsQueryable();
        if (!string.IsNullOrWhiteSpace(q)) query = query.Where(t => EF.Functions.ILike(t.Name, $"%{q}%"));
        if (!string.IsNullOrWhiteSpace(genre)) query = query.Where(t => t.Genre == genre);
        var total = await query.CountAsync();
        var items = await query.OrderBy(t => t.Name).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return new PagedResult<TitleDto>(items.Select(ToDto).ToList(), total, page, pageSize);
    }

    [HttpGet("{id:guid}"), Authorize]
    public async Task<ActionResult<TitleDto>> Get(Guid id)
    {
        var t = await db.Titles.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id);
        return t is null ? NotFound() : ToDto(t);
    }

    [HttpPost, Authorize(Roles = "Admin")]
    public async Task<ActionResult<TitleDto>> Create(TitleUpsert req)
    {
        var t = Apply(new Title(), req);
        db.Titles.Add(t);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(Get), new { id = t.Id }, ToDto(t));
    }

    [HttpPut("{id:guid}"), Authorize(Roles = "Admin")]
    public async Task<ActionResult<TitleDto>> Update(Guid id, TitleUpsert req)
    {
        var t = await db.Titles.FindAsync(id);
        if (t is null) return NotFound();
        Apply(t, req);
        await db.SaveChangesAsync();
        return ToDto(t);
    }

    [HttpDelete("{id:guid}"), Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var t = await db.Titles.FindAsync(id);
        if (t is null) return NotFound();
        db.Titles.Remove(t);
        await db.SaveChangesAsync();
        return NoContent();
    }

    private static Title Apply(Title t, TitleUpsert r)
    {
        t.Name = r.Name; t.Synopsis = r.Synopsis; t.Year = r.Year; t.Kind = r.Kind; t.Genre = r.Genre;
        t.DurationMinutes = r.DurationMinutes; t.PosterUrl = r.PosterUrl; t.StreamUrl = r.StreamUrl;
        return t;
    }

    private static TitleDto ToDto(Title t) => new(t.Id, t.Name, t.Synopsis, t.Year, t.Kind, t.Genre, t.DurationMinutes, t.PosterUrl, t.StreamUrl);
}
