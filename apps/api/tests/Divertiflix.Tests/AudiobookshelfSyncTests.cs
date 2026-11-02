using System.Net;
using System.Net.Http.Json;
using Divertiflix.Api.Dtos;
using Divertiflix.Domain;

namespace Divertiflix.Tests;

public class AudiobookshelfSyncTests(ApiFactory f) : IClassFixture<ApiFactory>
{
    private static HttpRequestMessage Req(string key, AudiobookshelfSyncRequest body)
    {
        var msg = new HttpRequestMessage(HttpMethod.Post, "/api/admin/audiobookshelf-sync") { Content = JsonContent.Create(body, options: Json.Options) };
        if (key.Length > 0) msg.Headers.Add("X-Sync-Key", key);
        return msg;
    }

    [Fact]
    public async Task Missing_key_is_unauthorized()
    {
        var res = await f.CreateClient().SendAsync(Req("", new AudiobookshelfSyncRequest([])));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Creates_then_updates_audiobook_without_duplicates_and_plays_it_in_the_portal()
    {
        var externalId = $"abs-{Guid.NewGuid():N}";
        var item = new AudiobookItemDto(externalId, "Le Petit Prince", "Un aviateur en panne dans le désert.", "Antoine de Saint-Exupéry", "Narrateur Test", 120, $"https://audiobookshelf.local/api/items/{externalId}/cover", "https://audiobookshelf.local/item/abc", "Jeunesse");

        // Le même identifiant deux fois dans un lot : une seule ligne.
        var created = await f.CreateClient().SendAsync(Req(ApiFactory.SyncKey, new AudiobookshelfSyncRequest([item, item with { Name = "Le Petit Prince (v2)" }])));
        Assert.Equal(HttpStatusCode.OK, created.StatusCode);
        Assert.Equal(1, (await created.Content.ReadAsync<AudiobookshelfSyncResult>())!.Created);

        var (client, _) = await f.RegisterAsync();
        var list = (await client.GetAsync<PagedResult<TitleDto>>("/api/titles?q=Petit Prince&kind=Audiobook"))!;
        var dto = Assert.Single(list.Items);
        Assert.Equal(TitleKind.Audiobook, dto.Kind);
        Assert.Equal("Antoine de Saint-Exupéry", dto.Author);
        // Même si le script pousse un lien vers la page web d'Audiobookshelf, le livre s'écoute dans le lecteur du portail.
        Assert.Equal(StreamKind.Audio, dto.StreamKind);
        Assert.Equal($"/api/media/abs/cover/{externalId}", dto.PosterUrl);

        var renamed = item with { Name = "Le Petit Prince (édition révisée)" };
        var updated = await f.CreateClient().SendAsync(Req(ApiFactory.SyncKey, new AudiobookshelfSyncRequest([renamed])));
        Assert.Equal(1, (await updated.Content.ReadAsync<AudiobookshelfSyncResult>())!.Updated);
        var listAfter = (await client.GetAsync<PagedResult<TitleDto>>("/api/titles?q=Petit Prince&kind=Audiobook&pageSize=100"))!;
        Assert.Single(listAfter.Items, t => t.Name == "Le Petit Prince (édition révisée)");
        Assert.Single(listAfter.Items);   // pas de doublon
    }
}
