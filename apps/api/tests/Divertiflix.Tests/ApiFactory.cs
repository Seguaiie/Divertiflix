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

    /// <summary>Dossier média isolé : des faux fichiers HLS, sans dépendre des médias générés du dépôt.</summary>
    public string MediaRoot { get; } = Path.Combine(Path.GetTempPath(), "divertiflix-media-" + Guid.NewGuid().ToString("N"));

    /// <summary>Plafonds de débit : élevés par défaut, surchargeables par les tests qui vérifient la limitation.</summary>
    protected virtual Dictionary<string, string> Settings => new()
    {
        ["RateLimit:AuthPerMinute"] = "100000", ["RateLimit:WritePerMinute"] = "100000", ["RateLimit:AssistantPerMinute"] = "100000",
        ["RateLimit:SyncPerMinute"] = "100000", ["RateLimit:MediaPerMinute"] = "100000",
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        Directory.CreateDirectory(Path.Combine(MediaRoot, "stream", "demo"));
        File.WriteAllText(Path.Combine(MediaRoot, "stream", "demo", "index.m3u8"), "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg0.ts\n#EXT-X-ENDLIST\n");
        File.WriteAllBytes(Path.Combine(MediaRoot, "stream", "demo", "seg0.ts"), new byte[2048]);
        Directory.CreateDirectory(Path.Combine(MediaRoot, "art"));

        builder.UseSetting("Seed:AdminPassword", AdminPassword);
        builder.UseSetting("Jwt:Key", "test-only-secret-key-0123456789abcdef-xyz");
        builder.UseSetting("ConnectionStrings:Default", _cs);
        builder.UseSetting("DirectorySync:ApiKey", SyncKey);
        builder.UseSetting("AudiobookshelfSync:ApiKey", SyncKey);
        builder.UseSetting("Media:Root", MediaRoot);
        foreach (var (k, v) in Settings) builder.UseSetting(k, v);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing && !_disposed)
        {
            _disposed = true;
            using (var scope = Services.CreateScope())
                scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>().Database.EnsureDeleted();
            try { Directory.Delete(MediaRoot, true); } catch { /* nettoyage au mieux */ }
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

    public Task<(HttpClient Client, AuthResponse Auth)> LoginAdminAsync() => LoginAsync(AdminEmail, AdminPassword);

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

    /// <summary>Premier profil du compte connecté.</summary>
    public static async Task<Guid> ProfileIdAsync(HttpClient client) =>
        (await client.GetAsync<List<ProfileDto>>("/api/profiles"))![0].Id;

    /// <summary>Un titre du catalogue par son nom.</summary>
    public static async Task<TitleDto> TitleAsync(HttpClient client, string name) =>
        (await client.GetAsync<PagedResult<TitleDto>>($"/api/titles?q={Uri.EscapeDataString(name)}&pageSize=5"))!.Items.First(t => t.Name == name);
}
