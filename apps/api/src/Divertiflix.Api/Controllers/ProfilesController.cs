using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

[ApiController, Route("api/profiles"), Authorize]
public class ProfilesController(DivertiflixDbContext db) : ControllerBase
{
    private const int MaxProfiles = 5;

    private Guid UserId => Guid.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub")!);

    [HttpGet]
    public async Task<List<ProfileDto>> List() =>
        await db.Profiles.AsNoTracking().Where(p => p.UserId == UserId).OrderBy(p => p.Name)
            .Select(p => new ProfileDto(p.Id, p.Name)).ToListAsync();

    [HttpPost]
    public async Task<ActionResult<ProfileDto>> Create(ProfileUpsert req)
    {
        if (await db.Profiles.CountAsync(p => p.UserId == UserId) >= MaxProfiles)
            return Conflict(new { error = $"Maximum {MaxProfiles} profils." });
        var p = new Profile { UserId = UserId, Name = req.Name.Trim() };
        db.Profiles.Add(p);
        await db.SaveChangesAsync();
        return CreatedAtAction(nameof(List), new ProfileDto(p.Id, p.Name));
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<ProfileDto>> Rename(Guid id, ProfileUpsert req)
    {
        var p = await db.Profiles.FirstOrDefaultAsync(p => p.Id == id && p.UserId == UserId);
        if (p is null) return NotFound();
        p.Name = req.Name.Trim();
        await db.SaveChangesAsync();
        return new ProfileDto(p.Id, p.Name);
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var profiles = await db.Profiles.Where(p => p.UserId == UserId).ToListAsync();
        var p = profiles.FirstOrDefault(p => p.Id == id);
        if (p is null) return NotFound();
        if (profiles.Count == 1) return Conflict(new { error = "Impossible de supprimer le dernier profil." });
        db.Profiles.Remove(p);
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("{id:guid}/watchlist")]
    public async Task<ActionResult<List<TitleDto>>> Watchlist(Guid id)
    {
        if (!await Owns(id)) return NotFound();
        var items = await db.Watchlist.AsNoTracking().Where(w => w.ProfileId == id)
            .OrderByDescending(w => w.AddedAt).Select(w => w.Title!).ToListAsync();
        return items.Select(t => new TitleDto(t.Id, t.Name, t.Synopsis, t.Year, t.Kind, t.Genre, t.DurationMinutes, t.PosterUrl, t.StreamUrl)).ToList();
    }

    [HttpPut("{id:guid}/watchlist/{titleId:guid}")]
    public async Task<IActionResult> AddToWatchlist(Guid id, Guid titleId)
    {
        if (!await Owns(id)) return NotFound();
        if (!await db.Titles.AnyAsync(t => t.Id == titleId)) return NotFound();
        if (!await db.Watchlist.AnyAsync(w => w.ProfileId == id && w.TitleId == titleId))
        {
            db.Watchlist.Add(new WatchlistItem { ProfileId = id, TitleId = titleId });
            await db.SaveChangesAsync();
        }
        return NoContent();
    }

    [HttpDelete("{id:guid}/watchlist/{titleId:guid}")]
    public async Task<IActionResult> RemoveFromWatchlist(Guid id, Guid titleId)
    {
        if (!await Owns(id)) return NotFound();
        await db.Watchlist.Where(w => w.ProfileId == id && w.TitleId == titleId).ExecuteDeleteAsync();
        return NoContent();
    }

    private Task<bool> Owns(Guid profileId) => db.Profiles.AnyAsync(p => p.Id == profileId && p.UserId == UserId);
}

public record ProfileUpsert([Required, MaxLength(50)] string Name);
