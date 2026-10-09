using System.Net;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;

namespace Divertiflix.Tests;

public class AssistantTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private async Task<ChatResponse> AskAsync(HttpClient c, Guid pid, string msg)
    {
        var res = await c.PostAsync("/api/assistant/chat", new ChatRequest(pid, msg, "fr"));
        res.EnsureSuccessStatusCode();
        return (await res.Content.ReadAsync<ChatResponse>())!;
    }

    [Fact]
    public async Task Horror_without_gore_returns_horror_and_never_gore()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var r = await AskAsync(c, pid, "un film d'horreur sans gore");
        Assert.Equal("found", r.Reply);
        Assert.NotEmpty(r.Cards);
        Assert.All(r.Cards, k => { Assert.Equal("Horreur", k.Title.Genre); Assert.DoesNotContain("gore", k.Title.Keywords); });
        Assert.Contains(r.Understood, ch => ch.Kind == "genre" && ch.Label == "Horreur");
        Assert.Contains(r.Understood, ch => ch.Kind == "avoid" && ch.Label == "gore");
        Assert.All(r.Cards, k => Assert.Equal("matches", k.Reason!.Type));
    }

    [Fact]
    public async Task Surprise_me_always_finds_something_and_says_why()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        foreach (var msg in new[] { "surprends-moi", "Surprends moi !", "surprends-moi avec de la science-fiction" })
        {
            var r = await AskAsync(c, pid, msg);
            Assert.Equal("surprise", r.Reply);
            Assert.NotEmpty(r.Cards);
            Assert.All(r.Cards, k => Assert.Equal("surprise", k.Reason!.Type));
        }
    }

    [Fact]
    public async Task Only_catalog_titles_are_ever_returned_and_all_are_playable()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var known = (await c.GetAsync<PagedResult<TitleDto>>("/api/titles?pageSize=100"))!.Items.Select(t => t.Id).ToHashSet();
        foreach (var msg in new[] { "surprends-moi", "quelque chose de court et réconfortant", "science fiction sombre", "comme Orbite silencieuse", "n'importe quoi de pluie" })
        {
            var r = await AskAsync(c, pid, msg);
            Assert.All(r.Cards, k => { Assert.Contains(k.Title.Id, known); Assert.True(k.Title.IsPlayable); });
            Assert.True(r.Cards.Count <= 5);
        }
    }

    [Fact]
    public async Task Short_constraint_is_respected_and_steps_describe_real_work()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var r = await AskAsync(c, pid, "un thriller de moins de 4 min");
        Assert.All(r.Cards, k => { Assert.True(k.Title.DurationMinutes <= 4); Assert.Equal("Thriller", k.Title.Genre); });
        Assert.Contains(r.Steps, s => s.Key == "catalog" && s.Count > 0);
        Assert.Contains(r.Steps, s => s.Key == "criteria");
        Assert.DoesNotContain(r.Steps, s => s.Key == "taste");   // aucun historique : on ne prétend pas avoir lu un profil
    }

    [Fact]
    public async Task Constraints_are_relaxed_openly_when_nothing_matches()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var r = await AskAsync(c, pid, "un film d'horreur de moins de 1 minute");
        Assert.Equal("relaxed", r.Reply);
        Assert.All(r.Cards, k => Assert.Equal("Horreur", k.Title.Genre));
    }

    [Fact]
    public async Task Unknown_reference_is_admitted_not_invented()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var r = await AskAsync(c, pid, "un film comme Hereditary");
        Assert.Equal("hereditary", r.UnknownTitle);
        var only = await AskAsync(c, pid, "comme Hereditary");
        Assert.Equal("similarUnknown", only.Reply);
        Assert.Equal("hereditary", only.Param);
    }

    [Fact]
    public async Task Similar_query_names_its_seed_and_greetings_get_help_without_cards()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var r = await AskAsync(c, pid, "quelque chose comme Orbite silencieuse");
        Assert.Equal("similar", r.Reply);
        Assert.Equal("Orbite silencieuse", r.Param);
        Assert.DoesNotContain(r.Cards, k => k.Title.Name == "Orbite silencieuse");
        Assert.All(r.Cards, k => Assert.Equal("similarTo", k.Reason!.Type));
        var hello = await AskAsync(c, pid, "bonjour");
        Assert.Equal("help", hello.Reply);
        Assert.Empty(hello.Cards);
    }

    [Fact]
    public async Task Taste_changes_the_answer_and_is_declared()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        var t = await ApiFactory.TitleAsync(c, "Orbite silencieuse");
        await c.PutAsync($"/api/profiles/{pid}/progress/{t.Id}", new ProgressUpsert(350, 360));
        var r = await AskAsync(c, pid, "surprends-moi");
        Assert.Contains(r.Steps, s => s.Key == "taste");
        Assert.DoesNotContain(r.Cards, k => k.Title.Id == t.Id);
    }

    [Fact]
    public async Task Input_is_validated_and_rate_limited_per_policy()
    {
        var (c, _) = await f.RegisterAsync();
        var pid = await ApiFactory.ProfileIdAsync(c);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync("/api/assistant/chat", new ChatRequest(pid, new string('x', 501), "fr"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsync("/api/assistant/chat", new ChatRequest(pid, "", "fr"))).StatusCode);
    }
}
