using System.Net;
using System.Net.Http.Json;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;

namespace Divertiflix.Tests;

public class RequestTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static RequestCreate New(string name) => new(name, TitleKind.Movie, 2001, "svp", null);

    [Fact]
    public async Task Creating_duplicate_capped_and_cancelling_requests()
    {
        var (c, _) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.Created, (await c.PostAsync("/api/requests", New("Nosferatu"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsync("/api/requests", New("nosferatu"))).StatusCode);   // doublon, casse indifférente
        for (var i = 0; i < 4; i++) Assert.Equal(HttpStatusCode.Created, (await c.PostAsync("/api/requests", New($"Film {i}"))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsync("/api/requests", New("Trop"))).StatusCode);        // plafond de 5 en cours
        var mine = (await c.GetAsync<List<RequestCardDto>>("/api/requests/mine"))!;
        Assert.Equal(5, mine.Count);
        Assert.All(mine, r => Assert.True(r.Mine));
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/requests/{mine[0].Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await c.PostAsync("/api/requests", New("Après annulation"))).StatusCode);
    }

    [Fact]
    public async Task Requesting_an_already_available_title_is_refused_and_unavailable_ones_are_linked()
    {
        var (c, _) = await f.RegisterAsync();
        var playable = await ApiFactory.TitleAsync(c, "Ligne 9");
        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsync("/api/requests", new RequestCreate("x", TitleKind.Movie, null, null, playable.Id))).StatusCode);
        var elephants = await ApiFactory.TitleAsync(c, "Elephants Dream");
        var res = await c.PostAsync("/api/requests", new RequestCreate("ignoré", TitleKind.Series, null, null, elephants.Id));
        var card = (await res.Content.ReadAsync<RequestCardDto>())!;
        Assert.Equal("Elephants Dream", card.Name);          // nom, type et année viennent du catalogue
        Assert.Equal(TitleKind.Movie, card.Kind);
        Assert.Equal(HttpStatusCode.NotFound, (await c.PostAsync("/api/requests", new RequestCreate("x", TitleKind.Movie, null, null, Guid.NewGuid()))).StatusCode);
    }

    [Fact]
    public async Task Full_lifecycle_request_approval_download_available_with_notifications()
    {
        var (user, _) = await f.RegisterAsync();
        var (admin, _) = await f.LoginAdminAsync();
        var sintel = await ApiFactory.TitleAsync(user, "Spring");
        var card = (await (await user.PostAsync("/api/requests", new RequestCreate("Spring", TitleKind.Movie, 2019, null, sintel.Id))).Content.ReadAsync<RequestCardDto>())!;

        var pending = (await admin.GetAsync<List<AdminRequestDto>>("/api/admin/requests?status=Pending"))!;
        Assert.Contains(pending, r => r.Id == card.Id);

        async Task<HttpResponseMessage> Set(RequestStatus s, Guid? title = null, string? reason = null) =>
            await admin.PutAsync($"/api/admin/requests/{card.Id}", new RequestStatusUpdate(s, title, reason));

        Assert.Equal(HttpStatusCode.Conflict, (await Set(RequestStatus.Available)).StatusCode);       // transition interdite
        Assert.Equal(HttpStatusCode.OK, (await Set(RequestStatus.Approved)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Set(RequestStatus.Downloading)).StatusCode);
        // Le titre n'a toujours pas de source de lecture : impossible de le déclarer disponible.
        Assert.Equal(HttpStatusCode.Conflict, (await Set(RequestStatus.Available)).StatusCode);

        // Le personnel ajoute la source (équivalent de l'arrivée dans Jellyfin) puis termine la demande.
        var admins = (await admin.GetAsync<AdminTitleDto>($"/api/admin/titles/{sintel.Id}"))!;
        var upsert = new TitleUpsert(admins.Name, admins.Synopsis, admins.Year, admins.Kind, admins.Genre, admins.DurationMinutes, admins.PosterUrl, "https://example.org/sintel/index.m3u8", Keywords: [.. admins.Keywords]);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsync($"/api/admin/titles/{sintel.Id}", upsert)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await Set(RequestStatus.Available)).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await Set(RequestStatus.Declined)).StatusCode);        // terminal

        var notes = (await user.GetAsync<NotificationsDto>("/api/notifications"))!;
        Assert.Equal(["request.available", "request.downloading", "request.approved"], notes.Items.Select(n => n.Kind).ToArray());
        Assert.Equal(3, notes.Unread);
        Assert.Equal($"/titres/{sintel.Id}", notes.Items[0].Link);

        // Le titre est maintenant lisible depuis le portail.
        var after = (await user.GetAsync<TitleDto>($"/api/titles/{sintel.Id}"))!;
        Assert.True(after.IsPlayable);
        // Marquer comme lues.
        await user.PostAsync("/api/notifications/read", new MarkReadRequest([notes.Items[0].Id]));
        Assert.Equal(2, (await user.GetAsync<NotificationsDto>("/api/notifications"))!.Unread);
        await user.PostAsync("/api/notifications/read", new MarkReadRequest(null));
        Assert.Equal(0, (await user.GetAsync<NotificationsDto>("/api/notifications"))!.Unread);
    }

    [Fact]
    public async Task Declining_carries_the_reason_and_only_admins_may_change_status()
    {
        var (user, _) = await f.RegisterAsync();
        var (admin, _) = await f.LoginAdminAsync();
        var card = (await (await user.PostAsync("/api/requests", New("Refusé"))).Content.ReadAsync<RequestCardDto>())!;
        Assert.Equal(HttpStatusCode.Forbidden, (await user.PutAsync($"/api/admin/requests/{card.Id}", new RequestStatusUpdate(RequestStatus.Approved, null, null))).StatusCode);
        await admin.PutAsync($"/api/admin/requests/{card.Id}", new RequestStatusUpdate(RequestStatus.Declined, null, "Hors catalogue"));
        var n = (await user.GetAsync<NotificationsDto>("/api/notifications"))!.Items.Single();
        Assert.Equal("request.declined", n.Kind);
        Assert.Equal("Hors catalogue", n.Body);
        // Une demande refusée ne bloque plus le plafond ni les doublons.
        Assert.Equal(HttpStatusCode.Created, (await user.PostAsync("/api/requests", New("Refusé"))).StatusCode);
    }

    [Fact]
    public async Task Users_cannot_see_each_others_notifications()
    {
        var (a, _) = await f.RegisterAsync();
        var (b, _) = await f.RegisterAsync();
        var (admin, _) = await f.LoginAdminAsync();
        var card = (await (await a.PostAsync("/api/requests", New("Privé"))).Content.ReadAsync<RequestCardDto>())!;
        await admin.PutAsync($"/api/admin/requests/{card.Id}", new RequestStatusUpdate(RequestStatus.Approved, null, null));
        Assert.Empty((await b.GetAsync<NotificationsDto>("/api/notifications"))!.Items);
        Assert.Single((await a.GetAsync<NotificationsDto>("/api/notifications"))!.Items);
    }
}

public class SupportTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Ticket_thread_between_user_and_staff_with_notifications_and_reopening()
    {
        var (user, _) = await f.RegisterAsync();
        var (admin, _) = await f.LoginAdminAsync();
        var res = await user.PostAsync("/api/support/tickets", new TicketCreate("Lecture saccadée", TicketCategory.Playback, "Ça saccade sur Ligne 9."));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var t = (await res.Content.ReadAsync<TicketDetailDto>())!;
        Assert.Equal(TicketStatus.Open, t.Ticket.Status);

        var queue = (await admin.GetAsync<List<AdminTicketDto>>("/api/admin/tickets"))!;
        Assert.Contains(queue, q => q.Ticket.Id == t.Ticket.Id && q.Requester.EndsWith("@test.com"));

        await admin.PostAsync($"/api/support/tickets/{t.Ticket.Id}/messages", new TicketReply("Pouvez-vous essayer en 720p ?"));
        var afterStaff = (await user.GetAsync<TicketDetailDto>($"/api/support/tickets/{t.Ticket.Id}"))!;
        Assert.Equal(TicketStatus.InProgress, afterStaff.Ticket.Status);
        Assert.Equal([false, true], afterStaff.Messages.Select(m => m.FromStaff).ToArray());
        Assert.Contains((await user.GetAsync<NotificationsDto>("/api/notifications"))!.Items, n => n.Kind == "ticket.reply" && n.Link == $"/?aide={t.Ticket.Id}");

        await admin.PutAsync($"/api/admin/tickets/{t.Ticket.Id}/status", new TicketStatusUpdate(TicketStatus.Resolved));
        Assert.Contains((await user.GetAsync<NotificationsDto>("/api/notifications"))!.Items, n => n.Kind == "ticket.resolved");
        await user.PostAsync($"/api/support/tickets/{t.Ticket.Id}/messages", new TicketReply("Toujours le même problème."));   // une réponse rouvre
        Assert.Equal(TicketStatus.Open, (await user.GetAsync<TicketDetailDto>($"/api/support/tickets/{t.Ticket.Id}"))!.Ticket.Status);
    }

    [Fact]
    public async Task Tickets_are_private_capped_and_validated()
    {
        var (a, _) = await f.RegisterAsync();
        var (b, _) = await f.RegisterAsync();
        var t = (await (await a.PostAsync("/api/support/tickets", new TicketCreate("Secret", TicketCategory.Account, "Contenu"))).Content.ReadAsync<TicketDetailDto>())!;
        Assert.Equal(HttpStatusCode.NotFound, (await b.GetAsync($"/api/support/tickets/{t.Ticket.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsync($"/api/support/tickets/{t.Ticket.Id}/messages", new TicketReply("intrus"))).StatusCode);
        Assert.Empty((await b.GetAsync<List<TicketSummaryDto>>("/api/support/tickets"))!);
        Assert.Equal(HttpStatusCode.Forbidden, (await a.GetAsync("/api/admin/tickets")).StatusCode);

        Assert.Equal(HttpStatusCode.BadRequest, (await a.PostAsync("/api/support/tickets", new TicketCreate("", TicketCategory.Other, "x"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await a.PostAsync("/api/support/tickets", new TicketCreate("ok", TicketCategory.Other, new string('x', 4001)))).StatusCode);
        await a.PostAsync("/api/support/tickets", new TicketCreate("Deux", TicketCategory.Other, "x"));
        await a.PostAsync("/api/support/tickets", new TicketCreate("Trois", TicketCategory.Other, "x"));
        Assert.Equal(HttpStatusCode.Conflict, (await a.PostAsync("/api/support/tickets", new TicketCreate("Quatre", TicketCategory.Other, "x"))).StatusCode);
    }
}

public class AdminTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Stats_reflect_the_real_catalog()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var s = (await admin.GetAsync<StatsDto>("/api/admin/stats"))!;
        Assert.True(s.Titles >= 27);
        Assert.True(s.Playable < s.Titles);
        Assert.Equal(s.Titles, s.Movies + s.Series + s.Audiobooks);
        Assert.Equal(s.Titles, s.ByGenre.Sum(g => g.Count));
        var (user, _) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await user.GetAsync("/api/admin/stats")).StatusCode);
    }

    [Fact]
    public async Task User_management_guards_self_last_admin_and_revokes_sessions_on_deactivation()
    {
        var (admin, auth) = await f.LoginAdminAsync();
        var (_, victim) = await f.RegisterAsync();
        var list = (await admin.GetAsync<PagedResult<AdminUserDto>>($"/api/admin/users?q={victim.User.Email}"))!;
        Assert.Single(list.Items);

        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsync($"/api/admin/users/{auth.User.Id}", new AdminUserUpdate(Role.Subscriber, null))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsync($"/api/admin/users/{auth.User.Id}", new AdminUserUpdate(null, false))).StatusCode);

        var off = await admin.PutAsync($"/api/admin/users/{victim.User.Id}", new AdminUserUpdate(null, false));
        Assert.False((await off.Content.ReadAsync<AdminUserDto>())!.IsActive);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().PostAsync("/api/auth/refresh", new RefreshRequest(victim.RefreshToken))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().PostAsync("/api/auth/login", new LoginRequest(victim.User.Email, "Passw0rd!"))).StatusCode);

        // Promotion d'un abonné en support : il accède à la console mais ne peut pas écrire.
        var (_, agent) = await f.RegisterAsync();
        await admin.PutAsync($"/api/admin/users/{agent.User.Id}", new AdminUserUpdate(Role.Support, null));
        var (support, _) = await f.LoginAsync(agent.User.Email, "Passw0rd!");
        Assert.Equal(HttpStatusCode.OK, (await support.GetAsync("/api/admin/stats")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await support.GetAsync("/api/admin/titles")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await support.PutAsync($"/api/admin/users/{victim.User.Id}", new AdminUserUpdate(null, true))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await support.DeleteAsync($"/api/admin/titles/{Guid.NewGuid()}")).StatusCode);
    }

    [Fact]
    public async Task Health_is_anonymous_and_status_reports_measured_states()
    {
        Assert.Equal(HttpStatusCode.OK, (await f.CreateClient().GetAsync("/health")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/api/status")).StatusCode);
        var (c, _) = await f.RegisterAsync();
        var s = (await c.GetAsync<StatusDto>("/api/status"))!;
        Assert.Equal("up", s.Services.Single(x => x.Id == "database").State);
        Assert.NotNull(s.Services.Single(x => x.Id == "database").LatencyMs);
        // Mosquitto n'est pas lancé pendant les tests : état dégradé, pas « tout va bien ».
        Assert.Equal("down", s.Services.Single(x => x.Id == "sensors").State);
        Assert.Equal("degraded", s.State);
    }
}
