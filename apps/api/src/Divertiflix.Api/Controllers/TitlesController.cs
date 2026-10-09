using System.Security.Claims;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Media;
using Divertiflix.Api.Services;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Divertiflix.Api.Controllers;

[ApiController, Route("api/titles"), Authorize]
public class TitlesController(DivertiflixDbContext db, HomeService home, StreamSigner signer) : ControllerBase
{
    private const int MaxPage = 100_000;

    /// <summary>Catalogue paginé. Recherche insensible à la casse et aux accents (tous les mots doivent correspondre).</summary>
    [HttpGet]
    public async Task<PagedResult<TitleDto>> List([FromQuery] string? q, [FromQuery] string? genre, [FromQuery] TitleKind? kind,
        [FromQuery] bool? available, [FromQuery] string? sort, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        page = Math.Clamp(page, 1, MaxPage);
        pageSize = Math.Clamp(pageSize, 1, 100);
        var query = db.Titles.AsNoTracking().AsQueryable();
        var words = Text.Normalize(q).Split(' ', StringSplitOptions.RemoveEmptyEntries).Take(8).ToList();
        if (!string.IsNullOrWhiteSpace(q) && words.Count == 0) query = query.Where(t => false);   // « % » ou « _ » : rien d'exploitable, pas tout le catalogue
        foreach (var word in words)
        {
            var w = word;
            query = query.Where(t => t.SearchText.Contains(w));
        }
        if (!string.IsNullOrWhiteSpace(genre)) query = query.Where(t => t.Genre == genre);
        if (kind is not null) query = query.Where(t => t.Kind == kind);
        if (available is true) query = query.Where(t => t.StreamUrl != null && t.StreamUrl != "");
        // Recherche : les titres dont le NOM commence par la requête passent avant les correspondances ailleurs (réalisateur, mots-clés).
        var prefix = Text.Normalize(q);
        var ranked = prefix.Length > 0 && sort is null or "" or "name";
        query = sort switch
        {
            _ when ranked => query.OrderByDescending(t => t.SearchText.StartsWith(prefix)).ThenBy(t => t.Name),
            "recent" => query.OrderByDescending(t => t.AddedAt).ThenBy(t => t.Name),
            "rating" => query.OrderByDescending(t => t.Rating ?? 0).ThenBy(t => t.Name),
            "year" => query.OrderByDescending(t => t.Year).ThenBy(t => t.Name),
            _ => query.OrderBy(t => t.Name),
        };
        var total = await query.CountAsync();
        var items = await query.Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        return new PagedResult<TitleDto>(items.Select(TitleMapper.ToDto).ToList(), total, page, pageSize);
    }

    /// <summary>Genres du catalogue avec effectifs (filtres de l'interface, sans télécharger tout le catalogue).</summary>
    [HttpGet("genres")]
    public async Task<List<GenreCount>> Genres([FromQuery] TitleKind? kind) =>
        await db.Titles.AsNoTracking().Where(t => t.Genre != "" && (kind == null || t.Kind == kind))
            .GroupBy(t => t.Genre).OrderByDescending(g => g.Count()).ThenBy(g => g.Key).Select(g => new GenreCount(g.Key, g.Count())).ToListAsync();

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<TitleDto>> Get(Guid id)
    {
        var t = await db.Titles.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id);
        return t is null ? NotFound() : TitleMapper.ToDto(t);
    }

    /// <summary>Fiche complète pour un profil : état personnel, raison de la recommandation, titres proches, demande en cours.</summary>
    [HttpGet("{id:guid}/detail")]
    public async Task<ActionResult<TitleDetailDto>> Detail(Guid id, [FromQuery] Guid profileId, CancellationToken ct)
    {
        if (!await OwnsProfile(profileId)) return NotFound();
        var d = await home.DetailAsync(User.UserId(), profileId, id, ct);
        return d is null ? NotFound() : d;
    }

    /// <summary>URL de lecture du titre : signée et à durée courte pour les médias servis par l'API, directe sinon.</summary>
    [HttpGet("{id:guid}/playback")]
    public async Task<ActionResult<PlaybackDto>> Playback(Guid id, [FromQuery] Guid? profileId)
    {
        var t = await db.Titles.AsNoTracking().FirstOrDefaultAsync(t => t.Id == id);
        if (t is null) return NotFound();
        if (!t.IsPlayable) return this.Err(409, "Ce titre n'est pas encore disponible.");

        var start = 0;
        if (profileId is { } pid && await OwnsProfile(pid))
        {
            var p = await db.Progress.AsNoTracking().FirstOrDefaultAsync(p => p.ProfileId == pid && p.TitleId == id);
            // Reprise à la seconde près ; au-delà de 95 %, on repart du début.
            if (p is { Fraction: > 0.01 and < 0.95 }) start = p.PositionSeconds;
        }

        var source = t.StreamUrl!;
        var url = source;
        var expires = DateTime.UtcNow.AddHours(6);
        if (source.StartsWith("media:", StringComparison.Ordinal))
        {
            source = source["media:".Length..].TrimStart('/');
            var (token, exp) = signer.Sign(User.UserId(), source.Split('/')[0], TimeSpan.FromHours(6));
            url = $"/api/media/stream/{token}/{source}";
            expires = exp;
        }
        return new PlaybackDto(t.Id, url, TitleMapper.KindOf(source) ?? StreamKind.External, start, expires);
    }

    private Task<bool> OwnsProfile(Guid profileId) =>
        db.Profiles.AnyAsync(p => p.Id == profileId && p.UserId == User.UserId());
}
