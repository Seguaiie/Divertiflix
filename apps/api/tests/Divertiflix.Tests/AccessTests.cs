using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Divertiflix.Api.Auth;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;
using Divertiflix.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Tests;

/// <summary>Un compte désactivé, rétrogradé ou promu perd tout de suite les droits de son ancien jeton d'accès.</summary>
public class AccessTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    /// <summary>Un abonné promu au rôle donné, puis reconnecté : son jeton porte le nouveau rôle.</summary>
    private async Task<(HttpClient Client, AuthResponse Auth)> PromotedAsync(HttpClient admin, Role role)
    {
        var (_, reg) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsync($"/api/admin/users/{reg.User.Id}", new AdminUserUpdate(role, null))).StatusCode);
        return await f.LoginAsync(reg.User.Email, "Passw0rd!");
    }

    [Fact]
    public async Task A_deactivated_admin_is_refused_at_once_and_cannot_reactivate_itself()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var (c, auth) = await PromotedAsync(admin, Role.Admin);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/admin/stats")).StatusCode);

        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsync($"/api/admin/users/{auth.User.Id}", new AdminUserUpdate(null, false))).StatusCode);

        // Le jeton (15 min) est encore valide pour la signature et la durée : le compte, lui, ne l'est plus.
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/admin/stats")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/titles")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.PutAsync($"/api/admin/users/{auth.User.Id}", new AdminUserUpdate(null, true))).StatusCode);

        var row = (await admin.GetAsync<PagedResult<AdminUserDto>>($"/api/admin/users?q={auth.User.Email}"))!.Items.Single();
        Assert.False(row.IsActive);   // la tentative de réhabilitation n'a rien changé

        // Réactivé par un administrateur, le compte retrouve son jeton (le rôle n'a pas changé).
        await admin.PutAsync($"/api/admin/users/{auth.User.Id}", new AdminUserUpdate(null, true));
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/admin/stats")).StatusCode);
    }

    [Fact]
    public async Task A_demoted_admin_cannot_use_the_old_token_to_promote_anyone()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var (c, auth) = await PromotedAsync(admin, Role.Admin);
        var (_, accomplice) = await f.RegisterAsync();

        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsync($"/api/admin/users/{auth.User.Id}", new AdminUserUpdate(Role.Subscriber, null))).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.PutAsync($"/api/admin/users/{accomplice.User.Id}", new AdminUserUpdate(Role.Admin, null))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.PutAsync($"/api/admin/users/{auth.User.Id}", new AdminUserUpdate(Role.Admin, null))).StatusCode);
        var (_, fresh) = await f.LoginAsync(auth.User.Email, "Passw0rd!");
        Assert.Equal(Role.Subscriber, fresh.User.Role);
        var (_, other) = await f.LoginAsync(accomplice.User.Email, "Passw0rd!");
        Assert.Equal(Role.Subscriber, other.User.Role);   // le complice n'a pas été promu
    }

    [Fact]
    public async Task A_promoted_subscriber_gets_the_new_role_after_a_refresh()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var (client, auth) = await f.RegisterAsync();
        await admin.PutAsync($"/api/admin/users/{auth.User.Id}", new AdminUserUpdate(Role.Support, null));

        // Le jeton annonce encore « Subscriber » : refusé, le client rafraîchit (comme le portail sur un 401).
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/titles")).StatusCode);
        var refreshed = (await (await client.PostAsync("/api/auth/refresh", new RefreshRequest(auth.RefreshToken))).Content.ReadAsync<AuthResponse>())!;
        Assert.Equal(Role.Support, refreshed.User.Role);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", refreshed.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/admin/stats")).StatusCode);
    }

    [Fact]
    public async Task Nobody_changes_their_own_role_or_active_state_but_a_no_op_is_tolerated()
    {
        var (admin, auth) = await f.LoginAdminAsync();
        var url = $"/api/admin/users/{auth.User.Id}";
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsync(url, new AdminUserUpdate(Role.Admin, true))).StatusCode);   // l'interface renvoie les valeurs courantes
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsync(url, new AdminUserUpdate(Role.Support, null))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await admin.PutAsync(url, new AdminUserUpdate(null, false))).StatusCode);
    }

    [Fact]
    public async Task Support_cannot_list_accounts_but_still_reads_the_rest_of_the_console()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var (support, _) = await PromotedAsync(admin, Role.Support);
        Assert.Equal(HttpStatusCode.Forbidden, (await support.GetAsync("/api/admin/users")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await support.GetAsync("/api/admin/stats")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await support.GetAsync("/api/admin/tickets")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync("/api/admin/users")).StatusCode);
    }

    [Fact]
    public async Task A_stream_url_stops_working_when_its_account_is_deactivated()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var title = (await (await admin.PostAsync("/api/admin/titles", new TitleUpsert("Flux coupé", "S", 2020, TitleKind.Movie, "Drame", 90, null, "media:demo/index.m3u8"))).Content.ReadAsync<AdminTitleDto>())!;
        var (viewer, auth) = await f.RegisterAsync();
        var pb = (await viewer.GetAsync<PlaybackDto>($"/api/titles/{title.Id}/playback"))!;
        Assert.True((pb.ExpiresAt - DateTime.UtcNow).TotalHours > 5);   // la durée du jeton n'est pas raccourcie : une longue lecture doit aller au bout

        var anon = f.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync(pb.Url)).StatusCode);
        await admin.PutAsync($"/api/admin/users/{auth.User.Id}", new AdminUserUpdate(null, false));
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync(pb.Url)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anon.GetAsync(pb.Url.Replace("index.m3u8", "seg0.ts"))).StatusCode);

        await admin.PutAsync($"/api/admin/users/{auth.User.Id}", new AdminUserUpdate(null, true));
        Assert.Equal(HttpStatusCode.OK, (await anon.GetAsync(pb.Url)).StatusCode);
    }

    [Theory]
    [InlineData("/api/media/stream/99999999999999999.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.x/demo/index.m3u8")]
    [InlineData("/api/media/stream/253402300800.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.x/demo/index.m3u8")]
    [InlineData("/api/media/stream/-1.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.x/demo/index.m3u8")]
    [InlineData("/api/media/stream/%2b5.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.x/demo/index.m3u8")]
    [InlineData("/api/media/stream/9223372036854775807.zzzz.x/demo/index.m3u8")]
    public async Task Hostile_stream_tokens_are_refused_not_a_server_error(string url)
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task A_long_email_never_prevents_the_administrator_from_deactivating_the_account()
    {
        var (admin, _) = await f.LoginAdminAsync();
        // Courriel de 200 caractères : le maximum à l'inscription.
        var email = new string('a', 200 - "@test.com".Length) + "@test.com";
        var (_, reg) = await f.RegisterAsync(email);
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsync($"/api/admin/users/{reg.User.Id}", new AdminUserUpdate(null, false))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await f.CreateClient().PostAsync("/api/auth/register", new RegisterRequest("b" + email, "Passw0rd!", "X"))).StatusCode);

        // Un courriel de l'annuaire peut aller jusqu'à 256 caractères (colonne) : le journal d'audit le tronque.
        var adEmail = new string('d', 256 - "@corp.test".Length) + "@corp.test";
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/admin/directory-sync?force=true") { Content = JsonContent.Create(new DirectorySyncRequest([new(adEmail, "Longue Adresse", [])]), options: Json.Options) };
        msg.Headers.Add("X-Sync-Key", ApiFactory.SyncKey);
        Assert.Equal(1, (await (await f.CreateClient().SendAsync(msg)).Content.ReadAsync<DirectorySyncResult>())!.Created);
        var ad = (await admin.GetAsync<PagedResult<AdminUserDto>>($"/api/admin/users?q={adEmail}"))!.Items.Single();
        var off = await admin.PutAsync($"/api/admin/users/{ad.Id}", new AdminUserUpdate(Role.Support, false));
        Assert.Equal(HttpStatusCode.OK, off.StatusCode);
        Assert.False((await off.Content.ReadAsync<AdminUserDto>())!.IsActive);
    }
}

/// <summary>Chaînes de jetons de rafraîchissement : durée absolue, rejeu, déconnexion de toutes les sessions.</summary>
public class SessionTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private async Task WithDb(Func<DivertiflixDbContext, Task> action)
    {
        using var scope = f.Services.CreateScope();
        await action(scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>());
    }

    private static async Task<AuthResponse> RefreshOk(HttpClient c, string token)
    {
        var res = await c.PostAsync("/api/auth/refresh", new RefreshRequest(token));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return (await res.Content.ReadAsync<AuthResponse>())!;
    }

    private static async Task<HttpStatusCode> RefreshStatus(HttpClient c, string token) =>
        (await c.PostAsync("/api/auth/refresh", new RefreshRequest(token))).StatusCode;

    [Fact]
    public async Task A_session_has_an_absolute_end_that_rotations_do_not_extend()
    {
        var (client, auth) = await f.RegisterAsync();
        var second = await RefreshOk(client, auth.RefreshToken);
        await WithDb(async db =>
        {
            var rows = await db.RefreshTokens.Where(r => r.UserId == auth.User.Id).ToListAsync();
            Assert.Equal(2, rows.Count);
            Assert.Single(rows.Select(r => r.FamilyId).Distinct());                  // même session
            Assert.Single(rows.Select(r => r.SessionExpiresAt).Distinct());          // même fin absolue
            Assert.All(rows, r => Assert.True(r.ExpiresAt <= r.SessionExpiresAt));
            // La session arrive à son terme : plus de renouvellement, même avec un jeton encore valide.
            await db.RefreshTokens.Where(r => r.UserId == auth.User.Id).ExecuteUpdateAsync(s => s.SetProperty(r => r.SessionExpiresAt, DateTime.UtcNow.AddMinutes(-1)));
        });
        Assert.Equal(HttpStatusCode.Unauthorized, await RefreshStatus(client, second.RefreshToken));
    }

    [Fact]
    public async Task A_new_login_opens_a_new_family()
    {
        var (_, first) = await f.RegisterAsync();
        var (_, second) = await f.LoginAsync(first.User.Email, "Passw0rd!");
        await WithDb(async db =>
            Assert.Equal(2, await db.RefreshTokens.Where(r => r.UserId == first.User.Id).Select(r => r.FamilyId).Distinct().CountAsync()));
        Assert.NotEqual(first.RefreshToken, second.RefreshToken);
    }

    [Fact]
    public async Task Replaying_a_rotated_token_after_the_grace_period_cuts_the_whole_chain()
    {
        var (client, rt1) = await f.RegisterAsync();
        var rt2 = await RefreshOk(client, rt1.RefreshToken);
        // Le voleur présente l'ancien jeton plus tard : la chaîne qui a continué (rt2) est coupée avec lui.
        await WithDb(db => db.RefreshTokens.Where(r => r.UserId == rt1.User.Id && r.RevokedAt != null).ExecuteUpdateAsync(s => s.SetProperty(r => r.RevokedAt, DateTime.UtcNow.AddMinutes(-1))));
        Assert.Equal(HttpStatusCode.Unauthorized, await RefreshStatus(client, rt1.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, await RefreshStatus(client, rt2.RefreshToken));
        await WithDb(async db => Assert.True(await db.AuditLogs.AnyAsync(a => a.Action == "auth.replay" && a.UserId == rt1.User.Id)));

        // Le titulaire se reconnecte : une nouvelle session, intacte.
        var (c2, again) = await f.LoginAsync(rt1.User.Email, "Passw0rd!");
        Assert.Equal(HttpStatusCode.OK, await RefreshStatus(c2, again.RefreshToken));
    }

    [Fact]
    public async Task A_token_presented_again_right_after_its_rotation_is_refused_without_cutting_the_session()
    {
        // Deux onglets du portail rafraîchissent en même temps avec le même jeton : l'un gagne, l'autre est refusé, la session survit.
        var (client, rt1) = await f.RegisterAsync();
        var rt2 = await RefreshOk(client, rt1.RefreshToken);
        Assert.Equal(HttpStatusCode.Unauthorized, await RefreshStatus(client, rt1.RefreshToken));
        Assert.Equal(HttpStatusCode.OK, await RefreshStatus(client, rt2.RefreshToken));
        await WithDb(async db => Assert.False(await db.AuditLogs.AnyAsync(a => a.Action == "auth.replay" && a.UserId == rt1.User.Id)));
    }

    [Fact]
    public async Task Replaying_a_logged_out_token_is_just_refused()
    {
        var (client, auth) = await f.RegisterAsync();
        await client.PostAsync("/api/auth/logout", new LogoutRequest(auth.RefreshToken));
        await WithDb(db => db.RefreshTokens.Where(r => r.UserId == auth.User.Id).ExecuteUpdateAsync(s => s.SetProperty(r => r.RevokedAt, DateTime.UtcNow.AddMinutes(-1))));
        Assert.Equal(HttpStatusCode.Unauthorized, await RefreshStatus(client, auth.RefreshToken));
        await WithDb(async db => Assert.False(await db.AuditLogs.AnyAsync(a => a.Action == "auth.replay" && a.UserId == auth.User.Id)));   // rien à signaler : la session était déjà finie
    }

    [Fact]
    public async Task Logout_all_revokes_every_session_of_the_account_and_only_that_account()
    {
        var (phone, first) = await f.RegisterAsync();
        var (_, laptop) = await f.LoginAsync(first.User.Email, "Passw0rd!");
        var (neighbour, other) = await f.RegisterAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().PostAsync("/api/auth/logout-all", (object?)null)).StatusCode);   // authentifié seulement
        Assert.Equal(HttpStatusCode.NoContent, (await phone.PostAsync("/api/auth/logout-all", (object?)null)).StatusCode);

        Assert.Equal(HttpStatusCode.Unauthorized, await RefreshStatus(phone, first.RefreshToken));
        Assert.Equal(HttpStatusCode.Unauthorized, await RefreshStatus(phone, laptop.RefreshToken));
        Assert.Equal(HttpStatusCode.OK, await RefreshStatus(neighbour, other.RefreshToken));
        await WithDb(async db => Assert.True(await db.AuditLogs.AnyAsync(a => a.Action == "auth.logoutAll" && a.UserId == first.User.Id)));
    }
}

/// <summary>Connexion : verrouillage progressif par courriel, mots de passe refusés.</summary>
public class LoginProtectionTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Repeated_failures_lock_the_email_with_retry_after_whether_or_not_the_account_exists()
    {
        var (_, real) = await f.RegisterAsync();
        async Task<HttpResponseMessage> Try(string email, string password) => await f.CreateClient().PostAsync("/api/auth/login", new LoginRequest(email, password));

        var unknown = $"inconnu{Guid.NewGuid():N}@test.com";
        foreach (var email in new[] { unknown, real.User.Email })
        {
            for (var i = 0; i < 5; i++) Assert.Equal(HttpStatusCode.Unauthorized, (await Try(email, "mauvais-" + i)).StatusCode);
            var locked = await Try(email, "Passw0rd!");   // même le bon mot de passe : verrouillé
            Assert.Equal(HttpStatusCode.TooManyRequests, locked.StatusCode);
            Assert.True(int.Parse(locked.Headers.GetValues("Retry-After").Single()) is > 0 and <= 30);
        }
    }

    [Fact]
    public async Task An_attacker_cannot_lock_out_a_source_that_already_logged_in_successfully()
    {
        var (_, reg) = await f.RegisterAsync();
        var c = f.CreateClient();
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsync("/api/auth/login", new LoginRequest(reg.User.Email, "Passw0rd!"))).StatusCode);   // le propriétaire est connu
        for (var i = 0; i < 8; i++) await c.PostAsync("/api/auth/login", new LoginRequest(reg.User.Email, "faux" + i));
        Assert.Equal(HttpStatusCode.OK, (await c.PostAsync("/api/auth/login", new LoginRequest(reg.User.Email, "Passw0rd!"))).StatusCode);
    }

    [Fact]
    public async Task A_simultaneous_burst_on_one_email_checks_no_more_passwords_than_the_threshold()
    {
        // La tentative est réservée avant la vérification du mot de passe : sans cela, tous les appels arrivés ensemble passaient le contrôle
        // avant que le premier échec soit enregistré (le seuil de 5 ne valait que pour des essais l'un après l'autre).
        var (_, real) = await f.RegisterAsync();
        var c = f.CreateClient();
        var codes = await ConcurrencyTests.TogetherAsync(40, i => c.PostAsync("/api/auth/login", new LoginRequest(real.User.Email, "mauvais-" + i)));
        var verified = codes.Count(code => code == HttpStatusCode.Unauthorized);
        Assert.InRange(verified, 1, LoginThrottle.Threshold);
        Assert.Equal(40 - verified, codes.Count(code => code == HttpStatusCode.TooManyRequests));
    }

    [Theory]
    [InlineData("password")]
    [InlineData("PASSWORD123")]
    [InlineData("12345678")]
    [InlineData("azertyuiop")]
    [InlineData("aaaaaaaa")]
    [InlineData("monmotdepasse")]
    public async Task Very_common_passwords_are_refused_at_registration(string password)
    {
        var res = await f.CreateClient().PostAsync("/api/auth/register", new RegisterRequest($"c{Guid.NewGuid():N}@test.com", password, "X"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("courant", await res.Content.ReadAsStringAsync());
    }

    [Theory]
    [InlineData("jeanne.durand@test.com", "jeanne.durand@test.com")]
    [InlineData("jeanne.durand@test.com", "Jeanne.Durand")]
    public async Task A_password_equal_to_the_email_is_refused(string email, string password)
    {
        var res = await f.CreateClient().PostAsync("/api/auth/register", new RegisterRequest(email, password, "X"));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
    }

    [Fact]
    public async Task Eight_character_passwords_that_are_not_common_still_work()
    {
        var res = await f.CreateClient().PostAsync("/api/auth/register", new RegisterRequest($"h{Guid.NewGuid():N}@test.com", "q7Xk!m2P", "X"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
    }
}

/// <summary>Entrées hostiles : le caractère nul est refusé partout (PostgreSQL le rejette), les adresses de média suivent une liste blanche.</summary>
public class HostileInputTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task A_nul_character_is_a_bad_request_never_a_server_error()
    {
        var c = f.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync("/api/auth/login", new LoginRequest("a\0@example.test", "Passw0rd!"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync("/api/auth/register", new RegisterRequest($"n{Guid.NewGuid():N}@test.com", "q7Xk!m2P", "p\0q"))).StatusCode);

        var (user, _) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await user.GetAsync("/api/titles?genre=a%00b")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await user.GetAsync("/api/titles?q=a%00b")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await user.PostAsync("/api/profiles", new ProfileUpsertBody("p\0q"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await user.PostAsync("/api/requests", new RequestCreate("Film\0", TitleKind.Movie, null, null, null))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await user.PostAsync("/api/support/tickets", new TicketCreate("Sujet", TicketCategory.Other, "Mess\0age"))).StatusCode);
        // Un texte normal passe toujours.
        Assert.Equal(HttpStatusCode.OK, (await user.GetAsync("/api/titles?genre=Drame")).StatusCode);
    }

    private record ProfileUpsertBody(string Name);

    private static TitleUpsert Title(string name, string? stream = null, string? poster = null, string? backdrop = null) =>
        new(name, "S", 2020, TitleKind.Movie, "Drame", 90, poster, stream, BackdropUrl: backdrop);

    [Theory]
    [InlineData("javascript:document.title=1")]
    [InlineData("JaVaScRiPt:alert(1)")]
    [InlineData(" javascript:alert(1)")]
    [InlineData("java\tscript:alert(1)")]
    [InlineData("data:text/html;base64,PHNjcmlwdD4=")]
    [InlineData("vbscript:x")]
    [InlineData("file:///etc/passwd")]
    [InlineData("//example.org/x.mp4")]
    [InlineData("ftp://example.org/x.mp4")]
    [InlineData("https:javascript:alert(1)")]
    [InlineData("/api/media/stream/x/y.m3u8")]
    public async Task Stream_urls_outside_the_allow_list_are_refused(string url)
    {
        var (admin, _) = await f.LoginAdminAsync();
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/admin/titles", Title("Piégé", stream: url))).StatusCode);
    }

    [Fact]
    public async Task Allowed_schemes_pass_and_images_may_use_a_site_path_but_not_a_script()
    {
        var (admin, _) = await f.LoginAdminAsync();
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsync("/api/admin/titles", Title("Http", stream: "http://example.org/v.mp4", poster: "https://example.org/p.webp"))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsync("/api/admin/titles", Title("Https", stream: "HTTPS://example.org/v/index.m3u8"))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsync("/api/admin/titles", Title("Media", stream: "media:demo/index.m3u8"))).StatusCode);
        // Les visuels du catalogue de démonstration sont des chemins du site : une fiche doit pouvoir les renvoyer telles quelles.
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsync("/api/admin/titles", Title("Visuels", poster: "/api/media/art/x/poster.webp", backdrop: "/api/media/art/x/backdrop.webp"))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await admin.PostAsync("/api/admin/titles", Title("Sans rien"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/admin/titles", Title("Poster piégé", poster: "javascript:alert(1)"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/admin/titles", Title("Fond piégé", backdrop: "data:image/svg+xml,<svg/>"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await admin.PostAsync("/api/admin/titles", Title("Réseau", poster: "//example.org/p.webp"))).StatusCode);
    }

    [Fact]
    public async Task The_audiobookshelf_sync_applies_the_same_allow_list()
    {
        AudiobookItemDto Item(string id, string stream, string? cover = null) => new(id, "Livre " + id, null, null, null, 10, cover, stream, null);
        async Task<HttpStatusCode> Sync(AudiobookItemDto item)
        {
            var msg = new HttpRequestMessage(HttpMethod.Post, "/api/admin/audiobookshelf-sync") { Content = JsonContent.Create(new AudiobookshelfSyncRequest([item]), options: Json.Options) };
            msg.Headers.Add("X-Sync-Key", ApiFactory.SyncKey);
            return (await f.CreateClient().SendAsync(msg)).StatusCode;
        }
        Assert.Equal(HttpStatusCode.BadRequest, await Sync(Item($"x{Guid.NewGuid():N}", "javascript:alert(1)")));
        Assert.Equal(HttpStatusCode.BadRequest, await Sync(Item($"y{Guid.NewGuid():N}", "https://abs.local/item/1", "javascript:alert(1)")));
        Assert.Equal(HttpStatusCode.OK, await Sync(Item($"z{Guid.NewGuid():N}", "https://abs.local/item/1", "https://abs.local/cover.jpg")));
    }

    [Fact]
    public async Task A_source_saved_before_the_allow_list_is_never_handed_to_the_player()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var title = (await (await admin.PostAsync("/api/admin/titles", Title("Ancien piège", stream: "https://example.org/ok.mp4"))).Content.ReadAsync<AdminTitleDto>())!;
        using (var scope = f.Services.CreateScope())
            await scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>().Titles.Where(t => t.Id == title.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.StreamUrl, "javascript:alert(1)"));
        var (viewer, _) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.Conflict, (await viewer.GetAsync($"/api/titles/{title.Id}/playback")).StatusCode);
    }
}

/// <summary>La synchronisation d'annuaire traite les comptes un par un : un nom trop long ou un courriel invalide ne bloque pas les départs.</summary>
public class DirectorySyncResilienceTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static HttpRequestMessage Req(DirectorySyncRequest body)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/admin/directory-sync?force=true") { Content = JsonContent.Create(body, options: Json.Options) };
        msg.Headers.Add("X-Sync-Key", ApiFactory.SyncKey);
        return msg;
    }

    [Fact]
    public async Task A_long_display_name_is_shortened_and_an_invalid_email_is_counted_while_departures_still_apply()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var stay = $"stay{Guid.NewGuid():N}@corp.test";
        var leave = $"leave{Guid.NewGuid():N}@corp.test";
        var newcomer = $"new{Guid.NewGuid():N}@corp.test";
        var longName = string.Concat(Enumerable.Repeat("Prénom-Très-Long ", 8));   // 136 caractères
        Assert.Equal(2, (await (await f.CreateClient().SendAsync(Req(new DirectorySyncRequest([new(stay, "Reste", []), new(leave, "Part", [])])))).Content.ReadAsync<DirectorySyncResult>())!.Created);

        var res = await f.CreateClient().SendAsync(Req(new DirectorySyncRequest([
            new(stay, "Reste", ["Divertiflix-Support"]), new(newcomer, longName, []),
            new("pas un courriel", "Intrus", []), new("", "Vide", []), new(null, null, null),
        ])));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var result = (await res.Content.ReadAsync<DirectorySyncResult>())!;
        Assert.Equal(3, result.Errors);
        Assert.Equal(1, result.Created);

        async Task<AdminUserDto> Row(string email) => (await admin.GetAsync<PagedResult<AdminUserDto>>($"/api/admin/users?q={email}"))!.Items.Single();
        Assert.False((await Row(leave)).IsActive);                 // le départ est appliqué
        Assert.Equal(Role.Support, (await Row(stay)).Role);        // le changement de groupe aussi
        Assert.True((await Row(newcomer)).IsActive);               // et l'arrivée, malgré le nom trop long
        var newcomerId = (await Row(newcomer)).Id;
        using var scope = f.Services.CreateScope();
        var name = await scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>().Profiles.Where(p => p.UserId == newcomerId).Select(p => p.Name).SingleAsync();
        Assert.Equal(longName.Trim()[..50], name);
    }

    [Fact]
    public async Task A_null_entry_in_the_list_is_counted_as_an_invalid_account_and_the_others_still_apply()
    {
        // System.Text.Json accepte un null dans la liste malgré son type : l'élément est un compte invalide comme un autre, pas un 500.
        var email = $"nul{Guid.NewGuid():N}@corp.test";
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/admin/directory-sync?force=true")
        { Content = new StringContent($$"""{"accounts":[null,{"email":"{{email}}","displayName":"Ok","groups":[null]}]}""", System.Text.Encoding.UTF8, "application/json") };
        msg.Headers.Add("X-Sync-Key", ApiFactory.SyncKey);
        var res = await f.CreateClient().SendAsync(msg);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var result = (await res.Content.ReadAsync<DirectorySyncResult>())!;
        Assert.Equal(1, result.Errors);
        Assert.Equal(1, result.Created);
    }

    [Fact]
    public async Task A_nul_character_in_one_account_rejects_the_whole_batch_before_anything_is_applied()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var email = $"nul{Guid.NewGuid():N}@corp.test";
        var res = await f.CreateClient().SendAsync(Req(new DirectorySyncRequest([new(email, "Nom\0piégé", []), new($"ok{Guid.NewGuid():N}@corp.test", "Ok", [])])));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Empty((await admin.GetAsync<PagedResult<AdminUserDto>>($"/api/admin/users?q={email}"))!.Items);
    }

    [Fact]
    public async Task Deactivation_by_sync_revokes_tokens_with_the_change_and_cuts_the_old_session_now()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var email = $"ad{Guid.NewGuid():N}@corp.test";
        await f.CreateClient().SendAsync(Req(new DirectorySyncRequest([new(email, "Quitte", ["Divertiflix-Admins"]), new($"autre{Guid.NewGuid():N}@corp.test", "Autre", [])])));
        var id = (await admin.GetAsync<PagedResult<AdminUserDto>>($"/api/admin/users?q={email}"))!.Items.Single().Id;
        // Les comptes d'annuaire n'ont pas de mot de passe utilisable : on leur donne un jeton comme le ferait un futur échange Kerberos/LDAP.
        string token;
        using (var scope = f.Services.CreateScope())
        {
            var tokens = scope.ServiceProvider.GetRequiredService<Divertiflix.Api.Auth.TokenService>();
            var db = scope.ServiceProvider.GetRequiredService<DivertiflixDbContext>();
            var user = await db.Users.SingleAsync(u => u.Id == id);
            token = tokens.CreateAccessToken(user);
            var (_, rt) = tokens.CreateRefreshToken(id);
            db.RefreshTokens.Add(rt);
            await db.SaveChangesAsync();
        }
        var c = f.CreateClient();
        c.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/admin/stats")).StatusCode);

        await f.CreateClient().SendAsync(Req(new DirectorySyncRequest([new($"autre{Guid.NewGuid():N}@corp.test", "Autre", [])])));   // plus personne d'autre : tout le monde part
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.GetAsync("/api/admin/stats")).StatusCode);
        using var verify = f.Services.CreateScope();
        Assert.False(await verify.ServiceProvider.GetRequiredService<DivertiflixDbContext>().RefreshTokens.AnyAsync(r => r.UserId == id && r.RevokedAt == null));
    }
}
