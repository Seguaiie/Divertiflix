using System.Net;
using System.Net.Http.Json;
using Divertiflix.Api.Dtos;

namespace Divertiflix.Tests;

public class AuthTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Register_then_login_works_and_role_is_subscriber()
    {
        var email = $"a{Guid.NewGuid():N}@test.com";
        var (_, reg) = await f.RegisterAsync(email);
        Assert.Equal(Divertiflix.Domain.Role.Subscriber, reg.User.Role);
        var (_, login) = await f.LoginAsync(email, "Passw0rd!");
        Assert.Equal(reg.User.Id, login.User.Id);
    }

    [Fact]
    public async Task Duplicate_email_is_conflict()
    {
        var email = $"d{Guid.NewGuid():N}@test.com";
        await f.RegisterAsync(email);
        var res = await f.CreateClient().PostAsync("/api/auth/register", new RegisterRequest(email.ToUpperInvariant(), "Passw0rd!", "X"));
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
    }

    [Fact]
    public async Task Wrong_password_is_unauthorized()
    {
        var res = await f.CreateClient().PostAsync("/api/auth/login", new LoginRequest(ApiFactory.AdminEmail, "nope"));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Short_password_is_rejected()
    {
        var res = await f.CreateClient().PostAsync("/api/auth/register", new RegisterRequest("s@test.com", "short", "X"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Refresh_rotates_token_and_old_one_is_rejected()
    {
        var (client, auth) = await f.RegisterAsync();
        var first = await client.PostAsync("/api/auth/refresh", new RefreshRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        var replay = await client.PostAsync("/api/auth/refresh", new RefreshRequest(auth.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, replay.StatusCode);
    }

    [Fact]
    public async Task Protected_endpoint_requires_token()
    {
        var res = await f.CreateClient().GetAsync("/api/titles");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }
}
