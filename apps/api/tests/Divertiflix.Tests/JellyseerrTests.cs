using System.Net;
using System.Text;
using System.Text.Json;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Divertiflix.Domain;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Tests;

/// <summary>Faux Jellyseerr 2.7 : mêmes routes et mêmes formes que l'API réelle (relevées dans sa documentation), clé exigée.</summary>
internal sealed class FakeSeerr : HttpMessageHandler
{
    public const string Key = "test-seerr-key";
    public static int DuneStatus = 2;   // disponibilité du film « Dune » (2021) : 2 en attente, 5 disponible
    public static readonly List<string> Posted = [];

    private static HttpResponseMessage Json(string body, HttpStatusCode code = HttpStatusCode.OK) =>
        new(code) { Content = new StringContent(body, Encoding.UTF8, "application/json") };

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        if (!request.Headers.TryGetValues("X-Api-Key", out var k) || k.Single() != Key) return new HttpResponseMessage(HttpStatusCode.Unauthorized);
        var path = request.RequestUri!.AbsolutePath;
        var query = Uri.UnescapeDataString(request.RequestUri.Query);
        switch (request.Method.Method, path)
        {
            case ("GET", "/api/v1/search") when query.Contains("query=Dune&"):
                return Json("""
                    {"page":1,"totalPages":1,"totalResults":4,"results":[
                      {"id":90228,"mediaType":"tv","name":"Dune: Prophecy","firstAirDate":"2024-11-17"},
                      {"id":841,"mediaType":"movie","title":"Dune","originalTitle":"Dune","releaseDate":"1984-12-14"},
                      {"id":438631,"mediaType":"movie","title":"Dune","originalTitle":"Dune","releaseDate":"2021-09-15"},
                      {"id":1,"mediaType":"person","name":"Denis Villeneuve"}
                    ]}
                    """);
            case ("GET", "/api/v1/search") when query.Contains("query=The Lord of the Rings"):
                return Json("""{"results":[{"id":120,"mediaType":"movie","title":"Le Seigneur des anneaux : La Communauté de l'anneau","originalTitle":"The Lord of the Rings: The Fellowship of the Ring","releaseDate":"2001-12-18","mediaInfo":{"id":9,"tmdbId":120,"status":5}}]}""");
            case ("GET", "/api/v1/search"):
                return Json("""{"page":1,"totalPages":0,"totalResults":0,"results":[]}""");
            case ("POST", "/api/v1/request"):
                var body = await request.Content!.ReadAsStringAsync(ct);
                lock (Posted) Posted.Add(body);
                return Json("""{"id":77,"status":2,"media":{"id":3,"tmdbId":438631,"status":2}}""", HttpStatusCode.Created);
            case ("GET", "/api/v1/movie/438631"):
                return Json("{\"id\":438631,\"title\":\"Dune\",\"mediaInfo\":{\"id\":3,\"tmdbId\":438631,\"status\":" + DuneStatus + "}}");
            case ("GET", "/api/v1/request/77"):
                return Json("""{"id":77,"status":2}""");
        }
        return new HttpResponseMessage(HttpStatusCode.NotFound);
    }
}

public class SeerrFactory : ApiFactory
{
    protected override Dictionary<string, string> Settings => new(base.Settings)
    {
        ["Jellyseerr:Url"] = "https://jellyseerr.test",
        ["Jellyseerr:ApiKey"] = FakeSeerr.Key,
        ["Jellyseerr:SyncMinutes"] = "600",   // pas de passage de fond pendant le test : il les déclenche lui-même
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s => s.AddHttpClient<JellyseerrClient>().ConfigurePrimaryHttpMessageHandler(() => new FakeSeerr()));
    }
}

public class JellyseerrTests(SeerrFactory f) : IClassFixture<SeerrFactory>
{
    private async Task<(HttpClient User, Guid Id)> ApprovedRequestAsync(string name, int? year, TitleKind kind = TitleKind.Movie)
    {
        var (user, _) = await f.RegisterAsync();
        var created = (await (await user.PostAsync("/api/requests", new RequestCreate(name, kind, year, null, null))).Content.ReadAsync<JsonElement>());
        var id = created.GetProperty("id").GetGuid();
        var (admin, _) = await f.LoginAdminAsync();
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsync($"/api/admin/requests/{id}", new RequestStatusUpdate(RequestStatus.Approved, null, null))).StatusCode);
        return (user, id);
    }

    private async Task<AdminRequestDto> AdminViewAsync(Guid id)
    {
        var (admin, _) = await f.LoginAdminAsync();
        return (await admin.GetAsync<List<AdminRequestDto>>("/api/admin/requests"))!.Single(r => r.Id == id);
    }

    private Task SyncAsync() => f.Services.GetRequiredService<JellyseerrSync>().RunOnceAsync(CancellationToken.None);

    [Fact]
    public async Task An_approved_movie_goes_to_jellyseerr_then_becomes_available_and_the_requester_is_told()
    {
        FakeSeerr.DuneStatus = 2;
        var (user, id) = await ApprovedRequestAsync("Dune", 2021);
        await SyncAsync();

        // Le bon film (2021, pas 1984 ni la série), transmis avec la clé ; la demande passe en téléchargement.
        lock (FakeSeerr.Posted) Assert.Contains("""{"mediaType":"movie","mediaId":438631}""", FakeSeerr.Posted);
        var sent = await AdminViewAsync(id);
        Assert.Equal((RequestStatus.Downloading, "sent"), (sent.Status, sent.SeerrState));
        Assert.Equal("Dune (2021) · TMDB 438631", sent.SeerrNote);

        // Pas encore disponible : rien ne bouge.
        await SyncAsync();
        Assert.Equal(RequestStatus.Downloading, (await AdminViewAsync(id)).Status);

        // Radarr a fini : disponible, et la personne est prévenue avec un lien vers Jellyfin.
        FakeSeerr.DuneStatus = 5;
        await SyncAsync();
        Assert.Equal(RequestStatus.Available, (await AdminViewAsync(id)).Status);
        var notes = (await user.GetAsync<NotificationsDto>("/api/notifications"))!.Items;
        var available = notes.Single(n => n.Kind == "request.available");
        Assert.Equal(("Dune", "Disponible sur Jellyfin.", "https://jellyfin.home.arpa/"), (available.Title, available.Body, available.Link));
        Assert.Contains(notes, n => n.Kind == "request.downloading");
    }

    [Fact]
    public async Task A_title_already_in_the_library_is_available_at_once_and_an_unknown_one_is_left_for_a_human()
    {
        var (_, owned) = await ApprovedRequestAsync("The Lord of the Rings: The Fellowship of the Ring", 2001);
        var (_, unknown) = await ApprovedRequestAsync("Un film qui n'existe pas", 2030);
        await SyncAsync();

        var o = await AdminViewAsync(owned);
        Assert.Equal(RequestStatus.Available, o.Status);   // titre original reconnu, déjà disponible : rien à demander
        var u = await AdminViewAsync(unknown);
        Assert.Equal((RequestStatus.Approved, "notfound"), (u.Status, u.SeerrState));
        Assert.Equal("Introuvable dans Jellyseerr : à traiter à la main.", u.SeerrNote);

        // « Introuvable » est définitif : pas de nouvelle recherche à chaque passage.
        await SyncAsync();
        Assert.Equal("notfound", (await AdminViewAsync(unknown)).SeerrState);
    }

    [Fact]
    public void The_right_result_is_picked_or_none_rather_than_a_wrong_download()
    {
        SeerrResult R(int id, string type, string title, int? year, string? original = null) => new(id, type, title, original, year, null);
        var results = new[] { R(90228, "tv", "Dune: Prophecy", 2024), R(841, "movie", "Dune", 1984), R(438631, "movie", "Dune", 2021) };

        Assert.Equal(438631, JellyseerrClient.Pick(results, TitleKind.Movie, "Dune", 2021)!.TmdbId);
        Assert.Equal(438631, JellyseerrClient.Pick(results, TitleKind.Movie, "dune", 2022)!.TmdbId);    // un an d'écart toléré
        Assert.Equal(90228, JellyseerrClient.Pick(results, TitleKind.Series, "Dune: Prophecy", null)!.TmdbId);
        Assert.Null(JellyseerrClient.Pick(results, TitleKind.Movie, "Dune", 1999));                    // mauvaise année : rien
        Assert.Equal(841, JellyseerrClient.Pick(results, TitleKind.Movie, "Dune", null)!.TmdbId);       // sans année : le premier film au bon titre
        Assert.Equal(1, JellyseerrClient.Pick([R(1, "movie", "Le Fabuleux Destin d'Amélie Poulain", 2001)], TitleKind.Movie, "le fabuleux destin d’amelie poulain", 2001)!.TmdbId);
    }
}
