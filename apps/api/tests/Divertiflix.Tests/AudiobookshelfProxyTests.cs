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

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var uri = request.RequestUri!;
        lock (calls) calls.Add($"{request.Method} {uri.AbsolutePath} {request.Headers.Authorization}");

        static HttpResponseMessage Json(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        static HttpResponseMessage Bytes(string type, byte[] body) { var r = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(body) }; r.Content.Headers.ContentType = new(type); return r; }

        var response = (request.Method.Method, uri.AbsolutePath) switch
        {
            ("GET", "/api/libraries") => Json("""{"libraries":[{"id":"lib1","mediaType":"book"},{"id":"pod1","mediaType":"podcast"}]}"""),
            ("GET", "/api/libraries/lib1/items") => Json(Items),
            ("POST", "/api/items/it1/play") => Json("""{"id":"sess1","audioTracks":[{"contentUrl":"/hls/sess1/output.m3u8"}]}"""),
            ("POST", "/api/items/broken/play") => new HttpResponseMessage(HttpStatusCode.InternalServerError),
            ("POST", "/api/session/sess1/close") => Json("{}"),
            ("GET", "/hls/sess1/output.m3u8") => Bytes("application/vnd.apple.mpegurl", Encoding.UTF8.GetBytes("#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\n/hls/sess1/output-0.ts\n#EXT-X-ENDLIST\n")),
            ("GET", "/hls/sess1/output-0.ts") => Bytes("video/mp2t", [1, 2, 3, 4]),
            ("GET", "/api/items/it1/cover") => Bytes("image/webp", [9, 9, 9]),
            _ => new HttpResponseMessage(HttpStatusCode.NotFound),
        };
        return Task.FromResult(response);
    }
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
            Assert.All(f.Calls, c => Assert.EndsWith("Bearer abs-secret", c));
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
}
