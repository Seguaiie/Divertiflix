using System.Net;
using Divertiflix.Api.Controllers;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;

namespace Divertiflix.Tests;

/// <summary>Code et restriction d'âge par profil, et historique de visionnage.</summary>
public class ProfileLockTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Profiles_have_no_lock_by_default()
    {
        var (c, _) = await f.RegisterAsync();
        var p = (await c.GetAsync<List<ProfileDto>>("/api/profiles"))![0];
        Assert.False(p.HasPin);
        Assert.Null(p.MaturityLimit);
    }

    [Fact]
    public async Task Setting_and_clearing_a_pin_updates_HasPin()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var locked = (await (await c.PutAsync($"/api/profiles/{pid}/lock", new ProfileLockUpdate("1234", "13+"))).Content.ReadAsync<ProfileDto>())!;
        Assert.True(locked.HasPin);
        Assert.Equal("13+", locked.MaturityLimit);

        var unlocked = (await (await c.PutAsync($"/api/profiles/{pid}/lock", new ProfileLockUpdate(null, null))).Content.ReadAsync<ProfileDto>())!;
        Assert.False(unlocked.HasPin);
        Assert.Null(unlocked.MaturityLimit);
    }

    [Fact]
    public async Task Unknown_maturity_level_is_rejected()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PutAsync($"/api/profiles/{pid}/lock", new ProfileLockUpdate(null, "beaucoup trop"))).StatusCode);
    }

    [Fact]
    public async Task Unlock_requires_the_right_pin_and_fails_without_one_set()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        Assert.Equal(HttpStatusCode.Conflict, (await c.PostAsync($"/api/profiles/{pid}/unlock", new ProfileUnlock("0000"))).StatusCode);

        await c.PutAsync($"/api/profiles/{pid}/lock", new ProfileLockUpdate("4242", null));
        Assert.Equal(HttpStatusCode.Forbidden, (await c.PostAsync($"/api/profiles/{pid}/unlock", new ProfileUnlock("0000"))).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await c.PostAsync($"/api/profiles/{pid}/unlock", new ProfileUnlock("4242"))).StatusCode);
    }

    [Fact]
    public async Task Lock_and_unlock_are_scoped_to_the_owning_account()
    {
        var (a, _) = await f.RegisterAsync();
        var (b, _) = await f.RegisterAsync();
        var pa = await ApiFactory.ProfileIdAsync(a);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PutAsync($"/api/profiles/{pa}/lock", new ProfileLockUpdate("1234", null))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await b.PostAsync($"/api/profiles/{pa}/unlock", new ProfileUnlock("1234"))).StatusCode);
    }

    [Fact]
    public async Task Playback_is_blocked_above_the_profiles_maturity_limit()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var created = (await (await admin.PostAsync("/api/admin/titles",
            new TitleUpsert("Film adulte", "Synopsis", 2020, TitleKind.Movie, "Drame", 90, null, "media:demo/index.m3u8", Maturity: "18+")))
            .Content.ReadAsync<AdminTitleDto>())!;

        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        // Sans restriction : la lecture est permise.
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync($"/api/titles/{created.Id}/playback?profileId={pid}")).StatusCode);

        await c.PutAsync($"/api/profiles/{pid}/lock", new ProfileLockUpdate(null, "13+"));
        Assert.Equal(HttpStatusCode.Forbidden, (await c.GetAsync($"/api/titles/{created.Id}/playback?profileId={pid}")).StatusCode);

        await c.PutAsync($"/api/profiles/{pid}/lock", new ProfileLockUpdate(null, "18+"));
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync($"/api/titles/{created.Id}/playback?profileId={pid}")).StatusCode);
    }

    [Fact]
    public async Task History_lists_every_started_title_most_recent_first_including_finished_ones()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var bunny = await ApiFactory.TitleAsync(c, "Big Buck Bunny");
        var sintel = await ApiFactory.TitleAsync(c, "Sintel");

        await c.PutAsync($"/api/profiles/{pid}/progress/{bunny.Id}", new ProgressUpsert(10, 600));
        await Task.Delay(20);   // horodatages distincts : l'ordre du plus récent au plus ancien doit être vérifiable
        await c.PutAsync($"/api/profiles/{pid}/progress/{sintel.Id}", new ProgressUpsert(600, 600));   // terminé : apparaît quand même

        var history = (await c.GetAsync<List<CardDto>>($"/api/profiles/{pid}/history"))!;
        Assert.Equal([sintel.Id, bunny.Id], history.Select(h => h.Title.Id));
    }
}
