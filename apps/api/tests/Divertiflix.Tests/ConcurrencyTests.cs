using System.Net;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Tests;

/// <summary>
/// Écritures qui lisent puis décident (plafond, doublon, transition) : des appels simultanés ne doivent pas tous passer.
/// Les appels partent ensemble sur un signal commun, pour maximiser les chances de collision.
/// </summary>
public class ConcurrencyTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    internal static async Task<List<HttpStatusCode>> TogetherAsync(int n, Func<int, Task<HttpResponseMessage>> call)
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

    [Fact]
    public async Task A_staff_reply_and_a_resolution_together_never_undo_the_resolution()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var ids = new List<Guid>();
        for (var u = 0; u < 4; u++)
        {
            var (user, _) = await f.RegisterAsync();
            for (var k = 0; k < 3; k++)
                ids.Add((await (await user.PostAsync("/api/support/tickets", new TicketCreate($"Course {k}", TicketCategory.Other, "Bonjour"))).Content.ReadAsync<TicketDetailDto>())!.Ticket.Id);
        }

        // Pour chaque billet, une réponse du personnel (ouvert vers en cours) part en même temps qu'une résolution : quel que soit
        // l'ordre, le billet finit résolu (sans verrou, la réponse écrasait « résolu » alors que l'abonné avait déjà été prévenu).
        var codes = await TogetherAsync(ids.Count * 2, i => i % 2 == 0
            ? admin.PostAsync($"/api/support/tickets/{ids[i / 2]}/messages", new TicketReply("On regarde"))
            : admin.PutAsync($"/api/admin/tickets/{ids[i / 2]}/status", new TicketStatusUpdate(TicketStatus.Resolved)));
        Assert.All(codes, c => Assert.Equal(HttpStatusCode.OK, c));
        foreach (var id in ids)
            Assert.Equal(TicketStatus.Resolved, (await admin.GetAsync<TicketDetailDto>($"/api/support/tickets/{id}"))!.Ticket.Status);
    }

    [Fact]
    public async Task A_burst_of_writes_on_one_lock_gets_clean_answers_and_leaves_the_pool_free()
    {
        // Toutes les créations de demandes passent par le même verrou : 200 appels simultanés font la queue. Ils attendent dans le
        // processus, sans connexion à la base (sinon la rafale épuise le pool ou PostgreSQL, et même les lectures sans rapport échouent en 500).
        var (c, _) = await f.RegisterAsync();
        await c.GetAsync("/api/titles");   // l'état du compte est connu : la rafale ne mesure que le verrou
        var burst = TogetherAsync(200, i => c.PostAsync("/api/requests", new RequestCreate($"Rafale {i} {Guid.NewGuid():N}", TitleKind.Movie, 2001, null, null)));
        await Task.Delay(200);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/titles")).StatusCode);   // une lecture sans rapport passe pendant la rafale
        var codes = await burst;
        Assert.All(codes, code => Assert.Contains(code, new[] { HttpStatusCode.Created, HttpStatusCode.Conflict, HttpStatusCode.TooManyRequests }));
        Assert.Equal(5, Count(codes, HttpStatusCode.Created));
    }

    [Fact]
    public async Task Waiting_for_a_lock_holds_no_database_connection_and_keeps_calls_exclusive()
    {
        const string key = "test:attente";
        using var holderScope = f.Services.CreateScope();
        var holderDb = holderScope.ServiceProvider.GetRequiredService<DivertiflixDbContext>();
        await using var holder = await holderDb.BeginLockedAsync(key);

        int inside = 0, maxInside = 0;
        var waiters = Enumerable.Range(0, 160).Select(async _ =>
        {
            using var scope = f.Services.CreateScope();
            await using var tx = await scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>().BeginLockedAsync(key);
            var now = Interlocked.Increment(ref inside);
            int seen; while ((seen = Volatile.Read(ref maxInside)) < now && Interlocked.CompareExchange(ref maxInside, now, seen) != seen) { }
            await Task.Delay(1);
            Interlocked.Decrement(ref inside);
            await tx.CommitAsync();
        }).ToList();
        await Task.Delay(500);   // les 160 appels attendent le détenteur

        // Seul le détenteur (et cette requête) occupent une connexion : les attentes n'en tiennent aucune.
        var busy = await holderDb.Database.SqlQuery<int>($"""SELECT count(*)::int AS "Value" FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle'""").SingleAsync();
        Assert.InRange(busy, 1, 3);
        await holder.CommitAsync();
        await Task.WhenAll(waiters);
        Assert.Equal(1, maxInside);   // jamais deux appels à la fois dans la section verrouillée
    }

    [Fact]
    public async Task A_cancelled_wait_leaves_the_queue_and_the_lock_stays_usable()
    {
        const string key = "test:annulation";
        using var scope = f.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>();
        await using var holder = await db.BeginLockedAsync(key);

        using var cts = new CancellationTokenSource();
        using var waiterScope = f.Services.CreateScope();
        var waiting = waiterScope.ServiceProvider.GetRequiredService<DivertiflixDbContext>().BeginLockedAsync(key, cts.Token);
        await Task.Delay(100);
        Assert.False(waiting.IsCompleted);
        await cts.CancelAsync();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => waiting);

        // L'appel annulé n'a rien rendu : le détenteur garde son tour, le suivant attend toujours, puis passe quand il le rend.
        using var again = f.Services.CreateScope();
        var next = again.ServiceProvider.GetRequiredService<DivertiflixDbContext>().BeginLockedAsync(key);
        await Task.Delay(200);
        Assert.False(next.IsCompleted);
        await holder.CommitAsync();
        await using var tx = await next.WaitAsync(TimeSpan.FromSeconds(5));
        await tx.CommitAsync();
    }
}

/// <summary>
/// Le garde-fou « il reste un administrateur actif » se juge sous verrou : deux administrateurs qui se retirent les droits en même temps
/// ne peuvent pas l'emporter tous les deux. Fixture à part : le test retire des droits à root pour de bon le temps d'un tour.
/// </summary>
public class LastAdminConcurrencyTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Two_administrators_removing_each_other_together_leave_exactly_one()
    {
        var (root, rootAuth) = await f.LoginAdminAsync();
        var (_, reg) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.OK, (await root.PutAsync($"/api/admin/users/{reg.User.Id}", new AdminUserUpdate(Role.Admin, null))).StatusCode);
        (Guid Id, string Email, string Password)[] admins = [(rootAuth.User.Id, ApiFactory.AdminEmail, ApiFactory.AdminPassword), (reg.User.Id, reg.User.Email, "Passw0rd!")];

        foreach (var removal in new[] { new AdminUserUpdate(Role.Subscriber, null), new AdminUserUpdate(null, false) })
        {
            var clients = await Task.WhenAll(admins.Select(a => f.LoginAsync(a.Email, a.Password)));
            var codes = await ConcurrencyTests.TogetherAsync(2, i => clients[i].Client.PutAsync($"/api/admin/users/{admins[1 - i].Id}", removal));
            Assert.Equal([HttpStatusCode.OK, HttpStatusCode.Conflict], codes.Order().ToArray());   // 200 puis 409, quel que soit l'ordre d'arrivée

            // Celui qui a gagné reste administrateur actif et rétablit l'autre pour le tour suivant.
            var winner = codes[0] == HttpStatusCode.OK ? 0 : 1;
            var restored = await clients[winner].Client.PutAsync($"/api/admin/users/{admins[1 - winner].Id}", new AdminUserUpdate(Role.Admin, true));
            Assert.Equal(HttpStatusCode.OK, restored.StatusCode);
        }
    }
}
