using System.Net.Http.Headers;
using System.Net.Http.Json;
using Divertiflix.Api.Dtos;
using Microsoft.AspNetCore.Mvc.Testing;
using Divertiflix.Infrastructure;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;

namespace Divertiflix.Tests;

/// <summary>API réelle sur une base PostgreSQL temporaire, une par classe de test.</summary>
public class ApiFactory : WebApplicationFactory<Program>
{
    // Serveur PostgreSQL du docker-compose ; une base jetable par classe de test.
    private readonly string _cs = new NpgsqlConnectionStringBuilder(
        Environment.GetEnvironmentVariable("TEST_DB") ?? "Host=localhost;Port=5432;Username=divertiflix;Password=divertiflix-dev")
        { Database = $"divertiflix_test_{Guid.NewGuid():N}" }.ConnectionString;
    private bool _disposed;
    public const string AdminEmail = "root";
    public const string AdminPassword = "boom123$";
    public const string SyncKey = "test-only-sync-key";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseSetting("Seed:AdminPassword", AdminPassword);
        builder.UseSetting("Jwt:Key", "test-only-secret-key-0123456789abcdef-xyz");
        builder.UseSetting("ConnectionStrings:Default", _cs);
        builder.UseSetting("DirectorySync:ApiKey", SyncKey);
        builder.UseSetting("AudiobookshelfSync:ApiKey", SyncKey);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !_disposed)
        {
            _disposed = true;
            using var scope = Services.CreateScope();
            scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>().Database.EnsureDeleted();
        }
        base.Dispose(disposing);
    }

    public async Task<(HttpClient Client, AuthResponse Auth)> LoginAsync(string email, string password)
    {
        var client = CreateClient();
        var res = await client.PostAsync("/api/auth/login", new LoginRequest(email, password));
        res.EnsureSuccessStatusCode();
        var auth = (await res.Content.ReadAsync<AuthResponse>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return (client, auth);
    }

    public async Task<(HttpClient Client, AuthResponse Auth)> RegisterAsync(string? email = null)
    {
        var client = CreateClient();
        var res = await client.PostAsync("/api/auth/register",
            new RegisterRequest(email ?? $"u{Guid.NewGuid():N}@test.com", "Passw0rd!", "Principal"));
        res.EnsureSuccessStatusCode();
        var auth = (await res.Content.ReadAsync<AuthResponse>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return (client, auth);
    }
}
