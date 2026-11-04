using System.Net;
using System.Text;
using Divertiflix.Api.Dtos;
using Divertiflix.Api.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace Divertiflix.Tests;

/// <summary>Faux sites de presse : RSS, Atom, Google Actualités, un fil en panne, et des images (dont un SVG à refuser).</summary>
internal sealed class FakeFeeds : HttpMessageHandler
{
    private static string Rfc(double hoursAgo) => DateTime.UtcNow.AddHours(-hoursAgo).ToString("ddd, dd MMM yyyy HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture) + " +0000";
    private static string Iso(double hoursAgo) => DateTime.UtcNow.AddHours(-hoursAgo).ToString("yyyy-MM-ddTHH:mm:ss") + "+00:00";

    private static HttpResponseMessage Xml(string body) => new(HttpStatusCode.OK) { Content = new StringContent(body, Encoding.UTF8, "application/rss+xml") };

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        var uri = request.RequestUri!;
        var res = uri.Host switch
        {
            "techcrunch.com" => Xml($"""
                <?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
                <item><title>OpenAI ships a new model &amp; more</title><link>https://techcrunch.com/a1</link><pubDate>{Rfc(1)}</pubDate>
                  <description><![CDATA[<p>A <b>big</b> launch.<script>alert(1)</script></p>]]></description>
                  <content:encoded><![CDATA[<img src="https://techcrunch.com/img/a1.jpg"/> Corps]]></content:encoded></item>
                <item><title>Old story</title><link>https://techcrunch.com/old</link><pubDate>{Rfc(100)}</pubDate></item>
                <item><title>Pas de lien</title><link>javascript:alert(1)</link><pubDate>{Rfc(2)}</pubDate></item>
                </channel></rss>
                """),
            "www.theverge.com" => Xml($"""
                <?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
                <entry><title>Robots learn to fold laundry</title><link rel="alternate" href="https://www.theverge.com/b1"/><published>{Iso(3)}</published>
                  <summary type="html">&lt;p&gt;Folding.&lt;/p&gt;</summary></entry>
                <entry><title>OpenAI ships a new model &amp; more</title><link href="https://www.theverge.com/dup"/><published>{Iso(5)}</published></entry>
                </feed>
                """),
            "news.google.com" => Xml($"""
                <?xml version="1.0"?><rss version="2.0"><channel>
                <item><title>L'IA au Québec - Le Devoir</title><link>https://news.google.com/rss/articles/xyz</link><pubDate>{Rfc(0.5)}</pubDate>
                  <description>&lt;a href="x"&gt;liens&lt;/a&gt;</description><source url="https://www.ledevoir.com">Le Devoir</source></item>
                </channel></rss>
                """),
            "www.journaldugeek.com" => Xml($"""
                <?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
                <item><title>Une IA française</title><link>https://www.journaldugeek.com/c1</link><pubDate>{Rfc(48)}</pubDate>
                  <media:content url="https://www.journaldugeek.com/img/logo.svg" medium="image"/></item>
                </channel></rss>
                """),
            "www.wired.com" => new HttpResponseMessage(HttpStatusCode.InternalServerError),
            _ => Xml("<rss version=\"2.0\"><channel></channel></rss>"),
        };
        // Images : celle de TechCrunch est une vraie image, le « logo » du Journal du Geek un SVG (refusé par le relais).
        if (uri.AbsolutePath.StartsWith("/img/", StringComparison.Ordinal))
        {
            var svg = uri.AbsolutePath.EndsWith(".svg", StringComparison.Ordinal);
            res = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(svg ? "<svg/>"u8.ToArray() : [0x89, 0x50, 0x4E, 0x47]) };
            res.Content.Headers.ContentType = new(svg ? "image/svg+xml" : "image/png");
        }
        res.RequestMessage = request;
        return Task.FromResult(res);
    }
}

public class NewsFactory : ApiFactory
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(s => s.AddHttpClient<AiNews>().ConfigurePrimaryHttpMessageHandler(() => new FakeFeeds()));
    }
}

public class AiNewsTests(NewsFactory f) : IClassFixture<NewsFactory>
{
    [Fact]
    public async Task Ai_news_gathers_feeds_as_plain_text_newest_first_without_duplicates()
    {
        var (user, _) = await f.RegisterAsync();
        var news = (await user.GetAsync<AiNewsDto>("/api/news/ai"))!;

        // Journée creuse (moins de 12 articles en 24 h) : fenêtre élargie à 72 h ; l'article de 100 h et le lien javascript: sont écartés,
        // et le même titre repris par The Verge n'apparaît qu'une fois (le plus récent, TechCrunch).
        Assert.Equal(72, news.WindowHours);
        Assert.Equal(new[] { "L'IA au Québec", "OpenAI ships a new model & more", "Robots learn to fold laundry", "Une IA française" }, news.Items.Select(i => i.Title));

        var gn = news.Items[0];
        Assert.Equal("Le Devoir", gn.Source);   // média d'origine, retiré de la fin du titre
        Assert.Equal("fr", gn.Language);
        Assert.Null(gn.Summary);                // le résumé de Google Actualités n'est qu'une liste de liens

        var tc = news.Items[1];
        Assert.Equal("TechCrunch", tc.Source);
        Assert.Equal("A big launch.", tc.Summary);   // texte seul : balises et script retirés
        Assert.DoesNotContain("<", tc.Summary);
        Assert.StartsWith("/api/media/news/image/", tc.ImageUrl);

        Assert.Equal("Folding.", news.Items[2].Summary);   // résumé Atom encodé en HTML

        // Wired est en panne : signalé, sans empêcher le reste.
        Assert.False(news.Sources.Single(s => s.Name == "Wired").Ok);
        Assert.Equal(1, news.Sources.Single(s => s.Name == "TechCrunch").Count);

        // Image relayée par le portail ; un SVG venu d'un fil est refusé ; un identifiant inconnu n'ouvre rien.
        var anonymous = f.CreateClient();
        var img = await anonymous.GetAsync(tc.ImageUrl);
        Assert.Equal(HttpStatusCode.OK, img.StatusCode);
        Assert.Equal("image/png", img.Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.BadGateway, (await anonymous.GetAsync(news.Items[3].ImageUrl)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/media/news/image/0123456789abcdef01234567")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await anonymous.GetAsync("/api/media/news/image/https%3A%2F%2Fevil.example")).StatusCode);
    }

    [Fact]
    public async Task Ai_news_require_a_signed_in_user()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await f.CreateClient().GetAsync("/api/news/ai")).StatusCode);
    }
}
