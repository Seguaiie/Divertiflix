using System.Net;
using System.Text;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Media;
using Divertiflix.Api.Support;
using Divertiflix.Domain;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Tests;

/// <summary>Faux serveur Audiobookshelf : mêmes chemins que l'API réelle, et il note chaque appel avec son en-tête Authorization.</summary>
internal sealed class FakeAudiobookshelf(List<string> calls) : HttpMessageHandler
{
    private const string Items = """
        {"results":[
          {"id":"it1","media":{"coverPath":"/books/cover.jpg","duration":7200,"metadata":{"title":"Le Petit Prince","description":"<p>Un aviateur</p>","authorName":"Antoine de Saint-Exupéry","narratorName":"Narrateur Test","genres":["Jeunesse"]}}},
          {"id":"broken","media":{"duration":60,"metadata":{"title":"Livre cassé","authorName":"Inconnu"}}}
        ]}
        """;

    private int _lateSegmentCalls;

    /// <summary>Utilisateurs créés par l'API (nom → identifiant), et progression enregistrée par clé d'API.</summary>
    public static readonly Dictionary<string, string> Users = new(StringComparer.OrdinalIgnoreCase) { ["root"] = "root-id" };
    public static readonly Dictionary<string, string> ProgressByKey = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var uri = request.RequestUri!;
        var body = request.Content is null ? "" : await request.Content.ReadAsStringAsync(ct);
        var auth = request.Headers.Authorization?.ToString() ?? "";
        lock (calls) calls.Add($"{request.Method} {uri.AbsolutePath} {auth}");
        lock (Users)
        {
            switch (request.Method.Method, uri.AbsolutePath)
            {
                case ("GET", "/api/users"):
                    return Json("{\"users\":[" + string.Join(",", Users.Keys.Select(u => $"{{\"username\":\"{u}\"}}")) + "]}");
                case ("POST", "/api/users"):
                {
                    var name = System.Text.Json.JsonDocument.Parse(body).RootElement.GetProperty("username").GetString()!;
                    if (Users.ContainsKey(name)) return new HttpResponseMessage(HttpStatusCode.BadRequest) { Content = new StringContent("Username already taken") };
                    var id = $"absu{Users.Count}";
                    Users[name] = id;
                    return Json($"{{\"user\":{{\"id\":\"{id}\",\"username\":\"{name}\"}}}}");
                }
                case ("POST", "/api/api-keys"):
                {
                    var userId = System.Text.Json.JsonDocument.Parse(body).RootElement.GetProperty("userId").GetString();
                    return Json($"{{\"apiKey\":{{\"id\":\"k1\",\"apiKey\":\"user-key-{userId}\"}}}}");
                }
                case ("PATCH", "/api/me/progress/it1"):
                    ProgressByKey[auth] = body;
                    return Json("{}");
                case ("GET", "/api/me/progress/it1"):
                    return ProgressByKey.TryGetValue(auth, out var saved) ? Json(saved) : new HttpResponseMessage(HttpStatusCode.NotFound);
            }
        }

        static HttpResponseMessage Bytes(string type, byte[] body) { var r = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(body) }; r.Content.Headers.ContentType = new(type); return r; }

        var response = (request.Method.Method, uri.AbsolutePath) switch
        {
            ("GET", "/api/libraries") => Json("""{"libraries":[{"id":"lib1","mediaType":"book"},{"id":"pod1","mediaType":"podcast"}]}"""),
            ("GET", "/api/libraries/lib1/items") => Json(Items),
            ("POST", "/api/items/it1/play") => Json("""{"id":"sess1","audioTracks":[{"contentUrl":"/hls/sess1/output.m3u8"}],"chapters":[{"id":0,"start":0,"end":3600,"title":"Chapitre un"},{"id":1,"start":3600,"end":7200,"title":""}]}"""),
            ("POST", "/api/items/broken/play") => new HttpResponseMessage(HttpStatusCode.InternalServerError),
            ("POST", "/api/session/sess1/close") => Json("{}"),
            ("GET", "/hls/sess1/output.m3u8") => Bytes("application/vnd.apple.mpegurl", Encoding.UTF8.GetBytes("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\n/hls/sess1/output-0.ts\n#EXT-X-ENDLIST\n")),
            ("GET", "/hls/sess1/output-0.ts") => Bytes("video/mp2t", [1, 2, 3, 4]),
            // Segment pas encore transcodé : 404 aux deux premiers appels, puis prêt (comme Audiobookshelf juste après un saut).
            ("GET", "/hls/sess1/output-7.ts") => Interlocked.Increment(ref _lateSegmentCalls) <= 2 ? new HttpResponseMessage(HttpStatusCode.NotFound) : Bytes("video/mp2t", [7]),
            ("GET", "/api/items/it1/cover") => Bytes("image/webp", [9, 9, 9]),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound),
        };
        return response;
    }

    private static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
}

/// <summary>API réelle dont le client Audiobookshelf parle à <see cref="FakeAudiobookshelf"/> au lieu du réseau.</summary>
public class AbsFactory : ApiFactory
{
    public List<string> Calls { get; } = [];

    protected override Dictionary<string, string> Settings => new(base.Settings)
    {
        ["Audiobookshelf:Url"] = "http://abs.test:13378",
        ["Audiobookshelf:Token"] = "abs-secret",
        ["Audiobookshelf:SyncMinutes"] = "0",   // pas de synchronisation de fond : les tests déclenchent la leur
    };

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s => s.AddHttpClient<AudiobookshelfClient>().ConfigurePrimaryHttpMessageHandler(() => new FakeAudiobookshelf(Calls)));
    }
}

public class AudiobookshelfProxyTests(AbsFactory f) : IClassFixture<AbsFactory>
{
    private async Task ImportAsync()
    {
        var (admin, _) = await f.LoginAdminAsync();
        var res = await admin.PostAsync("/api/admin/audiobookshelf-sync/run", new { });
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var result = (await res.Content.ReadAsync<AudiobookshelfSyncResult>())!;
        Assert.Equal(2, result.Created + result.Updated);   // les deux livres de « lib1 », rien du balado
    }

    [Fact]
    public async Task Admin_run_imports_books_but_not_podcasts_and_never_exposes_the_token()
    {
        await ImportAsync();
        var (user, _) = await f.RegisterAsync();
        var book = await ApiFactory.TitleAsync(user, "Le Petit Prince");

        Assert.Equal(TitleKind.Audiobook, book.Kind);
        Assert.Equal("Antoine de Saint-Exupéry", book.Author);
        Assert.Equal(120, book.DurationMinutes);
        Assert.Equal(StreamKind.Audio, book.StreamKind);   // le portail ouvre son lecteur audio
        Assert.Equal("/api/media/abs/cover/it1", book.PosterUrl);
        Assert.Equal("Un aviateur", book.Synopsis.Trim());   // balises HTML retirées

        lock (f.Calls)
        {
            Assert.DoesNotContain(f.Calls, c => c.Contains("/pod1/"));
            Assert.All(f.Calls.Where(c => c.Contains("/api/libraries")), c => Assert.EndsWith("Bearer abs-secret", c));
        }
    }

    [Fact]
    public async Task Admin_run_is_reserved_to_admins()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().PostAsync("/api/admin/audiobookshelf-sync/run", new { })).StatusCode);
        var (user, _) = await f.RegisterAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await user.PostAsync("/api/admin/audiobookshelf-sync/run", new { })).StatusCode);
    }

    [Fact]
    public async Task Playback_serves_one_continuous_hls_stream_through_the_api()
    {
        await ImportAsync();
        var (user, _) = await f.RegisterAsync();
        var book = await ApiFactory.TitleAsync(user, "Le Petit Prince");

        var pb = (await user.GetAsync<PlaybackDto>($"/api/titles/{book.Id}/playback"))!;
        Assert.Equal(StreamKind.Hls, pb.Kind);
        Assert.StartsWith("/api/media/abs/hls/", pb.Url);
        Assert.EndsWith("/sess1/output.m3u8", pb.Url);
        Assert.DoesNotContain("abs.test", pb.Url);   // jamais l'adresse d'Audiobookshelf

        // Les chapitres d'Audiobookshelf arrivent au portail ; un titre vide devient « Chapitre n ».
        Assert.Equal(new[] { "Chapitre un", "Chapitre 2" }, pb.Chapters!.Select(c => c.Title));
        Assert.Equal(3600, pb.Chapters![1].StartSeconds);

        // L'URL est signée : elle se lit sans en-tête d'autorisation, comme les médias du catalogue.
        var anonymous = f.CreateClient();
        var playlist = await anonymous.GetAsync(pb.Url);
        Assert.Equal(HttpStatusCode.OK, playlist.StatusCode);
        Assert.Equal("application/vnd.apple.mpegurl", playlist.Content.Headers.ContentType?.MediaType);
        var text = await playlist.Content.ReadAsStringAsync();
        Assert.Contains("\noutput-0.ts\n", text);   // segment relatif : il hérite du jeton
        Assert.DoesNotContain("/hls/", text);
        Assert.DoesNotContain("abs-secret", text);

        var segment = await anonymous.GetAsync(pb.Url.Replace("output.m3u8", "output-0.ts"));
        Assert.Equal(HttpStatusCode.OK, segment.StatusCode);
        Assert.Equal(new byte[] { 1, 2, 3, 4 }, await segment.Content.ReadAsByteArrayAsync());
    }

    [Fact]
    public async Task A_segment_not_yet_transcoded_is_awaited_and_a_missing_one_is_retryable_for_the_player()
    {
        await ImportAsync();
        var (user, _) = await f.RegisterAsync();
        var book = await ApiFactory.TitleAsync(user, "Le Petit Prince");
        var pb = (await user.GetAsync<PlaybackDto>($"/api/titles/{book.Id}/playback"))!;
        var anonymous = f.CreateClient();

        // Prêt au troisième essai : le relais patiente au lieu de renvoyer le 404 qui arrêterait hls.js.
        var late = await anonymous.GetAsync(pb.Url.Replace("output.m3u8", "output-7.ts"));
        Assert.Equal(HttpStatusCode.OK, late.StatusCode);
        Assert.Equal(new byte[] { 7 }, await late.Content.ReadAsByteArrayAsync());

        // Toujours absent : 503 (hls.js réessaie), pas 404.
        var missing = await anonymous.GetAsync(pb.Url.Replace("output.m3u8", "output-99.ts"));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, missing.StatusCode);
    }

    [Fact]
    public async Task Hls_relay_rejects_forged_tokens_and_unknown_sessions_or_files()
    {
        await ImportAsync();
        var (user, _) = await f.RegisterAsync();
        var book = await ApiFactory.TitleAsync(user, "Le Petit Prince");
        var pb = (await user.GetAsync<PlaybackDto>($"/api/titles/{book.Id}/playback"))!;
        var token = pb.Url.Split('/')[5];
        var anonymous = f.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/media/abs/hls/forged.token.value/sess1/output.m3u8")).StatusCode);
        // Le jeton est lié à la session : il n'ouvre pas une autre session, même valide côté Audiobookshelf.
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/media/abs/hls/{token}/sess2/output.m3u8")).StatusCode);
        // Seuls les fichiers de flux passent (listes et segments), pas une autre extension.
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync($"/api/media/abs/hls/{token}/sess1/secret.json")).StatusCode);
    }

    [Fact]
    public async Task Playback_answers_bad_gateway_when_audiobookshelf_fails()
    {
        await ImportAsync();
        var (user, _) = await f.RegisterAsync();
        var broken = await ApiFactory.TitleAsync(user, "Livre cassé");
        Assert.Equal(HttpStatusCode.BadGateway, (await user.GetAsync($"/api/titles/{broken.Id}/playback")).StatusCode);
    }

    [Fact]
    public async Task Cover_is_relayed_only_for_books_in_the_catalog()
    {
        await ImportAsync();
        var anonymous = f.CreateClient();
        var cover = await anonymous.GetAsync("/api/media/abs/cover/it1");
        Assert.Equal(HttpStatusCode.OK, cover.StatusCode);
        Assert.Equal("image/webp", cover.Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/media/abs/cover/not-in-catalog")).StatusCode);
    }

    [Theory]
    [InlineData("abs:li_abc-123", true)]
    [InlineData("abs:", false)]
    [InlineData("abs:../etc/passwd", false)]
    [InlineData("abs:a/b", false)]
    [InlineData("abs:a b", false)]
    public void Safe_url_accepts_abs_prefix_only_with_a_plain_identifier(string url, bool expected) =>
        Assert.Equal(expected, SafeUrl.IsAllowed(url));

    [Fact]
    public async Task A_new_account_gets_its_own_audiobookshelf_user_and_its_progress_is_saved_there()
    {
        await ImportAsync();
        var email = $"lecteur{Guid.NewGuid():N}@test.com";
        var (user, _) = await f.RegisterAsync(email);

        // Inscription : utilisateur Audiobookshelf au nom du courriel, puis clé d'API à son nom (créés par le compte de service).
        string absId;
        lock (FakeAudiobookshelf.Users) absId = FakeAudiobookshelf.Users[email];
        var key = $"Bearer user-key-{absId}";
        lock (f.Calls)
        {
            Assert.Contains(f.Calls, c => c == "POST /api/users Bearer abs-secret");
            Assert.Contains(f.Calls, c => c == "POST /api/api-keys Bearer abs-secret");
        }

        // L'écoute s'ouvre au nom de cet utilisateur, et les segments passent par sa clé.
        var book = await ApiFactory.TitleAsync(user, "Le Petit Prince");
        var pb = (await user.GetAsync<PlaybackDto>($"/api/titles/{book.Id}/playback"))!;
        Assert.Equal(HttpStatusCode.OK, (await f.CreateClient().GetAsync(pb.Url.Replace("output.m3u8", "output-0.ts"))).StatusCode);
        lock (f.Calls)
        {
            Assert.Contains(f.Calls, c => c == $"POST /api/items/it1/play {key}");
            Assert.Contains(f.Calls, c => c == $"GET /hls/sess1/output-0.ts {key}");
        }

        // La position enregistrée par le portail est recopiée dans Audiobookshelf, au nom de la personne.
        var profile = await ApiFactory.ProfileIdAsync(user);
        Assert.Equal(HttpStatusCode.NoContent, (await user.PutAsync($"/api/profiles/{profile}/progress/{book.Id}", new { positionSeconds = 1800, durationSeconds = 7200 })).StatusCode);
        string saved;
        lock (FakeAudiobookshelf.Users) saved = FakeAudiobookshelf.ProgressByKey[key];
        Assert.Contains("\"currentTime\":1800", saved);

        // Un livre jamais écouté sur le portail reprend là où la personne s'est arrêtée dans Audiobookshelf.
        var (other, _) = await f.RegisterAsync();
        string otherKey;
        lock (FakeAudiobookshelf.Users) otherKey = $"Bearer user-key-{FakeAudiobookshelf.Users.Values.Last()}";
        Assert.NotEqual(key, otherKey);   // chaque compte a son propre utilisateur
        lock (FakeAudiobookshelf.Users) FakeAudiobookshelf.ProgressByKey[otherKey] = """{"currentTime":4000,"duration":7200,"isFinished":false}""";
        var otherPb = (await other.GetAsync<PlaybackDto>($"/api/titles/{book.Id}/playback?profileId={await ApiFactory.ProfileIdAsync(other)}"))!;
        Assert.Equal(4000, otherPb.StartSeconds);
    }
}
