using System.Net;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;

namespace Divertiflix.Tests;

/// <summary>
/// Écritures qui lisent puis décident (plafond, doublon, transition) : des appels simultanés ne doivent pas tous passer.
/// Les appels partent ensemble sur un signal commun, pour maximiser les chances de collision.
/// </summary>
public class ConcurrencyTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static async Task<List<HttpStatusCode>> TogetherAsync(int n, Func<int, Task<HttpResponseMessage>> call)
    {
        var go = new TaskCompletionSource();
        var tasks = Enumerable.Range(0, n).Select(async i => { await go.Task; return (await call(i)).StatusCode; }).ToList();
        await Task.Delay(50);   // tous les appels sont prêts, en attente du signal
        go.SetResult();
        return [.. await Task.WhenAll(tasks)];
    }

    private static int Count(List<HttpStatusCode> codes, HttpStatusCode code) => codes.Count(c => c == code);

    [Fact]
    public async Task Simultaneous_requests_never_exceed_the_open_cap()
    {
        var (c, _) = await f.RegisterAsync();
        var codes = await TogetherAsync(12, i => c.PostAsync("/api/requests", new RequestCreate($"Plafond {Guid.NewGuid():N}", TitleKind.Movie, 2001, null, null)));
        Assert.Equal(5, Count(codes, HttpStatusCode.Created));
        Assert.Equal(7, Count(codes, HttpStatusCode.Conflict));
        Assert.Equal(5, (await c.GetAsync<List<RequestCardDto>>("/api/requests/mine"))!.Count);
    }

    [Fact]
    public async Task Simultaneous_requests_for_the_same_title_create_only_one()
    {
        var (c, _) = await f.RegisterAsync();
        var (other, _) = await f.RegisterAsync();
        var name = $"Doublon {Guid.NewGuid():N}";
        // Deux comptes, et des variantes de casse : le doublon se juge sur le titre, pas sur l'auteur.
        var codes = await TogetherAsync(8, i => (i % 2 == 0 ? c : other).PostAsync("/api/requests", new RequestCreate(i % 4 < 2 ? name : name.ToUpperInvariant(), TitleKind.Movie, 2001, null, null)));
        Assert.Equal(1, Count(codes, HttpStatusCode.Created));
        Assert.Equal(7, Count(codes, HttpStatusCode.Conflict));
    }

    [Fact]
    public async Task Simultaneous_approvals_of_one_request_apply_once_and_notify_once()
    {
        var (user, _) = await f.RegisterAsync();
        var (admin, _) = await f.LoginAdminAsync();
        var card = (await (await user.PostAsync("/api/requests", new RequestCreate($"Approbation {Guid.NewGuid():N}", TitleKind.Movie, 2001, null, null))).Content.ReadAsync<RequestCardDto>())!;

        var codes = await TogetherAsync(6, _ => admin.PutAsync($"/api/admin/requests/{card.Id}", new RequestStatusUpdate(RequestStatus.Approved, null, null)));
        Assert.Equal(1, Count(codes, HttpStatusCode.OK));
        Assert.Equal(5, Count(codes, HttpStatusCode.Conflict));   // Approved vers Approved est interdit, en séquentiel comme en concurrence
        var notes = (await user.GetAsync<NotificationsDto>("/api/notifications"))!;
        Assert.Equal(1, notes.Items.Count(n => n.Kind == "request.approved"));
    }

    [Fact]
    public async Task Cancelling_while_the_admin_approves_leaves_a_consistent_answer()
    {
        var (user, _) = await f.RegisterAsync();
        var (admin, _) = await f.LoginAdminAsync();
        var card = (await (await user.PostAsync("/api/requests", new RequestCreate($"Course {Guid.NewGuid():N}", TitleKind.Movie, 2001, null, null))).Content.ReadAsync<RequestCardDto>())!;

        var codes = await TogetherAsync(2, i => i == 0 ? user.DeleteAsync($"/api/requests/{card.Id}") : admin.PutAsync($"/api/admin/requests/{card.Id}", new RequestStatusUpdate(RequestStatus.Approved, null, null)));
        // Un seul des deux l'emporte ; l'autre voit l'état réel (jamais une erreur serveur).
        Assert.DoesNotContain(codes, c => (int)c >= 500);
        Assert.Equal(1, codes.Count(c => c is HttpStatusCode.OK or HttpStatusCode.NoContent));
    }

    [Fact]
    public async Task Simultaneous_tickets_never_exceed_the_open_cap()
    {
        var (c, _) = await f.RegisterAsync();
        var codes = await TogetherAsync(8, i => c.PostAsync("/api/support/tickets", new TicketCreate($"Sujet {i}", TicketCategory.Other, "Bonjour")));
        Assert.Equal(3, Count(codes, HttpStatusCode.Created));
        Assert.Equal(5, Count(codes, HttpStatusCode.Conflict));
        Assert.Equal(3, (await c.GetAsync<List<TicketSummaryDto>>("/api/support/tickets"))!.Count);
    }

    [Fact]
    public async Task Simultaneous_resolutions_of_one_ticket_notify_once()
    {
        var (user, _) = await f.RegisterAsync();
        var (admin, _) = await f.LoginAdminAsync();
        var t = (await (await user.PostAsync("/api/support/tickets", new TicketCreate("Lecture", TicketCategory.Playback, "Ça saccade"))).Content.ReadAsync<TicketDetailDto>())!;

        var codes = await TogetherAsync(6, _ => admin.PutAsync($"/api/admin/tickets/{t.Ticket.Id}/status", new TicketStatusUpdate(TicketStatus.Resolved)));
        Assert.All(codes, c => Assert.Equal(HttpStatusCode.OK, c));   // fixer deux fois le même état reste permis
        var notes = (await user.GetAsync<NotificationsDto>("/api/notifications"))!;
        Assert.Equal(1, notes.Items.Count(n => n.Kind == "ticket.resolved"));
    }
}
