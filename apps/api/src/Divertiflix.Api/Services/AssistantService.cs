using Divertiflix.Api.Dtos;
using Divertiflix.Domain;
using Divertiflix.Domain.Recommendations;
using Divertiflix.Infrastructure;

namespace Divertiflix.Api.Services;

/// <summary>
/// Assistant conversationnel sans modèle de langage : <see cref="QueryParser"/> comprend la demande,
/// <see cref="RecommendationEngine"/> y répond avec le goût du profil. Il ne peut citer que des titres du
/// catalogue, par construction. Les messages d'ambiance (rédaction FR/EN) sont composés par le client
/// à partir de la réponse structurée.
/// </summary>
public sealed class AssistantService(DivertiflixDbContext db, CatalogCache cache)
{
    private const int MaxCards = 5;

    public async Task<ChatResponse> AskAsync(Guid profileId, string message, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        var snap = await cache.GetAsync(db, ct);
        var state = await ProfileState.LoadAsync(db, profileId, ct);
        var ctx = state.Context(now, profileId);
        var cards = new HomeService.CardFactory(snap, state);
        var hasTaste = snap.Engine.HasTaste(ctx);

        var parsed = snap.Parser.Parse(message);
        var steps = new List<ChatStep>();
        if (hasTaste) steps.Add(new ChatStep("taste", ctx.Signals.Count));
        steps.Add(new ChatStep("catalog", snap.Engine.Items.Count(i => i.Playable)));
        if (parsed.Chips.Count > 0) steps.Add(new ChatStep("criteria", parsed.Chips.Count));
        var chips = parsed.Chips.Select(c => new ChipDto(c.Kind, c.Label)).ToList();

        ChatResponse Reply(string reply, string? param, IEnumerable<Scored> found) =>
            new(reply, param, parsed.UnknownTitle, chips, steps, found.Take(MaxCards).Select(cards.Make).ToList());

        if (parsed.Intent == Intent.Help)
        {
            if (parsed.UnknownTitle is not null)
                return Reply("similarUnknown", parsed.UnknownTitle, snap.Engine.Recommend(ctx, MaxCards));
            return Reply("help", null, []);
        }

        if (parsed.Intent == Intent.Surprise)
        {
            var found = snap.Engine.Search(parsed.Spec, ctx, MaxCards);
            return found.Count > 0 ? Reply("surprise", null, found) : Reply("nothing", null, []);
        }

        if (parsed.Intent == Intent.Similar)
        {
            var seedName = snap.ById[parsed.Spec.SimilarTo!.Value].Name;
            var found = snap.Engine.Search(parsed.Spec, ctx, MaxCards);
            return found.Count > 0 ? Reply("similar", seedName, found) : Reply("nothing", null, []);
        }

        var results = snap.Engine.Search(parsed.Spec, ctx, MaxCards);
        if (results.Count > 0) return Reply("found", null, results);

        // Rien de strict : on relâche durée et époque (jamais les exclusions), en le disant.
        var c = parsed.Spec.Constraints;
        if (c.MaxMinutes is not null || c.MinMinutes is not null || c.YearFrom is not null || c.YearTo is not null)
        {
            var relaxed = parsed.Spec with { Constraints = c with { MaxMinutes = null, MinMinutes = null, YearFrom = null, YearTo = null } };
            results = snap.Engine.Search(relaxed, ctx, MaxCards);
            if (results.Count > 0) return Reply("relaxed", null, results);
        }
        return Reply("nothing", null, []);
    }
}
