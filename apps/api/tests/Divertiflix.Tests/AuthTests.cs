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
    public async Task Duplicate_email_is_conflict_with_problem_json_and_error_field()
    {
        var email = $"d{Guid.NewGuid():N}@test.com";
        await f.RegisterAsync(email);
        var res = await f.CreateClient().PostAsync("/api/auth/register", new RegisterRequest(email.ToUpperInvariant(), "Passw0rd!", "X"));
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Equal("application/problem+json", res.Content.Headers.ContentType?.MediaType);
        var body = await res.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(409, body.GetProperty("status").GetInt32());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("error").GetString()));   // compat des fronts existants
    }

    [Fact]
    public async Task Wrong_password_and_unknown_account_are_indistinguishable()
    {
        var wrong = await f.CreateClient().PostAsync("/api/auth/login", new LoginRequest(ApiFactory.AdminEmail, "nope"));
        var unknown = await f.CreateClient().PostAsync("/api/auth/login", new LoginRequest("personne@test.com", "nope"));
        Assert.Equal(HttpStatusCode.Unauthorized, wrong.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknown.StatusCode);
        Assert.Equal(await wrong.Content.ReadAsStringAsync(), (await unknown.Content.ReadAsStringAsync()).Replace("personne@test.com", ""));
    }

    [Fact]
    public async Task Short_and_oversized_passwords_are_rejected()
    {
        var c = f.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync("/api/auth/register", new RegisterRequest("s@test.com", "short", "X"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync("/api/auth/register", new RegisterRequest("big@test.com", new string('a', 129), "X"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync("/api/auth/login", new LoginRequest("big@test.com", new string('a', 129)))).StatusCode);
    }

    [Fact]
    public async Task Overlong_email_is_a_validation_error_not_a_server_error()
    {
        var email = new string('a', 250) + "@test.com";
        var res = await f.CreateClient().PostAsync("/api/auth/register", new RegisterRequest(email, "Passw0rd!", "X"));
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
    public async Task Concurrent_refreshes_with_the_same_token_let_exactly_one_through()
    {
        var (client, auth) = await f.RegisterAsync();
        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => client.PostAsync("/api/auth/refresh", new RefreshRequest(auth.RefreshToken))));
        Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Equal(7, results.Count(r => r.StatusCode == HttpStatusCode.Unauthorized));
    }

    [Fact]
    public async Task Logout_revokes_the_refresh_token_server_side()
    {
        var (client, auth) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsync("/api/auth/logout", new LogoutRequest(auth.RefreshToken))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/auth/refresh", new RefreshRequest(auth.RefreshToken))).StatusCode);
    }

    [Fact]
    public async Task Protected_endpoint_requires_token()
    {
        var res = await f.CreateClient().GetAsync("/api/titles");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Security_headers_are_present()
    {
        var res = await f.CreateClient().GetAsync("/health");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("nosniff", res.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("DENY", res.Headers.GetValues("X-Frame-Options").Single());
        Assert.Equal("no-referrer", res.Headers.GetValues("Referrer-Policy").Single());
    }
}

/// <summary>Plafond d'authentification volontairement bas pour vérifier la limitation de débit.</summary>
public class LowLimitFactory : ApiFactory
{
    protected override Dictionary<string, string> Settings => new() { ["RateLimit:AuthPerMinute"] = "4" };
}

public class RateLimitTests(LowLimitFactory f) : IClassFixture<LowLimitFactory>
{
    [Fact]
    public async Task Login_is_rate_limited_per_address_with_retry_after()
    {
        var c = f.CreateClient();
        var codes = new List<HttpStatusCode>();
        HttpResponseMessage? last = null;
        for (var i = 0; i < 8; i++) { last = await c.PostAsync("/api/auth/login", new LoginRequest("x@test.com", "nope")); codes.Add(last.StatusCode); }
        Assert.Contains(HttpStatusCode.TooManyRequests, codes);
        Assert.Equal(HttpStatusCode.Unauthorized, codes[0]);
        Assert.True(last!.Headers.Contains("Retry-After"));
    }
}
