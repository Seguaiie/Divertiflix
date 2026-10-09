using System.ComponentModel.DataAnnotations;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

[ApiController, Route("api/profiles"), Authorize]
public class ProfilesController(DivertiflixDbContext db, CatalogCache cache) : ControllerBase
{
    private const int MaxProfiles = 5;

    private Guid UserId => User.UserId();

    [HttpGet]
    public async Task<List<ProfileDto>> List() =>
        await db.Profiles.AsNoTracking().Where(p => p.UserId == UserId).OrderBy(p => p.Name)
            .Select(p => new ProfileDto(p.Id, p.Name)).ToListAsync();

    [HttpPost]
    public async Task<ActionResult<ProfileDto>> Create(ProfileUpsert req)
    {
        if (await db.Profiles.CountAsync(p => p.UserId == UserId) >= MaxProfiles)
            return this.Err(409, $"Maximum {MaxProfiles} profils.");
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
        if (profiles.Count == 1) return this.Err(409, "Impossible de supprimer le dernier profil.");
        db.Profiles.Remove(p);
        await db.SaveChangesAsync();
        return NoContent();
    }

    // ------------------------------------------------------------------ Ma liste

    [HttpGet("{id:guid}/watchlist")]
    public async Task<ActionResult<List<CardDto>>> Watchlist(Guid id, CancellationToken ct)
    {
        if (!await Owns(id)) return NotFound();
        var snap = await cache.GetAsync(db, ct);
        var state = await ProfileState.LoadAsync(db, id, ct);
        var cards = new HomeService.CardFactory(snap, state);
        return state.Watchlist.OrderByDescending(w => w.Value).Where(w => snap.ById.ContainsKey(w.Key)).Select(w => cards.Make(w.Key)).ToList();
    }

    [HttpPut("{id:guid}/watchlist/{titleId:guid}")]
    public async Task<IActionResult> AddToWatchlist(Guid id, Guid titleId)
    {
        if (!await Owns(id)) return NotFound();
        if (!await db.Titles.AnyAsync(t => t.Id == titleId)) return NotFound();
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""INSERT INTO "Watchlist" ("ProfileId","TitleId","AddedAt") VALUES ({id},{titleId},{DateTime.UtcNow}) ON CONFLICT DO NOTHING""");
        return NoContent();
    }

    [HttpDelete("{id:guid}/watchlist/{titleId:guid}")]
    public async Task<IActionResult> RemoveFromWatchlist(Guid id, Guid titleId)
    {
        if (!await Owns(id)) return NotFound();
        await db.Watchlist.Where(w => w.ProfileId == id && w.TitleId == titleId).ExecuteDeleteAsync();
        return NoContent();
    }

    // ------------------------------------------------------------------ Reprise de lecture

    /// <summary>Enregistré toutes les ~10 s par le lecteur. Un upsert atomique évite les conflits entre onglets.</summary>
    [HttpPut("{id:guid}/progress/{titleId:guid}")]
    public async Task<IActionResult> SaveProgress(Guid id, Guid titleId, ProgressUpsert req)
    {
        if (!await Owns(id)) return NotFound();
        var title = await db.Titles.AsNoTracking().Where(t => t.Id == titleId).Select(t => new { t.DurationMinutes }).FirstOrDefaultAsync();
        if (title is null) return NotFound();
        var duration = req.DurationSeconds > 0 ? req.DurationSeconds : title.DurationMinutes * 60;
        if (duration <= 0) return this.Err(400, "Durée inconnue.");
        var position = Math.Clamp(req.PositionSeconds, 0, duration);
        await db.Database.ExecuteSqlInterpolatedAsync($"""
            INSERT INTO "Progress" ("ProfileId","TitleId","PositionSeconds","DurationSeconds","UpdatedAt")
            VALUES ({id},{titleId},{position},{duration},{DateTime.UtcNow})
            ON CONFLICT ("ProfileId","TitleId") DO UPDATE SET "PositionSeconds" = EXCLUDED."PositionSeconds",
              "DurationSeconds" = EXCLUDED."DurationSeconds", "UpdatedAt" = EXCLUDED."UpdatedAt"
            """);
        return NoContent();
    }

    /// <summary>« Retirer de Continuer à regarder ».</summary>
    [HttpDelete("{id:guid}/progress/{titleId:guid}")]
    public async Task<IActionResult> ClearProgress(Guid id, Guid titleId)
    {
        if (!await Owns(id)) return NotFound();
        await db.Progress.Where(p => p.ProfileId == id && p.TitleId == titleId).ExecuteDeleteAsync();
        return NoContent();
    }

    // ------------------------------------------------------------------ Pouces

    /// <summary>1 = pouce haut, -1 = pouce bas, 0 = retire la note.</summary>
    [HttpPut("{id:guid}/ratings/{titleId:guid}")]
    public async Task<IActionResult> Rate(Guid id, Guid titleId, RatingUpsert req)
    {
        if (!await Owns(id)) return NotFound();
        if (!await db.Titles.AnyAsync(t => t.Id == titleId)) return NotFound();
        if (req.Value == 0)
            await db.Ratings.Where(r => r.ProfileId == id && r.TitleId == titleId).ExecuteDeleteAsync();
        else
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO "Ratings" ("ProfileId","TitleId","Value","At") VALUES ({id},{titleId},{(short)Math.Sign(req.Value)},{DateTime.UtcNow})
                ON CONFLICT ("ProfileId","TitleId") DO UPDATE SET "Value" = EXCLUDED."Value", "At" = EXCLUDED."At"
                """);
        return NoContent();
    }

    private Task<bool> Owns(Guid profileId) => db.Profiles.AnyAsync(p => p.Id == profileId && p.UserId == UserId);
}

public record ProfileUpsert([Required, MaxLength(50)] string Name);
