using System.Net;
using System.Net.Http.Json;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

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
