using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Divertiflix.Tests;

/// <summary>Mêmes options que l'API : enums en chaînes, camelCase.</summary>
public static class Json
{
    public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    public static Task<T?> ReadAsync<T>(this HttpContent c) => c.ReadFromJsonAsync<T>(Options);
    public static Task<T?> GetAsync<T>(this HttpClient c, string url) => c.GetFromJsonAsync<T>(url, Options);
    public static Task<HttpResponseMessage> PostAsync<T>(this HttpClient c, string url, T body) => c.PostAsJsonAsync(url, body, Options);
    public static Task<HttpResponseMessage> PutAsync<T>(this HttpClient c, string url, T body) => c.PutAsJsonAsync(url, body, Options);
}
