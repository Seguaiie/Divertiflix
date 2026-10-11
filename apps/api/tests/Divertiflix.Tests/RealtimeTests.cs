using System.Net;
using System.Net.Http.Json;
using Divertiflix.Api.Auth;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Tests;

/// <summary>Le hub SignalR : les abonnés ne reçoivent jamais la télémétrie d'exploitation ; chacun reçoit ses propres notifications.</summary>
public class RealtimeTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private async Task<HubConnection> ConnectAsync(string token)
    {
        var conn = new HubConnectionBuilder()
            .WithUrl(new Uri(f.Server.BaseAddress, "/api/hubs/notifications"), o =>
            {
                o.HttpMessageHandlerFactory = _ => f.Server.CreateHandler();
                o.Transports = HttpTransportType.LongPolling;
                o.AccessTokenProvider = () => Task.FromResult<string?>(token);
            }).Build();
        await conn.StartAsync();
        return conn;
    }

    private static async Task<bool> Received(Task<bool> got, int ms = 1500) => await Task.WhenAny(got, Task.Delay(ms)) == got && await got;

    [Fact]
    public async Task Hub_requires_authentication()
    {
        var res = await f.CreateClient().PostAsync("/api/hubs/notifications/negotiate?negotiateVersion=1", null);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Operations_events_reach_staff_only()
    {
        var (_, admin) = await f.LoginAdminAsync();
        var (_, viewer) = await f.RegisterAsync();
        await using var staffConn = await ConnectAsync(admin.AccessToken);
        await using var viewerConn = await ConnectAsync(viewer.AccessToken);
        var staffGot = new TaskCompletionSource<bool>(); var viewerGot = new TaskCompletionSource<bool>();
        staffConn.On<object>("directorySynced", _ => staffGot.TrySetResult(true));
        viewerConn.On<object>("directorySynced", _ => viewerGot.TrySetResult(true));

        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/admin/directory-sync") { Content = JsonContent.Create(new DirectorySyncRequest([new($"rt{Guid.NewGuid():N}@corp.test", "RT", [])]), options: Json.Options) };
        msg.Headers.Add("X-Sync-Key", ApiFactory.SyncKey);
        Assert.Equal(HttpStatusCode.OK, (await f.CreateClient().SendAsync(msg)).StatusCode);

        Assert.True(await Received(staffGot.Task), "le personnel reçoit la synchro");
        Assert.False(await Received(viewerGot.Task, 800), "un abonné ne doit jamais la recevoir");
    }

    private async Task<(HubConnection Conn, Task Closed, AuthResponse Auth)> StaffConnectionAsync(HttpClient admin)
    {
        var (_, reg) = await f.RegisterAsync();
        await admin.PutAsync($"/api/admin/users/{reg.User.Id}", new AdminUserUpdate(Role.Support, null));
        var (_, support) = await f.LoginAsync(reg.User.Email, "Passw0rd!");
        var conn = await ConnectAsync(support.AccessToken);
        var closed = new TaskCompletionSource();
        conn.Closed += _ => { closed.TrySetResult(); return Task.CompletedTask; };
        return (conn, closed.Task, support);
    }

    [Fact]
    public async Task A_deactivated_staff_member_is_disconnected_at_once_and_cannot_come_back_with_the_old_token()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var (conn, closed, support) = await StaffConnectionAsync(admin);
        await using var staffConn = conn;
        Assert.Equal(HubConnectionState.Connected, conn.State);

        await admin.PutAsync($"/api/admin/users/{support.User.Id}", new AdminUserUpdate(null, false));
        Assert.Same(closed, await Task.WhenAny(closed, Task.Delay(5000)));
        await Assert.ThrowsAnyAsync<Exception>(() => ConnectAsync(support.AccessToken));
    }

    [Fact]
    public async Task A_demoted_staff_member_is_disconnected_and_no_longer_receives_staff_events()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var (conn, closed, support) = await StaffConnectionAsync(admin);
        await using var staffConn = conn;

        await admin.PutAsync($"/api/admin/users/{support.User.Id}", new AdminUserUpdate(Role.Subscriber, null));
        Assert.Same(closed, await Task.WhenAny(closed, Task.Delay(5000)));

        // Reconnecté avec un jeton à jour (abonné), il ne reçoit plus les évènements d'exploitation.
        var (_, subscriber) = await f.LoginAsync(support.User.Email, "Passw0rd!");
        await using var again = await ConnectAsync(subscriber.AccessToken);
        var got = new TaskCompletionSource<bool>();
        again.On<object>("directorySynced", _ => got.TrySetResult(true));
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/admin/directory-sync") { Content = JsonContent.Create(new DirectorySyncRequest([new($"dm{Guid.NewGuid():N}@corp.test", "DM", [])]), options: Json.Options) };
        msg.Headers.Add("X-Sync-Key", ApiFactory.SyncKey);
        await f.CreateClient().SendAsync(msg);
        Assert.False(await Received(got.Task, 800));
    }

    [Fact]
    public async Task Logout_all_cuts_the_realtime_connections_of_the_account()
    {
        var (client, auth) = await f.RegisterAsync();
        await using var conn = await ConnectAsync(auth.AccessToken);
        var closed = new TaskCompletionSource();
        conn.Closed += _ => { closed.TrySetResult(); return Task.CompletedTask; };

        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/logout-all", (object?)null)).StatusCode);
        Assert.Same(closed.Task, await Task.WhenAny(closed.Task, Task.Delay(5000)));
    }

    private async Task SyncAsync(params DirectoryAccountDto[] accounts)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/admin/directory-sync?force=true") { Content = JsonContent.Create(new DirectorySyncRequest([.. accounts]), options: Json.Options) };
        msg.Headers.Add("X-Sync-Key", ApiFactory.SyncKey);
        Assert.Equal(HttpStatusCode.OK, (await f.CreateClient().SendAsync(msg)).StatusCode);
    }

    [Fact]
    public async Task A_role_change_by_directory_sync_cuts_the_realtime_connection_of_that_account()
    {
        var email = $"rc{Guid.NewGuid():N}@corp.test";
        await SyncAsync(new DirectoryAccountDto(email, "RC", ["Divertiflix-Support"]));
        try
        {
            // Un compte d'annuaire n'a pas de mot de passe utilisable : on lui donne un jeton comme le ferait un futur échange Kerberos/LDAP.
            string token;
            using (var scope = f.Services.CreateScope())
            {
                var user = await scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>().Users.SingleAsync(u => u.Email == email);
                token = scope.ServiceProvider.GetRequiredService<TokenService>().CreateAccessToken(user);
            }
            await using var conn = await ConnectAsync(token);
            var closed = new TaskCompletionSource();
            conn.Closed += _ => { closed.TrySetResult(); return Task.CompletedTask; };

            await SyncAsync(new DirectoryAccountDto(email, "RC", []));   // plus dans le groupe Support : le rôle change, le compte reste actif
            Assert.Same(closed.Task, await Task.WhenAny(closed.Task, Task.Delay(5000)));
        }
        finally { await SyncAsync(); }   // l'annuaire se vide : le compte part, les autres tests de la classe synchronisent sans garde-fou de masse
    }

    [Fact]
    public async Task Notifications_are_pushed_only_to_their_recipient_in_real_time()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var (user, auth) = await f.RegisterAsync();
        var (_, other) = await f.RegisterAsync();
        await using var userConn = await ConnectAsync(auth.AccessToken);
        await using var otherConn = await ConnectAsync(other.AccessToken);
        var userGot = new TaskCompletionSource<NotificationDto>(); var otherGot = new TaskCompletionSource<bool>();
        userConn.On<NotificationDto>("notification", n => userGot.TrySetResult(n));
        otherConn.On<object>("notification", _ => otherGot.TrySetResult(true));

        var card = (await (await user.PostAsync("/api/requests", new RequestCreate("En direct", TitleKind.Movie, null, null, null))).Content.ReadAsync<RequestCardDto>())!;
        await admin.PutAsync($"/api/admin/requests/{card.Id}", new RequestStatusUpdate(RequestStatus.Approved, null, null));

        var got = await Task.WhenAny(userGot.Task, Task.Delay(3000));
        Assert.Same(userGot.Task, got);
        Assert.Equal("request.approved", (await userGot.Task).Kind);
        Assert.False(await Received(otherGot.Task, 800));
    }
}
